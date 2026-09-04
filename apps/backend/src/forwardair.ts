import { getQuoteDimensions, type QuoteDimensionInput, type QuoteRequestInput } from "@tms/shared";
import type { CarrierAdapter, CarrierQuoteOutcome } from "./carriers.js";
import type { ForwardAirApiConfig } from "./config.js";

const documentedPickupAccessorials: Record<string, string> = {
  "CFS Pickup": "CNP",
  "Airport Pickup": "ALP",
  "Inside Pickup": "IPU",
  "Liftgate Pickup": "LGP",
  "Pickup Appointment": "APP",
  "Residential Pickup": "RPU",
  "Hospital Pickup": "HPC",
  "Hotel Pickup": "HOT",
  "Military Base Pickup": "MBP",
  "Construction Site Pickup": "LTP",
  "Church Pickup": "LTP",
  "Resort Pickup": "LTP",
  "School Pickup": "LTP",
  "Prison Pickup": "LTP",
  "Country Club Pickup": "LTP",
  "Farm Pickup": "LTP",
  "Ranch Pickup": "LTP",
  "Camp Pickup": "LTP",
  "Park Pickup": "LTP"
};

const documentedDeliveryAccessorials: Record<string, string> = {
  "Inside Delivery": "IDE",
  "Liftgate Delivery": "LGD",
  "Delivery Appointment": "ADE",
  "Residential Delivery": "RDE",
  "Hospital Delivery": "HDC",
  "Hotel Delivery": "HOD",
  "Military Base Delivery": "MBD",
  "CFS Delivery": "CND",
  "Construction Site Delivery": "LTD",
  "Church Delivery": "LTD",
  "Resort Delivery": "LTD",
  "School Delivery": "LTD",
  "Prison Delivery": "LTD",
  "Country Club Delivery": "LTD",
  "Farm Delivery": "LTD",
  "Ranch Delivery": "LTD",
  "Camp Delivery": "LTD",
  "Park Delivery": "LTD"
};

function escapeXml(value: string | number): string {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function decodeXml(value: string): string {
  return value
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&amp;", "&");
}

function xmlText(xml: string, localName: string): string | null {
  const match = xml.match(new RegExp(`<(?:[\\w.-]+:)?${localName}\\b[^>]*>([\\s\\S]*?)<\\/(?:[\\w.-]+:)?${localName}>`, "i"));
  return match ? decodeXml(match[1].replace(/<[^>]+>/g, "").trim()) : null;
}

function numberFromXml(xml: string, localName: string): number | null {
  const text = xmlText(xml, localName);
  return text !== null && text !== "" && Number.isFinite(Number(text)) ? Number(text) : null;
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

function weightValue(dimension: QuoteDimensionInput): { value: number; type: "L" | "K" } {
  const kilograms = dimension.weightUnit.toLowerCase() === "kg";
  return { value: Math.round(dimension.weight * 100) / 100, type: kilograms ? "K" : "L" };
}

function countryCode(value: string): string {
  const normalized = value.trim().toUpperCase();
  return normalized === "USA" ? "US" : normalized === "CAN" ? "CA" : normalized === "MEX" ? "MX" : normalized;
}

function errorMessage(xml: string, status: number): string {
  for (const tag of ["ErrorMessage", "Message", "Description", "faultstring"]) {
    const value = xmlText(xml, tag);
    if (value) return `Forward Air API error (${status}): ${value}`;
  }
  const plainText = xml.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  return plainText
    ? `Forward Air API error (${status}): ${plainText.slice(0, 300)}`
    : `Forward Air API error (${status}).`;
}

export class ForwardAirAdapter implements CarrierAdapter {
  readonly key = "forward-air";
  readonly name = "Forward Air";

  constructor(private readonly config: ForwardAirApiConfig) {}

  async quote(input: QuoteRequestInput): Promise<CarrierQuoteOutcome> {
    if (!this.config.user || !this.config.password || !this.config.customerId || !this.config.billToNumber) {
      throw new Error("Forward Air credentials and billing account are not configured.");
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs);
    try {
      const response = await fetch(`${this.config.baseUrl}/ltlservices/v2/rest/waybills/quote`, {
        method: "POST",
        headers: {
          "Content-Type": "application/xml",
          Accept: "application/xml",
          user: this.config.user,
          password: this.config.password,
          customerId: this.config.customerId
        },
        body: this.buildRequest(input),
        signal: controller.signal
      });
      const payload = await response.text();
      if (!response.ok) throw new Error(errorMessage(payload, response.status));

      const quoteTotal = numberFromXml(payload, "QuoteTotal");
      if (quoteTotal === null) throw new Error(errorMessage(payload, response.status));
      const guaranteed = input.specialServices.general.includes("Guaranteed Service");
      return {
        status: "success",
        rateAmount: quoteTotal,
        currency: "USD",
        serviceLevel: guaranteed ? "Forward Expedited LTL · Guaranteed" : "Forward Expedited LTL",
        transitDays: numberFromXml(payload, "TransitDaysTotal"),
        rawResponse: payload,
        errorMessage: null
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  private buildRequest(input: QuoteRequestInput): string {
    const dimensionRows = getQuoteDimensions(input);
    const pickupMap = { ...documentedPickupAccessorials, ...this.config.pickupAccessorialMap };
    const deliveryMap = { ...documentedDeliveryAccessorials, ...this.config.deliveryAccessorialMap };
    const pickupCodes = [...new Set(input.specialServices.pickup.map((label) => pickupMap[label]).filter((code): code is string => Boolean(code)))];
    const deliveryLabels = input.specialServices.general.includes("Notification")
      ? [...input.specialServices.delivery, "Notification"]
      : input.specialServices.delivery;
    const deliveryCodes = [...new Set(deliveryLabels
      .map((label) => label === "Notification" ? "NOD" : deliveryMap[label])
      .filter((code): code is string => Boolean(code)))];
    const pickupAccessorials = pickupCodes.map((code) => `<PickupAccessorial>${escapeXml(code)}</PickupAccessorial>`).join("");
    const deliveryAccessorials = deliveryCodes.map((code) => `<DeliveryAccessorial>${escapeXml(code)}</DeliveryAccessorial>`).join("");
    const hazmat = dimensionRows.some((dimension) => dimension.hazmat) || input.specialServices.general.includes("HazMat");
    const freightDetails = dimensionRows.map((dimension) => {
      const weight = weightValue(dimension);
      return `<FreightDetail><FreightClass>${escapeXml(dimension.freightClass)}</FreightClass><Weight>${weight.value}</Weight><WeightType>${weight.type}</WeightType><Pieces>${escapeXml(dimension.quantity)}</Pieces><Description>${escapeXml(input.commodity)}</Description></FreightDetail>`;
    }).join("");
    const dimensions = dimensionRows.map((dimension) => {
      const converted = dimensionsInInches(dimension);
      return `<Dimension><Pieces>${escapeXml(dimension.quantity)}</Pieces><Length>${converted.length}</Length><Width>${converted.width}</Width><Height>${converted.height}</Height></Dimension>`;
    }).join("");

    return `<?xml version="1.0" encoding="UTF-8"?>
<FAQuoteRequest>
  <BillToCustomerNumber>${escapeXml(this.config.billToNumber!)}</BillToCustomerNumber>
  <ShipperCustomerNumber>${escapeXml(this.config.shipperNumber ?? this.config.billToNumber!)}</ShipperCustomerNumber>
  <Origin>
    <OriginAirportCode/>
    <OriginZipCode>${escapeXml(input.pickupLocation.zipCode)}</OriginZipCode>
    <OriginCountryCode>${escapeXml(countryCode(input.pickupLocation.country))}</OriginCountryCode>
    <Pickup><AirportPickup>N</AirportPickup>${pickupCodes.length ? `<PickupAccessorials>${pickupAccessorials}</PickupAccessorials>` : ""}</Pickup>
  </Origin>
  <Destination>
    <DestinationAirportCode/>
    <DestinationZipCode>${escapeXml(input.deliveryLocation.zipCode)}</DestinationZipCode>
    <DestinationCountryCode>${escapeXml(countryCode(input.deliveryLocation.country))}</DestinationCountryCode>
    <Delivery><AirportDelivery>N</AirportDelivery>${deliveryCodes.length ? `<DeliveryAccessorials>${deliveryAccessorials}</DeliveryAccessorials>` : ""}</Delivery>
  </Destination>
  <FreightDetails>${freightDetails}</FreightDetails>
  <Dimensions>${dimensions}</Dimensions>
  <Hazmat>${hazmat ? "Y" : "N"}</Hazmat>
  <InBondShipment>N</InBondShipment>
  <GuaranteedService>${input.specialServices.general.includes("Guaranteed Service") ? "Y" : "N"}</GuaranteedService>
  <DeclaredValue>0.00</DeclaredValue>
  <ShippingDate>${escapeXml(input.requestedDate)}</ShippingDate>
</FAQuoteRequest>`;
  }
}
