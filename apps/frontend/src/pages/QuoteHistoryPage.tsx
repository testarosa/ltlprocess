import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import type { QuoteSummary } from "@tms/shared";
import { createQuote, fetchQuote, fetchQuoteHistory } from "../api";
import { useAuth } from "../state";

const PAGE_SIZE = 20;

export function QuoteHistoryPage() {
  const navigate = useNavigate();
  const { session } = useAuth();
  const [quotes, setQuotes] = useState<QuoteSummary[]>([]);
  const [error, setError] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [selectedQuoteId, setSelectedQuoteId] = useState("");
  const [refreshingQuoteId, setRefreshingQuoteId] = useState("");
  const [currentPage, setCurrentPage] = useState(1);

  useEffect(() => {
    if (!session) return;

    fetchQuoteHistory(session.token)
      .then((result) => {
        setQuotes(result);
        setError("");
        setSelectedQuoteId((current) => current || result[0]?.id || "");
      })
      .catch((nextError) => {
        setError(nextError instanceof Error ? nextError.message : "Failed to load quote history.");
      });
  }, [session]);

  const filteredQuotes = quotes.filter((quote) => {
    if (dateFrom && quote.shipmentDate < dateFrom) {
      return false;
    }

    if (dateTo && quote.shipmentDate > dateTo) {
      return false;
    }

    return true;
  });
  const totalPages = Math.max(1, Math.ceil(filteredQuotes.length / PAGE_SIZE));
  const pageStart = (currentPage - 1) * PAGE_SIZE;
  const pagedQuotes = filteredQuotes.slice(pageStart, pageStart + PAGE_SIZE);

  useEffect(() => {
    setCurrentPage((page) => Math.min(page, totalPages));
  }, [totalPages]);

  useEffect(() => {
    if (!filteredQuotes.some((quote) => quote.id === selectedQuoteId)) {
      setSelectedQuoteId(filteredQuotes[0]?.id ?? "");
    }
  }, [filteredQuotes, selectedQuoteId]);

  function openSelectedQuote() {
    if (!selectedQuoteId) {
      return;
    }

    navigate(`/quotes/${selectedQuoteId}`);
  }

  function copyQuote(quoteId: string) {
    navigate(`/?copy=${encodeURIComponent(quoteId)}`);
  }

  async function refreshQuote(quoteId: string) {
    if (!session) {
      return;
    }

    setError("");
    setRefreshingQuoteId(quoteId);

    try {
      const existingQuote = await fetchQuote(quoteId, session.token);
      const result = await createQuote(
        {
          requestedDate: existingQuote.requestedDate,
          requestedFrom: `${existingQuote.requestedFrom} (Copy)`,
          commodity: existingQuote.commodity,
          pickupLocation: existingQuote.pickupLocation,
          deliveryLocation: existingQuote.deliveryLocation,
          dimensions: existingQuote.dimensions,
          additionalDimensions: existingQuote.additionalDimensions,
          specialServices: existingQuote.specialServices
        },
        session.token
      );

      navigate(`/quotes/${result.id}`);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Failed to refresh quote.");
    } finally {
      setRefreshingQuoteId("");
    }
  }

  return (
    <section className="stack">
      <div className="page-header">
        <div>
          <p className="eyebrow">Saved requests</p>
          <h2>Quote history</h2>
          <p className="page-description">Review, reopen, or duplicate previous freight quotes.</p>
        </div>
      </div>
      <div className="results-toolbar">
        <div className="results-actions">
          <span className="results-count">{filteredQuotes.length} {filteredQuotes.length === 1 ? "quote" : "quotes"}</span>
        </div>
        <div className="results-filter-bar">
          <label className="inline-filter">
            <span>Requested Date</span>
            <input
              type="date"
              value={dateFrom}
              onChange={(event) => {
                setDateFrom(event.target.value);
                setCurrentPage(1);
              }}
            />
          </label>
          <input
            type="date"
            value={dateTo}
            onChange={(event) => {
              setDateTo(event.target.value);
              setCurrentPage(1);
            }}
          />
          <button type="button" className="compact-button">Apply</button>
        </div>
      </div>

      {error ? <div className="panel error-text">{error}</div> : null}

      <div className="table-panel search-results-panel">
        <table className="results-table">
          <thead>
            <tr>
              <th>Quotation#</th>
              <th>Requested Date</th>
              <th>Requested From</th>
              <th>User Name</th>
              <th>User Office</th>
              <th>User Team</th>
              <th>Last Edited By</th>
              <th>Pu Zip Code</th>
              <th>Del Zip Code</th>
              <th>Is Confirmed</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {pagedQuotes.map((quote) => (
              <tr
                key={quote.id}
                className={quote.id === selectedQuoteId ? "selected-row" : undefined}
                onClick={() => setSelectedQuoteId(quote.id)}
              >
                <td className={quote.id === selectedQuoteId ? "selected-cell" : undefined}>{quote.id}</td>
                <td>{quote.shipmentDate}</td>
                <td className="truncate-cell" title={quote.requestedFrom}>{quote.requestedFrom || `${quote.origin} -> ${quote.destination}`}</td>
                <td>{quote.operatorName}</td>
                <td>{quote.userOffice}</td>
                <td>{quote.userTeam}</td>
                <td>{quote.lastEditedBy}</td>
                <td>{quote.pickupZipCode}</td>
                <td>{quote.deliveryZipCode}</td>
                <td>{quote.isConfirmed}</td>
                <td className="row-actions-cell">
                  <div className="quote-row-actions" aria-label={`Actions for ${quote.id}`}>
                    <Link className="quote-action quote-action-open" to={`/quotes/${quote.id}`} onClick={(event) => event.stopPropagation()}>
                      <span className="quote-action-icon" aria-hidden="true">↗</span>
                      Open
                    </Link>
                    <button
                      className="quote-action"
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        copyQuote(quote.id);
                      }}
                    >
                      <span className="quote-action-icon copy-icon" aria-hidden="true">□</span>
                      Copy
                    </button>
                    <button
                      className="quote-action"
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        void refreshQuote(quote.id);
                      }}
                      disabled={refreshingQuoteId === quote.id}
                    >
                      <span className="quote-action-icon refresh-icon" aria-hidden="true">↻</span>
                      {refreshingQuoteId === quote.id ? "Refreshing..." : "Refresh"}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {filteredQuotes.length === 0 ? (
              <tr>
                <td colSpan={11}>No quote history yet.</td>
              </tr>
            ) : null}
          </tbody>
        </table>
        <div className="results-footer">
          <span>
            {filteredQuotes.length === 0
              ? "Rows: 0"
              : `Rows ${pageStart + 1}-${Math.min(pageStart + PAGE_SIZE, filteredQuotes.length)} of ${filteredQuotes.length}`}
          </span>
          <div className="pagination-controls" aria-label="Quote history pagination">
            <button
              type="button"
              className="pagination-button"
              onClick={() => setCurrentPage((page) => Math.max(1, page - 1))}
              disabled={currentPage === 1}
            >
              Previous
            </button>
            <span>Page {currentPage} of {totalPages}</span>
            <button
              type="button"
              className="pagination-button"
              onClick={() => setCurrentPage((page) => Math.min(totalPages, page + 1))}
              disabled={currentPage === totalPages}
            >
              Next
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
