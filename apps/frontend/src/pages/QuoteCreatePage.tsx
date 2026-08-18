import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import type { QuoteRequestInput } from "@tms/shared";
import { createQuote } from "../api";
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

export function QuoteCreatePage() {
  const navigate = useNavigate();
  const { session } = useAuth();
  const [form, setForm] = useState<QuoteRequestInput>(initialForm);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  function updateLocation(section: "pickupLocation" | "deliveryLocation", field: "zipCode" | "city" | "state" | "country", value: string) {
    setForm({
      ...form,
      [section]: {
        ...form[section],
        [field]: value
      }
    });
  }

  function updateDimension<K extends keyof QuoteRequestInput["dimensions"]>(field: K, value: QuoteRequestInput["dimensions"][K]) {
    setForm({
      ...form,
      dimensions: {
        ...form.dimensions,
        [field]: value
      }
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
          <h2>Create a freight quote</h2>
          <p className="page-description">Add the shipment details below to compare available carrier rates.</p>
        </div>
      </div>
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
              <input value={form.pickupLocation.zipCode} onChange={(event) => updateLocation("pickupLocation", "zipCode", event.target.value)} />
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
        </section>

        <section className="panel stack">
          <div className="section-heading"><span className="section-number">02</span><div><div className="section-title">Delivery</div><p>Where the shipment is going</p></div></div>
          <div className="location-grid">
            <label>
              Zip Code
              <input value={form.deliveryLocation.zipCode} onChange={(event) => updateLocation("deliveryLocation", "zipCode", event.target.value)} />
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
        </section>

        <section className="panel stack">
          <div className="section-heading"><span className="section-number">03</span><div><div className="section-title">Dimensions</div><p>Package size, weight, and handling</p></div></div>
          <div className="dimension-grid">
            <label>
              Handling Unit
              <select value={form.dimensions.handlingUnit} onChange={(event) => updateDimension("handlingUnit", event.target.value)}>
                <option value="Pallet">Pallet</option>
                <option value="Crate">Crate</option>
                <option value="Carton">Carton</option>
              </select>
            </label>
            <label>
              Length
              <input type="number" min="1" value={form.dimensions.length} onChange={(event) => updateDimension("length", Number(event.target.value))} />
            </label>
            <label>
              Width
              <input type="number" min="1" value={form.dimensions.width} onChange={(event) => updateDimension("width", Number(event.target.value))} />
            </label>
            <label>
              Height
              <input type="number" min="1" value={form.dimensions.height} onChange={(event) => updateDimension("height", Number(event.target.value))} />
            </label>
            <label>
              Unit
              <select value={form.dimensions.dimensionUnit} onChange={(event) => updateDimension("dimensionUnit", event.target.value)}>
                <option value="in">in</option>
                <option value="ft">ft</option>
                <option value="cm">cm</option>
              </select>
            </label>
            <label>
              QTY
              <input type="number" min="1" value={form.dimensions.quantity} onChange={(event) => updateDimension("quantity", Number(event.target.value))} />
            </label>
            <label>
              Weight
              <input type="number" min="1" value={form.dimensions.weight} onChange={(event) => updateDimension("weight", Number(event.target.value))} />
            </label>
            <label>
              Weight Unit
              <select value={form.dimensions.weightUnit} onChange={(event) => updateDimension("weightUnit", event.target.value)}>
                <option value="lb">lb</option>
                <option value="kg">kg</option>
              </select>
            </label>
            <label>
              Freight Class
              <input value={form.dimensions.freightClass} onChange={(event) => updateDimension("freightClass", event.target.value)} placeholder="70" />
            </label>
            <label className="checkbox-row">
              <input type="checkbox" checked={form.dimensions.hazmat} onChange={(event) => updateDimension("hazmat", event.target.checked)} />
              <span>HazMat?</span>
            </label>
            <label className="checkbox-row">
              <input type="checkbox" checked={form.dimensions.stackable} onChange={(event) => updateDimension("stackable", event.target.checked)} />
              <span>Stackable?</span>
            </label>
          </div>
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
          <button disabled={submitting}>{submitting ? "Searching rates..." : "Search carrier rates"}</button>
        </div>
      </form>
    </section>
  );
}
