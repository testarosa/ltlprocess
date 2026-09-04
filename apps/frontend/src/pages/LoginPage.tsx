import { useEffect, useRef, useState, type FormEvent } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { login } from "../api";
import { abandonMicrosoftSignIn, isMicrosoftAuthConfigured, signInWithMicrosoft } from "../microsoftAuth";
import { useAuth } from "../state";

export function LoginPage() {
  const navigate = useNavigate();
  const { session, setSession } = useAuth();
  const [operatorName, setOperatorName] = useState("");
  const [accessCode, setAccessCode] = useState("letmein");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [resetMicrosoftOnNextAttempt, setResetMicrosoftOnNextAttempt] = useState(false);
  const microsoftSignInActive = useRef(false);
  const microsoftPopupTookFocus = useRef(false);
  const microsoftAttempt = useRef(0);

  useEffect(() => {
    let focusTimer: number | undefined;
    const handleBlur = () => {
      if (microsoftSignInActive.current) microsoftPopupTookFocus.current = true;
    };
    const handleFocus = () => {
      if (!microsoftSignInActive.current || !microsoftPopupTookFocus.current) return;
      window.clearTimeout(focusTimer);
      focusTimer = window.setTimeout(() => {
        // Give a successful MSAL response time to settle first. If it is still
        // pending after focus returns, the popup was closed without a callback.
        if (!microsoftSignInActive.current || !document.hasFocus()) return;
        microsoftSignInActive.current = false;
        microsoftPopupTookFocus.current = false;
        microsoftAttempt.current += 1;
        setSubmitting(false);
        setResetMicrosoftOnNextAttempt(false);
        setError("");
        void abandonMicrosoftSignIn().catch(() => undefined);
      }, 1500);
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        handleBlur();
      } else {
        handleFocus();
      }
    };

    window.addEventListener("blur", handleBlur);
    window.addEventListener("focus", handleFocus);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      window.clearTimeout(focusTimer);
      window.removeEventListener("blur", handleBlur);
      window.removeEventListener("focus", handleFocus);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, []);

  if (session) {
    return <Navigate to="/" replace />;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setSubmitting(true);

    try {
      const nextSession = await login(operatorName, accessCode);
      setSession(nextSession);
      navigate("/", { replace: true });
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Login failed.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleMicrosoftSignIn() {
    const attempt = ++microsoftAttempt.current;
    microsoftSignInActive.current = true;
    microsoftPopupTookFocus.current = false;
    setError("");
    setSubmitting(true);
    try {
      const nextSession = await signInWithMicrosoft(resetMicrosoftOnNextAttempt);
      if (attempt !== microsoftAttempt.current) return;
      microsoftSignInActive.current = false;
      setResetMicrosoftOnNextAttempt(false);
      setSession(nextSession);
      navigate("/", { replace: true });
    } catch (nextError) {
      if (attempt !== microsoftAttempt.current) return;
      microsoftSignInActive.current = false;
      const errorCode = typeof nextError === "object" && nextError && "errorCode" in nextError
        ? String(nextError.errorCode)
        : "";
      if (errorCode === "user_cancelled" || errorCode === "interaction_in_progress_cancelled") {
        // Closing the account picker is a normal cancellation. Restore the
        // initial sign-in state without showing an error or a retry variant.
        setResetMicrosoftOnNextAttempt(false);
        setError("");
      } else if (errorCode === "interaction_in_progress" || errorCode === "no_token_request_cache_error") {
        setResetMicrosoftOnNextAttempt(true);
        setError(
          errorCode === "interaction_in_progress"
            ? "A previous Microsoft sign-in is still pending. Select Sign in with Microsoft 365 to cancel it and start again."
            : "Microsoft sign-in was interrupted and its temporary request expired. Select Sign in with Microsoft 365 to start again."
        );
      } else {
        setResetMicrosoftOnNextAttempt(false);
        setError(nextError instanceof Error ? nextError.message : "Microsoft sign-in failed.");
      }
    } finally {
      if (attempt === microsoftAttempt.current) {
        microsoftSignInActive.current = false;
        setSubmitting(false);
      }
    }
  }

  return (
    <div className="login-page">
      <div className="login-shell">
        <section className="login-intro">
          <div className="brand-lockup login-brand">
            <span className="brand-mark" aria-hidden="true">Q</span>
            <span>Quote Console</span>
          </div>
          <div className="login-copy">
            <p className="eyebrow">Freight intelligence, simplified</p>
            <h1>Move from shipment details to the right rate—fast.</h1>
            <p>Build, compare, and track freight quotes from one focused workspace.</p>
          </div>
          <p className="login-footnote">Internal transportation management system</p>
        </section>
        <section className="login-form-wrap">
          <form className="form login-form" onSubmit={handleSubmit}>
            <div className="login-form-heading">
              <p className="eyebrow">Secure access</p>
              <h2>Welcome back</h2>
              <p className="muted">
                {isMicrosoftAuthConfigured ? "Use your company Microsoft 365 account to continue." : "Enter your development credentials to continue."}
              </p>
            </div>
            {isMicrosoftAuthConfigured ? (
              <button className="microsoft-signin" type="button" disabled={submitting} onClick={() => void handleMicrosoftSignIn()}>
                <span className="microsoft-mark" aria-hidden="true"><i /><i /><i /><i /></span>
                {submitting ? "Connecting to Microsoft..." : "Sign in with Microsoft 365"}
              </button>
            ) : (
              <>
                <label>
                  Operator name
                  <input value={operatorName} onChange={(event) => setOperatorName(event.target.value)} placeholder="Alex Morgan" autoComplete="name" />
                </label>
                <label>
                  Access code
                  <input
                    type="password"
                    value={accessCode}
                    onChange={(event) => setAccessCode(event.target.value)}
                    placeholder="Enter access code"
                    autoComplete="current-password"
                  />
                </label>
                <button disabled={submitting}>{submitting ? "Signing in..." : "Development sign in"}</button>
                <p className="auth-config-note">Set the Entra environment values to enable Microsoft 365 authentication.</p>
              </>
            )}
            {error ? <p className="error-text" role="alert">{error}</p> : null}
          </form>
        </section>
      </div>
    </div>
  );
}
