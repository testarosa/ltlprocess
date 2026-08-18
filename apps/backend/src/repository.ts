import crypto from "node:crypto";
import type {
  CarrierQuoteRecord,
  CarrierQuoteStatus,
  QuoteRequestInput,
  QuoteRequestRecord,
  QuoteStatus,
  QuoteSummary
} from "@tms/shared";
import { db } from "./db.js";

function formatLocationSummary(location: QuoteRequestInput["pickupLocation"]): string {
  const cityState = [location.city, location.state].filter(Boolean).join(", ");
  return [cityState, location.zipCode].filter(Boolean).join(" ").trim();
}

function toWeightLbs(input: QuoteRequestInput): number {
  const total = input.dimensions.weight * input.dimensions.quantity;
  return input.dimensions.weightUnit.toLowerCase() === "kg" ? Math.round(total * 2.20462 * 100) / 100 : total;
}

function mapCarrierQuote(row: Record<string, unknown>): CarrierQuoteRecord {
  return {
    id: String(row.id),
    carrierKey: String(row.carrier_key),
    carrierName: String(row.carrier_name),
    status: row.status as CarrierQuoteStatus,
    rateAmount: row.rate_amount === null ? null : Number(row.rate_amount),
    currency: row.currency === null ? null : String(row.currency),
    serviceLevel: row.service_level === null ? null : String(row.service_level),
    transitDays: row.transit_days === null ? null : Number(row.transit_days),
    errorMessage: row.error_message === null ? null : String(row.error_message),
    requestedAt: String(row.requested_at),
    respondedAt: row.responded_at === null ? null : String(row.responded_at),
    updatedAt: String(row.updated_at)
  };
}

export function createQuoteRequest(operatorName: string, input: QuoteRequestInput, carriers: { key: string; name: string }[]): string {
  const quoteRequestId = crypto.randomUUID();
  const timestamp = new Date().toISOString();

  const insertQuote = db.prepare(`
    INSERT INTO quote_requests (
      id, operator_name, origin, destination, shipment_date, weight_lbs, request_payload, status, created_at, updated_at
    ) VALUES (
      @id, @operator_name, @origin, @destination, @shipment_date, @weight_lbs, @request_payload, @status, @created_at, @updated_at
    )
  `);

  const insertCarrierQuote = db.prepare(`
    INSERT INTO carrier_quotes (
      id, quote_request_id, carrier_key, carrier_name, status, requested_at, updated_at
    ) VALUES (
      @id, @quote_request_id, @carrier_key, @carrier_name, @status, @requested_at, @updated_at
    )
  `);

  db.exec("BEGIN");
  try {
    insertQuote.run({
      id: quoteRequestId,
      operator_name: operatorName,
      origin: formatLocationSummary(input.pickupLocation),
      destination: formatLocationSummary(input.deliveryLocation),
      shipment_date: input.requestedDate,
      weight_lbs: toWeightLbs(input),
      request_payload: JSON.stringify(input),
      status: "processing",
      created_at: timestamp,
      updated_at: timestamp
    });

    for (const carrier of carriers) {
      insertCarrierQuote.run({
        id: crypto.randomUUID(),
        quote_request_id: quoteRequestId,
        carrier_key: carrier.key,
        carrier_name: carrier.name,
        status: "pending",
        requested_at: timestamp,
        updated_at: timestamp
      });
    }

    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return quoteRequestId;
}

export function updateCarrierQuote(
  quoteRequestId: string,
  carrierKey: string,
  updates: {
    status: CarrierQuoteStatus;
    rateAmount: number | null;
    currency: string | null;
    serviceLevel: string | null;
    transitDays: number | null;
    rawResponse: string | null;
    errorMessage: string | null;
  }
): void {
  const timestamp = new Date().toISOString();

  db.prepare(`
    UPDATE carrier_quotes
    SET status = @status,
        rate_amount = @rate_amount,
        currency = @currency,
        service_level = @service_level,
        transit_days = @transit_days,
        raw_response = @raw_response,
        error_message = @error_message,
        responded_at = @responded_at,
        updated_at = @updated_at
    WHERE quote_request_id = @quote_request_id AND carrier_key = @carrier_key
  `).run({
    quote_request_id: quoteRequestId,
    carrier_key: carrierKey,
    status: updates.status,
    rate_amount: updates.rateAmount,
    currency: updates.currency,
    service_level: updates.serviceLevel,
    transit_days: updates.transitDays,
    raw_response: updates.rawResponse,
    error_message: updates.errorMessage,
    responded_at: timestamp,
    updated_at: timestamp
  });
}

export function replaceCarrierQuotes(
  quoteRequestId: string,
  sourceCarrierKey: string,
  quotes: Array<{
    carrierKey: string;
    carrierName: string;
    status: CarrierQuoteStatus;
    rateAmount: number | null;
    currency: string | null;
    serviceLevel: string | null;
    transitDays: number | null;
    rawResponse: string | null;
    errorMessage: string | null;
  }>
): void {
  const timestamp = new Date().toISOString();
  const insert = db.prepare(`
    INSERT INTO carrier_quotes (
      id, quote_request_id, carrier_key, carrier_name, status, rate_amount, currency,
      service_level, transit_days, raw_response, error_message, requested_at, responded_at, updated_at
    ) VALUES (
      @id, @quote_request_id, @carrier_key, @carrier_name, @status, @rate_amount, @currency,
      @service_level, @transit_days, @raw_response, @error_message, @requested_at, @responded_at, @updated_at
    )
  `);

  db.exec("BEGIN");
  try {
    db.prepare(`
      DELETE FROM carrier_quotes
      WHERE quote_request_id = ?
        AND (carrier_key = ? OR carrier_key LIKE ?)
    `).run(quoteRequestId, sourceCarrierKey, `${sourceCarrierKey}:%`);
    for (const quote of quotes) {
      insert.run({
        id: crypto.randomUUID(),
        quote_request_id: quoteRequestId,
        carrier_key: quote.carrierKey,
        carrier_name: quote.carrierName,
        status: quote.status,
        rate_amount: quote.rateAmount,
        currency: quote.currency,
        service_level: quote.serviceLevel,
        transit_days: quote.transitDays,
        raw_response: quote.rawResponse,
        error_message: quote.errorMessage,
        requested_at: timestamp,
        responded_at: timestamp,
        updated_at: timestamp
      });
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function updateQuoteStatus(quoteRequestId: string, status: QuoteStatus): void {
  db.prepare(`
    UPDATE quote_requests
    SET status = @status, updated_at = @updated_at
    WHERE id = @id
  `).run({
    id: quoteRequestId,
    status,
    updated_at: new Date().toISOString()
  });
}

export function getQuoteRequestById(id: string): QuoteRequestRecord | null {
  const quote = db.prepare(`
    SELECT * FROM quote_requests WHERE id = ?
  `).get(id) as Record<string, unknown> | undefined;

  if (!quote) {
    return null;
  }

  const carrierRows = db.prepare(`
    SELECT * FROM carrier_quotes
    WHERE quote_request_id = ?
    ORDER BY carrier_name ASC
  `).all(id) as Record<string, unknown>[];

  const payload = quote.request_payload
    ? (JSON.parse(String(quote.request_payload)) as QuoteRequestInput)
    : {
        requestedDate: String(quote.shipment_date),
        requestedFrom: "",
        commodity: "",
        pickupLocation: { zipCode: "", city: String(quote.origin), state: "", country: "US" },
        deliveryLocation: { zipCode: "", city: String(quote.destination), state: "", country: "US" },
        dimensions: {
          handlingUnit: "Pallet",
          length: 0,
          width: 0,
          height: 0,
          dimensionUnit: "in",
          quantity: 1,
          weight: Number(quote.weight_lbs),
          weightUnit: "lb",
          freightClass: "",
          hazmat: false,
          stackable: false
        },
        specialServices: {
          general: [],
          pickup: [],
          delivery: [],
          overLength: []
        }
      };

  return {
    ...payload,
    id: String(quote.id),
    operatorName: String(quote.operator_name),
    status: quote.status as QuoteStatus,
    createdAt: String(quote.created_at),
    updatedAt: String(quote.updated_at),
    carrierQuotes: carrierRows.map(mapCarrierQuote)
  };
}

export function listQuoteRequests(): QuoteSummary[] {
  const rows = db.prepare(`
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
      COUNT(cq.id) AS carrier_count
    FROM quote_requests qr
    LEFT JOIN carrier_quotes cq ON cq.quote_request_id = qr.id
    GROUP BY qr.id
    ORDER BY qr.created_at DESC
  `).all() as Record<string, unknown>[];

  return rows.map((row) => ({
    id: String(row.id),
    operatorName: String(row.operator_name),
    requestedFrom: row.request_payload
      ? ((JSON.parse(String(row.request_payload)) as QuoteRequestInput).requestedFrom ?? "")
      : "",
    origin: String(row.origin),
    destination: String(row.destination),
    shipmentDate: String(row.shipment_date),
    pickupZipCode: row.request_payload
      ? ((JSON.parse(String(row.request_payload)) as QuoteRequestInput).pickupLocation?.zipCode ?? "")
      : "",
    deliveryZipCode: row.request_payload
      ? ((JSON.parse(String(row.request_payload)) as QuoteRequestInput).deliveryLocation?.zipCode ?? "")
      : "",
    lastEditedBy: String(row.operator_name),
    userOffice: "Global",
    userTeam: "TNA",
    isConfirmed: row.status === "completed" ? "Y" : "N",
    status: row.status as QuoteStatus,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    carrierCount: Number(row.carrier_count)
  }));
}
