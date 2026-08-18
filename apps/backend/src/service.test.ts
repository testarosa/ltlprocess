import assert from "node:assert/strict";
import type { CarrierAdapter } from "./carriers.js";

const carriers: CarrierAdapter[] = [
  {
    key: "alpha",
    name: "Alpha",
    async quote() {
      return {
        status: "success",
        rateAmount: 1200,
        currency: "USD",
        serviceLevel: "Standard",
        transitDays: 2,
        rawResponse: "{}",
        errorMessage: null
      };
    }
  },
  {
    key: "beta",
    name: "Beta",
    async quote() {
      return {
        status: "error",
        rateAmount: null,
        currency: null,
        serviceLevel: null,
        transitDays: null,
        rawResponse: "{}",
        errorMessage: "Timeout"
      };
    }
  },
  {
    key: "batch-provider",
    name: "Batch Provider",
    async quote() {
      return [
        {
          carrierKey: "batch-provider:one:quote-1",
          carrierName: "Carrier One",
          status: "success" as const,
          rateAmount: 980,
          currency: "USD",
          serviceLevel: "Standard",
          transitDays: 3,
          rawResponse: "{}",
          errorMessage: null
        },
        {
          carrierKey: "batch-provider:two:quote-2",
          carrierName: "Carrier Two",
          status: "success" as const,
          rateAmount: 1040,
          currency: "USD",
          serviceLevel: "Priority",
          transitDays: 2,
          rawResponse: "{}",
          errorMessage: null
        }
      ];
    }
  }
];

async function main() {
  process.env.DB_FILE = ":memory:";
  const [{ QuoteService }, { getQuoteRequestById }] = await Promise.all([
    import("./service.js"),
    import("./repository.js")
  ]);

  const service = new QuoteService(carriers);
  const result = service.submitQuoteRequest("Taylor", {
    requestedDate: "2026-04-02",
    requestedFrom: "Taylor",
    commodity: "BBQ grills",
    pickupLocation: {
      zipCode: "98101",
      city: "Seattle",
      state: "WA",
      country: "US"
    },
    deliveryLocation: {
      zipCode: "97204",
      city: "Portland",
      state: "OR",
      country: "US"
    },
    dimensions: {
      handlingUnit: "Pallet",
      length: 48,
      width: 40,
      height: 60,
      dimensionUnit: "in",
      quantity: 1,
      weight: 1500,
      weightUnit: "lb",
      freightClass: "70",
      hazmat: false,
      stackable: true
    },
    specialServices: {
      general: [],
      pickup: [],
      delivery: [],
      overLength: []
    }
  });

  assert.equal(result.errors.length, 0);
  await service.processQuoteRequest(result.id);

  const stored = getQuoteRequestById(result.id);
  assert.ok(stored);
  assert.equal(stored.status, "partial");
  assert.equal(stored.carrierQuotes.length, 4);
  assert.equal(stored.carrierQuotes.some((item) => item.carrierName === "Carrier One"), true);
  assert.equal(stored.carrierQuotes.some((item) => item.status === "success"), true);
  assert.equal(stored.carrierQuotes.some((item) => item.status === "error"), true);
  console.log("Backend quote service test passed.");
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
