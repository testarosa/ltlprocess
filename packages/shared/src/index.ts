export const quoteStatuses = ["submitted", "processing", "completed", "partial", "failed"] as const;
export const carrierQuoteStatuses = ["pending", "success", "unavailable", "error"] as const;

export type QuoteStatus = (typeof quoteStatuses)[number];
export type CarrierQuoteStatus = (typeof carrierQuoteStatuses)[number];

export interface LocationInput {
  zipCode: string;
  city: string;
  state: string;
  country: string;
}

export interface QuoteDimensionInput {
  handlingUnit: string;
  length: number;
  width: number;
  height: number;
  dimensionUnit: string;
  quantity: number;
  weight: number;
  weightUnit: string;
  freightClass: string;
  hazmat: boolean;
  stackable: boolean;
}

export interface QuoteSpecialServices {
  general: string[];
  pickup: string[];
  delivery: string[];
  overLength: string[];
}

export interface QuoteRequestInput {
  requestedDate: string;
  requestedFrom: string;
  commodity: string;
  pickupLocation: LocationInput;
  deliveryLocation: LocationInput;
  dimensions: QuoteDimensionInput;
  specialServices: QuoteSpecialServices;
}

export interface CarrierQuoteRecord {
  id: string;
  carrierKey: string;
  carrierName: string;
  status: CarrierQuoteStatus;
  rateAmount: number | null;
  currency: string | null;
  serviceLevel: string | null;
  transitDays: number | null;
  errorMessage: string | null;
  requestedAt: string;
  respondedAt: string | null;
  updatedAt: string;
}

export interface QuoteRequestRecord extends QuoteRequestInput {
  id: string;
  operatorName: string;
  status: QuoteStatus;
  createdAt: string;
  updatedAt: string;
  carrierQuotes: CarrierQuoteRecord[];
}

export interface AuthSession {
  token: string;
  operatorName: string;
  expiresAt: string;
}

export interface QuoteSummary {
  id: string;
  operatorName: string;
  requestedFrom: string;
  origin: string;
  destination: string;
  shipmentDate: string;
  pickupZipCode: string;
  deliveryZipCode: string;
  lastEditedBy: string;
  userOffice: string;
  userTeam: string;
  isConfirmed: "Y" | "N";
  status: QuoteStatus;
  createdAt: string;
  updatedAt: string;
  carrierCount: number;
}

export interface CreateQuoteResponse {
  id: string;
  status: QuoteStatus;
}
