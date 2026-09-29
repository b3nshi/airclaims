import "server-only";
import { FEE } from "@/lib/eligibility";
import { SIGNED_AGREEMENTS, renderLegal } from "@/lib/legal/documents";
import type { ClaimRow } from "@/lib/supabase/database.types";
import type { ClaimAssessment } from "./assess";
import { aliasEmail } from "./model";

/** Renders the three agreements exactly as the user signs them for this claim. */
export async function renderClaimAgreements(claim: ClaimRow, assessment: ClaimAssessment, locale: string) {
  const lead = assessment.passengers.find((p) => p.is_lead);
  const vars = {
    SIGNER_NAME: lead?.full_name ?? "",
    ALIAS_EMAIL: aliasEmail(claim.alias_code),
    FLIGHT: claim.flight_iata,
    FLIGHT_DATE: claim.flight_date,
    AIRLINE: assessment.airline?.name ?? claim.flight_iata.slice(0, 2),
    FEE_BASE: String(FEE.basePct),
    FEE_MIN: String(FEE.minPct),
  };
  const docs = await Promise.all(SIGNED_AGREEMENTS.map((kind) => renderLegal(kind, locale, vars)));
  return SIGNED_AGREEMENTS.map((kind, i) => ({ kind, ...docs[i] }));
}

/** Names match ignoring case, accents and extra spaces. */
export const sameName = (a: string, b: string) => {
  const norm = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/\s+/g, " ").trim();
  return norm(a) === norm(b);
};
