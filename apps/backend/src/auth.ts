import crypto from "node:crypto";
import type { Request, Response, NextFunction } from "express";
import { createRemoteJWKSet, jwtVerify } from "jose";
import type { AuthSession } from "@tms/shared";
import { config } from "./config.js";

const SESSION_TTL_MS = 1000 * 60 * 60 * 8;
let entraJwks: ReturnType<typeof createRemoteJWKSet> | null = null;

function signPayload(payload: string): string {
  return crypto.createHmac("sha256", config.internalAppAccessCode).update(payload).digest("hex");
}

function encodeToken(operatorName: string): AuthSession {
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
  const payload = Buffer.from(JSON.stringify({ operatorName, expiresAt })).toString("base64url");
  const signature = signPayload(payload);

  return {
    token: `${payload}.${signature}`,
    operatorName,
    expiresAt
  };
}

function decodeToken(token: string): { operatorName: string; expiresAt: string } | null {
  const [payload, signature] = token.split(".");
  if (!payload || !signature || signPayload(payload) !== signature) {
    return null;
  }

  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
      operatorName: string;
      expiresAt: string;
    };
    if (new Date(parsed.expiresAt).getTime() <= Date.now()) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function createSession(operatorName: string, accessCode: string): AuthSession | null {
  if (accessCode !== config.internalAppAccessCode) {
    return null;
  }

  return encodeToken(operatorName);
}

export interface AuthenticatedRequest extends Request {
  operatorName?: string;
}

function isEntraConfigured(): boolean {
  return Boolean(config.entraAuthConfig.tenantId && config.entraAuthConfig.clientId && config.entraAuthConfig.audience);
}

async function verifyMicrosoftToken(token: string): Promise<string | null> {
  const { tenantId, audience, requiredScope } = config.entraAuthConfig;
  if (!tenantId || !audience) return null;

  const issuers = [
    `https://login.microsoftonline.com/${tenantId}/v2.0`,
    `https://sts.windows.net/${tenantId}/`
  ];
  entraJwks ??= createRemoteJWKSet(new URL(`https://login.microsoftonline.com/${tenantId}/discovery/v2.0/keys`));
  const { payload } = await jwtVerify(token, entraJwks, { issuer: issuers, audience });

  if (payload.tid !== tenantId) return null;
  const scopes = typeof payload.scp === "string" ? payload.scp.split(" ") : [];
  if (requiredScope && !scopes.includes(requiredScope)) return null;

  const operatorName = payload.name ?? payload.preferred_username ?? payload.email ?? payload.oid ?? payload.sub;
  return typeof operatorName === "string" ? operatorName : null;
}

export function requireAuth(request: AuthenticatedRequest, response: Response, next: NextFunction): void {
  const authorization = request.header("authorization");
  if (!authorization?.startsWith("Bearer ")) {
    response.status(401).json({ message: "Missing authorization token." });
    return;
  }

  const token = authorization.slice("Bearer ".length);

  if (isEntraConfigured()) {
    void verifyMicrosoftToken(token)
      .then((operatorName) => {
        if (!operatorName) {
          response.status(401).json({ message: "Microsoft token is missing the required API scope." });
          return;
        }
        request.operatorName = operatorName;
        next();
      })
      .catch((error: unknown) => {
        const detail = error instanceof Error ? `${error.name}: ${error.message}` : "Unknown verification error";
        console.error(`[auth] Microsoft token validation failed: ${detail}`);
        response.status(401).json({ message: "Invalid or expired Microsoft access token." });
      });
    return;
  }

  const session = decodeToken(token);
  if (!session) {
    response.status(401).json({ message: "Invalid or expired development session." });
    return;
  }

  request.operatorName = session.operatorName;
  next();
}
