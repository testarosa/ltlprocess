import express from "express";
import cors from "cors";
import type { QuoteRequestInput } from "@tms/shared";
import { createSession, requireAuth, type AuthenticatedRequest } from "./auth.js";
import { createCarrierAdapters } from "./carriers.js";
import { config } from "./config.js";
import { listQuoteRequests, getQuoteRequestById } from "./repository.js";
import { QuoteService } from "./service.js";
import { getLocationByZipCode, isValidUsZipCode } from "./locations.js";

const app = express();
app.use(cors({ origin: config.corsOrigin }));
app.use(express.json());

const quoteService = new QuoteService(
  createCarrierAdapters(
    config.carrierApiConfig,
    config.threePlSystemsApiConfig,
    config.priorityOneApiConfig,
    config.roadrunnerApiConfig,
    config.wwexApiConfig,
    config.forwardAirApiConfig
  )
);

app.get("/api/health", (_request, response) => {
  response.json({ ok: true });
});

app.post("/api/auth/login", (request, response) => {
  const operatorName = String(request.body?.operatorName ?? "").trim();
  const accessCode = String(request.body?.accessCode ?? "");

  if (!operatorName) {
    response.status(400).json({ message: "Operator name is required." });
    return;
  }

  const session = createSession(operatorName, accessCode);
  if (!session) {
    response.status(401).json({ message: "Invalid access code." });
    return;
  }

  response.json(session);
});

app.post("/api/quotes", requireAuth, async (request: AuthenticatedRequest, response) => {
  const input = request.body as QuoteRequestInput;
  try {
    const result = await quoteService.submitQuoteRequest(request.operatorName ?? "Operator", input);
    if (result.errors.length > 0) {
      response.status(400).json({ errors: result.errors });
      return;
    }

    response.status(202).json({ id: result.id, status: "processing" });
  } catch (error: unknown) {
    const detail = error instanceof Error ? error.message : "Unknown SQL Server error";
    console.error(`[quotes] Failed to create quote: ${detail}`);
    response.status(503).json({ message: "Quote storage is temporarily unavailable." });
  }
});

app.get("/api/quotes", requireAuth, async (_request, response) => {
  try {
    response.json(await listQuoteRequests());
  } catch (error: unknown) {
    const detail = error instanceof Error ? error.message : "Unknown SQL Server error";
    console.error(`[quotes] Failed to list quotes: ${detail}`);
    response.status(503).json({ message: "Quote storage is temporarily unavailable." });
  }
});

app.get("/api/quotes/:id", requireAuth, async (request, response) => {
  const quoteId = Array.isArray(request.params.id) ? request.params.id[0] : request.params.id;
  try {
    const quoteRequest = await getQuoteRequestById(quoteId);
    if (!quoteRequest) {
      response.status(404).json({ message: "Quote request not found." });
      return;
    }

    response.json(quoteRequest);
  } catch (error: unknown) {
    const detail = error instanceof Error ? error.message : "Unknown SQL Server error";
    console.error(`[quotes] Failed to load quote ${quoteId}: ${detail}`);
    response.status(503).json({ message: "Quote storage is temporarily unavailable." });
  }
});

app.get("/api/locations/:zipCode", async (request, response) => {
  const zipCode = String(request.params.zipCode).trim();
  if (!isValidUsZipCode(zipCode)) {
    response.status(400).json({ message: "ZIP code must contain exactly 5 digits." });
    return;
  }

  try {
    const location = await getLocationByZipCode(zipCode);
    if (!location) {
      response.status(404).json({ message: "ZIP code not found." });
      return;
    }

    response.json(location);
  } catch (error: unknown) {
    const detail = error instanceof Error ? error.message : "Unknown SQL Server error";
    console.error(`[locations] ZIP lookup failed: ${detail}`);
    response.status(503).json({ message: "Location lookup is temporarily unavailable." });
  }
});

export { app };
