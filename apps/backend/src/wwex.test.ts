import assert from "node:assert/strict";
import type { QuoteRequestInput } from "@tms/shared";
import { extractWwexCubicMinimumWarning, WwexAdapter } from "./wwex.js";

const input: QuoteRequestInput = {
  requestedDate: "2026-08-21",
  requestedFrom: "Test Customer",
  commodity: "Boxed grills",
  pickupLocation: { zipCode: "72205", city: "Little Rock", state: "AR", country: "US" },
  deliveryLocation: { zipCode: "60606", city: "Chicago", state: "IL", country: "US" },
  dimensions: {
    handlingUnit: "Pallet",
    length: 48,
    width: 40,
    height: 40,
    dimensionUnit: "in",
    quantity: 2,
    weight: 275,
    weightUnit: "lb",
    freightClass: "150",
    hazmat: false,
    stackable: false
  },
  specialServices: {
    general: ["Notification", "Guaranteed Service"],
    pickup: ["Liftgate Pickup"],
    delivery: ["Inside Delivery", "Residential Delivery", "Delivery Appointment", "Protect from Freeze"],
    overLength: []
  }
};

async function main() {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    if (String(url).includes("oauth/token")) {
      return new Response(JSON.stringify({ access_token: "test-token", expires_in: 86400 }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    }
    return new Response(JSON.stringify({
      clientStatus: { success: true, message: "" },
      response: {
        message: "Shop Offers created.",
        offerList: [{
          offerId: "offer-1",
          productTransactionId: "transaction-1",
          primaryVendor: { preferredName: "SAIA MOTOR FREIGHT LINE LLC", scac: "SAIA" },
          totalOfferPrice: { value: 775.42, unit: "USD" },
          offeredProductList: [{
            cubicMinWarning: "This shipment exceeds carrier's cubic min threshold.",
            shopRQShipment: {
              timeInTransit: {
                scac: "SAIA",
                transitDays: 2,
                serviceLevel: "GUARANTEED",
                serviceDescription: "Saia Guaranteed 5"
              }
            }
          }]
        }]
      }
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  };

  try {
    const adapter = new WwexAdapter({
      authUrl: "https://auth.wwex.com/oauth/token",
      apiBaseUrl: "https://www.speedship.com/svc/",
      clientId: "client-id",
      clientSecret: "client-secret",
      audience: "wwex-apig",
      timeoutMs: 30000
    });
    const first = await adapter.quote(input);
    const second = await adapter.quote(input);

    assert.equal(calls.length, 3, "the OAuth token should be reused for the second quote");
    const tokenBody = calls[0].init?.body as URLSearchParams;
    assert.equal(tokenBody.get("grant_type"), "client_credentials");
    assert.equal(tokenBody.get("audience"), "wwex-apig");

    assert.equal(calls[1].url, "https://www.speedship.com/svc/shopFlow");
    assert.equal(new Headers(calls[1].init?.headers).get("Authorization"), "Bearer test-token");
    const body = JSON.parse(String(calls[1].init?.body)) as any;
    const shipment = body.request.shipment;
    assert.equal(body.request.productType, "LTL");
    assert.equal(shipment.handlingUnitList[0].packagingType, "PLT");
    assert.equal(shipment.handlingUnitList[0].weight.value, 275);
    assert.equal(shipment.totalWeight.value, 275);
    assert.equal(shipment.liftgatePickupFlag, true);
    assert.equal(shipment.insideDeliveryFlag, true);
    assert.equal(shipment.appointmentDeliveryFlag, true);
    assert.equal(shipment.protectionFromColdFlag, true);
    assert.equal(shipment.destinationAddress.locationType, "RESIDENTIAL");
    assert.equal(shipment.notifyBeforeDeliveryFlag, true);
    assert.equal(shipment.isGuaranteed, true);

    assert.equal(first.length, 1);
    assert.equal(first[0].carrierKey, "wwex:saia:offer-1");
    assert.equal(first[0].carrierName, "SAIA MOTOR FREIGHT LINE LLC");
    assert.equal(first[0].rateAmount, 775.42);
    assert.equal(first[0].serviceLevel, "GUARANTEED · Saia Guaranteed 5");
    assert.equal(first[0].transitDays, 2);
    assert.equal(
      extractWwexCubicMinimumWarning(first[0].rawResponse),
      "This shipment exceeds carrier's cubic min threshold."
    );
    assert.equal(extractWwexCubicMinimumWarning("not-json"), null);
    assert.deepEqual(second, first);

    await assert.rejects(
      () => adapter.quote({ ...input, dimensions: { ...input.dimensions, hazmat: true } }),
      /hazardous-material rating requires/
    );
    console.log("WWEX adapter test passed.");
  } finally {
    globalThis.fetch = originalFetch;
  }
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
