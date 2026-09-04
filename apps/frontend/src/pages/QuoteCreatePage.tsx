import { useEffect, useState, type Dispatch, type FormEvent, type SetStateAction } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { calculateDensity, freightClassForDensity, getQuoteDimensions, type QuoteDimensionInput, type QuoteRequestInput } from "@tms/shared";
import { createQuote, fetchLocationByZipCode, fetchQuote } from "../api";
import { useAuth } from "../state";

const generalOptions = ["HazMat", "Notification", "Guaranteed Service"];
const pickupOptions = [
  "CFS Pickup",
  "Airport Pickup",
  "Inside Pickup",
  "Liftgate Pickup",
  "Pickup Appointment",
  "Residential Pickup",
  "Construction Site Pickup",
  "Church Pickup",
  "Hospital Pickup",
  "Hotel Pickup",
  "Resort Pickup",
  "School Pickup",
  "Military Base Pickup",
  "Prison Pickup",
  "Country Club Pickup",
  "Farm Pickup",
  "Ranch Pickup",
  "Camp Pickup",
  "Park Pickup"
];
const deliveryOptions = [
  "Inside Delivery",
  "Liftgate Delivery",
  "Delivery Appointment",
  "Residential Delivery",
  "Construction Site Delivery",
  "Church Delivery",
  "Hospital Delivery",
  "Hotel Delivery",
  "Resort Delivery",
  "Military Base Delivery",
  "Prison Delivery",
  "Country Club Delivery",
  "CFS Delivery",
  "Farm Delivery",
  "Ranch Delivery",
  "Camp Delivery",
  "Park Delivery",
  "Protect from Freeze"
];
const overLengthOptions = ["8ft", "9ft", "10ft", "11ft", "12ft", "13ft", "14ft", "15ft", "16ft", "17ft", "18ft", "19ft", "20ft"];

const initialForm: QuoteRequestInput = {
  requestedDate: new Date().toISOString().slice(0, 10),
  requestedFrom: "",
  commodity: "",
  pickupLocation: {
    zipCode: "",
    city: "",
    state: "",
    country: "US"
  },
  deliveryLocation: {
    zipCode: "",
    city: "",
    state: "",
    country: "US"
  },
  dimensions: {
    handlingUnit: "Pallet",
    length: 48,
    width: 40,
    height: 48,
    dimensionUnit: "in",
    quantity: 1,
    weight: 1000,
    weightUnit: "lb",
    freightClass: "",
    hazmat: false,
    stackable: false
  },
  additionalDimensions: [],
  specialServices: {
    general: [],
    pickup: [],
    delivery: [],
    overLength: []
  }
};

function toggleSelection(items: string[], value: string): string[] {
  return items.includes(value) ? items.filter((item) => item !== value) : [...items, value];
}

type LocationSection = "pickupLocation" | "deliveryLocation";

function useZipCodeLookup(
  section: LocationSection,
  zipCode: string,
  setForm: Dispatch<SetStateAction<QuoteRequestInput>>,
  setStatus: Dispatch<SetStateAction<string>>
) {
  useEffect(() => {
    if (!/^\d{5}$/.test(zipCode)) {
      setStatus("");
      return;
    }

    let cancelled = false;
    const timer = window.setTimeout(() => {
      setStatus("Looking up ZIP code...");
      void fetchLocationByZipCode(zipCode)
        .then((location) => {
          if (cancelled) return;
          setForm((current) => {
            if (current[section].zipCode !== zipCode) return current;
            return {
              ...current,
              [section]: {
                ...current[section],
                city: location.cityName,
                state: location.stateCode,
                country: location.countryCode
              }
            };
          });
          setStatus("");
        })
        .catch((lookupError: unknown) => {
          if (!cancelled) {
            setStatus(lookupError instanceof Error ? lookupError.message : "Unable to look up ZIP code.");
          }
        });
    }, 250);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [section, setForm, setStatus, zipCode]);
}

export function QuoteCreatePage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { session } = useAuth();
  const copiedQuoteId = searchParams.get("copy")?.trim() ?? "";
  const [form, setForm] = useState<QuoteRequestInput>(initialForm);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [loadingCopy, setLoadingCopy] = useState(Boolean(copiedQuoteId));
  const [pickupLookupStatus, setPickupLookupStatus] = useState("");
  const [deliveryLookupStatus, setDeliveryLookupStatus] = useState("");

  useZipCodeLookup("pickupLocation", form.pickupLocation.zipCode, setForm, setPickupLookupStatus);
  useZipCodeLookup("deliveryLocation", form.deliveryLocation.zipCode, setForm, setDeliveryLookupStatus);

  useEffect(() => {
    if (!copiedQuoteId || !session) {
      setLoadingCopy(false);
      return;
    }

    let cancelled = false;
    setLoadingCopy(true);
    setError("");
    void fetchQuote(copiedQuoteId, session.token)
      .then((existingQuote) => {
        if (cancelled) return;
        setForm({
          requestedDate: existingQuote.requestedDate,
          requestedFrom: existingQuote.requestedFrom,
          commodity: existingQuote.commodity,
          pickupLocation: { ...existingQuote.pickupLocation },
          deliveryLocation: { ...existingQuote.deliveryLocation },
          dimensions: { ...existingQuote.dimensions },
          additionalDimensions: (existingQuote.additionalDimensions ?? []).map((dimension) => ({ ...dimension })),
          specialServices: {
            general: [...existingQuote.specialServices.general],
            pickup: [...existingQuote.specialServices.pickup],
            delivery: [...existingQuote.specialServices.delivery],
            overLength: [...existingQuote.specialServices.overLength]
          }
        });
      })
      .catch((nextError: unknown) => {
        if (!cancelled) setError(nextError instanceof Error ? nextError.message : "Failed to load the copied quote.");
      })
      .finally(() => {
        if (!cancelled) setLoadingCopy(false);
      });

    return () => {
      cancelled = true;
    };
  }, [copiedQuoteId, session]);

  const dimensionRows = getQuoteDimensions(form);

  function updateLocation(section: "pickupLocation" | "deliveryLocation", field: "zipCode" | "city" | "state" | "country", value: string) {
    setForm((current) => ({
      ...current,
      [section]: {
        ...current[section],
        [field]: value
      }
    }));
  }

  function updateZipCode(section: LocationSection, value: string) {
    const zipCode = value.replace(/\D/g, "").slice(0, 5);
    setForm((current) => ({
      ...current,
      [section]: {
        ...current[section],
        zipCode,
        city: "",
        state: ""
      }
    }));
  }

  function updateDimension<K extends keyof QuoteDimensionInput>(index: number, field: K, value: QuoteDimensionInput[K]) {
    setForm((current) => {
      const rows = getQuoteDimensions(current);
      const nextDimension = { ...rows[index], [field]: value };
      if (field !== "freightClass") {
        nextDimension.freightClass = freightClassForDensity(calculateDensity(nextDimension)) ?? "";
      }
      rows[index] = nextDimension;
      return { ...current, dimensions: rows[0], additionalDimensions: rows.slice(1) };
    });
  }

  function addDimension() {
    setForm((current) => ({
      ...current,
      additionalDimensions: [
        ...(current.additionalDimensions ?? []),
        { ...initialForm.dimensions }
      ]
    }));
  }

  function deleteDimension(index: number) {
    setForm((current) => {
      const rows = getQuoteDimensions(current);
      if (rows.length === 1) return current;
      rows.splice(index, 1);
      return { ...current, dimensions: rows[0], additionalDimensions: rows.slice(1) };
    });
  }

  function toggleService(group: keyof QuoteRequestInput["specialServices"], option: string) {
    setForm({
      ...form,
      specialServices: {
        ...form.specialServices,
        [group]: toggleSelection(form.specialServices[group], option)
      }
    });
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!session) return;

    setError("");
    setSubmitting(true);
    try {
      const result = await createQuote(form, session.token);
      navigate(`/quotes/${result.id}`);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Failed to create quote.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="stack">
      <div className="page-header">
        <div>
          <p className="eyebrow">New Request</p>
          <h2>{copiedQuoteId ? `Copy quote ${copiedQuoteId}` : "Create a freight quote"}</h2>
          <p className="page-description">
            {copiedQuoteId
              ? "Edit the copied shipment information, then submit it to generate a new quotation number."
              : "Add the shipment details below to compare available carrier rates."}
          </p>
        </div>
      </div>
      {loadingCopy ? <div className="panel copy-status" role="status">Loading quote information...</div> : null}
      {copiedQuoteId && !loadingCopy && !error ? (
        <div className="copy-notice" role="status">Copied from <strong>{copiedQuoteId}</strong>. Changes will be saved as a new quote.</div>
      ) : null}
      <form className="stack" onSubmit={handleSubmit}>
        <section className="panel form request-grid">
          <label>
            Requested Date
            <input
              type="date"
              value={form.requestedDate}
              onChange={(event) => setForm({ ...form, requestedDate: event.target.value })}
            />
          </label>
          <label>
            Requested From
            <input
              value={form.requestedFrom}
              onChange={(event) => setForm({ ...form, requestedFrom: event.target.value })}
              placeholder="Customer or branch"
            />
          </label>
          <label className="full-width">
            Commodity
            <input value={form.commodity} onChange={(event) => setForm({ ...form, commodity: event.target.value })} placeholder="ex) BBQ grills" />
          </label>
        </section>

        <section className="panel stack">
          <div className="section-heading"><span className="section-number">01</span><div><div className="section-title">Pickup</div><p>Where the shipment starts</p></div></div>
          <div className="location-grid">
            <label>
              Zip Code
              <input
                inputMode="numeric"
                maxLength={5}
                value={form.pickupLocation.zipCode}
                onChange={(event) => updateZipCode("pickupLocation", event.target.value)}
              />
            </label>
            <label>
              City
              <input value={form.pickupLocation.city} onChange={(event) => updateLocation("pickupLocation", "city", event.target.value)} />
            </label>
            <label>
              State
              <input value={form.pickupLocation.state} onChange={(event) => updateLocation("pickupLocation", "state", event.target.value)} />
            </label>
            <label>
              Country
              <select value={form.pickupLocation.country} onChange={(event) => updateLocation("pickupLocation", "country", event.target.value)}>
                <option value="US">US</option>
                <option value="CA">CA</option>
                <option value="MX">MX</option>
              </select>
            </label>
          </div>
          {pickupLookupStatus ? <p className="zip-lookup-status" role="status">{pickupLookupStatus}</p> : null}
        </section>

        <section className="panel stack">
          <div className="section-heading"><span className="section-number">02</span><div><div className="section-title">Delivery</div><p>Where the shipment is going</p></div></div>
          <div className="location-grid">
            <label>
              Zip Code
              <input
                inputMode="numeric"
                maxLength={5}
                value={form.deliveryLocation.zipCode}
                onChange={(event) => updateZipCode("deliveryLocation", event.target.value)}
              />
            </label>
            <label>
              City
              <input value={form.deliveryLocation.city} onChange={(event) => updateLocation("deliveryLocation", "city", event.target.value)} />
            </label>
            <label>
              State
              <input value={form.deliveryLocation.state} onChange={(event) => updateLocation("deliveryLocation", "state", event.target.value)} />
            </label>
            <label>
              Country
              <select value={form.deliveryLocation.country} onChange={(event) => updateLocation("deliveryLocation", "country", event.target.value)}>
                <option value="US">US</option>
                <option value="CA">CA</option>
                <option value="MX">MX</option>
              </select>
            </label>
          </div>
          {deliveryLookupStatus ? <p className="zip-lookup-status" role="status">{deliveryLookupStatus}</p> : null}
        </section>

        <section className="panel stack">
          <div className="section-heading dimension-section-heading">
            <span className="section-number">03</span>
            <div><div className="section-title">Dimensions</div><p>Package size, weight, and handling</p></div>
            <button className="compact-button dimension-add-button" type="button" onClick={addDimension}>+ Add dimension</button>
          </div>
          {dimensionRows.map((dimension, index) => {
            const density = calculateDensity(dimension);
            const suggestedFreightClass = freightClassForDensity(density);
            const formattedDensity = density === null ? "--" : density.toFixed(1);
            return (
          <div className="dimension-entry stack" key={index}>
            <div className="dimension-entry-heading">
              <strong>Dimension {index + 1}</strong>
              <button className="dimension-delete-button" type="button" disabled={dimensionRows.length === 1} onClick={() => deleteDimension(index)}>Delete</button>
            </div>
          <div className="dimension-grid">
            <label>
              Handling Unit
              <select value={dimension.handlingUnit} onChange={(event) => updateDimension(index, "handlingUnit", event.target.value)}>
                <option value="Pallet">Pallet</option>
                <option value="Crate">Crate</option>
                <option value="Carton">Carton</option>
              </select>
            </label>
            <label>
              Length
              <input type="number" min="1" value={dimension.length} onChange={(event) => updateDimension(index, "length", Number(event.target.value))} />
            </label>
            <label>
              Width
              <input type="number" min="1" value={dimension.width} onChange={(event) => updateDimension(index, "width", Number(event.target.value))} />
            </label>
            <label>
              Height
              <input type="number" min="1" value={dimension.height} onChange={(event) => updateDimension(index, "height", Number(event.target.value))} />
            </label>
            <label>
              Unit
              <select value={dimension.dimensionUnit} onChange={(event) => updateDimension(index, "dimensionUnit", event.target.value)}>
                <option value="in">in</option>
                <option value="ft">ft</option>
                <option value="cm">cm</option>
              </select>
            </label>
            <label>
              QTY
              <input type="number" min="1" value={dimension.quantity} onChange={(event) => updateDimension(index, "quantity", Number(event.target.value))} />
            </label>
            <label className="dimension-field-with-result">
              Total Weight
              <input type="number" min="1" value={dimension.weight} onChange={(event) => updateDimension(index, "weight", Number(event.target.value))} />
              <span className="calculated-value" aria-live="polite">Density: {formattedDensity} lb/ft³</span>
            </label>
            <label>
              Weight Unit
              <select value={dimension.weightUnit} onChange={(event) => updateDimension(index, "weightUnit", event.target.value)}>
                <option value="lb">lb</option>
                <option value="kg">kg</option>
              </select>
            </label>
            <label className="dimension-field-with-result">
              Freight Class
              <input value={dimension.freightClass} onChange={(event) => updateDimension(index, "freightClass", event.target.value)} placeholder="--" />
              <span className="calculated-value" aria-live="polite">Suggested: {suggestedFreightClass ?? "--"}</span>
            </label>
            <label className="checkbox-row">
              <input type="checkbox" checked={dimension.hazmat} onChange={(event) => updateDimension(index, "hazmat", event.target.checked)} />
              <span>HazMat?</span>
            </label>
            <label className="checkbox-row">
              <input type="checkbox" checked={dimension.stackable} onChange={(event) => updateDimension(index, "stackable", event.target.checked)} />
              <span>Stackable?</span>
            </label>
          </div>
          </div>
            );
          })}
        </section>

        <section className="panel stack">
          <div className="section-heading"><span className="section-number">04</span><div><div className="section-title">Special services</div><p>Select any additional handling requirements</p></div></div>
          <div className="services-grid">
            <div>
              <div className="service-group-title">General</div>
              {generalOptions.map((option) => (
                <label className="checkbox-row" key={option}>
                  <input
                    type="checkbox"
                    checked={form.specialServices.general.includes(option)}
                    onChange={() => toggleService("general", option)}
                  />
                  <span>{option}</span>
                </label>
              ))}
            </div>
            <div>
              <div className="service-group-title">Pick Up</div>
              {pickupOptions.map((option) => (
                <label className="checkbox-row" key={option}>
                  <input
                    type="checkbox"
                    checked={form.specialServices.pickup.includes(option)}
                    onChange={() => toggleService("pickup", option)}
                  />
                  <span>{option}</span>
                </label>
              ))}
            </div>
            <div>
              <div className="service-group-title">Delivery</div>
              {deliveryOptions.map((option) => (
                <label className="checkbox-row" key={option}>
                  <input
                    type="checkbox"
                    checked={form.specialServices.delivery.includes(option)}
                    onChange={() => toggleService("delivery", option)}
                  />
                  <span>{option}</span>
                </label>
              ))}
            </div>
            <div>
              <div className="service-group-title">Over Length</div>
              {overLengthOptions.map((option) => (
                <label className="checkbox-row" key={option}>
                  <input
                    type="checkbox"
                    checked={form.specialServices.overLength.includes(option)}
                    onChange={() => toggleService("overLength", option)}
                  />
                  <span>Over Length {option}</span>
                </label>
              ))}
            </div>
          </div>
        </section>

        {error ? <p className="error-text full-width">{error}</p> : null}
        <div className="panel actions">
          <div><strong>Ready to compare rates?</strong><p className="muted action-note">Carrier results are saved to quote history.</p></div>
          <button disabled={submitting || loadingCopy}>
            {submitting ? "Searching rates..." : copiedQuoteId ? "Get new quotation number" : "Search carrier rates"}
          </button>
        </div>
      </form>
    </section>
  );
}
