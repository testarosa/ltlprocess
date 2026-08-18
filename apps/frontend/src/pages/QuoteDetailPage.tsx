import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import type { QuoteRequestRecord } from "@tms/shared";
import { fetchQuote } from "../api";
import { useAuth } from "../state";

function formatLocation(location: QuoteRequestRecord["pickupLocation"]): string {
  return `${location.city} (${location.state}), ${location.country} ${location.zipCode}`.trim();
}

function formatServiceList(items: string[]): string {
  return items.length > 0 ? items.join(", ") : "[]";
}

function packageSummary(quote: QuoteRequestRecord): string {
  const totalWeight = quote.dimensions.quantity * quote.dimensions.weight;
  return `${quote.dimensions.quantity} ${quote.dimensions.handlingUnit.toLowerCase()}(s), ${totalWeight} ${quote.dimensions.weightUnit}`;
}

function dimensionSummary(quote: QuoteRequestRecord): string {
  return [
    `Handling Unit - ${quote.dimensions.quantity}`,
    `${quote.dimensions.length} x ${quote.dimensions.width} x ${quote.dimensions.height} ${quote.dimensions.dimensionUnit}`,
    `${quote.dimensions.weight} ${quote.dimensions.weightUnit} (CLS ${quote.dimensions.freightClass || "--"})`,
    `HazMat? ${quote.dimensions.hazmat ? "Yes" : "No"}`,
    `Stackable? ${quote.dimensions.stackable ? "Yes" : "No"}`
  ].join("  ");
}

export function QuoteDetailPage() {
  const { id = "" } = useParams();
  const { session } = useAuth();
  const [quote, setQuote] = useState<QuoteRequestRecord | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!session || !id) return;
    const token = session.token;

    let cancelled = false;
    let timeoutId: number | undefined;

    async function loadQuote() {
      try {
        const result = await fetchQuote(id, token);
        if (cancelled) return;
        setQuote(result);
        setError("");

        if (result.status === "processing") {
          timeoutId = window.setTimeout(loadQuote, 1500);
        }
      } catch (nextError) {
        if (!cancelled) {
          setError(nextError instanceof Error ? nextError.message : "Failed to load quote.");
        }
      }
    }

    void loadQuote();

    return () => {
      cancelled = true;
      if (timeoutId) {
        window.clearTimeout(timeoutId);
      }
    };
  }, [id, session]);

  return (
    <section className="stack">
      <div className="page-header detail-page-header">
        <div>
          <p className="eyebrow">Quote results</p>
          <h2>Quote details</h2>
          <p className="page-description">Shipment summary and available carrier rates.</p>
        </div>
      </div>

      {error ? <div className="panel error-text">{error}</div> : null}

      {quote ? (
        <>
          <div className="panel detail-summary-panel">
            <div className="detail-summary-grid">
              <div className="detail-label">Quotation#:</div>
              <div>{quote.id}</div>

              <div className="detail-label">Requested Date:</div>
              <div>{quote.requestedDate}</div>

              <div className="detail-label">Requested From:</div>
              <div>{quote.requestedFrom}</div>

              <div className="detail-label">Commodity:</div>
              <div>{quote.commodity || "-"}</div>

              <div className="detail-label">Pick up:</div>
              <div>{formatLocation(quote.pickupLocation)}</div>

              <div className="detail-label">Delivery:</div>
              <div>{formatLocation(quote.deliveryLocation)}</div>

              <div className="detail-label">Package:</div>
              <div>{packageSummary(quote)}</div>

              <div className="detail-label">Dimensions:</div>
              <div>{dimensionSummary(quote)}</div>

              <div className="detail-label">Freight Classes:</div>
              <div>{quote.dimensions.freightClass || "-"}</div>

              <div className="detail-label">General Service(s):</div>
              <div>{formatServiceList(quote.specialServices.general)}</div>

              <div className="detail-label">Pick up Service(s):</div>
              <div>{formatServiceList(quote.specialServices.pickup)}</div>

              <div className="detail-label">Delivery Service(s):</div>
              <div>{formatServiceList(quote.specialServices.delivery)}</div>

              <div className="detail-label">Overlength:</div>
              <div>{formatServiceList(quote.specialServices.overLength)}</div>
            </div>
          </div>

          <div className="table-panel detail-rates-panel">
            <table className="detail-rates-table">
              <thead>
                <tr>
                  <th>Carrier</th>
                  <th>Status</th>
                  <th>Rate</th>
                  <th>Service</th>
                  <th>Transit</th>
                  <th>Updated</th>
                </tr>
              </thead>
              <tbody>
                {quote.carrierQuotes.map((carrierQuote) => (
                  <tr key={carrierQuote.id}>
                    <td>{carrierQuote.carrierName}</td>
                    <td>
                      <span className={`status-badge status-${carrierQuote.status}`}>{carrierQuote.status}</span>
                    </td>
                    <td>{carrierQuote.rateAmount !== null ? `$${carrierQuote.rateAmount.toFixed(2)}` : "-"}</td>
                    <td>{carrierQuote.serviceLevel ?? "-"}</td>
                    <td>{carrierQuote.transitDays !== null ? `${carrierQuote.transitDays}d` : "-"}</td>
                    <td>{new Date(carrierQuote.updatedAt).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="detail-footer-actions">
            <button type="button" disabled>
              Save
            </button>
            <Link className="close-button-link" to="/history">
              Close
            </Link>
          </div>
        </>
      ) : (
        <div className="panel">Waiting for persisted carrier results...</div>
      )}
    </section>
  );
}
