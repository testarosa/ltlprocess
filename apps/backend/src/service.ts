import { getQuoteDimensions, type QuoteStatus, type QuoteRequestInput } from "@tms/shared";
import type { CarrierAdapter } from "./carriers.js";
import {
  sqlQuoteRepository,
  type QuoteRepository
} from "./repository.js";

function validateQuoteRequest(input: QuoteRequestInput): string[] {
  const errors: string[] = [];
  if (!input.requestedDate.trim()) errors.push("Requested date is required.");
  if (!input.requestedFrom.trim()) errors.push("Requested from is required.");
  if (!input.commodity.trim()) errors.push("Commodity is required.");
  if (!input.pickupLocation.zipCode.trim()) errors.push("Pickup zip code is required.");
  if (!input.pickupLocation.city.trim()) errors.push("Pickup city is required.");
  if (!input.pickupLocation.state.trim()) errors.push("Pickup state is required.");
  if (!input.deliveryLocation.zipCode.trim()) errors.push("Delivery zip code is required.");
  if (!input.deliveryLocation.city.trim()) errors.push("Delivery city is required.");
  if (!input.deliveryLocation.state.trim()) errors.push("Delivery state is required.");
  getQuoteDimensions(input).forEach((dimension, index) => {
    const prefix = `Dimension ${index + 1}: `;
    if (!Number.isFinite(dimension.length) || dimension.length <= 0) errors.push(`${prefix}length must be greater than zero.`);
    if (!Number.isFinite(dimension.width) || dimension.width <= 0) errors.push(`${prefix}width must be greater than zero.`);
    if (!Number.isFinite(dimension.height) || dimension.height <= 0) errors.push(`${prefix}height must be greater than zero.`);
    if (!Number.isFinite(dimension.quantity) || dimension.quantity <= 0) errors.push(`${prefix}quantity must be greater than zero.`);
    if (!Number.isFinite(dimension.weight) || dimension.weight <= 0) errors.push(`${prefix}weight must be greater than zero.`);
  });
  return errors;
}

function summarizeQuoteStatus(statuses: Array<"pending" | "success" | "unavailable" | "error">): QuoteStatus {
  if (statuses.length === 0) {
    return "failed";
  }
  if (statuses.every((status) => status === "success")) {
    return "completed";
  }

  if (statuses.every((status) => status === "error")) {
    return "failed";
  }

  if (statuses.some((status) => status === "success")) {
    return "partial";
  }

  return "failed";
}

export class QuoteService {
  constructor(
    private readonly carriers: CarrierAdapter[],
    private readonly repository: QuoteRepository = sqlQuoteRepository,
    private readonly startBackgroundProcessing = true
  ) {}

  async submitQuoteRequest(operatorName: string, input: QuoteRequestInput): Promise<{ id: string; errors: string[] }> {
    const errors = validateQuoteRequest(input);
    if (errors.length > 0) {
      return { id: "", errors };
    }

    const id = await this.repository.createQuoteRequest(operatorName, input, this.carriers);
    if (this.startBackgroundProcessing) {
      void this.processQuoteRequest(id).catch((error: unknown) => {
        const detail = error instanceof Error ? error.message : "Unknown quote processing error";
        console.error(`[quotes] Background processing failed for ${id}: ${detail}`);
      });
    }

    return { id, errors: [] };
  }

  async processQuoteRequest(quoteRequestId: string): Promise<void> {
    const quoteRequest = await this.repository.getQuoteRequestById(quoteRequestId);
    if (!quoteRequest) {
      return;
    }

    const resultGroups = await Promise.all(
      this.carriers.map(async (carrier) => {
        try {
          const result = await carrier.quote(quoteRequest);
          if (Array.isArray(result)) {
            if (result.length === 0) {
              const unavailable = {
                status: "unavailable" as const,
                rateAmount: null,
                currency: null,
                serviceLevel: null,
                transitDays: null,
                rawResponse: "[]",
                errorMessage: "No carrier rates were returned."
              };
              await this.repository.updateCarrierQuote(quoteRequestId, carrier.key, unavailable);
              return [unavailable.status];
            }
            await this.repository.replaceCarrierQuotes(quoteRequestId, carrier.key, result);
            return result.map((item) => item.status);
          }
          await this.repository.updateCarrierQuote(quoteRequestId, carrier.key, result);
          return [result.status];
        } catch (error) {
          const failed = {
            status: "error" as const,
            rateAmount: null,
            currency: null,
            serviceLevel: null,
            transitDays: null,
            rawResponse: null,
            errorMessage: error instanceof Error ? error.message : "Carrier request failed."
          };
          await this.repository.updateCarrierQuote(quoteRequestId, carrier.key, failed);
          return [failed.status];
        }
      })
    );

    await this.repository.updateQuoteStatus(quoteRequestId, summarizeQuoteStatus(resultGroups.flat()));
  }
}
