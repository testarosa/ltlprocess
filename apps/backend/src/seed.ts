import crypto from "node:crypto";
import sql from "mssql/msnodesqlv8.js";
import type { QuoteRequestInput, QuoteStatus } from "@tms/shared";
import { getSqlPool } from "./db.js";

interface SeedQuote {
  id: string;
  operatorName: string;
  status: QuoteStatus;
  createdAt: string;
  request: QuoteRequestInput;
  carrierQuotes: Array<{
    carrierKey: string;
    carrierName: string;
    status: "success" | "unavailable" | "error";
    rateAmount: number | null;
    currency: string | null;
    serviceLevel: string | null;
    transitDays: number | null;
    errorMessage: string | null;
  }>;
}

const demoQuotes: SeedQuote[] = [
  {
    id: "HY44328",
    operatorName: "Hani Yong",
    status: "partial",
    createdAt: "2026-03-31T08:15:00.000Z",
    request: {
      requestedDate: "2026-03-31",
      requestedFrom: "MIKI FW: [見積依頼] メリトール様案件 / US FLORENCE",
      commodity: "Meritor axles",
      pickupLocation: { zipCode: "41042", city: "Florence", state: "KY", country: "US" },
      deliveryLocation: { zipCode: "60101", city: "Addison", state: "IL", country: "US" },
      dimensions: {
        handlingUnit: "Pallet",
        length: 42,
        width: 42,
        height: 15,
        dimensionUnit: "in",
        quantity: 5,
        weight: 550,
        weightUnit: "lb",
        freightClass: "60",
        hazmat: false,
        stackable: false
      },
      specialServices: {
        general: [],
        pickup: [],
        delivery: [],
        overLength: []
      }
    },
    carrierQuotes: [
      {
        carrierKey: "priority-1",
        carrierName: "AAA Cooper",
        status: "success",
        rateAmount: 355.82,
        currency: "USD",
        serviceLevel: "Priority 1",
        transitDays: 1,
        errorMessage: null
      },
      {
        carrierKey: "tfww",
        carrierName: "AAA Cooper Transportation",
        status: "success",
        rateAmount: 549.37,
        currency: "USD",
        serviceLevel: "TFWW",
        transitDays: 1,
        errorMessage: null
      },
      {
        carrierKey: "speed-ship",
        carrierName: "AAA COOPER TRANSPORTATION",
        status: "success",
        rateAmount: 345.24,
        currency: "USD",
        serviceLevel: "Speed Ship",
        transitDays: 1,
        errorMessage: null
      },
      {
        carrierKey: "3pl",
        carrierName: "ABERDEEN EXPRESS INC",
        status: "success",
        rateAmount: 290.83,
        currency: "USD",
        serviceLevel: "3PL",
        transitDays: 1,
        errorMessage: null
      }
    ]
  },
  {
    id: "HY44327",
    operatorName: "Hani Yong",
    status: "completed",
    createdAt: "2026-03-31T07:45:00.000Z",
    request: {
      requestedDate: "2026-03-31",
      requestedFrom: "VICKY [SDNS] LTL TO THORNTON, CO",
      commodity: "HVAC parts",
      pickupLocation: { zipCode: "90746", city: "Carson", state: "CA", country: "US" },
      deliveryLocation: { zipCode: "80241", city: "Thornton", state: "CO", country: "US" },
      dimensions: {
        handlingUnit: "Pallet",
        length: 48,
        width: 40,
        height: 55,
        dimensionUnit: "in",
        quantity: 2,
        weight: 720,
        weightUnit: "lb",
        freightClass: "70",
        hazmat: false,
        stackable: true
      },
      specialServices: {
        general: ["Notification"],
        pickup: ["Pickup Appointment"],
        delivery: ["Delivery Appointment"],
        overLength: []
      }
    },
    carrierQuotes: [
      {
        carrierKey: "priority-1",
        carrierName: "Priority 1",
        status: "success",
        rateAmount: 612.4,
        currency: "USD",
        serviceLevel: "Priority 1",
        transitDays: 2,
        errorMessage: null
      },
      {
        carrierKey: "saia",
        carrierName: "SAIA",
        status: "success",
        rateAmount: 645.1,
        currency: "USD",
        serviceLevel: "Direct",
        transitDays: 2,
        errorMessage: null
      }
    ]
  },
  {
    id: "SK44319",
    operatorName: "Scott Kim",
    status: "partial",
    createdAt: "2026-03-31T06:20:00.000Z",
    request: {
      requestedDate: "2026-03-31",
      requestedFrom: "TRACY RE: TRUCKING FEE FROM WASHINGTON",
      commodity: "Consumer electronics",
      pickupLocation: { zipCode: "20166", city: "Dulles", state: "VA", country: "US" },
      deliveryLocation: { zipCode: "20166", city: "Dulles", state: "VA", country: "US" },
      dimensions: {
        handlingUnit: "Carton",
        length: 39,
        width: 39,
        height: 28,
        dimensionUnit: "in",
        quantity: 1,
        weight: 545,
        weightUnit: "lb",
        freightClass: "70",
        hazmat: false,
        stackable: false
      },
      specialServices: {
        general: [],
        pickup: ["Airport Pickup"],
        delivery: ["Airport Delivery"],
        overLength: []
      }
    },
    carrierQuotes: [
      {
        carrierKey: "roadrunner",
        carrierName: "Roadrunner",
        status: "success",
        rateAmount: 322.66,
        currency: "USD",
        serviceLevel: "Economy",
        transitDays: 1,
        errorMessage: null
      },
      {
        carrierKey: "custom",
        carrierName: "Custom Carrier",
        status: "error",
        rateAmount: null,
        currency: null,
        serviceLevel: null,
        transitDays: null,
        errorMessage: "Carrier API timeout."
      }
    ]
  }
];

function formatLocationSummary(location: QuoteRequestInput["pickupLocation"]): string {
  const cityState = [location.city, location.state].filter(Boolean).join(", ");
  return [cityState, location.zipCode].filter(Boolean).join(" ").trim();
}

function toWeightLbs(input: QuoteRequestInput): number {
  const totalWeight = input.dimensions.weight;
  return input.dimensions.weightUnit.toLowerCase() === "kg" ? Math.round(totalWeight * 2.20462 * 100) / 100 : totalWeight;
}

export async function seedDemoData(): Promise<void> {
  const pool = await getSqlPool();
  const existing = await pool.request().query<{ count: number }>("SELECT COUNT_BIG(*) AS count FROM dbo.quote_requests;");
  if (Number(existing.recordset[0]?.count ?? 0) > 0) return;

  const transaction = new sql.Transaction(pool);
  await transaction.begin();
  try {
    for (const quote of demoQuotes) {
      const createdAt = new Date(quote.createdAt);
      await new sql.Request(transaction)
        .input("id", sql.NVarChar(50), quote.id)
        .input("operatorName", sql.NVarChar(200), quote.operatorName)
        .input("origin", sql.NVarChar(300), formatLocationSummary(quote.request.pickupLocation))
        .input("destination", sql.NVarChar(300), formatLocationSummary(quote.request.deliveryLocation))
        .input("shipmentDate", sql.VarChar(10), quote.request.requestedDate)
        .input("weightLbs", sql.Decimal(18, 2), toWeightLbs(quote.request))
        .input("requestPayload", sql.NVarChar(sql.MAX), JSON.stringify(quote.request))
        .input("status", sql.VarChar(20), quote.status)
        .input("createdAt", sql.DateTime2(3), createdAt)
        .query(`
          INSERT dbo.quote_requests (
            id, operator_name, origin, destination, shipment_date, weight_lbs,
            request_payload, status, created_at, updated_at
          ) VALUES (
            @id, @operatorName, @origin, @destination, @shipmentDate, @weightLbs,
            @requestPayload, @status, @createdAt, @createdAt
          );
        `);

      for (const carrierQuote of quote.carrierQuotes) {
        await new sql.Request(transaction)
          .input("id", sql.UniqueIdentifier, crypto.randomUUID())
          .input("quoteRequestId", sql.NVarChar(50), quote.id)
          .input("carrierKey", sql.NVarChar(300), carrierQuote.carrierKey)
          .input("carrierName", sql.NVarChar(300), carrierQuote.carrierName)
          .input("status", sql.VarChar(20), carrierQuote.status)
          .input("rateAmount", sql.Decimal(18, 2), carrierQuote.rateAmount)
          .input("currency", sql.VarChar(10), carrierQuote.currency)
          .input("serviceLevel", sql.NVarChar(300), carrierQuote.serviceLevel)
          .input("transitDays", sql.Int, carrierQuote.transitDays)
          .input("rawResponse", sql.NVarChar(sql.MAX), JSON.stringify({ seeded: true }))
          .input("errorMessage", sql.NVarChar(sql.MAX), carrierQuote.errorMessage)
          .input("createdAt", sql.DateTime2(3), createdAt)
          .query(`
            INSERT dbo.carrier_quotes (
              id, quote_request_id, carrier_key, carrier_name, status, rate_amount, currency,
              service_level, transit_days, raw_response, error_message, requested_at, responded_at, updated_at
            ) VALUES (
              @id, @quoteRequestId, @carrierKey, @carrierName, @status, @rateAmount, @currency,
              @serviceLevel, @transitDays, @rawResponse, @errorMessage, @createdAt, @createdAt, @createdAt
            );
          `);
      }
    }

    await transaction.commit();
  } catch (error) {
    await transaction.rollback().catch(() => undefined);
    throw error;
  }
}
