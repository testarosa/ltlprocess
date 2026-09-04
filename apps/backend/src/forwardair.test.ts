import assert from "node:assert/strict";
import type { QuoteRequestInput } from "@tms/shared";
import { ForwardAirAdapter } from "./forwardair.js";

const input: QuoteRequestInput = {
  requestedDate: "2026-08-24",
  requestedFrom: "Test Customer",
  commodity: "Crated motors & parts",
  pickupLocation: { zipCode: "90746", city: "Carson", state: "CA", country: "USA" },
  deliveryLocation: { zipCode: "48154", city: "Livonia", state: "MI", country: "US" },
  dimensions: {
    handlingUnit: "Pallet",
    length: 4,
    width: 3.5,
    height: 3,
    dimensionUnit: "ft",
    quantity: 2,
    weight: 1500,
    weightUnit: "lb",
    freightClass: "60",
    hazmat: false,
    stackable: true
  },
  specialServices: {
    general: ["Notification", "Guaranteed Service"],
    pickup: ["Liftgate Pickup", "Inside Pickup", "Church Pickup"],
    delivery: ["Residential Delivery", "Prison Delivery"],
    overLength: []
  }
};

const config = {
  baseUrl: "https://api.forwardair.com",
  user: "test-user",
  password: "test-password",
  customerId: "test-customer",
  billToNumber: "2326926",
  timeoutMs: 20000,
  pickupAccessorialMap: {},
  deliveryAccessorialMap: {}
};

async function main() {
  const originalFetch = globalThis.fetch;
  let capturedUrl = "";
  let capturedInit: RequestInit | undefined;
  globalThis.fetch = async (url, init) => {
    capturedUrl = String(url);
    capturedInit = init;
    return new Response(`<?xml version="1.0"?><FAQuoteResponse>
      <QuoteTotal>400.39</QuoteTotal><TotalWeight>1500.0</TotalWeight>
      <TransitDaysTotal>3</TransitDaysTotal><ChargeLineItems><ChargeLineItem>
      <Code>FSC</Code><Description>FSC</Description><Amount>57.50</Amount>
      </ChargeLineItem></ChargeLineItems></FAQuoteResponse>`, {
      status: 200,
      headers: { "Content-Type": "application/xml" }
    });
  };

  try {
    const adapter = new ForwardAirAdapter(config);
    const result = await adapter.quote(input);
    const headers = new Headers(capturedInit?.headers);
    const body = String(capturedInit?.body);

    assert.equal(capturedUrl, "https://api.forwardair.com/ltlservices/v2/rest/waybills/quote");
    assert.equal(capturedInit?.method, "POST");
    assert.equal(headers.get("Content-Type"), "application/xml");
    assert.equal(headers.get("user"), "test-user");
    assert.equal(headers.get("password"), "test-password");
    assert.equal(headers.get("customerId"), "test-customer");
    assert.match(body, /<BillToCustomerNumber>2326926<\/BillToCustomerNumber>/);
    assert.match(body, /<ShipperCustomerNumber>2326926<\/ShipperCustomerNumber>/);
    assert.match(body, /<OriginCountryCode>US<\/OriginCountryCode>/);
    assert.match(body, /<PickupAccessorial>LGP<\/PickupAccessorial>/);
    assert.match(body, /<PickupAccessorial>IPU<\/PickupAccessorial>/);
    assert.match(body, /<PickupAccessorial>LTP<\/PickupAccessorial>/);
    assert.match(body, /<DeliveryAccessorial>RDE<\/DeliveryAccessorial>/);
    assert.match(body, /<DeliveryAccessorial>LTD<\/DeliveryAccessorial>/);
    assert.match(body, /<DeliveryAccessorial>NOD<\/DeliveryAccessorial>/);
    assert.match(body, /<Length>48<\/Length><Width>42<\/Width><Height>36<\/Height>/);
    assert.match(body, /<Description>Crated motors &amp; parts<\/Description>/);
    assert.match(body, /<GuaranteedService>Y<\/GuaranteedService>/);
    assert.equal(result.rateAmount, 400.39);
    assert.equal(result.transitDays, 3);
    assert.equal(result.serviceLevel, "Forward Expedited LTL · Guaranteed");
    assert.equal(result.rawResponse?.includes("ChargeLineItem"), true);

    globalThis.fetch = async () => new Response(
      "<FAError><ErrorMessage>Invalid bill-to account</ErrorMessage></FAError>",
      { status: 400, headers: { "Content-Type": "application/xml" } }
    );
    await assert.rejects(() => adapter.quote(input), /Invalid bill-to account/);

    console.log("Forward Air REST adapter tests passed.");
  } finally {
    globalThis.fetch = originalFetch;
  }
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
