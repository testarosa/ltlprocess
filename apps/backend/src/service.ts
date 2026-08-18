import type { QuoteStatus, QuoteRequestInput } from "@tms/shared";
import type { CarrierAdapter } from "./carriers.js";
import {
  createQuoteRequest,
  getQuoteRequestById,
  replaceCarrierQuotes,
  updateCarrierQuote,
  updateQuoteStatus
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
  if (!Number.isFinite(input.dimensions.length) || input.dimensions.length <= 0) errors.push("Length must be greater than zero.");
  if (!Number.isFinite(input.dimensions.width) || input.dimensions.width <= 0) errors.push("Width must be greater than zero.");
  if (!Number.isFinite(input.dimensions.height) || input.dimensions.height <= 0) errors.push("Height must be greater than zero.");
  if (!Number.isFinite(input.dimensions.quantity) || input.dimensions.quantity <= 0) errors.push("Quantity must be greater than zero.");
  if (!Number.isFinite(input.dimensions.weight) || input.dimensions.weight <= 0) errors.push("Weight must be greater than zero.");
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
  constructor(private readonly carriers: CarrierAdapter[]) {}

  submitQuoteRequest(operatorName: string, input: QuoteRequestInput): { id: string; errors: string[] } {
    const errors = validateQuoteRequest(input);
    if (errors.length > 0) {
      return { id: "", errors };
    }

    const id = createQuoteRequest(operatorName, input, this.carriers);
    void this.processQuoteRequest(id);

    return { id, errors: [] };
  }

  async processQuoteRequest(quoteRequestId: string): Promise<void> {
    const quoteRequest = getQuoteRequestById(quoteRequestId);
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
              updateCarrierQuote(quoteRequestId, carrier.key, unavailable);
              return [unavailable.status];
            }
            replaceCarrierQuotes(quoteRequestId, carrier.key, result);
            return result.map((item) => item.status);
          }
          updateCarrierQuote(quoteRequestId, carrier.key, result);
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
          updateCarrierQuote(quoteRequestId, carrier.key, failed);
          return [failed.status];
        }
      })
    );

    updateQuoteStatus(quoteRequestId, summarizeQuoteStatus(resultGroups.flat()));
  }
}
