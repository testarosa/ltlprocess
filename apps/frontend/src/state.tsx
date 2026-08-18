import { createContext, useContext, useEffect, useState } from "react";
import type { PropsWithChildren } from "react";
import type { AuthSession } from "@tms/shared";
import { signOutFromMicrosoft } from "./microsoftAuth";

const STORAGE_KEY = "tms-session";

interface AuthContextValue {
  session: AuthSession | null;
  setSession: (session: AuthSession | null) => void;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: PropsWithChildren) {
  const [session, setSessionState] = useState<AuthSession | null>(null);

  useEffect(() => {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (!saved) return;
    try {
      const parsed = JSON.parse(saved) as AuthSession;
      if (new Date(parsed.expiresAt).getTime() > Date.now()) setSessionState(parsed);
      else window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      window.localStorage.removeItem(STORAGE_KEY);
    }
  }, []);

  const setSession = (value: AuthSession | null) => {
    setSessionState(value);
    if (value) {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
    } else {
      window.localStorage.removeItem(STORAGE_KEY);
    }
  };

  const signOut = async () => {
    setSession(null);
    await signOutFromMicrosoft();
  };

  return <AuthContext.Provider value={{ session, setSession, signOut }}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within AuthProvider.");
  }
  return context;
}
