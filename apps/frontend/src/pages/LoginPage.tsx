import { useState, type FormEvent } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { login } from "../api";
import { isMicrosoftAuthConfigured, signInWithMicrosoft } from "../microsoftAuth";
import { useAuth } from "../state";

export function LoginPage() {
  const navigate = useNavigate();
  const { session, setSession } = useAuth();
  const [operatorName, setOperatorName] = useState("");
  const [accessCode, setAccessCode] = useState("letmein");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [canRetryMicrosoft, setCanRetryMicrosoft] = useState(false);

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
    setError("");
    setSubmitting(true);
    try {
      const nextSession = await signInWithMicrosoft(canRetryMicrosoft);
      setCanRetryMicrosoft(false);
      setSession(nextSession);
      navigate("/", { replace: true });
    } catch (nextError) {
      const errorCode = typeof nextError === "object" && nextError && "errorCode" in nextError
        ? String(nextError.errorCode)
        : "";
      if (errorCode === "interaction_in_progress" || errorCode === "no_token_request_cache_error") {
        setCanRetryMicrosoft(true);
        setError(
          errorCode === "interaction_in_progress"
            ? "A previous Microsoft sign-in is still pending. Select Retry to cancel it and start again."
            : "Microsoft sign-in was interrupted and its temporary request expired. Select Retry to start a fresh sign-in."
        );
      } else {
        setCanRetryMicrosoft(false);
        setError(nextError instanceof Error ? nextError.message : "Microsoft sign-in failed.");
      }
    } finally {
      setSubmitting(false);
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
                {submitting ? "Connecting to Microsoft..." : canRetryMicrosoft ? "Retry Microsoft sign-in" : "Sign in with Microsoft 365"}
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
