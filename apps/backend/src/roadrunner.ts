import { getQuoteDimensions, type QuoteRequestInput } from "@tms/shared";
import type { CarrierAdapter, IdentifiedCarrierQuoteOutcome } from "./carriers.js";
import type { RoadrunnerApiConfig } from "./config.js";

const SOAP_NAMESPACE = "https://webservices.rrts.com/ratequote/";
const validFreightClasses = new Set([50, 55, 60, 65, 70, 77.5, 85, 92.5, 100, 110, 125, 150, 175, 200, 250, 300, 400, 500]);

const documentedAccessorials: Record<string, string> = {
  HazMat: "HAZ",
  Notification: "NC",
  "CFS Pickup": "CFS",
  "Airport Pickup": "AIP",
  "Inside Pickup": "IP",
  "Liftgate Pickup": "LGP",
  "Pickup Appointment": "APT",
  "Residential Pickup": "RSP",
  "Construction Site Pickup": "CSP",
  "Church Pickup": "CHP",
  "Hotel Pickup": "HHP",
  "Resort Pickup": "CPP",
  "School Pickup": "SHP",
  "Military Base Pickup": "LTP",
  "Prison Pickup": "LTP",
  "Country Club Pickup": "CCP",
  "Farm Pickup": "FAP",
  "Ranch Pickup": "FAP",
  "Camp Pickup": "CPP",
  "Park Pickup": "CPP",
  "Inside Delivery": "ID",
  "Liftgate Delivery": "LGD",
  "Delivery Appointment": "APT",
  "Residential Delivery": "RSD",
  "Construction Site Delivery": "CSD",
  "Church Delivery": "CHD",
  "Hospital Delivery": "NHD",
  "Hotel Delivery": "HHD",
  "Resort Delivery": "CPD",
  "School Delivery": "LTD",
  "Military Base Delivery": "LTD",
  "Prison Delivery": "PSD",
  "Country Club Delivery": "CCD",
  "CFS Delivery": "CFD",
  "Farm Delivery": "FAD",
  "Ranch Delivery": "FAD",
  "Camp Delivery": "CPD",
  "Park Delivery": "CPD",
  "Protect from Freeze": "PSC"
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
  if (!match) return null;
  return decodeXml(match[1].replace(/<[^>]+>/g, "").trim());
}

function numberFromXml(xml: string, localName: string): number | null {
  const value = xmlText(xml, localName);
  if (value === null || value === "" || !Number.isFinite(Number(value))) return null;
  return Number(value);
}

function totalWeightInPounds(input: QuoteRequestInput): number {
  return Math.round(getQuoteDimensions(input).reduce((total, dimension) => {
    const multiplier = dimension.weightUnit.toLowerCase() === "kg" ? 2.20462 : 1;
    return total + dimension.weight * multiplier;
  }, 0));
}

function totalCubicFeet(input: QuoteRequestInput): number {
  return getQuoteDimensions(input).reduce((total, dimension) => {
    const unit = dimension.dimensionUnit.toLowerCase();
    const inchesPerUnit = unit === "ft" ? 12 : unit === "cm" ? 0.3937007874 : 1;
    return total + dimension.length * dimension.width * dimension.height * inchesPerUnit ** 3 * dimension.quantity / 1728;
  }, 0);
}

function overLengthCode(overLength: string[]): string | null {
  const maximumFeet = Math.max(0, ...overLength.map((value) => Number.parseInt(value, 10)).filter(Number.isFinite));
  if (maximumFeet >= 21) return "EXO";
  if (maximumFeet >= 17) return "EXL";
  if (maximumFeet >= 13) return "EXN";
  if (maximumFeet >= 8) return "EXM";
  return null;
}

function requestedAccessorials(input: QuoteRequestInput, config: RoadrunnerApiConfig, includeGuaranteedCode: boolean): string[] {
  const labels = [
    ...input.specialServices.general.filter((label) => label !== "Guaranteed Service"),
    ...input.specialServices.pickup,
    ...input.specialServices.delivery
  ];
  if (getQuoteDimensions(input).some((dimension) => dimension.hazmat) && !labels.includes("HazMat")) labels.push("HazMat");

  const mappings = { ...documentedAccessorials, ...config.accessorialMap };
  const codes = labels.map((label) => mappings[label]).filter((code): code is string => Boolean(code));
  const lengthCode = overLengthCode(input.specialServices.overLength);
  if (lengthCode) codes.push(lengthCode);
  if (includeGuaranteedCode) codes.push("PP");
  return [...new Set(codes)].slice(0, 15);
}

function operationFor(input: QuoteRequestInput, config: RoadrunnerApiConfig): { name: string; guaranteed: boolean } {
  const guaranteed = input.specialServices.general.includes("Guaranteed Service");
  if (config.account) {
    return { name: guaranteed ? "RateQuoteByAccountWithGuarV2" : "RateQuoteByAccountV2", guaranteed };
  }
  return { name: guaranteed ? "RateQuoteWithGuarV2" : "RateQuoteV2", guaranteed };
}

export class RoadrunnerAdapter implements CarrierAdapter {
  readonly key = "roadrunner";
  readonly name = "Roadrunner";

  constructor(private readonly config: RoadrunnerApiConfig) {}

  async quote(input: QuoteRequestInput): Promise<IdentifiedCarrierQuoteOutcome[]> {
    if (!this.config.applicationId || !this.config.apiKey) {
      throw new Error("Roadrunner credentials are not configured.");
    }

    const invalidDimension = getQuoteDimensions(input).find((dimension) => !validFreightClasses.has(Number(dimension.freightClass)));
    if (invalidDimension) {
      throw new Error(`Roadrunner does not accept freight class ${invalidDimension.freightClass || "(blank)"}.`);
    }

    const operation = operationFor(input, this.config);
    const requestXml = this.buildSoapRequest(input, operation.name);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs);

    try {
      const response = await fetch(this.config.baseUrl, {
        method: "POST",
        headers: {
          "Content-Type": "text/xml; charset=utf-8",
          SOAPAction: `"${SOAP_NAMESPACE}${operation.name}"`
        },
        body: requestXml,
        signal: controller.signal
      });
      const responseXml = await response.text();
      const fault = xmlText(responseXml, "faultstring") ?? xmlText(responseXml, "Text");
      if (!response.ok || fault) {
        throw new Error(fault || `Roadrunner rate request failed (${response.status}).`);
      }

      return this.normalizeResponse(responseXml, operation.guaranteed);
    } finally {
      clearTimeout(timeout);
    }
  }

  buildSoapRequest(input: QuoteRequestInput, operationName = operationFor(input, this.config).name): string {
    const serviceCodes = requestedAccessorials(input, this.config, false);
    const serviceOptions = serviceCodes.length > 0
      ? `<rr:ServiceDeliveryOptions>${serviceCodes.map((code) => `<rr:ServiceOptions><rr:ServiceCode>${escapeXml(code)}</rr:ServiceCode></rr:ServiceOptions>`).join("")}</rr:ServiceDeliveryOptions>`
      : "";
    const site = this.config.site ? `<rr:Site>${escapeXml(this.config.site)}</rr:Site>` : "";
    const account = this.config.account ? `<rr:Account>${escapeXml(this.config.account)}</rr:Account>` : "";
    const dimensions = getQuoteDimensions(input);
    const palletCount = dimensions.reduce((total, dimension) => total + (dimension.handlingUnit.toLowerCase() === "pallet" ? dimension.quantity : 0), 0);
    const shipmentDetails = dimensions.map((dimension) => `<rr:ShipmentDetail><rr:ActualClass>${escapeXml(dimension.freightClass)}</rr:ActualClass><rr:Weight>${Math.round(dimension.weight * (dimension.weightUnit.toLowerCase() === "kg" ? 2.20462 : 1))}</rr:Weight></rr:ShipmentDetail>`).join("");
    const shipDate = `${input.requestedDate}T00:00:00`;

    return `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/" xmlns:rr="${SOAP_NAMESPACE}">
  <soap:Header>
    <rr:AuthenticationHeader>
      <rr:UserName>${escapeXml(this.config.applicationId ?? "")}</rr:UserName>
      <rr:Password>${escapeXml(this.config.apiKey ?? "")}</rr:Password>
      ${site}
    </rr:AuthenticationHeader>
  </soap:Header>
  <soap:Body>
    <rr:${operationName}>
      <rr:request>
        <rr:OriginZip>${escapeXml(input.pickupLocation.zipCode)}</rr:OriginZip>
        <rr:DestinationZip>${escapeXml(input.deliveryLocation.zipCode)}</rr:DestinationZip>
        <rr:ShipmentDetails>${shipmentDetails}</rr:ShipmentDetails>
        <rr:OriginType>O</rr:OriginType>
        <rr:PaymentType>P</rr:PaymentType>
        <rr:PalletCount>${palletCount}</rr:PalletCount>
        <rr:LinearFeet>0</rr:LinearFeet>
        <rr:CubicFeet>${Math.ceil(totalCubicFeet(input))}</rr:CubicFeet>
        <rr:Pieces>${Math.round(dimensions.reduce((total, dimension) => total + dimension.quantity, 0))}</rr:Pieces>
        ${serviceOptions}
        <rr:PalletPosition></rr:PalletPosition>
        <rr:ShipDate>${escapeXml(shipDate)}</rr:ShipDate>
        ${account}
        <rr:InsuredAmount>0</rr:InsuredAmount>
      </rr:request>
    </rr:${operationName}>
  </soap:Body>
</soap:Envelope>`;
  }

  private normalizeResponse(responseXml: string, guaranteedRequested: boolean): IdentifiedCarrierQuoteOutcome[] {
    const netCharge = numberFromXml(responseXml, "NetCharge");
    const quoteNumber = xmlText(responseXml, "QuoteNumber") ?? "unknown";
    const transitDays = numberFromXml(responseXml, "EstimatedTransitDays");
    if (netCharge === null || netCharge < 0) {
      throw new Error(xmlText(responseXml, "ExtraMessages") || "Roadrunner did not return a valid rate.");
    }

    const base = {
      status: "success" as const,
      currency: "USD",
      transitDays,
      rawResponse: responseXml,
      errorMessage: null
    };
    const guaranteedCharge = guaranteedRequested ? numberFromXml(responseXml, "Guaranteed") : null;
    if (guaranteedCharge !== null && guaranteedCharge > 0 && netCharge >= guaranteedCharge) {
      return [
        {
          ...base,
          carrierKey: `${this.key}:rrts-standard:${quoteNumber}`,
          carrierName: "Roadrunner Standard",
          rateAmount: Math.round((netCharge - guaranteedCharge) * 100) / 100,
          serviceLevel: "Standard"
        },
        {
          ...base,
          carrierKey: `${this.key}:rrts-guaranteed:${quoteNumber}`,
          carrierName: "Roadrunner Guaranteed",
          rateAmount: netCharge,
          serviceLevel: "Guaranteed"
        }
      ];
    }

    return [{
      ...base,
      carrierKey: `${this.key}:rrts:${quoteNumber}`,
      carrierName: "Roadrunner",
      rateAmount: netCharge,
      serviceLevel: "Standard"
    }];
  }
}
