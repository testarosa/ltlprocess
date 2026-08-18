import crypto from "node:crypto";
import type { QuoteRequestInput, QuoteStatus } from "@tms/shared";
import { db } from "./db.js";

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
  const total = input.dimensions.weight * input.dimensions.quantity;
  return input.dimensions.weightUnit.toLowerCase() === "kg" ? Math.round(total * 2.20462 * 100) / 100 : total;
}

export function seedDemoData(): void {
  const existing = db.prepare("SELECT COUNT(*) AS count FROM quote_requests").get() as { count: number };
  if (existing.count > 0) {
    return;
  }

  const insertQuote = db.prepare(`
    INSERT INTO quote_requests (
      id, operator_name, origin, destination, shipment_date, weight_lbs, request_payload, status, created_at, updated_at
    ) VALUES (
      @id, @operator_name, @origin, @destination, @shipment_date, @weight_lbs, @request_payload, @status, @created_at, @updated_at
    )
  `);

  const insertCarrierQuote = db.prepare(`
    INSERT INTO carrier_quotes (
      id, quote_request_id, carrier_key, carrier_name, status, rate_amount, currency, service_level, transit_days,
      raw_response, error_message, requested_at, responded_at, updated_at
    ) VALUES (
      @id, @quote_request_id, @carrier_key, @carrier_name, @status, @rate_amount, @currency, @service_level, @transit_days,
      @raw_response, @error_message, @requested_at, @responded_at, @updated_at
    )
  `);

  db.exec("BEGIN");
  try {
    for (const quote of demoQuotes) {
      insertQuote.run({
        id: quote.id,
        operator_name: quote.operatorName,
        origin: formatLocationSummary(quote.request.pickupLocation),
        destination: formatLocationSummary(quote.request.deliveryLocation),
        shipment_date: quote.request.requestedDate,
        weight_lbs: toWeightLbs(quote.request),
        request_payload: JSON.stringify(quote.request),
        status: quote.status,
        created_at: quote.createdAt,
        updated_at: quote.createdAt
      });

      for (const carrierQuote of quote.carrierQuotes) {
        insertCarrierQuote.run({
          id: crypto.randomUUID(),
          quote_request_id: quote.id,
          carrier_key: carrierQuote.carrierKey,
          carrier_name: carrierQuote.carrierName,
          status: carrierQuote.status,
          rate_amount: carrierQuote.rateAmount,
          currency: carrierQuote.currency,
          service_level: carrierQuote.serviceLevel,
          transit_days: carrierQuote.transitDays,
          raw_response: JSON.stringify({ seeded: true }),
          error_message: carrierQuote.errorMessage,
          requested_at: quote.createdAt,
          responded_at: quote.createdAt,
          updated_at: quote.createdAt
        });
      }
    }

    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
