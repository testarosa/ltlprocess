import assert from "node:assert/strict";
import type { QuoteRequestInput } from "@tms/shared";
import type { RoadrunnerApiConfig } from "./config.js";
import { RoadrunnerAdapter } from "./roadrunner.js";

const baseInput: QuoteRequestInput = {
  requestedDate: "2026-08-20",
  requestedFrom: "Test Customer",
  commodity: "Boxed grills",
  pickupLocation: { zipCode: "90210", city: "Beverly Hills", state: "CA", country: "US" },
  deliveryLocation: { zipCode: "60606", city: "Chicago", state: "IL", country: "US" },
  dimensions: {
    handlingUnit: "Pallet",
    length: 48,
    width: 40,
    height: 60,
    dimensionUnit: "in",
    quantity: 4,
    weight: 4800,
    weightUnit: "lb",
    freightClass: "70",
    hazmat: false,
    stackable: false
  },
  specialServices: {
    general: ["Notification"],
    pickup: ["Liftgate Pickup", "Military Base Pickup"],
    delivery: ["Residential Delivery", "School Delivery"],
    overLength: ["13ft"]
  }
};

const config: RoadrunnerApiConfig = {
  baseUrl: "https://webservices.rrts.com/rating/ratequote.asmx",
  applicationId: "test-application-id",
  apiKey: "test-api-key",
  timeoutMs: 20000,
  accessorialMap: {}
};

const standardResponse = `<?xml version="1.0"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <RateQuoteV2Response xmlns="https://webservices.rrts.com/ratequote/">
      <RateQuoteV2Result>
        <QuoteNumber>12345</QuoteNumber>
        <NetCharge>1234.56</NetCharge>
        <RoutingInfo><EstimatedTransitDays>3</EstimatedTransitDays></RoutingInfo>
      </RateQuoteV2Result>
    </RateQuoteV2Response>
  </soap:Body>
</soap:Envelope>`;

async function main() {
  const originalFetch = globalThis.fetch;
  let capturedInit: RequestInit | undefined;
  globalThis.fetch = async (_url, init) => {
    capturedInit = init;
    return new Response(standardResponse, { status: 200, headers: { "Content-Type": "text/xml" } });
  };

  try {
    const adapter = new RoadrunnerAdapter(config);
    const result = await adapter.quote(baseInput);
    const requestBody = String(capturedInit?.body);
    const headers = new Headers(capturedInit?.headers);

    assert.equal(headers.get("SOAPAction"), '"https://webservices.rrts.com/ratequote/RateQuoteV2"');
    assert.match(requestBody, /<rr:UserName>test-application-id<\/rr:UserName>/);
    assert.match(requestBody, /<rr:Password>test-api-key<\/rr:Password>/);
    assert.match(requestBody, /<rr:OriginZip>90210<\/rr:OriginZip>/);
    assert.match(requestBody, /<rr:ActualClass>70<\/rr:ActualClass>/);
    assert.match(requestBody, /<rr:Weight>4800<\/rr:Weight>/);
    assert.match(requestBody, /<rr:CubicFeet>267<\/rr:CubicFeet>/);
    assert.match(requestBody, /<rr:ServiceCode>NC<\/rr:ServiceCode>/);
    assert.match(requestBody, /<rr:ServiceCode>LGP<\/rr:ServiceCode>/);
    assert.match(requestBody, /<rr:ServiceCode>LTP<\/rr:ServiceCode>/);
    assert.match(requestBody, /<rr:ServiceCode>RSD<\/rr:ServiceCode>/);
    assert.match(requestBody, /<rr:ServiceCode>LTD<\/rr:ServiceCode>/);
    assert.match(requestBody, /<rr:ServiceCode>EXN<\/rr:ServiceCode>/);
    assert.equal(result.length, 1);
    assert.equal(result[0].carrierName, "Roadrunner");
    assert.equal(result[0].rateAmount, 1234.56);
    assert.equal(result[0].transitDays, 3);

    globalThis.fetch = async () => new Response(`
      <soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body>
        <RateQuoteWithGuarV2Response xmlns="https://webservices.rrts.com/ratequote/">
          <RateQuoteWithGuarV2Result><Guaranteed>150</Guaranteed><RateQuoteResult>
            <QuoteNumber>67890</QuoteNumber><NetCharge>1300</NetCharge>
            <RoutingInfo><EstimatedTransitDays>2</EstimatedTransitDays></RoutingInfo>
          </RateQuoteResult></RateQuoteWithGuarV2Result>
        </RateQuoteWithGuarV2Response>
      </soap:Body></soap:Envelope>
    `, { status: 200 });

    const guaranteedResult = await adapter.quote({
      ...baseInput,
      specialServices: { ...baseInput.specialServices, general: ["Guaranteed Service"] }
    });
    assert.equal(guaranteedResult.length, 2);
    assert.equal(guaranteedResult[0].rateAmount, 1150);
    assert.equal(guaranteedResult[1].rateAmount, 1300);
    assert.equal(guaranteedResult[1].serviceLevel, "Guaranteed");

    globalThis.fetch = async () => new Response(`
      <soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body><soap:Fault>
        <faultcode>soap:Client</faultcode><faultstring>Invalid user</faultstring>
      </soap:Fault></soap:Body></soap:Envelope>
    `, { status: 500 });
    await assert.rejects(() => adapter.quote(baseInput), /Invalid user/);

    console.log("Roadrunner SOAP adapter tests passed.");
  } finally {
    globalThis.fetch = originalFetch;
  }
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
