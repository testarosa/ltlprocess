import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import sql from "mssql/msnodesqlv8.js";
import type { QuoteRequestInput } from "@tms/shared";
import { config } from "./config.js";
import { closeDatabase, getSqlPool, initializeDatabase } from "./db.js";

type LegacyRow = Record<string, unknown>;

function argumentValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function requiredDate(value: unknown, field: string): Date {
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) throw new Error(`Invalid ${field} timestamp: ${String(value)}`);
  return date;
}

function nullableDate(value: unknown): Date | null {
  if (value === null || value === undefined || value === "") return null;
  return requiredDate(value, "legacy");
}

function fallbackPayload(row: LegacyRow): QuoteRequestInput {
  return {
    requestedDate: String(row.shipment_date),
    requestedFrom: "",
    commodity: "",
    pickupLocation: { zipCode: "", city: String(row.origin), state: "", country: "US" },
    deliveryLocation: { zipCode: "", city: String(row.destination), state: "", country: "US" },
    dimensions: {
      handlingUnit: "Pallet",
      length: 0,
      width: 0,
      height: 0,
      dimensionUnit: "in",
      quantity: 1,
      weight: Number(row.weight_lbs),
      weightUnit: "lb",
      freightClass: "",
      hazmat: false,
      stackable: false
    },
    specialServices: { general: [], pickup: [], delivery: [], overLength: [] }
  };
}

async function migrate(): Promise<void> {
  const sourceArgument = argumentValue("--file") ?? config.legacySqliteFile;
  if (!sourceArgument) {
    throw new Error("Provide the SQLite database with --file <path> or LEGACY_SQLITE_FILE.");
  }

  const repositoryRoot = fileURLToPath(new URL("../../../", import.meta.url));
  const sourceFile = resolve(repositoryRoot, sourceArgument);
  if (!existsSync(sourceFile)) throw new Error(`SQLite database not found: ${sourceFile}`);

  const legacy = new DatabaseSync(sourceFile, { readOnly: true });
  try {
    const quoteColumns = legacy.prepare("PRAGMA table_info(quote_requests)").all() as Array<{ name: string }>;
    if (quoteColumns.length === 0) throw new Error("SQLite database does not contain quote_requests.");

    const quotes = legacy.prepare("SELECT * FROM quote_requests ORDER BY created_at, id").all() as LegacyRow[];
    const carrierQuotes = legacy.prepare("SELECT * FROM carrier_quotes ORDER BY requested_at, id").all() as LegacyRow[];
    const hasSequences = (
      legacy.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table' AND name = 'quote_number_sequences'")
        .get() as { count: number }
    ).count > 0;
    const sequences = hasSequences
      ? (legacy.prepare("SELECT year, last_number FROM quote_number_sequences").all() as LegacyRow[])
      : [];

    await initializeDatabase();
    const pool = await getSqlPool();
    const transaction = new sql.Transaction(pool);
    await transaction.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
    let insertedQuotes = 0;
    let insertedCarrierQuotes = 0;

    try {
      for (const row of quotes) {
        const payload = row.request_payload ? String(row.request_payload) : JSON.stringify(fallbackPayload(row));
        const result = await new sql.Request(transaction)
          .input("id", sql.NVarChar(50), String(row.id))
          .input("operatorName", sql.NVarChar(200), String(row.operator_name))
          .input("origin", sql.NVarChar(300), String(row.origin))
          .input("destination", sql.NVarChar(300), String(row.destination))
          .input("shipmentDate", sql.VarChar(10), String(row.shipment_date))
          .input("weightLbs", sql.Decimal(18, 2), Number(row.weight_lbs))
          .input("requestPayload", sql.NVarChar(sql.MAX), payload)
          .input("status", sql.VarChar(20), String(row.status))
          .input("createdAt", sql.DateTime2(3), requiredDate(row.created_at, "created_at"))
          .input("updatedAt", sql.DateTime2(3), requiredDate(row.updated_at, "updated_at"))
          .query(`
            IF NOT EXISTS (SELECT 1 FROM dbo.quote_requests WITH (UPDLOCK, HOLDLOCK) WHERE id = @id)
            BEGIN
              INSERT dbo.quote_requests (
                id, operator_name, origin, destination, shipment_date, weight_lbs,
                request_payload, status, created_at, updated_at
              ) VALUES (
                @id, @operatorName, @origin, @destination, @shipmentDate, @weightLbs,
                @requestPayload, @status, @createdAt, @updatedAt
              );
            END;
          `);
        insertedQuotes += result.rowsAffected.reduce((sum, count) => sum + count, 0);
      }

      for (const row of carrierQuotes) {
        const result = await new sql.Request(transaction)
          .input("id", sql.UniqueIdentifier, String(row.id))
          .input("quoteRequestId", sql.NVarChar(50), String(row.quote_request_id))
          .input("carrierKey", sql.NVarChar(300), String(row.carrier_key))
          .input("carrierName", sql.NVarChar(300), String(row.carrier_name))
          .input("status", sql.VarChar(20), String(row.status))
          .input("rateAmount", sql.Decimal(18, 2), row.rate_amount === null ? null : Number(row.rate_amount))
          .input("currency", sql.VarChar(10), row.currency === null ? null : String(row.currency))
          .input("serviceLevel", sql.NVarChar(300), row.service_level === null ? null : String(row.service_level))
          .input("transitDays", sql.Int, row.transit_days === null ? null : Number(row.transit_days))
          .input("rawResponse", sql.NVarChar(sql.MAX), row.raw_response === null ? null : String(row.raw_response))
          .input("errorMessage", sql.NVarChar(sql.MAX), row.error_message === null ? null : String(row.error_message))
          .input("requestedAt", sql.DateTime2(3), requiredDate(row.requested_at, "requested_at"))
          .input("respondedAt", sql.DateTime2(3), nullableDate(row.responded_at))
          .input("updatedAt", sql.DateTime2(3), requiredDate(row.updated_at, "updated_at"))
          .query(`
            IF NOT EXISTS (SELECT 1 FROM dbo.carrier_quotes WITH (UPDLOCK, HOLDLOCK) WHERE id = @id)
            BEGIN
              INSERT dbo.carrier_quotes (
                id, quote_request_id, carrier_key, carrier_name, status, rate_amount, currency,
                service_level, transit_days, raw_response, error_message, requested_at, responded_at, updated_at
              ) VALUES (
                @id, @quoteRequestId, @carrierKey, @carrierName, @status, @rateAmount, @currency,
                @serviceLevel, @transitDays, @rawResponse, @errorMessage, @requestedAt, @respondedAt, @updatedAt
              );
            END;
          `);
        insertedCarrierQuotes += result.rowsAffected.reduce((sum, count) => sum + count, 0);
      }

      const sequenceMaximums = new Map<number, number>();
      for (const row of sequences) sequenceMaximums.set(Number(row.year), Number(row.last_number));
      for (const row of quotes) {
        const match = /^Q-PLS-(\d{4})-(\d{6})$/.exec(String(row.id));
        if (!match) continue;
        const year = Number(match[1]);
        const number = Number(match[2]);
        sequenceMaximums.set(year, Math.max(sequenceMaximums.get(year) ?? 0, number));
      }

      for (const [year, lastNumber] of sequenceMaximums) {
        await new sql.Request(transaction)
          .input("year", sql.Int, year)
          .input("lastNumber", sql.Int, lastNumber)
          .query(`
            UPDATE dbo.quote_number_sequences WITH (UPDLOCK, HOLDLOCK)
            SET last_number = CASE WHEN last_number < @lastNumber THEN @lastNumber ELSE last_number END
            WHERE [year] = @year;
            IF @@ROWCOUNT = 0
              INSERT dbo.quote_number_sequences ([year], last_number) VALUES (@year, @lastNumber);
          `);
      }

      await transaction.commit();
      console.log(`SQLite migration complete: ${insertedQuotes} quote requests and ${insertedCarrierQuotes} carrier quotes inserted.`);
    } catch (error) {
      await transaction.rollback().catch(() => undefined);
      throw error;
    }
  } finally {
    legacy.close();
    await closeDatabase();
  }
}

void migrate().catch((error: unknown) => {
  const detail = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(`SQLite migration failed: ${detail}`);
  process.exitCode = 1;
});
