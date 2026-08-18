import type { AuthSession, CreateQuoteResponse, QuoteRequestInput, QuoteRequestRecord, QuoteSummary } from "@tms/shared";
import { getMicrosoftAccessToken } from "./microsoftAuth";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:4000";

async function request<T>(path: string, init: RequestInit = {}, token?: string): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init.headers ?? {})
    }
  });

  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(body?.message ?? body?.errors?.join(" ") ?? "Request failed.");
  }

  return body as T;
}

export function login(operatorName: string, accessCode: string): Promise<AuthSession> {
  return request<AuthSession>("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ operatorName, accessCode })
  });
}

export async function createQuote(input: QuoteRequestInput, token: string): Promise<CreateQuoteResponse> {
  return request<CreateQuoteResponse>(
    "/api/quotes",
    {
      method: "POST",
      body: JSON.stringify(input)
    },
    await getMicrosoftAccessToken(token)
  );
}

export async function fetchQuote(id: string, token: string): Promise<QuoteRequestRecord> {
  return request<QuoteRequestRecord>(`/api/quotes/${id}`, {}, await getMicrosoftAccessToken(token));
}

export async function fetchQuoteHistory(token: string): Promise<QuoteSummary[]> {
  return request<QuoteSummary[]>("/api/quotes", {}, await getMicrosoftAccessToken(token));
}
