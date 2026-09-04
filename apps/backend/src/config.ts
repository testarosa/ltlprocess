import { config as loadEnv } from "dotenv";
import { fileURLToPath } from "node:url";

loadEnv({ path: fileURLToPath(new URL("../../../.env", import.meta.url)) });
loadEnv({ path: fileURLToPath(new URL("../../../.env.local", import.meta.url)), override: true });

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

export interface RoadrunnerApiConfig {
  baseUrl: string;
  applicationId?: string;
  apiKey?: string;
  site?: string;
  account?: string;
  timeoutMs: number;
  accessorialMap: Record<string, string>;
}

export interface WwexApiConfig {
  authUrl: string;
  apiBaseUrl: string;
  clientId?: string;
  clientSecret?: string;
  audience: string;
  timeoutMs: number;
}

export interface ForwardAirApiConfig {
  baseUrl: string;
  user?: string;
  password?: string;
  customerId?: string;
  billToNumber?: string;
  shipperNumber?: string;
  timeoutMs: number;
  pickupAccessorialMap: Record<string, string>;
  deliveryAccessorialMap: Record<string, string>;
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
  seedDemoData: process.env.SEED_DEMO_DATA === "true",
  internalAppAccessCode: process.env.INTERNAL_APP_ACCESS_CODE ?? "letmein",
  entraAuthConfig: {
    tenantId: process.env.ENTRA_TENANT_ID,
    clientId: process.env.ENTRA_CLIENT_ID,
    audience: process.env.ENTRA_AUDIENCE ?? (process.env.ENTRA_CLIENT_ID ? `api://${process.env.ENTRA_CLIENT_ID}` : undefined),
    requiredScope: process.env.ENTRA_REQUIRED_SCOPE ?? "access_as_user"
  } satisfies EntraAuthConfig,
  legacySqliteFile: process.env.LEGACY_SQLITE_FILE ?? process.env.DB_FILE,
  sqlServerConnectionString:
    process.env.SQL_SERVER_CONNECTION_STRING ??
    "Driver={ODBC Driver 17 for SQL Server};Server=.\\SQLEXPRESS;Database=LTLTms;Trusted_Connection=yes;TrustServerCertificate=yes;",
  carrierApiConfig: parseCarrierApiConfig(process.env.CARRIER_API_CONFIG),
  threePlSystemsApiConfig: {
    baseUrl: (process.env.THREE_PL_BASE_URL ?? "https://virncorp.3plsystems.com").replace(/\/$/, ""),
    clientId: process.env.THREE_PL_CLIENT_ID,
    clientSecret: process.env.THREE_PL_CLIENT_SECRET,
    timeoutMs: Number(process.env.THREE_PL_TIMEOUT_MS ?? 60000)
  } satisfies ThreePlSystemsApiConfig,
  priorityOneApiConfig: {
    baseUrl: (process.env.PRIORITY1_BASE_URL ?? "https://api.priority1.com").replace(/\/$/, ""),
    apiKey: process.env.PRIORITY1_API_KEY,
    customerId: process.env.PRIORITY1_CUSTOMER_ID ? Number(process.env.PRIORITY1_CUSTOMER_ID) : undefined,
    timeoutMs: Number(process.env.PRIORITY1_TIMEOUT_MS ?? 60000),
    accessorialMap: parseStringMap(process.env.PRIORITY1_ACCESSORIAL_MAP)
  } satisfies PriorityOneApiConfig,
  roadrunnerApiConfig: {
    baseUrl: (process.env.ROADRUNNER_BASE_URL ?? "https://webservices.rrts.com/rating/ratequote.asmx").replace(/\/$/, ""),
    applicationId: process.env.ROADRUNNER_APPLICATION_ID ?? process.env.ROADRUNNER_USERNAME,
    apiKey: process.env.ROADRUNNER_API_KEY ?? process.env.ROADRUNNER_PASSWORD,
    site: process.env.ROADRUNNER_SITE,
    account: process.env.ROADRUNNER_ACCOUNT,
    timeoutMs: Number(process.env.ROADRUNNER_TIMEOUT_MS ?? 20000),
    accessorialMap: parseStringMap(process.env.ROADRUNNER_ACCESSORIAL_MAP)
  } satisfies RoadrunnerApiConfig,
  wwexApiConfig: {
    authUrl: process.env.WWEX_AUTH_URL ?? "https://auth.wwex.com/oauth/token",
    apiBaseUrl: (process.env.WWEX_API_BASE_URL ?? "https://www.speedship.com/svc/").replace(/\/+$/, ""),
    clientId: process.env.WWEX_CLIENT_ID,
    clientSecret: process.env.WWEX_CLIENT_SECRET,
    audience: process.env.WWEX_AUDIENCE ?? "wwex-apig",
    timeoutMs: Number(process.env.WWEX_TIMEOUT_MS ?? 30000)
  } satisfies WwexApiConfig,
  forwardAirApiConfig: {
    baseUrl: (process.env.FORWARD_AIR_BASE_URL ?? "https://api.forwardair.com").replace(/\/$/, ""),
    user: process.env.FORWARD_AIR_USER,
    password: process.env.FORWARD_AIR_PASSWORD,
    customerId: process.env.FORWARD_AIR_CUSTOMER_ID,
    billToNumber: process.env.FORWARD_AIR_BILL_TO_NUMBER,
    shipperNumber: process.env.FORWARD_AIR_SHIPPER_NUMBER,
    timeoutMs: Number(process.env.FORWARD_AIR_TIMEOUT_MS ?? 20000),
    pickupAccessorialMap: parseStringMap(process.env.FORWARD_AIR_PICKUP_ACCESSORIAL_MAP),
    deliveryAccessorialMap: parseStringMap(process.env.FORWARD_AIR_DELIVERY_ACCESSORIAL_MAP)
  } satisfies ForwardAirApiConfig,
  corsOrigin: process.env.CORS_ORIGIN ?? "http://localhost:5173"
};
