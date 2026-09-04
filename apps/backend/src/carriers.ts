import crypto from "node:crypto";
import { getQuoteDimensions, type QuoteDimensionInput, type QuoteRequestInput, type CarrierQuoteStatus } from "@tms/shared";
import type { CarrierApiConfig, ForwardAirApiConfig, PriorityOneApiConfig, RoadrunnerApiConfig, ThreePlSystemsApiConfig, WwexApiConfig } from "./config.js";
import { ForwardAirAdapter } from "./forwardair.js";
import { PriorityOneAdapter } from "./priority1.js";
import { RoadrunnerAdapter } from "./roadrunner.js";
import { WwexAdapter } from "./wwex.js";

export interface CarrierQuoteOutcome {
  status: CarrierQuoteStatus;
  rateAmount: number | null;
  currency: string | null;
  serviceLevel: string | null;
  transitDays: number | null;
  rawResponse: string | null;
  errorMessage: string | null;
}

export interface IdentifiedCarrierQuoteOutcome extends CarrierQuoteOutcome {
  carrierKey: string;
  carrierName: string;
}

export interface CarrierAdapter {
  key: string;
  name: string;
  quote(input: QuoteRequestInput): Promise<CarrierQuoteOutcome | IdentifiedCarrierQuoteOutcome[]>;
}

interface ThreePlTokenResponse {
  access_token?: unknown;
  expires_in?: unknown;
}

interface ThreePlRateResponse {
  name?: unknown;
  scac?: unknown;
  billed?: unknown;
  transitTime?: unknown;
  rateQuoteId?: unknown;
  serviceType?: unknown;
  serviceDescription?: unknown;
  isGuaranteed?: unknown;
  guaranteed?: unknown;
  billTo?: unknown;
  [key: string]: unknown;
}

interface IndexedThreePlRate {
  item: unknown;
  index: number;
}

const threePlAccessorialCodes: Record<string, string> = {
  Notification: "NOTY",
  "Guaranteed Service": "GUAR",
  "CFS Pickup": "CFSP",
  "Airport Pickup": "AIPK",
  "Inside Pickup": "INPK",
  "Liftgate Pickup": "LGPK",
  "Residential Pickup": "RSPK",
  "Construction Site Pickup": "CSPK",
  "Church Pickup": "PWPK",
  "Hospital Pickup": "LIPK",
  "Hotel Pickup": "HOPK",
  "Resort Pickup": "LIPK",
  "School Pickup": "SCPK",
  "Military Base Pickup": "MIPK",
  "Prison Pickup": "LIPK",
  "Country Club Pickup": "COCP",
  "Farm Pickup": "FAPK",
  "Ranch Pickup": "LIPK",
  "Camp Pickup": "CAPK",
  "Park Pickup": "FMPK",
  "Inside Delivery": "INDE",
  "Liftgate Delivery": "LGDE",
  "Delivery Appointment": "APTD",
  "Residential Delivery": "RSDE",
  "Construction Site Delivery": "CSDE",
  "Church Delivery": "PWDE",
  "Hospital Delivery": "LIDE",
  "Hotel Delivery": "HODE",
  "Resort Delivery": "LIDE",
  "Military Base Delivery": "MIDE",
  "Prison Delivery": "LIDE",
  "Country Club Delivery": "COCD",
  "CFS Delivery": "CFSD",
  "Farm Delivery": "FADE",
  "Ranch Delivery": "LIDE",
  "Camp Delivery": "CADE",
  "Park Delivery": "FMDE",
  "Protect from Freeze": "PRFR",
  "Excessive Length": "EXLG"
};

interface ThreePlAccessorial {
  code: string;
  description: string;
}

function pseudoRandom(seed: string, min: number, max: number): number {
  const hash = crypto.createHash("sha256").update(seed).digest("hex");
  const value = Number.parseInt(hash.slice(0, 8), 16) / 0xffffffff;
  return Math.round((min + (max - min) * value) * 100) / 100;
}

function normalizeRemotePayload(remote: unknown): CarrierQuoteOutcome {
  if (!remote || typeof remote !== "object") {
    return {
      status: "error",
      rateAmount: null,
      currency: null,
      serviceLevel: null,
      transitDays: null,
      rawResponse: JSON.stringify(remote),
      errorMessage: "Carrier returned an invalid payload."
    };
  }

  const value = remote as Record<string, unknown>;
  return {
    status: (typeof value.status === "string" ? value.status : "success") as CarrierQuoteStatus,
    rateAmount: typeof value.rateAmount === "number" ? value.rateAmount : null,
    currency: typeof value.currency === "string" ? value.currency : "USD",
    serviceLevel: typeof value.serviceLevel === "string" ? value.serviceLevel : null,
    transitDays: typeof value.transitDays === "number" ? value.transitDays : null,
    rawResponse: JSON.stringify(remote),
    errorMessage: typeof value.errorMessage === "string" ? value.errorMessage : null
  };
}

function numberOrNull(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return null;
}

function normalizeCountry(value: string): string {
  const countries: Record<string, string> = { US: "USA", USA: "USA", CA: "CAN", CAN: "CAN", MX: "MEX", MEX: "MEX" };
  return countries[value.trim().toUpperCase()] ?? value.trim().toUpperCase();
}

function normalizePackaging(value: string): string {
  const packaging: Record<string, string> = {
    pallet: "Pallets",
    crate: "Crates",
    carton: "Cartons",
    box: "Boxes",
    skid: "Skids"
  };
  return packaging[value.trim().toLowerCase()] ?? (value.trim() || "Pallets");
}

function dimensionsInInches(dimension: QuoteDimensionInput): { length: number; width: number; height: number } {
  const unit = dimension.dimensionUnit.toLowerCase();
  const multiplier = unit === "ft" ? 12 : unit === "cm" ? 0.393701 : 1;
  return {
    length: Math.round(dimension.length * multiplier * 100) / 100,
    width: Math.round(dimension.width * multiplier * 100) / 100,
    height: Math.round(dimension.height * multiplier * 100) / 100
  };
}

function weightInPounds(dimension: QuoteDimensionInput): number {
  const multiplier = dimension.weightUnit.toLowerCase() === "kg" ? 2.20462 : 1;
  return Math.round(dimension.weight * multiplier * 100) / 100;
}

function totalWeightInPounds(input: QuoteRequestInput): number {
  return Math.round(getQuoteDimensions(input).reduce((total, dimension) => total + weightInPounds(dimension), 0) * 100) / 100;
}

function normalizeText(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function isThreePlGuaranteedRate(value: ThreePlRateResponse): boolean {
  if (value.isGuaranteed === true || value.guaranteed === true) return true;

  const serviceText = [value.serviceType, value.serviceDescription]
    .filter((part): part is string => typeof part === "string")
    .join(" ")
    .toLowerCase();

  return /\bguarantee(?:d)?\b|\bguar\b|\bgur\b|\btime critical\b/.test(serviceText);
}

export class ThreePlSystemsAdapter implements CarrierAdapter {
  readonly key = "3pl-systems";
  readonly name = "3PL Systems";
  private token: { value: string; expiresAt: number } | null = null;
  private accessorials: { value: ThreePlAccessorial[]; expiresAt: number } | null = null;

  constructor(private readonly config: ThreePlSystemsApiConfig) {}

  async quote(input: QuoteRequestInput): Promise<IdentifiedCarrierQuoteOutcome[]> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs);

    try {
      const token = await this.getToken(controller.signal);
      const accessorialCodes = await this.resolveAccessorialCodes(input, token, controller.signal);
      const response = await fetch(`${this.config.baseUrl}/api/v1/RatingWithRateQuoteIdAndBillTo`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(this.buildRatingRequest(input, accessorialCodes)),
        signal: controller.signal
      });

      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(`3PL Systems rating request failed (${response.status}).`);
      }
      if (!Array.isArray(payload)) {
        throw new Error("3PL Systems returned an invalid rating response.");
      }

      return this.selectPreferredRates(payload).map(({ item, index }) => this.normalizeRate(item, index));
    } finally {
      clearTimeout(timeout);
    }
  }

  private async getToken(signal: AbortSignal): Promise<string> {
    if (this.token && this.token.expiresAt > Date.now() + 60_000) {
      return this.token.value;
    }
    if (!this.config.clientId || !this.config.clientSecret) {
      throw new Error("3PL Systems credentials are not configured.");
    }

    const body = new URLSearchParams({
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
      grant_type: "client_credentials"
    });
    const response = await fetch(`${this.config.baseUrl}/connect/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
      signal
    });
    const payload = (await response.json().catch(() => null)) as ThreePlTokenResponse | null;
    if (!response.ok || typeof payload?.access_token !== "string") {
      throw new Error(`3PL Systems authentication failed (${response.status}).`);
    }

    const expiresIn = numberOrNull(payload.expires_in) ?? 3600;
    this.token = { value: payload.access_token, expiresAt: Date.now() + expiresIn * 1000 };
    return this.token.value;
  }

  private buildRatingRequest(input: QuoteRequestInput, accessorials: string[]): Record<string, unknown> {
    return {
      consigneeZip: input.deliveryLocation.zipCode,
      shipmentMode: "LTL",
      shipperZip: input.pickupLocation.zipCode,
      miles: "0",
      shipperCountry: normalizeCountry(input.pickupLocation.country),
      consigneeCountry: normalizeCountry(input.deliveryLocation.country),
      equipmentType: "StraightVan",
      accessorials,
      items: getQuoteDimensions(input).map((dimension) => ({
          class: dimension.freightClass,
          isHazardous: dimension.hazmat || input.specialServices.general.includes("HazMat"),
          pieces: dimension.quantity,
          weight: weightInPounds(dimension),
          packaging: normalizePackaging(dimension.handlingUnit),
          nmfc: 0,
          productDescription: input.commodity,
          density: "0",
          ...dimensionsInInches(dimension),
          billed: 0,
          cost: 0,
          unitsWeight: "0",
          unitsDensity: "0",
          unitsDimension: "0"
        }))
    };
  }

  private async resolveAccessorialCodes(input: QuoteRequestInput, token: string, signal: AbortSignal): Promise<string[]> {
    const requested = [
      ...input.specialServices.general.filter((item) => item !== "HazMat"),
      ...input.specialServices.pickup,
      ...input.specialServices.delivery,
      ...(input.specialServices.overLength.length > 0 ? ["Excessive Length"] : [])
    ];
    if (requested.length === 0) return [];

    let byDescription = new Map<string, string>();
    try {
      const available = await this.getAccessorials(token, signal);
      byDescription = new Map(available.map((item) => [normalizeText(item.description), item.code]));
    } catch {
      // The documented codes below are sufficient when the accessorial catalog is unavailable.
    }

    return [...new Set(requested
      .map((item) => threePlAccessorialCodes[item] ?? byDescription.get(normalizeText(item)))
      .filter((code): code is string => Boolean(code)))];
  }

  private async getAccessorials(token: string, signal: AbortSignal): Promise<ThreePlAccessorial[]> {
    if (this.accessorials && this.accessorials.expiresAt > Date.now()) return this.accessorials.value;
    const response = await fetch(`${this.config.baseUrl}/api/v1/accessorial`, {
      headers: { Authorization: `Bearer ${token}` },
      signal
    });
    if (!response.ok) throw new Error(`3PL Systems accessorial request failed (${response.status}).`);
    const payload = await response.json().catch(() => null);
    if (!Array.isArray(payload)) return [];

    const value = payload.flatMap((item): ThreePlAccessorial[] => {
      if (!item || typeof item !== "object") return [];
      const record = item as Record<string, unknown>;
      const code = record.code ?? record.accessorialCode ?? record.scac ?? record.id;
      const description = record.description ?? record.name ?? record.label;
      return typeof code === "string" && typeof description === "string" ? [{ code, description }] : [];
    });
    this.accessorials = { value, expiresAt: Date.now() + 24 * 60 * 60 * 1000 };
    return value;
  }

  private selectPreferredRates(payload: unknown[]): IndexedThreePlRate[] {
    const preferred = new Map<string, IndexedThreePlRate>();

    payload.forEach((item, index) => {
      const value = (item && typeof item === "object" ? item : {}) as ThreePlRateResponse;
      const scac = typeof value.scac === "string" ? value.scac.trim().toLowerCase() : "";

      // 3PL Systems can return tariff and dynamic prices for the same carrier.
      // Collapse every non-guaranteed SCAC rate into one bucket and retain the
      // cheapest. Guaranteed service remains a separate selectable quote.
      // Broker/house rates do not have a SCAC, so they must never be deduplicated.
      const key = scac
        ? `${scac}:${isThreePlGuaranteedRate(value) ? "guaranteed" : "regular"}`
        : `house-rate:${index}`;
      const existing = preferred.get(key);
      const billed = numberOrNull(value.billed);
      const existingValue = (existing?.item && typeof existing.item === "object" ? existing.item : {}) as ThreePlRateResponse;
      const existingBilled = numberOrNull(existingValue.billed);

      if (!existing || (billed !== null && (existingBilled === null || billed < existingBilled))) {
        preferred.set(key, { item, index });
      }
    });

    return [...preferred.values()].sort((left, right) => {
      const leftValue = (left.item && typeof left.item === "object" ? left.item : {}) as ThreePlRateResponse;
      const rightValue = (right.item && typeof right.item === "object" ? right.item : {}) as ThreePlRateResponse;
      const leftRank = isThreePlGuaranteedRate(leftValue) ? 1 : 0;
      const rightRank = isThreePlGuaranteedRate(rightValue) ? 1 : 0;
      return leftRank - rightRank
        || (numberOrNull(leftValue.billed) ?? Number.POSITIVE_INFINITY) - (numberOrNull(rightValue.billed) ?? Number.POSITIVE_INFINITY);
    });
  }

  private normalizeRate(remote: unknown, index: number): IdentifiedCarrierQuoteOutcome {
    const value = (remote && typeof remote === "object" ? remote : {}) as ThreePlRateResponse;
    const name = typeof value.name === "string" && value.name.trim() ? value.name.trim() : `3PL Carrier ${index + 1}`;
    const scac = typeof value.scac === "string" && value.scac.trim() ? value.scac.trim() : `carrier-${index + 1}`;
    const quoteId = typeof value.rateQuoteId === "string" ? value.rateQuoteId : String(index);
    const serviceParts = [value.serviceType, value.serviceDescription]
      .filter((part): part is string => typeof part === "string" && part.trim() !== "" && part !== "N/A");
    return {
      carrierKey: `${this.key}:${scac.toLowerCase()}:${quoteId}`,
      carrierName: name,
      status: numberOrNull(value.billed) === null ? "unavailable" : "success",
      rateAmount: numberOrNull(value.billed),
      currency: "USD",
      serviceLevel: serviceParts.join(" · ") || null,
      transitDays: numberOrNull(value.transitTime),
      rawResponse: JSON.stringify(remote),
      errorMessage: numberOrNull(value.billed) === null ? "Carrier did not return a billed rate." : null
    };
  }
}

class HttpCarrierAdapter implements CarrierAdapter {
  key: string;
  name: string;
  private readonly endpointUrl?: string;
  private readonly authHeaderName?: string;
  private readonly authToken?: string;
  private readonly timeoutMs: number;

  constructor(config: CarrierApiConfig) {
    this.key = config.key;
    this.name = config.name;
    this.endpointUrl = config.endpointUrl;
    this.authHeaderName = config.authHeaderName;
    this.authToken = config.authToken;
    this.timeoutMs = config.timeoutMs ?? 8000;
  }

  async quote(input: QuoteRequestInput): Promise<CarrierQuoteOutcome> {
    if (!this.endpointUrl) return this.simulate(input);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (this.authHeaderName && this.authToken) headers[this.authHeaderName] = this.authToken;
      const response = await fetch(this.endpointUrl, {
        method: "POST",
        headers,
        body: JSON.stringify(input),
        signal: controller.signal
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        return { status: "error", rateAmount: null, currency: null, serviceLevel: null, transitDays: null, rawResponse: JSON.stringify(payload), errorMessage: `Carrier API error (${response.status}).` };
      }
      return normalizeRemotePayload(payload);
    } catch (error) {
      return { status: "error", rateAmount: null, currency: null, serviceLevel: null, transitDays: null, rawResponse: null, errorMessage: error instanceof Error ? error.message : "Unknown carrier API error." };
    } finally {
      clearTimeout(timeout);
    }
  }

  private async simulate(input: QuoteRequestInput): Promise<CarrierQuoteOutcome> {
    await new Promise((resolve) => setTimeout(resolve, 350 + pseudoRandom(`${this.key}-delay`, 0, 700)));
    const totalWeight = totalWeightInPounds(input);
    const origin = `${input.pickupLocation.zipCode}-${input.pickupLocation.city}-${input.pickupLocation.state}`;
    const destination = `${input.deliveryLocation.zipCode}-${input.deliveryLocation.city}-${input.deliveryLocation.state}`;
    const seed = `${this.key}-${origin}-${destination}-${totalWeight}-${input.requestedDate}-${input.commodity}`;
    const behavior = pseudoRandom(`${seed}-behavior`, 0, 100);
    if (behavior < 15) return { status: "error", rateAmount: null, currency: null, serviceLevel: null, transitDays: null, rawResponse: JSON.stringify({ simulated: true }), errorMessage: "Simulated carrier timeout." };
    if (behavior < 30) return { status: "unavailable", rateAmount: null, currency: null, serviceLevel: null, transitDays: null, rawResponse: JSON.stringify({ simulated: true }), errorMessage: "Carrier could not quote this lane." };
    return {
      status: "success",
      rateAmount: pseudoRandom(seed, 950, 4200),
      currency: "USD",
      serviceLevel: totalWeight > 10000 ? "FTL Standard" : "LTL Priority",
      transitDays: Math.max(1, Math.round(pseudoRandom(`${seed}-transit`, 1, 6))),
      rawResponse: JSON.stringify({ simulated: true, seed }),
      errorMessage: null
    };
  }
}

export function createCarrierAdapters(
  configs: CarrierApiConfig[],
  threePlConfig?: ThreePlSystemsApiConfig,
  priorityOneConfig?: PriorityOneApiConfig,
  roadrunnerConfig?: RoadrunnerApiConfig,
  wwexConfig?: WwexApiConfig,
  forwardAirConfig?: ForwardAirApiConfig
): CarrierAdapter[] {
  const liveAdapters: CarrierAdapter[] = [];
  if (threePlConfig?.clientId && threePlConfig.clientSecret) liveAdapters.push(new ThreePlSystemsAdapter(threePlConfig));
  if (priorityOneConfig?.apiKey) liveAdapters.push(new PriorityOneAdapter(priorityOneConfig));
  if (roadrunnerConfig?.applicationId && roadrunnerConfig.apiKey) liveAdapters.push(new RoadrunnerAdapter(roadrunnerConfig));
  if (wwexConfig?.clientId && wwexConfig.clientSecret) liveAdapters.push(new WwexAdapter(wwexConfig));
  if (forwardAirConfig?.user && forwardAirConfig.password && forwardAirConfig.customerId && forwardAirConfig.billToNumber) {
    liveAdapters.push(new ForwardAirAdapter(forwardAirConfig));
  }
  return liveAdapters.length > 0 ? liveAdapters : configs.map((item) => new HttpCarrierAdapter(item));
}
