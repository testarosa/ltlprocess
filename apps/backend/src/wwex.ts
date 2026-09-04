import { getQuoteDimensions, type QuoteDimensionInput, type QuoteRequestInput } from "@tms/shared";
import type { CarrierAdapter, IdentifiedCarrierQuoteOutcome } from "./carriers.js";
import type { WwexApiConfig } from "./config.js";

interface WwexTokenResponse {
  access_token?: unknown;
  expires_in?: unknown;
}

interface WwexMoney {
  value?: unknown;
  unit?: unknown;
}

interface WwexTimeInTransit {
  scac?: unknown;
  transitDays?: unknown;
  serviceLevel?: unknown;
  serviceDescription?: unknown;
}

interface WwexOfferedProduct {
  shopRQShipment?: { timeInTransit?: WwexTimeInTransit };
  cubicMinWarning?: unknown;
}

interface WwexOffer {
  offerId?: unknown;
  productTransactionId?: unknown;
  totalOfferPrice?: WwexMoney;
  primaryVendor?: { preferredName?: unknown; scac?: unknown; vendorId?: unknown };
  offeredProductList?: WwexOfferedProduct[];
}

interface WwexShopResponse {
  clientStatus?: { success?: unknown; message?: unknown };
  response?: { offerList?: WwexOffer[]; message?: unknown };
  message?: unknown;
}

const packagingTypes: Record<string, string> = {
  bag: "BAG",
  bale: "BALE",
  box: "BOX",
  bundle: "BUNDLE",
  carton: "CARTON",
  case: "CASE",
  crate: "CRATE",
  cylinder: "CYLINDER",
  drum: "DRUM",
  pail: "PAIL",
  pallet: "PLT",
  pallets: "PLT",
  piece: "PIECES",
  pieces: "PIECES",
  reel: "REEL",
  roll: "ROLL",
  skid: "SKID",
  skids: "SKID",
  tank: "TANK",
  tote: "TOTE",
  trailer: "TRAILER",
  tube: "TUBE"
};

function numberOrNull(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return null;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function dimensionsInInches(dimension: QuoteDimensionInput): { length: number; width: number; height: number } {
  const unit = dimension.dimensionUnit.toLowerCase();
  const multiplier = unit === "ft" ? 12 : unit === "cm" ? 0.3937007874 : 1;
  return {
    length: Math.round(dimension.length * multiplier * 100) / 100,
    width: Math.round(dimension.width * multiplier * 100) / 100,
    height: Math.round(dimension.height * multiplier * 100) / 100
  };
}

function weightInPounds(dimension: QuoteDimensionInput): number {
  const multiplier = dimension.weightUnit.toLowerCase() === "kg" ? 2.2046226218 : 1;
  return Math.round(dimension.weight * multiplier * 100) / 100;
}

function locationType(services: string[]): string | null {
  if (services.some((service) => service.includes("Residential"))) return "RESIDENTIAL";
  if (services.some((service) => service.includes("Airport"))) return "AIRPORT";
  if (services.some((service) => service.includes("CFS"))) return "CONTAINER_FREIGHT_STATION";
  if (services.some((service) => service.includes("Construction"))) return "CONSTRUCTION";
  if (services.some((service) => /Church|Hospital|Hotel|Resort|Military|Prison|Country Club|Farm|Ranch|Camp|Park/.test(service))) {
    return "LIMITED_ACCESS";
  }
  return null;
}

function errorMessage(payload: unknown, status: number): string {
  if (payload && typeof payload === "object") {
    const response = payload as WwexShopResponse;
    const message = stringOrNull(response.clientStatus?.message) ?? stringOrNull(response.response?.message) ?? stringOrNull(response.message);
    if (message) return `WWEX request failed (${status}): ${message}`;
  }
  return `WWEX request failed (${status}).`;
}

function shopFlowUrl(apiBaseUrl: string): string {
  const baseUrl = apiBaseUrl.replace(/\/+$/, "");
  return `${baseUrl}${baseUrl.toLowerCase().endsWith("/svc") ? "" : "/svc"}/shopFlow`;
}

export function extractWwexCubicMinimumWarning(rawResponse: string | null): string | null {
  if (!rawResponse) return null;

  try {
    const offer = JSON.parse(rawResponse) as WwexOffer;
    if (!Array.isArray(offer.offeredProductList)) return null;

    const warnings = offer.offeredProductList
      .map((product) => stringOrNull(product.cubicMinWarning))
      .filter((warning): warning is string => Boolean(warning));
    return [...new Set(warnings)].join(" ") || null;
  } catch {
    return null;
  }
}

export class WwexAdapter implements CarrierAdapter {
  readonly key = "wwex";
  readonly name = "WWEX";
  private token: { value: string; expiresAt: number } | null = null;

  constructor(private readonly config: WwexApiConfig) {}

  async quote(input: QuoteRequestInput): Promise<IdentifiedCarrierQuoteOutcome[]> {
    if (getQuoteDimensions(input).some((dimension) => dimension.hazmat) || input.specialServices.general.includes("HazMat")) {
      throw new Error("WWEX hazardous-material rating requires UN/NA ID, hazard class, packing group, and emergency-contact fields that are not collected by this quote form.");
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs);
    try {
      const token = await this.getToken(controller.signal);
      const response = await fetch(shopFlowUrl(this.config.apiBaseUrl), {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(this.buildRequest(input)),
        signal: controller.signal
      });
      const payload = (await response.json().catch(() => null)) as WwexShopResponse | null;
      if (!response.ok || payload?.clientStatus?.success === false) {
        throw new Error(errorMessage(payload, response.status));
      }

      const offers = payload?.response?.offerList;
      if (!Array.isArray(offers)) throw new Error("WWEX returned an invalid shopFlow response.");
      return offers.map((offer, index) => this.normalizeOffer(offer, index));
    } finally {
      clearTimeout(timeout);
    }
  }

  buildRequest(input: QuoteRequestInput): Record<string, unknown> {
    const dimensionRows = getQuoteDimensions(input);
    const totalWeight = dimensionRows.reduce((total, dimension) => total + weightInPounds(dimension), 0);
    const totalHandlingUnits = dimensionRows.reduce((total, dimension) => total + dimension.quantity, 0);
    const pickup = input.specialServices.pickup;
    const delivery = input.specialServices.delivery;
    const general = input.specialServices.general;

    return {
      request: {
        productType: "LTL",
        returnSelectedServiceOnly: false,
        shipment: {
          appointmentDeliveryFlag: delivery.includes("Delivery Appointment"),
          originAddress: {
            address: {
              addressLineList: [],
              locality: input.pickupLocation.city,
              region: input.pickupLocation.state,
              postalCode: input.pickupLocation.zipCode,
              countryCode: input.pickupLocation.country.toUpperCase(),
              companyName: input.requestedFrom,
              contactList: []
            },
            locationType: locationType(pickup)
          },
          handlingCharge: null,
          handlingUnitList: dimensionRows.map((dimension) => {
            const converted = dimensionsInInches(dimension);
            const weight = weightInPounds(dimension);
            const packagingType = packagingTypes[dimension.handlingUnit.trim().toLowerCase()] ?? "PLT";
            return {
            billedDimension: {
              length: { value: converted.length, unit: "in" },
              width: { value: converted.width, unit: "in" },
              height: { value: converted.height, unit: "in" },
              dimensionType: "NET"
            },
            isMixedClass: false,
            isStackable: dimension.stackable,
            packagingType,
            quantity: dimension.quantity,
            shippedItemList: [{
              commodityClass: dimension.freightClass,
              commodityDescription: input.commodity,
              commodityType: packagingType,
              dimensions: {
                length: { value: null, unit: "in" },
                width: { value: null, unit: "in" },
                height: { value: null, unit: "in" },
                dimensionType: "NET"
              },
              hazMatItemInfo: null,
              isHazMat: false,
              NMFCNbr: null,
              quantity: String(dimension.quantity),
              weight: { value: weight, unit: "LB" }
            }],
            weight: { value: weight, unit: "LB" }
          };
          }),
          destinationAddress: {
            address: {
              addressLineList: [],
              locality: input.deliveryLocation.city,
              region: input.deliveryLocation.state,
              postalCode: input.deliveryLocation.zipCode,
              countryCode: input.deliveryLocation.country.toUpperCase(),
              companyName: "",
              contactList: []
            },
            locationType: locationType(delivery)
          },
          protectionFromColdFlag: delivery.includes("Protect from Freeze"),
          residentialPickupFlag: pickup.includes("Residential Pickup"),
          shipmentDate: `${input.requestedDate} 00:00:00`,
          sortAndSegregateFlag: false,
          isGuaranteed: general.includes("Guaranteed Service"),
          totalHandlingUnitCount: totalHandlingUnits,
          totalWeight: { value: Math.round(totalWeight * 100) / 100, unit: "LB" },
          tradeshowDeliveryFlag: false,
          tradeshowDeliveryName: "",
          tradeshowPickupFlag: false,
          tradeshowPickupName: "",
          marksNumbers: "",
          holdAtTerminalFlag: false,
          insideDeliveryFlag: delivery.includes("Inside Delivery"),
          insidePickupFlag: pickup.includes("Inside Pickup"),
          carrierTerminalPickupFlag: false,
          insuranceRequestFlag: false,
          insuredMarksNumbers: "",
          liftgateDeliveryFlag: delivery.includes("Liftgate Delivery"),
          liftgatePickupFlag: pickup.includes("Liftgate Pickup"),
          constructionSiteDeliveryFlag: delivery.includes("Construction Site Delivery"),
          constructionSitePickupFlag: pickup.includes("Construction Site Pickup"),
          notifyBeforeDeliveryFlag: general.includes("Notification")
        }
      }
    };
  }

  private async getToken(signal: AbortSignal): Promise<string> {
    if (this.token && this.token.expiresAt > Date.now() + 60_000) return this.token.value;
    if (!this.config.clientId || !this.config.clientSecret) throw new Error("WWEX credentials are not configured.");

    const response = await fetch(this.config.authUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: this.config.clientId,
        client_secret: this.config.clientSecret,
        audience: this.config.audience
      }),
      signal
    });
    const payload = (await response.json().catch(() => null)) as WwexTokenResponse | null;
    if (!response.ok || typeof payload?.access_token !== "string") {
      throw new Error(`WWEX authentication failed (${response.status}).`);
    }

    const expiresIn = numberOrNull(payload.expires_in) ?? 3600;
    this.token = { value: payload.access_token, expiresAt: Date.now() + expiresIn * 1000 };
    return this.token.value;
  }

  private normalizeOffer(offer: WwexOffer, index: number): IdentifiedCarrierQuoteOutcome {
    const product = Array.isArray(offer.offeredProductList) ? offer.offeredProductList[0] : undefined;
    const transit = product?.shopRQShipment?.timeInTransit;
    const scac = stringOrNull(offer.primaryVendor?.scac) ?? stringOrNull(offer.primaryVendor?.vendorId) ?? stringOrNull(transit?.scac) ?? `carrier-${index + 1}`;
    const carrierName = stringOrNull(offer.primaryVendor?.preferredName) ?? scac;
    const offerId = stringOrNull(offer.offerId) ?? String(index);
    const amount = numberOrNull(offer.totalOfferPrice?.value);
    const serviceLevel = [stringOrNull(transit?.serviceLevel), stringOrNull(transit?.serviceDescription)]
      .filter((value): value is string => Boolean(value))
      .join(" · ");

    return {
      carrierKey: `${this.key}:${scac.toLowerCase()}:${offerId}`,
      carrierName,
      status: amount === null ? "unavailable" : "success",
      rateAmount: amount,
      currency: stringOrNull(offer.totalOfferPrice?.unit) ?? "USD",
      serviceLevel: serviceLevel || null,
      transitDays: numberOrNull(transit?.transitDays),
      rawResponse: JSON.stringify(offer),
      errorMessage: amount === null ? "WWEX carrier did not return a total offer price." : null
    };
  }
}
