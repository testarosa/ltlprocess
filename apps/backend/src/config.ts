import { config as loadEnv } from "dotenv";
import { fileURLToPath } from "node:url";

loadEnv({ path: fileURLToPath(new URL("../../../.env", import.meta.url)) });

export interface CarrierApiConfig {
  key: string;
  name: string;
  endpointUrl?: string;
  authHeaderName?: string;
  authToken?: string;
  timeoutMs?: number;
}

export interface ThreePlSystemsApiConfig {
  baseUrl: string;
  clientId?: string;
  clientSecret?: string;
  timeoutMs: number;
}

export interface PriorityOneApiConfig {
  baseUrl: string;
  apiKey?: string;
  customerId?: number;
  timeoutMs: number;
  accessorialMap: Record<string, string>;
}

export interface EntraAuthConfig {
  tenantId?: string;
  clientId?: string;
  audience?: string;
  requiredScope: string;
}

function parseStringMap(rawValue: string | undefined): Record<string, string> {
  if (!rawValue) return {};
  try {
    const parsed = JSON.parse(rawValue) as Record<string, unknown>;
    return Object.fromEntries(Object.entries(parsed).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
  } catch {
    return {};
  }
}

const defaultCarrierConfig: CarrierApiConfig[] = [
  { key: "acme-freight", name: "Acme Freight" },
  { key: "roadrunner-logistics", name: "Roadrunner Logistics" },
  { key: "summit-haul", name: "Summit Haul" },
  { key: "northstar-carrier", name: "Northstar Carrier" }
];

function parseCarrierApiConfig(rawValue: string | undefined): CarrierApiConfig[] {
  if (!rawValue) {
    return defaultCarrierConfig;
  }

  try {
    const parsed = JSON.parse(rawValue) as CarrierApiConfig[];
    return parsed.length > 0 ? parsed : defaultCarrierConfig;
  } catch {
    return defaultCarrierConfig;
  }
}

export const config = {
  backendPort: Number(process.env.BACKEND_PORT ?? 4000),
  internalAppAccessCode: process.env.INTERNAL_APP_ACCESS_CODE ?? "letmein",
  entraAuthConfig: {
    tenantId: process.env.ENTRA_TENANT_ID,
    clientId: process.env.ENTRA_CLIENT_ID,
    audience: process.env.ENTRA_AUDIENCE ?? (process.env.ENTRA_CLIENT_ID ? `api://${process.env.ENTRA_CLIENT_ID}` : undefined),
    requiredScope: process.env.ENTRA_REQUIRED_SCOPE ?? "access_as_user"
  } satisfies EntraAuthConfig,
  dbFile: process.env.DB_FILE ?? ":memory:",
  carrierApiConfig: parseCarrierApiConfig(process.env.CARRIER_API_CONFIG),
  threePlSystemsApiConfig: {
    baseUrl: (process.env.THREE_PL_BASE_URL ?? "https://3pl.hyperiontms.com").replace(/\/$/, ""),
    clientId: process.env.THREE_PL_CLIENT_ID,
    clientSecret: process.env.THREE_PL_CLIENT_SECRET,
    timeoutMs: Number(process.env.THREE_PL_TIMEOUT_MS ?? 15000)
  } satisfies ThreePlSystemsApiConfig,
  priorityOneApiConfig: {
    baseUrl: (process.env.PRIORITY1_BASE_URL ?? "https://api.priority1.com").replace(/\/$/, ""),
    apiKey: process.env.PRIORITY1_API_KEY,
    customerId: process.env.PRIORITY1_CUSTOMER_ID ? Number(process.env.PRIORITY1_CUSTOMER_ID) : undefined,
    timeoutMs: Number(process.env.PRIORITY1_TIMEOUT_MS ?? 20000),
    accessorialMap: parseStringMap(process.env.PRIORITY1_ACCESSORIAL_MAP)
  } satisfies PriorityOneApiConfig,
  corsOrigin: process.env.CORS_ORIGIN ?? "http://localhost:5173"
};
