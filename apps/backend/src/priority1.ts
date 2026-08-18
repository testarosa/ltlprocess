import type { QuoteRequestInput } from "@tms/shared";
import type { CarrierAdapter, IdentifiedCarrierQuoteOutcome } from "./carriers.js";
import type { PriorityOneApiConfig } from "./config.js";

interface PriorityOneRateQuote {
  id?: unknown;
  carrierName?: unknown;
  carrierCode?: unknown;
  serviceLevel?: unknown;
  serviceLevelDescription?: unknown;
  transitDays?: unknown;
  carrierQuoteNumber?: unknown;
  rateQuoteDetail?: { total?: unknown } | null;
  [key: string]: unknown;
}

interface PriorityOneInvalidRateQuote {
  carrierCode?: unknown;
  carrierName?: unknown;
  errorMessages?: Array<{ text?: unknown }> | null;
  [key: string]: unknown;
}

interface PriorityOneRateResponse {
  id?: unknown;
  rateQuotes?: PriorityOneRateQuote[] | null;
  invalidRateQuotes?: PriorityOneInvalidRateQuote[] | null;
}

const documentedAccessorialMap: Record<string, string> = {
  "Liftgate Pickup": "LGPU",
  "Pickup Appointment": "APPT",
  "Delivery Appointment": "APPT"
};

function numberOrNull(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return null;
}

function dimensionsInInches(input: QuoteRequestInput): { length: number; width: number; height: number } {
  const unit = input.dimensions.dimensionUnit.toLowerCase();
  const multiplier = unit === "ft" ? 12 : unit === "cm" ? 0.393701 : 1;
  return {
    length: Math.round(input.dimensions.length * multiplier * 100) / 100,
    width: Math.round(input.dimensions.width * multiplier * 100) / 100,
    height: Math.round(input.dimensions.height * multiplier * 100) / 100
  };
}

function totalWeightInPounds(input: QuoteRequestInput): number {
  const multiplier = input.dimensions.weightUnit.toLowerCase() === "kg" ? 2.20462 : 1;
  return Math.round(input.dimensions.weight * input.dimensions.quantity * multiplier * 100) / 100;
}

function normalizePackaging(value: string): string {
  const types: Record<string, string> = {
    bag: "Bag",
    bale: "Bale",
    box: "Box",
    bucket: "Bucket",
    bundle: "Bundle",
    carton: "Carton",
    case: "Case",
    coil: "Coil",
    crate: "Crate",
    cylinder: "Cylinder",
    drum: "Drums",
    drums: "Drums",
    pail: "Pail",
    pallet: "Pallet",
    piece: "Pieces",
    pieces: "Pieces",
    reel: "Reel",
    roll: "Roll",
    skid: "Skid",
    tote: "Tote"
  };
  return types[value.trim().toLowerCase()] ?? "Pallet";
}

function allSelectedServices(input: QuoteRequestInput): string[] {
  return [
    ...input.specialServices.general.filter((item) => item !== "HazMat"),
    ...input.specialServices.pickup,
    ...input.specialServices.delivery
  ];
}

function providerErrorMessage(payload: unknown, status: number): string {
  if (payload && typeof payload === "object") {
    const value = payload as Record<string, unknown>;
    for (const candidate of [value.detail, value.title, value.message]) {
      if (typeof candidate === "string" && candidate.trim()) {
        return `Priority1 API error (${status}): ${candidate.trim()}`;
      }
    }
  }
  return `Priority1 API error (${status}).`;
}

export class PriorityOneAdapter implements CarrierAdapter {
  readonly key = "priority1";
  readonly name = "Priority1";

  constructor(private readonly config: PriorityOneApiConfig) {}

  async quote(input: QuoteRequestInput): Promise<IdentifiedCarrierQuoteOutcome[]> {
    if (!this.config.apiKey) throw new Error("Priority1 API key is not configured.");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs);
    try {
      const response = await fetch(`${this.config.baseUrl}/v2/ltl/quotes/rates`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-API-KEY": this.config.apiKey
        },
        body: JSON.stringify(this.buildRequest(input)),
        signal: controller.signal
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(providerErrorMessage(payload, response.status));
      if (!payload || typeof payload !== "object") throw new Error("Priority1 returned an invalid quote response.");
      return this.normalizeResponse(payload as PriorityOneRateResponse);
    } finally {
      clearTimeout(timeout);
    }
  }

  private buildRequest(input: QuoteRequestInput): Record<string, unknown> {
    const dimensions = dimensionsInInches(input);
    const accessorialMap = { ...documentedAccessorialMap, ...this.config.accessorialMap };
    const codes = [...new Set(allSelectedServices(input).map((service) => accessorialMap[service]).filter(Boolean))];
    return {
      ...(Number.isFinite(this.config.customerId) ? { customerId: this.config.customerId } : {}),
      originCity: input.pickupLocation.city,
      originStateAbbreviation: input.pickupLocation.state,
      originZipCode: input.pickupLocation.zipCode,
      originCountryCode: input.pickupLocation.country.toUpperCase(),
      destinationCity: input.deliveryLocation.city,
      destinationStateAbbreviation: input.deliveryLocation.state,
      destinationZipCode: input.deliveryLocation.zipCode,
      destinationCountryCode: input.deliveryLocation.country.toUpperCase(),
      pickupDate: `${input.requestedDate}T00:00:00`,
      items: [
        {
          freightClass: input.dimensions.freightClass,
          packagingType: normalizePackaging(input.dimensions.handlingUnit),
          units: input.dimensions.quantity,
          pieces: input.dimensions.quantity,
          totalWeight: totalWeightInPounds(input),
          ...dimensions,
          isStackable: input.dimensions.stackable,
          isHazardous: input.dimensions.hazmat || input.specialServices.general.includes("HazMat"),
          isUsed: false,
          isMachinery: false,
          nmfcItemCode: null,
          nmfcSubCode: null,
          description: input.commodity || null
        }
      ],
      accessorialServices: codes.map((code) => ({ code })),
      apiConfiguration: { timeout: Math.max(1, Math.round(this.config.timeoutMs / 1000)) }
    };
  }

  private normalizeResponse(payload: PriorityOneRateResponse): IdentifiedCarrierQuoteOutcome[] {
    const valid = (payload.rateQuotes ?? []).map((quote, index): IdentifiedCarrierQuoteOutcome => {
      const carrierCode = typeof quote.carrierCode === "string" && quote.carrierCode ? quote.carrierCode : `carrier-${index + 1}`;
      const carrierName = typeof quote.carrierName === "string" && quote.carrierName ? quote.carrierName : `Priority1 Carrier ${index + 1}`;
      const quoteId = quote.id ?? quote.carrierQuoteNumber ?? index;
      const total = numberOrNull(quote.rateQuoteDetail?.total);
      const serviceLevel = [quote.serviceLevel, quote.serviceLevelDescription]
        .filter((item): item is string => typeof item === "string" && item.trim() !== "")
        .join(" · ");
      return {
        carrierKey: `${this.key}:${carrierCode.toLowerCase()}:${String(quoteId)}`,
        carrierName,
        status: total === null ? "unavailable" : "success",
        rateAmount: total,
        currency: "USD",
        serviceLevel: serviceLevel || null,
        transitDays: numberOrNull(quote.transitDays),
        rawResponse: JSON.stringify({ priorityOneQuoteRequestId: payload.id, ...quote }),
        errorMessage: total === null ? "Priority1 carrier did not return a quote total." : null
      };
    });

    const invalid = (payload.invalidRateQuotes ?? []).map((quote, index): IdentifiedCarrierQuoteOutcome => {
      const carrierCode = typeof quote.carrierCode === "string" && quote.carrierCode ? quote.carrierCode : `invalid-${index + 1}`;
      const carrierName = typeof quote.carrierName === "string" && quote.carrierName ? quote.carrierName : `Priority1 Carrier ${index + 1}`;
      const messages = (quote.errorMessages ?? [])
        .map((message) => message.text)
        .filter((message): message is string => typeof message === "string" && message.trim() !== "");
      return {
        carrierKey: `${this.key}:${carrierCode.toLowerCase()}:invalid-${index}`,
        carrierName,
        status: "unavailable",
        rateAmount: null,
        currency: "USD",
        serviceLevel: null,
        transitDays: null,
        rawResponse: JSON.stringify({ priorityOneQuoteRequestId: payload.id, ...quote }),
        errorMessage: messages.join(" ") || "Priority1 carrier could not quote this shipment."
      };
    });
    return [...valid, ...invalid];
  }
}
