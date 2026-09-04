import {
  BrowserCacheLocation,
  PublicClientApplication,
  type AccountInfo,
  type AuthenticationResult
} from "@azure/msal-browser";
import type { AuthSession } from "@tms/shared";

const clientId = String(import.meta.env.VITE_ENTRA_CLIENT_ID ?? "").trim();
const tenantId = String(import.meta.env.VITE_ENTRA_TENANT_ID ?? "").trim();
const apiScope = String(
  import.meta.env.VITE_ENTRA_API_SCOPE ?? (clientId ? `api://${clientId}/access_as_user` : "")
).trim();

// MSAL requires Web Crypto, which browsers expose only in a secure context
// (HTTPS or loopback localhost). A temporary HTTP deployment by IP should
// fall back to development authentication instead of crashing at startup.
const canUseBrowserCrypto = window.isSecureContext && Boolean(window.crypto?.subtle);
export const isMicrosoftAuthConfigured = Boolean(clientId && tenantId && apiScope && canUseBrowserCrypto);

const msal = isMicrosoftAuthConfigured
  ? new PublicClientApplication({
      auth: {
        clientId,
        authority: `https://login.microsoftonline.com/${tenantId}`,
        redirectUri: `${window.location.origin}/auth-redirect.html`,
        postLogoutRedirectUri: `${window.location.origin}/login`
      },
      cache: {
        cacheLocation: BrowserCacheLocation.LocalStorage
      }
    })
  : null;

let initialization: Promise<void> | null = null;
let signInPromise: Promise<AuthSession> | null = null;

async function initializeMicrosoftAuth(): Promise<PublicClientApplication> {
  if (!msal) {
    throw new Error("Microsoft 365 sign-in is not configured.");
  }

  initialization ??= msal.initialize().then(async () => {
    await msal.handleRedirectPromise();
  });
  await initialization;

  if (!msal.getActiveAccount()) {
    const account = msal.getAllAccounts()[0];
    if (account) msal.setActiveAccount(account);
  }

  return msal;
}

function toSession(result: AuthenticationResult): AuthSession {
  return {
    token: result.accessToken,
    operatorName: result.account.name ?? result.account.username,
    expiresAt: result.expiresOn?.toISOString() ?? new Date(Date.now() + 60 * 60 * 1000).toISOString()
  };
}

export function signInWithMicrosoft(overrideInteractionInProgress = false): Promise<AuthSession> {
  if (signInPromise) return signInPromise;

  const pendingSignIn = (async () => {
    const client = await initializeMicrosoftAuth();
    if (overrideInteractionInProgress) {
      // A popup can return after its one-time PKCE request has been lost (for
      // example after a reload or an interrupted browser handoff). Remove the
      // stale interaction state before starting a fresh user-initiated popup.
      await client.clearCache();
    }
    const result = await client.loginPopup({
      scopes: [apiScope],
      prompt: "select_account",
      overrideInteractionInProgress
    });
    client.setActiveAccount(result.account);
    return toSession(result);
  })().finally(() => {
    // Do not let an abandoned popup clear a newer sign-in attempt.
    if (signInPromise === pendingSignIn) signInPromise = null;
  });

  signInPromise = pendingSignIn;
  return signInPromise;
}

export async function abandonMicrosoftSignIn(): Promise<void> {
  // MSAL normally rejects loginPopup when its window closes. Some embedded
  // browsers do not deliver that close signal, so release the unresolved
  // promise and remove its stale interaction state before another attempt.
  signInPromise = null;
  const client = await initializeMicrosoftAuth();
  await client.clearCache();
}

export async function getMicrosoftAccessToken(fallbackToken: string): Promise<string> {
  if (!isMicrosoftAuthConfigured) return fallbackToken;

  const client = await initializeMicrosoftAuth();
  const account: AccountInfo | null = client.getActiveAccount();
  if (!account) {
    throw new Error("Your Microsoft session has ended. Please sign in again.");
  }

  try {
    const result = await client.acquireTokenSilent({ account, scopes: [apiScope] });
    return result.accessToken;
  } catch {
    throw new Error("Your Microsoft session has ended. Please sign in again.");
  }
}

export async function signOutFromMicrosoft(): Promise<void> {
  if (!isMicrosoftAuthConfigured) return;

  const client = await initializeMicrosoftAuth();
  const account = client.getActiveAccount();
  if (account) {
    await client.logoutPopup({
      account,
      postLogoutRedirectUri: `${window.location.origin}/auth-redirect.html`,
      mainWindowRedirectUri: `${window.location.origin}/login`
    });
  }
}
