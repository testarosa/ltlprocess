import express from "express";
import cors from "cors";
import type { QuoteRequestInput } from "@tms/shared";
import { createSession, requireAuth, type AuthenticatedRequest } from "./auth.js";
import { createCarrierAdapters } from "./carriers.js";
import { config } from "./config.js";
import { listQuoteRequests, getQuoteRequestById } from "./repository.js";
import { seedDemoData } from "./seed.js";
import { QuoteService } from "./service.js";

const app = express();
app.use(cors({ origin: config.corsOrigin }));
app.use(express.json());

seedDemoData();

const quoteService = new QuoteService(
  createCarrierAdapters(config.carrierApiConfig, config.threePlSystemsApiConfig, config.priorityOneApiConfig)
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

app.post("/api/quotes", requireAuth, (request: AuthenticatedRequest, response) => {
  const input = request.body as QuoteRequestInput;
  const result = quoteService.submitQuoteRequest(request.operatorName ?? "Operator", input);

  if (result.errors.length > 0) {
    response.status(400).json({ errors: result.errors });
    return;
  }

  response.status(202).json({
    id: result.id,
    status: "processing"
  });
});

app.get("/api/quotes", requireAuth, (_request, response) => {
  response.json(listQuoteRequests());
});

app.get("/api/quotes/:id", requireAuth, (request, response) => {
  const quoteId = Array.isArray(request.params.id) ? request.params.id[0] : request.params.id;
  const quoteRequest = getQuoteRequestById(quoteId);
  if (!quoteRequest) {
    response.status(404).json({ message: "Quote request not found." });
    return;
  }

  response.json(quoteRequest);
});

export { app };
