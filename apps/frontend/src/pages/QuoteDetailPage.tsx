import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { calculateDensity, getQuoteDimensions, type CarrierQuoteRecord, type QuoteRequestRecord } from "@tms/shared";
import { fetchQuote } from "../api";
import { useAuth } from "../state";

function formatLocation(location: QuoteRequestRecord["pickupLocation"]): string {
  return `${location.city} (${location.state}), ${location.country} ${location.zipCode}`.trim();
}

function formatServiceList(items: string[]): string {
  return items.length > 0 ? items.join(", ") : "[]";
}

function packageSummary(quote: QuoteRequestRecord): string {
  const dimensions = getQuoteDimensions(quote);
  const weightInPounds = dimensions.reduce((total, dimension) => total + (
    dimension.weightUnit.toLowerCase() === "kg" ? dimension.weight * 2.20462 : dimension.weight
  ), 0);
  const weightInKilograms = weightInPounds / 2.20462;
  const formatWeight = (weight: number) => weight.toLocaleString(undefined, { maximumFractionDigits: 2 });
  const units = dimensions.reduce((total, dimension) => total + dimension.quantity, 0);
  return `${units} handling unit(s), ${formatWeight(weightInPounds)} lbs / ${formatWeight(weightInKilograms)} kgs`;
}

function densitySummary(quote: QuoteRequestRecord): string {
  return getQuoteDimensions(quote).map((dimension, index) => {
    const poundsPerCubicFoot = calculateDensity(dimension);
    if (poundsPerCubicFoot === null) return `#${index + 1}: -`;
    const kilogramsPerCubicMeter = poundsPerCubicFoot * 16.018463;
    return `#${index + 1}: ${poundsPerCubicFoot.toFixed(1)} lb/ft³ / ${kilogramsPerCubicMeter.toFixed(1)} kg/m³`;
  }).join(" · ");
}

function dimensionSummary(quote: QuoteRequestRecord): string {
  return getQuoteDimensions(quote).map((dimension, index) => [
    `#${index + 1}: ${dimension.quantity} ${dimension.handlingUnit}`,
    `${dimension.length} x ${dimension.width} x ${dimension.height} ${dimension.dimensionUnit}`,
    `${dimension.weight} ${dimension.weightUnit} (CLS ${dimension.freightClass || "--"})`,
    `HazMat? ${dimension.hazmat ? "Yes" : "No"}`,
    `Stackable? ${dimension.stackable ? "Yes" : "No"}`
  ].join("; ")).join(" | ");
}

const providerNames: Record<string, string> = {
  "3pl-systems": "3PL Systems",
  priority1: "Priority1",
  roadrunner: "Roadrunner"
};
const providerOrder: Record<string, number> = { "3pl-systems": 0, priority1: 1, roadrunner: 2 };

function formatProviderName(key: string): string {
  return providerNames[key] ?? key.split("-").map((part) => part ? `${part[0].toUpperCase()}${part.slice(1)}` : "").join(" ");
}

function buildRateColumns(carrierQuotes: CarrierQuoteRecord[]) {
  const columns = new Map<string, { key: string; name: string; quotes: CarrierQuoteRecord[] }>();

  for (const carrierQuote of carrierQuotes) {
    const keyParts = carrierQuote.carrierKey.split(":");
    const providerKey = keyParts[0];
    const isAggregatedRate = keyParts.length > 1;
    const column = columns.get(providerKey) ?? {
      key: providerKey,
      name: isAggregatedRate ? formatProviderName(providerKey) : carrierQuote.carrierName,
      quotes: []
    };
    column.quotes.push(carrierQuote);
    columns.set(providerKey, column);
  }

  return Array.from(columns.values())
    .sort((left, right) => (providerOrder[left.key] ?? 100) - (providerOrder[right.key] ?? 100) || left.name.localeCompare(right.name));
}

type RateSortField = "carrier" | "rate" | "service" | "transit";
type RateSortDirection = "ascending" | "descending";
type RateSort = { field: RateSortField; direction: RateSortDirection };

export function QuoteDetailPage() {
  const { id = "" } = useParams();
  const { session } = useAuth();
  const [quote, setQuote] = useState<QuoteRequestRecord | null>(null);
  const [error, setError] = useState("");
  const [rateSorts, setRateSorts] = useState<Record<string, RateSort>>({});
  const [activeProviderKey, setActiveProviderKey] = useState("");
  const rateColumns = quote ? buildRateColumns(quote.carrierQuotes) : [];
  const activeRateColumn = rateColumns.find((column) => column.key === activeProviderKey) ?? rateColumns[0] ?? null;
  const activeSort = activeRateColumn ? rateSorts[activeRateColumn.key] : undefined;
  const activeRates = activeRateColumn
    ? activeRateColumn.quotes.filter((carrierQuote) => carrierQuote.rateAmount !== null)
    : [];
  const activeRateIsWaiting = activeRateColumn?.quotes.some((carrierQuote) => carrierQuote.status === "pending") ?? false;
  if (activeSort) {
    activeRates.sort((left, right) => {
      let comparison = 0;
      if (activeSort.field === "carrier") {
        comparison = left.carrierName.localeCompare(right.carrierName);
      } else if (activeSort.field === "rate") {
        comparison = (left.rateAmount ?? Number.POSITIVE_INFINITY) - (right.rateAmount ?? Number.POSITIVE_INFINITY);
      } else if (activeSort.field === "service") {
        comparison = (left.serviceLevel ?? "").localeCompare(right.serviceLevel ?? "");
      } else {
        comparison = (left.transitDays ?? Number.POSITIVE_INFINITY) - (right.transitDays ?? Number.POSITIVE_INFINITY);
      }
      return activeSort.direction === "ascending" ? comparison : -comparison;
    });
  }

  function toggleRateSort(field: RateSortField) {
    if (!activeRateColumn) return;
    setRateSorts((current) => {
      const previous = current[activeRateColumn.key];
      return {
        ...current,
        [activeRateColumn.key]: {
          field,
          direction: previous?.field === field && previous.direction === "ascending" ? "descending" : "ascending"
        }
      };
    });
  }

  function sortIndicator(field: RateSortField): string {
    if (activeSort?.field !== field) return "↕";
    return activeSort.direction === "ascending" ? "↑" : "↓";
  }

  useEffect(() => {
    if (!session || !id) return;
    const token = session.token;

    let cancelled = false;
    let shouldPoll = true;
    let timeoutId: number | undefined;

    function scheduleReload() {
      if (!cancelled && shouldPoll) {
        timeoutId = window.setTimeout(loadQuote, 1500);
      }
    }

    async function loadQuote() {
      try {
        const result = await fetchQuote(id, token);
        if (cancelled) return;
        setQuote(result);
        setError("");

        if (result.status === "processing") {
          scheduleReload();
        } else {
          shouldPoll = false;
        }
      } catch (nextError) {
        if (!cancelled) {
          setError(nextError instanceof Error ? nextError.message : "Failed to load quote.");
          // SQL Server can briefly reject a read as a deadlock victim while carrier
          // results are being replaced. Keep polling so one transient failure does
          // not leave the page showing its original pending placeholders forever.
          scheduleReload();
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

              <div className="detail-label">Density:</div>
              <div>{densitySummary(quote)}</div>

              <div className="detail-label">Freight Classes:</div>
              <div>{getQuoteDimensions(quote).map((dimension) => dimension.freightClass || "-").join(", ")}</div>

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

          <div className="detail-rates-toolbar">
            <div>
              <strong>Carrier rates</strong>
              <span>{rateColumns.reduce((total, column) => total + column.quotes.length, 0)} rates</span>
            </div>
            <span className="rate-sort-hint">Select a company tab to view its rates</span>
          </div>

          <div className="provider-tabs" role="tablist" aria-label="Rate companies">
            {rateColumns.map((column) => {
              const selected = column.key === activeRateColumn?.key;
              const waiting = column.quotes.some((carrierQuote) => carrierQuote.status === "pending");
              const availableRateCount = column.quotes.filter((carrierQuote) => carrierQuote.rateAmount !== null).length;
              return (
                <button
                  type="button"
                  role="tab"
                  id={`provider-tab-${column.key}`}
                  aria-controls="provider-rate-panel"
                  aria-selected={selected}
                  className={selected ? "provider-tab active" : "provider-tab"}
                  key={column.key}
                  onClick={() => setActiveProviderKey(column.key)}
                >
                  <span>{column.name}</span>
                  <small className={waiting ? "waiting" : undefined}>{waiting ? "Waiting" : availableRateCount}</small>
                </button>
              );
            })}
          </div>

          <div
            className="table-panel detail-rates-panel"
            id="provider-rate-panel"
            role="tabpanel"
            aria-labelledby={activeRateColumn ? `provider-tab-${activeRateColumn.key}` : undefined}
          >
            {activeRateColumn ? (
              <>
                <div className="provider-rate-controls">
                  <strong>{activeRateColumn.name}</strong>
                  <span>{activeRates.length} rate(s)</span>
                </div>
                <table className="detail-rates-table provider-rates-table">
              <thead>
                <tr>
                  {([
                    ["carrier", "Carrier"],
                    ["rate", "Rate"],
                    ["service", "Service"],
                    ["transit", "Transit"]
                  ] as Array<[RateSortField, string]>).map(([field, label]) => (
                    <th
                      scope="col"
                      key={field}
                      aria-sort={activeSort?.field === field ? activeSort.direction : "none"}
                    >
                      <button type="button" className="rate-header-sort" onClick={() => toggleRateSort(field)}>
                        <span>{label}</span>
                        <span aria-hidden="true">{sortIndicator(field)}</span>
                      </button>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {activeRates.map((carrierQuote) => (
                  <tr key={carrierQuote.id}>
                    <td>
                      <div className="carrier-rate-cell">
                        <span className="carrier-rate-name">{carrierQuote.carrierName}</span>
                        {carrierQuote.warningMessage ? (
                          <span className="carrier-rate-warning">
                            <span aria-hidden="true">⚠</span>
                            {carrierQuote.warningMessage}
                          </span>
                        ) : null}
                      </div>
                    </td>
                    <td><strong>{carrierQuote.rateAmount !== null ? `$${carrierQuote.rateAmount.toFixed(2)}` : "No rate"}</strong></td>
                    <td>{carrierQuote.serviceLevel ?? "Service unavailable"}</td>
                    <td>{carrierQuote.transitDays !== null ? `${carrierQuote.transitDays} day(s)` : "—"}</td>
                  </tr>
                ))}
                {activeRates.length === 0 ? (
                  <tr>
                    <td colSpan={4}>
                      {activeRateIsWaiting ? "Waiting for this carrier to respond..." : "No carrier results are available for this company."}
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
              </>
            ) : <div className="empty-provider-rates">No carrier results are available.</div>}
          </div>

          <div className="detail-footer-actions">
            <button type="button" className="print-quote-button" onClick={() => window.print()}>
              Print
            </button>
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
