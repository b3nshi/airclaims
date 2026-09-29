// Client-safe claim model helpers (no server imports).
import type { ClaimStatus, Json } from "@/lib/supabase/database.types";

export const WIZARD_STEPS = [
  "flight",
  "disruption",
  "passengers",
  "expenses",
  "documents",
  "review",
  "sign",
  "done",
] as const;
export type WizardStep = (typeof WIZARD_STEPS)[number];

export const nextStep = (step: WizardStep): WizardStep =>
  WIZARD_STEPS[Math.min(WIZARD_STEPS.indexOf(step) + 1, WIZARD_STEPS.length - 1)];

/** Claim content (flight, what happened, passengers…) is editable only as a draft. */
export const isDraft = (status: ClaimStatus) => status === "draft";

/** Expenses can be changed, and documents deleted, until the claim is signed and sent. */
export const canEditDocuments = (status: ClaimStatus) => status === "draft" || status === "documents_pending";

/** Documents can be added while the claim is open (e.g. when the airline asks for them). */
export const canAddDocuments = (status: ClaimStatus) =>
  !["won", "partially_won", "lost", "withdrawn"].includes(status);

export const REASON_CATEGORIES = [
  "technical",
  "weather",
  "atc",
  "crew_shortage",
  "airline_staff_strike",
  "external_strike",
  "security",
  "operational",
  "none_given",
  "other",
] as const;
export type ReasonCategory = (typeof REASON_CATEGORIES)[number];

/** Stored in claims.reason_given_by_airline as "category" or "category: details". */
export function encodeReason(category: ReasonCategory, details: string | null) {
  return details ? `${category}: ${details}` : category;
}

export function decodeReason(value: string | null): { category: ReasonCategory | null; details: string } {
  if (!value) return { category: null, details: "" };
  const [head, ...rest] = value.split(": ");
  const category = (REASON_CATEGORIES as readonly string[]).includes(head) ? (head as ReasonCategory) : null;
  return category ? { category, details: rest.join(": ") } : { category: "other", details: value };
}

export type CareProvided = {
  meals?: boolean;
  hotel?: boolean;
  transport?: boolean;
  // Cancellations: the alternative flight offered (Art. 5.1(c) limits).
  rerouting?: { offered: boolean; earlier_departure_minutes: number | null; later_arrival_minutes: number | null };
};

export function parseCare(value: Json): CareProvided {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as CareProvided) : {};
}

/** "w6 2345" → "W62345". */
export const normalizeFlightNumber = (value: string) => value.toUpperCase().replace(/[^A-Z0-9]/g, "");
export const FLIGHT_NUMBER_RE = /^[A-Z0-9]{2}\d{1,4}[A-Z]?$/;

export const aliasEmail = (aliasCode: string) => `airclaims_${aliasCode}@airclaims.klivr.com`;

export const minutesToParts = (minutes: number | null) =>
  minutes === null ? { hours: "", minutes: "" } : { hours: String(Math.floor(minutes / 60)), minutes: String(minutes % 60) };

// Mirrors the claim-documents bucket limits set in migration 0003.
export const UPLOAD_MIME_TYPES = ["application/pdf", "image/jpeg", "image/png", "image/webp", "image/heic"] as const;
export const UPLOAD_MAX_BYTES = 10 * 1024 * 1024;
