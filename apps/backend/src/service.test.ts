import assert from "node:assert/strict";
import crypto from "node:crypto";
import {
  calculateDensity,
  freightClassForDensity,
  type CarrierQuoteRecord,
  type QuoteRequestInput,
  type QuoteRequestRecord,
  type QuoteStatus,
  type QuoteSummary
} from "@tms/shared";
import type { CarrierAdapter } from "./carriers.js";
import type { CarrierQuoteUpdate, QuoteRepository, ReplacementCarrierQuote } from "./repository.js";
import { QuoteService } from "./service.js";

class MemoryQuoteRepository implements QuoteRepository {
  private sequence = 0;
  private readonly quotes = new Map<string, QuoteRequestRecord>();

  async createQuoteRequest(
    operatorName: string,
    input: QuoteRequestInput,
    carriers: { key: string; name: string }[]
  ): Promise<string> {
    const year = new Date().getUTCFullYear();
    const id = `Q-PLS-${year}-${String(++this.sequence).padStart(6, "0")}`;
    const timestamp = new Date().toISOString();
    this.quotes.set(id, {
      ...structuredClone(input),
      id,
      operatorName,
      status: "processing",
      createdAt: timestamp,
      updatedAt: timestamp,
      carrierQuotes: carriers.map((carrier) => ({
        id: crypto.randomUUID(),
        carrierKey: carrier.key,
        carrierName: carrier.name,
        status: "pending",
        rateAmount: null,
        currency: null,
        serviceLevel: null,
        transitDays: null,
        errorMessage: null,
        warningMessage: null,
        requestedAt: timestamp,
        respondedAt: null,
        updatedAt: timestamp
      }))
    });
    return id;
  }

  async updateCarrierQuote(quoteRequestId: string, carrierKey: string, updates: CarrierQuoteUpdate): Promise<void> {
    const quote = this.requiredQuote(quoteRequestId);
    const target = quote.carrierQuotes.find((item) => item.carrierKey === carrierKey);
    if (!target) return;
    const timestamp = new Date().toISOString();
    Object.assign(target, updates, { respondedAt: timestamp, updatedAt: timestamp });
  }

  async replaceCarrierQuotes(
    quoteRequestId: string,
    sourceCarrierKey: string,
    quotes: ReplacementCarrierQuote[]
  ): Promise<void> {
    const record = this.requiredQuote(quoteRequestId);
    const timestamp = new Date().toISOString();
    const retained = record.carrierQuotes.filter(
      (item) => item.carrierKey !== sourceCarrierKey && !item.carrierKey.startsWith(`${sourceCarrierKey}:`)
    );
    const replacements: CarrierQuoteRecord[] = quotes.map((quote) => ({
      id: crypto.randomUUID(),
      carrierKey: quote.carrierKey,
      carrierName: quote.carrierName,
      status: quote.status,
      rateAmount: quote.rateAmount,
      currency: quote.currency,
      serviceLevel: quote.serviceLevel,
      transitDays: quote.transitDays,
      errorMessage: quote.errorMessage,
      warningMessage: null,
      requestedAt: timestamp,
      respondedAt: timestamp,
      updatedAt: timestamp
    }));
    record.carrierQuotes = [...retained, ...replacements];
  }

  async updateQuoteStatus(quoteRequestId: string, status: QuoteStatus): Promise<void> {
    const quote = this.requiredQuote(quoteRequestId);
    quote.status = status;
    quote.updatedAt = new Date().toISOString();
  }

  async getQuoteRequestById(id: string): Promise<QuoteRequestRecord | null> {
    const quote = this.quotes.get(id);
    return quote ? structuredClone(quote) : null;
  }

  async listQuoteRequests(): Promise<QuoteSummary[]> {
    return [];
  }

  private requiredQuote(id: string): QuoteRequestRecord {
    const quote = this.quotes.get(id);
    if (!quote) throw new Error(`Missing quote ${id}`);
    return quote;
  }
}

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

const quoteInput: QuoteRequestInput = {
  requestedDate: "2026-04-02",
  requestedFrom: "Taylor",
  commodity: "BBQ grills",
  pickupLocation: { zipCode: "98101", city: "Seattle", state: "WA", country: "US" },
  deliveryLocation: { zipCode: "97204", city: "Portland", state: "OR", country: "US" },
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
  specialServices: { general: [], pickup: [], delivery: [], overLength: [] }
};

async function main(): Promise<void> {
  const exampleDensity = calculateDensity({
    length: 48,
    width: 40,
    height: 60,
    dimensionUnit: "in",
    quantity: 4,
    weight: 4800,
    weightUnit: "lb"
  });
  assert.equal(exampleDensity, 18);
  assert.equal(freightClassForDensity(exampleDensity), "70");
  assert.equal(freightClassForDensity(22.5), "65");

  const repository = new MemoryQuoteRepository();
  const service = new QuoteService(carriers, repository, false);
  const result = await service.submitQuoteRequest("Taylor", quoteInput);

  assert.equal(result.errors.length, 0);
  const currentYear = new Date().getUTCFullYear();
  assert.match(result.id, new RegExp(`^Q-PLS-${currentYear}-\\d{6}$`));
  await service.processQuoteRequest(result.id);

  const stored = await repository.getQuoteRequestById(result.id);
  assert.ok(stored);
  assert.equal(stored.status, "partial");
  assert.equal(stored.carrierQuotes.length, 4);
  assert.equal(stored.carrierQuotes.some((item) => item.carrierName === "Carrier One"), true);
  assert.equal(stored.carrierQuotes.some((item) => item.status === "success"), true);
  assert.equal(stored.carrierQuotes.some((item) => item.status === "error"), true);

  const nextId = await repository.createQuoteRequest("Taylor", stored, []);
  const firstSequence = Number(result.id.slice(-6));
  assert.equal(nextId, `Q-PLS-${currentYear}-${String(firstSequence + 1).padStart(6, "0")}`);
  console.log("Backend quote service test passed.");
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
