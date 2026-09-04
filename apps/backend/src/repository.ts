import crypto from "node:crypto";
import sql from "mssql/msnodesqlv8.js";
import type {
  CarrierQuoteRecord,
  CarrierQuoteStatus,
  QuoteRequestInput,
  QuoteRequestRecord,
  QuoteStatus,
  QuoteSummary
} from "@tms/shared";
import { getQuoteDimensions } from "@tms/shared";
import { getSqlPool } from "./db.js";
import { extractWwexCubicMinimumWarning } from "./wwex.js";

export interface CarrierQuoteUpdate {
  status: CarrierQuoteStatus;
  rateAmount: number | null;
  currency: string | null;
  serviceLevel: string | null;
  transitDays: number | null;
  rawResponse: string | null;
  errorMessage: string | null;
}

export interface ReplacementCarrierQuote extends CarrierQuoteUpdate {
  carrierKey: string;
  carrierName: string;
}

export interface QuoteRepository {
  createQuoteRequest(operatorName: string, input: QuoteRequestInput, carriers: { key: string; name: string }[]): Promise<string>;
  updateCarrierQuote(quoteRequestId: string, carrierKey: string, updates: CarrierQuoteUpdate): Promise<void>;
  replaceCarrierQuotes(quoteRequestId: string, sourceCarrierKey: string, quotes: ReplacementCarrierQuote[]): Promise<void>;
  updateQuoteStatus(quoteRequestId: string, status: QuoteStatus): Promise<void>;
  getQuoteRequestById(id: string): Promise<QuoteRequestRecord | null>;
  listQuoteRequests(): Promise<QuoteSummary[]>;
}

function formatLocationSummary(location: QuoteRequestInput["pickupLocation"]): string {
  const cityState = [location.city, location.state].filter(Boolean).join(", ");
  return [cityState, location.zipCode].filter(Boolean).join(" ").trim();
}

function toWeightLbs(input: QuoteRequestInput): number {
  const totalWeight = getQuoteDimensions(input).reduce((sum, dimension) => {
    const pounds = dimension.weightUnit.toLowerCase() === "kg" ? dimension.weight * 2.20462 : dimension.weight;
    return sum + pounds;
  }, 0);
  return Math.round(totalWeight * 100) / 100;
}

function toIsoString(value: unknown): string {
  return value instanceof Date ? value.toISOString() : new Date(String(value)).toISOString();
}

function mapCarrierQuote(row: Record<string, unknown>): CarrierQuoteRecord {
  const carrierKey = String(row.carrier_key);
  const rawResponse = row.raw_response === null ? null : String(row.raw_response);
  return {
    id: String(row.id),
    carrierKey,
    carrierName: String(row.carrier_name),
    status: row.status as CarrierQuoteStatus,
    rateAmount: row.rate_amount === null ? null : Number(row.rate_amount),
    currency: row.currency === null ? null : String(row.currency),
    serviceLevel: row.service_level === null ? null : String(row.service_level),
    transitDays: row.transit_days === null ? null : Number(row.transit_days),
    errorMessage: row.error_message === null ? null : String(row.error_message),
    warningMessage: carrierKey.startsWith("wwex:") ? extractWwexCubicMinimumWarning(rawResponse) : null,
    requestedAt: toIsoString(row.requested_at),
    respondedAt: row.responded_at === null ? null : toIsoString(row.responded_at),
    updatedAt: toIsoString(row.updated_at)
  };
}

function requestPayload(row: Record<string, unknown>): QuoteRequestInput {
  return JSON.parse(String(row.request_payload)) as QuoteRequestInput;
}

export async function createQuoteRequest(
  operatorName: string,
  input: QuoteRequestInput,
  carriers: { key: string; name: string }[]
): Promise<string> {
  const pool = await getSqlPool();
  const transaction = new sql.Transaction(pool);
  const timestamp = new Date();
  const quoteYear = timestamp.getUTCFullYear();

  await transaction.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
  try {
    const sequenceResult = await new sql.Request(transaction)
      .input("year", sql.Int, quoteYear)
      .query<{ last_number: number }>(`
        UPDATE dbo.quote_number_sequences WITH (UPDLOCK, HOLDLOCK)
        SET last_number = last_number + 1
        OUTPUT inserted.last_number
        WHERE [year] = @year;
      `);

    let sequenceNumber = sequenceResult.recordset[0]?.last_number;
    if (sequenceNumber === undefined) {
      sequenceNumber = 1;
      await new sql.Request(transaction)
        .input("year", sql.Int, quoteYear)
        .input("lastNumber", sql.Int, sequenceNumber)
        .query(`INSERT dbo.quote_number_sequences ([year], last_number) VALUES (@year, @lastNumber);`);
    }

    const quoteRequestId = `Q-PLS-${quoteYear}-${String(sequenceNumber).padStart(6, "0")}`;
    await new sql.Request(transaction)
      .input("id", sql.NVarChar(50), quoteRequestId)
      .input("operatorName", sql.NVarChar(200), operatorName)
      .input("origin", sql.NVarChar(300), formatLocationSummary(input.pickupLocation))
      .input("destination", sql.NVarChar(300), formatLocationSummary(input.deliveryLocation))
      .input("shipmentDate", sql.VarChar(10), input.requestedDate)
      .input("weightLbs", sql.Decimal(18, 2), toWeightLbs(input))
      .input("requestPayload", sql.NVarChar(sql.MAX), JSON.stringify(input))
      .input("status", sql.VarChar(20), "processing")
      .input("timestamp", sql.DateTime2(3), timestamp)
      .query(`
        INSERT dbo.quote_requests (
          id, operator_name, origin, destination, shipment_date, weight_lbs,
          request_payload, status, created_at, updated_at
        ) VALUES (
          @id, @operatorName, @origin, @destination, @shipmentDate, @weightLbs,
          @requestPayload, @status, @timestamp, @timestamp
        );
      `);

    for (const carrier of carriers) {
      await new sql.Request(transaction)
        .input("id", sql.UniqueIdentifier, crypto.randomUUID())
        .input("quoteRequestId", sql.NVarChar(50), quoteRequestId)
        .input("carrierKey", sql.NVarChar(300), carrier.key)
        .input("carrierName", sql.NVarChar(300), carrier.name)
        .input("status", sql.VarChar(20), "pending")
        .input("timestamp", sql.DateTime2(3), timestamp)
        .query(`
          INSERT dbo.carrier_quotes (
            id, quote_request_id, carrier_key, carrier_name, status, requested_at, updated_at
          ) VALUES (
            @id, @quoteRequestId, @carrierKey, @carrierName, @status, @timestamp, @timestamp
          );
        `);
    }

    await transaction.commit();
    return quoteRequestId;
  } catch (error) {
    await transaction.rollback().catch(() => undefined);
    throw error;
  }
}

export async function updateCarrierQuote(
  quoteRequestId: string,
  carrierKey: string,
  updates: CarrierQuoteUpdate
): Promise<void> {
  const pool = await getSqlPool();
  const timestamp = new Date();
  await pool.request()
    .input("quoteRequestId", sql.NVarChar(50), quoteRequestId)
    .input("carrierKey", sql.NVarChar(300), carrierKey)
    .input("status", sql.VarChar(20), updates.status)
    .input("rateAmount", sql.Decimal(18, 2), updates.rateAmount)
    .input("currency", sql.VarChar(10), updates.currency)
    .input("serviceLevel", sql.NVarChar(300), updates.serviceLevel)
    .input("transitDays", sql.Int, updates.transitDays)
    .input("rawResponse", sql.NVarChar(sql.MAX), updates.rawResponse)
    .input("errorMessage", sql.NVarChar(sql.MAX), updates.errorMessage)
    .input("timestamp", sql.DateTime2(3), timestamp)
    .query(`
      UPDATE dbo.carrier_quotes
      SET status = @status,
          rate_amount = @rateAmount,
          currency = @currency,
          service_level = @serviceLevel,
          transit_days = @transitDays,
          raw_response = @rawResponse,
          error_message = @errorMessage,
          responded_at = @timestamp,
          updated_at = @timestamp
      WHERE quote_request_id = @quoteRequestId AND carrier_key = @carrierKey;
    `);
}

export async function replaceCarrierQuotes(
  quoteRequestId: string,
  sourceCarrierKey: string,
  quotes: ReplacementCarrierQuote[]
): Promise<void> {
  const pool = await getSqlPool();
  const transaction = new sql.Transaction(pool);
  const timestamp = new Date();

  await transaction.begin();
  try {
    await new sql.Request(transaction)
      .input("quoteRequestId", sql.NVarChar(50), quoteRequestId)
      .input("sourceCarrierKey", sql.NVarChar(300), sourceCarrierKey)
      .input("sourcePrefix", sql.NVarChar(301), `${sourceCarrierKey}:`)
      .query(`
        DELETE dbo.carrier_quotes
        WHERE quote_request_id = @quoteRequestId
          AND (carrier_key = @sourceCarrierKey OR LEFT(carrier_key, LEN(@sourcePrefix)) = @sourcePrefix);
      `);

    for (const quote of quotes) {
      await new sql.Request(transaction)
        .input("id", sql.UniqueIdentifier, crypto.randomUUID())
        .input("quoteRequestId", sql.NVarChar(50), quoteRequestId)
        .input("carrierKey", sql.NVarChar(300), quote.carrierKey)
        .input("carrierName", sql.NVarChar(300), quote.carrierName)
        .input("status", sql.VarChar(20), quote.status)
        .input("rateAmount", sql.Decimal(18, 2), quote.rateAmount)
        .input("currency", sql.VarChar(10), quote.currency)
        .input("serviceLevel", sql.NVarChar(300), quote.serviceLevel)
        .input("transitDays", sql.Int, quote.transitDays)
        .input("rawResponse", sql.NVarChar(sql.MAX), quote.rawResponse)
        .input("errorMessage", sql.NVarChar(sql.MAX), quote.errorMessage)
        .input("timestamp", sql.DateTime2(3), timestamp)
        .query(`
          INSERT dbo.carrier_quotes (
            id, quote_request_id, carrier_key, carrier_name, status, rate_amount, currency,
            service_level, transit_days, raw_response, error_message, requested_at, responded_at, updated_at
          ) VALUES (
            @id, @quoteRequestId, @carrierKey, @carrierName, @status, @rateAmount, @currency,
            @serviceLevel, @transitDays, @rawResponse, @errorMessage, @timestamp, @timestamp, @timestamp
          );
        `);
    }

    await transaction.commit();
  } catch (error) {
    await transaction.rollback().catch(() => undefined);
    throw error;
  }
}

export async function updateQuoteStatus(quoteRequestId: string, status: QuoteStatus): Promise<void> {
  const pool = await getSqlPool();
  await pool.request()
    .input("id", sql.NVarChar(50), quoteRequestId)
    .input("status", sql.VarChar(20), status)
    .input("updatedAt", sql.DateTime2(3), new Date())
    .query(`
      UPDATE dbo.quote_requests
      SET status = @status, updated_at = @updatedAt
      WHERE id = @id;
    `);
}

export async function getQuoteRequestById(id: string): Promise<QuoteRequestRecord | null> {
  const pool = await getSqlPool();
  const quoteResult = await pool.request()
    .input("id", sql.NVarChar(50), id)
    .query<Record<string, unknown>>(`SELECT * FROM dbo.quote_requests WHERE id = @id;`);
  const quote = quoteResult.recordset[0];
  if (!quote) return null;

  const carrierResult = await pool.request()
    .input("id", sql.NVarChar(50), id)
    .query<Record<string, unknown>>(`
      SELECT * FROM dbo.carrier_quotes
      WHERE quote_request_id = @id
      ORDER BY carrier_name ASC;
    `);

  return {
    ...requestPayload(quote),
    id: String(quote.id),
    operatorName: String(quote.operator_name),
    status: quote.status as QuoteStatus,
    createdAt: toIsoString(quote.created_at),
    updatedAt: toIsoString(quote.updated_at),
    carrierQuotes: carrierResult.recordset.map(mapCarrierQuote)
  };
}

export async function listQuoteRequests(): Promise<QuoteSummary[]> {
  const pool = await getSqlPool();
  const result = await pool.request().query<Record<string, unknown>>(`
    SELECT
      qr.id,
      qr.operator_name,
      qr.origin,
      qr.destination,
      qr.shipment_date,
      qr.request_payload,
      qr.status,
      qr.created_at,
      qr.updated_at,
      (SELECT COUNT_BIG(*) FROM dbo.carrier_quotes cq WHERE cq.quote_request_id = qr.id) AS carrier_count
    FROM dbo.quote_requests qr
    ORDER BY qr.created_at DESC;
  `);

  return result.recordset.map((row) => {
    const payload = requestPayload(row);
    return {
      id: String(row.id),
      operatorName: String(row.operator_name),
      requestedFrom: payload.requestedFrom ?? "",
      origin: String(row.origin),
      destination: String(row.destination),
      shipmentDate: String(row.shipment_date),
      pickupZipCode: payload.pickupLocation?.zipCode ?? "",
      deliveryZipCode: payload.deliveryLocation?.zipCode ?? "",
      lastEditedBy: String(row.operator_name),
      userOffice: "Global",
      userTeam: "TNA",
      isConfirmed: row.status === "completed" ? "Y" : "N",
      status: row.status as QuoteStatus,
      createdAt: toIsoString(row.created_at),
      updatedAt: toIsoString(row.updated_at),
      carrierCount: Number(row.carrier_count)
    };
  });
}

export const sqlQuoteRepository: QuoteRepository = {
  createQuoteRequest,
  updateCarrierQuote,
  replaceCarrierQuotes,
  updateQuoteStatus,
  getQuoteRequestById,
  listQuoteRequests
};
