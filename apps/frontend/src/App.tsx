import { NavLink, Navigate, Route, Routes } from "react-router-dom";
import { LoginPage } from "./pages/LoginPage";
import { QuoteCreatePage } from "./pages/QuoteCreatePage";
import { QuoteDetailPage } from "./pages/QuoteDetailPage";
import { QuoteHistoryPage } from "./pages/QuoteHistoryPage";
import { useAuth } from "./state";

function Shell() {
  const { session, signOut } = useAuth();

  if (!session) {
    return <Navigate to="/login" replace />;
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-top">
          <div className="sidebar-brand">
            <div className="brand-lockup">
              <span className="brand-mark" aria-hidden="true">Q</span>
              <div>
                <p className="eyebrow">Internal TMS</p>
                <h1>Quote Console</h1>
              </div>
            </div>
          </div>
          <nav className="nav" aria-label="Primary navigation">
            <NavLink to="/" end>
              <span className="nav-icon" aria-hidden="true">+</span>
              <span>New Quote</span>
            </NavLink>
            <NavLink to="/history">
              <span className="nav-icon nav-icon-history" aria-hidden="true" />
              <span>Quote History</span>
            </NavLink>
          </nav>
        </div>
        <div className="sidebar-footer">
          <div className="operator-card">
            <span className="operator-avatar" aria-hidden="true">{session.operatorName.slice(0, 1).toUpperCase()}</span>
            <div>
              <span className="operator-label">Signed in as</span>
              <strong>{session.operatorName}</strong>
            </div>
          </div>
          <button className="secondary-button sidebar-signout" onClick={() => void signOut()}>
            Sign out
          </button>
        </div>
      </aside>
      <main className="content">
        <Routes>
          <Route path="/" element={<QuoteCreatePage />} />
          <Route path="/quotes/:id" element={<QuoteDetailPage />} />
          <Route path="/history" element={<QuoteHistoryPage />} />
        </Routes>
      </main>
    </div>
  );
}

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/*" element={<Shell />} />
    </Routes>
  );
}
