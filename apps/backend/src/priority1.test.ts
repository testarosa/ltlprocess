import assert from "node:assert/strict";
import type { QuoteRequestInput } from "@tms/shared";
import { PriorityOneAdapter } from "./priority1.js";

const input: QuoteRequestInput = {
  requestedDate: "2026-07-23",
  requestedFrom: "Test Customer",
  commodity: "Boxed grills",
  pickupLocation: { zipCode: "72205", city: "Little Rock", state: "AR", country: "US" },
  deliveryLocation: { zipCode: "60606", city: "Chicago", state: "IL", country: "US" },
  dimensions: {
    handlingUnit: "Pallet",
    length: 48,
    width: 40,
    height: 40,
    dimensionUnit: "in",
    quantity: 2,
    weight: 275,
    weightUnit: "lb",
    freightClass: "150",
    hazmat: false,
    stackable: false
  },
  additionalDimensions: [{
    handlingUnit: "Crate",
    length: 36,
    width: 30,
    height: 24,
    dimensionUnit: "in",
    quantity: 1,
    weight: 100,
    weightUnit: "kg",
    freightClass: "85",
    hazmat: false,
    stackable: true
  }],
  specialServices: {
    general: ["Notification", "Guaranteed Service", "HazMat"],
    pickup: ["CFS Pickup", "Liftgate Pickup"],
    delivery: ["Delivery Appointment", "Residential Delivery"],
    overLength: []
  }
};

async function main() {
  const originalFetch = globalThis.fetch;
  let capturedUrl = "";
  let capturedInit: RequestInit | undefined;
  globalThis.fetch = async (url, init) => {
    capturedUrl = String(url);
    capturedInit = init;
    return new Response(
      JSON.stringify({
        id: 123456,
        rateQuotes: [
          {
            id: 21108,
            carrierName: "Southeastern Freight",
            carrierCode: "SEFL",
            serviceLevel: "STANDARD",
            transitDays: 4,
            rateQuoteDetail: { total: 235.89 }
          }
        ],
        invalidRateQuotes: [
          {
            carrierCode: "ODFL",
            carrierName: "Old Dominion Freight Line",
            errorMessages: [{ text: "An error occurred while retrieving rates." }]
          }
        ]
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  };

  try {
    const adapter = new PriorityOneAdapter({
      baseUrl: "https://api.priority1.com",
      apiKey: "test-key",
      customerId: 42,
      timeoutMs: 20000,
      accessorialMap: {}
    });
    const result = await adapter.quote(input);
    assert.equal(capturedUrl, "https://api.priority1.com/v2/ltl/quotes/rates");
    assert.equal(new Headers(capturedInit?.headers).get("X-API-KEY"), "test-key");
    const body = JSON.parse(String(capturedInit?.body)) as Record<string, any>;
    assert.equal(body.customerId, 42);
    assert.equal(body.items[0].totalWeight, 275);
    assert.equal(body.items[0].packagingType, "Pallet");
    assert.equal(body.items.length, 2);
    assert.equal(body.items[1].packagingType, "Crate");
    assert.equal(body.items[1].totalWeight, 220.46);
    assert.equal(body.items[1].isStackable, true);
    assert.deepEqual(body.accessorialServices, [
      { code: "NOTIFY" },
      { code: "GUR" },
      { code: "HAZM" },
      { code: "LTDPU" },
      { code: "LGPU" },
      { code: "APPT" },
      { code: "RESDEL" }
    ]);
    assert.equal(body.items[0].isHazardous, true);
    assert.equal(result.length, 2);
    assert.equal(result[0].rateAmount, 235.89);
    assert.equal(result[0].transitDays, 4);
    assert.equal(result[1].status, "unavailable");
    assert.match(result[1].errorMessage ?? "", /retrieving rates/);
    console.log("Priority1 adapter test passed.");
  } finally {
    globalThis.fetch = originalFetch;
  }
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
