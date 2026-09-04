import assert from "node:assert/strict";
import type { QuoteRequestInput } from "@tms/shared";
import { ThreePlSystemsAdapter } from "./carriers.js";

const input: QuoteRequestInput = {
  requestedDate: "2026-08-20",
  requestedFrom: "Test Customer",
  commodity: "Boxed grills",
  pickupLocation: { zipCode: "30071", city: "Norcross", state: "GA", country: "US" },
  deliveryLocation: { zipCode: "33467", city: "Lake Worth", state: "FL", country: "US" },
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
    pickup: ["Liftgate Pickup"],
    delivery: ["Residential Delivery"],
    overLength: ["8ft"]
  }
};

async function main() {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ url: string; init?: RequestInit }> = [];

  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    if (String(url).endsWith("/connect/token")) {
      return new Response(JSON.stringify({ token_type: "Bearer", access_token: "test-token", expires_in: 86400 }), { status: 200 });
    }
    if (String(url).endsWith("/api/v1/accessorial")) {
      return new Response(JSON.stringify([
        { code: "NOTY", description: "Notify Before Delivery" },
        { code: "LGPK", description: "Lift Gate Pickup" },
        { code: "EXLG", description: "Excessive Length" },
        { code: "RSDE", description: "Residential Delivery" }
      ]), { status: 200 });
    }
    if (String(url).endsWith("/api/v1/RatingWithRateQuoteIdAndBillTo")) {
      return new Response(JSON.stringify([
        { name: "Roadrunner Transportation Systems", scac: "RDFS", billed: 201.44, transitTime: "4", rateQuoteId: "rdfs-expensive", serviceType: "Standard Tariff", billTo: { accountNumber: "first" } },
        { name: "FedEx LTL Priority", scac: "FXFE", billed: 225.58, transitTime: "1", rateQuoteId: "fxfe-standard", serviceType: "Standard" },
        { name: "Roadrunner Transportation Systems", scac: "RDFS", billed: 173.14, transitTime: "4", rateQuoteId: "rdfs-lowest", serviceType: "Dynamic", serviceDescription: "Dynamic Pricing", billTo: { accountNumber: "second" } },
        { name: "Roadrunner Transportation Systems", scac: "RDFS", billed: 260.12, transitTime: "3", rateQuoteId: "rdfs-guaranteed", serviceType: "Guaranteed" },
        { name: "Partner House Rate", billed: 190, transitTime: "2", rateQuoteId: "house-a", serviceType: "Standard" },
        { name: "Partner House Rate", billed: 180, transitTime: "2", rateQuoteId: "house-b", serviceType: "Standard" }
      ]), { status: 200 });
    }
    return new Response("Not found", { status: 404 });
  };

  try {
    const adapter = new ThreePlSystemsAdapter({
      baseUrl: "https://3pl.hyperiontms.com",
      clientId: "test-client-id",
      clientSecret: "test-client-secret",
      timeoutMs: 15000
    });
    const result = await adapter.quote(input);

    assert.equal(calls.length, 3);
    const tokenBody = new URLSearchParams(String(calls[0].init?.body));
    assert.equal(tokenBody.get("client_id"), "test-client-id");
    assert.equal(tokenBody.get("client_secret"), "test-client-secret");
    assert.equal(tokenBody.get("grant_type"), "client_credentials");

    assert.equal(new Headers(calls[1].init?.headers).get("Authorization"), "Bearer test-token");
    assert.equal(new Headers(calls[2].init?.headers).get("Authorization"), "Bearer test-token");
    const ratingBody = JSON.parse(String(calls[2].init?.body)) as Record<string, any>;
    assert.equal(ratingBody.shipmentMode, "LTL");
    assert.equal(ratingBody.equipmentType, "StraightVan");
    assert.equal(ratingBody.miles, "0");
    assert.deepEqual(ratingBody.accessorials, ["NOTY", "LGPK", "RSDE", "EXLG"]);
    assert.equal(ratingBody.items[0].class, "70");
    assert.equal(ratingBody.items[0].pieces, 4);
    assert.equal(ratingBody.items[0].weight, 4800);
    assert.equal(ratingBody.items[0].packaging, "Pallets");
    assert.equal(ratingBody.items[0].density, "0");
    assert.equal(ratingBody.items[0].unitsWeight, "0");
    assert.equal(ratingBody.items[0].unitsDensity, "0");
    assert.equal(ratingBody.items[0].unitsDimension, "0");
    assert.equal(result.length, 5);
    assert.equal(result[0].carrierName, "Roadrunner Transportation Systems");
    assert.equal(result[0].rateAmount, 173.14);
    assert.equal(result[0].transitDays, 4);
    assert.equal(result[0].carrierKey, "3pl-systems:rdfs:rdfs-lowest");
    assert.equal(result.filter((rate) => rate.carrierName === "Roadrunner Transportation Systems").length, 2);
    assert.equal(result.some((rate) => rate.carrierName === "FedEx LTL Priority"), true);
    assert.equal(result.filter((rate) => rate.carrierName === "Partner House Rate").length, 2);
    const guaranteed = result.find((rate) => rate.carrierKey === "3pl-systems:rdfs:rdfs-guaranteed");
    assert.equal(guaranteed?.serviceLevel, "Guaranteed");

    console.log("3PL Systems rating adapter tests passed.");
  } finally {
    globalThis.fetch = originalFetch;
  }
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
