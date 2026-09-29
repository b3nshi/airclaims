import "server-only";
import { notFound } from "next/navigation";
import { redirect } from "@/i18n/navigation";
import { canEditDocuments, isDraft, type WizardStep } from "@/lib/claims/model";
import { createClient, getCurrentUser } from "@/lib/supabase/server";

/** Signed-in user, or redirect to login (returning here afterwards). */
export async function requireUser(locale: string, returnTo: string) {
  const user = await getCurrentUser();
  if (!user) {
    return redirect({ href: { pathname: "/login", query: { next: `/${locale}${returnTo}` } }, locale });
  }
  return user;
}

/** The user's claim (RLS-scoped) or 404. */
export async function getOwnClaim(claimId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(claimId)) notFound();
  const supabase = await createClient();
  const { data, error } = await supabase.from("claims").select("*").eq("id", claimId).maybeSingle();
  if (error) throw error;
  if (!data) notFound();
  return data;
}

const CONTENT_STEPS = ["flight", "disruption", "passengers", "review", "sign"];

/**
 * For wizard step pages: signed-in owner + claim, redirecting to the done step when
 * the claim can no longer be edited at this step.
 */
export async function loadStep(locale: string, claimId: string, step: WizardStep) {
  const user = await requireUser(locale, `/claims/${claimId}/${step}`);
  const claim = await getOwnClaim(claimId);
  const allowed = CONTENT_STEPS.includes(step)
    ? isDraft(claim.status)
    : step === "expenses" || step === "documents"
      ? canEditDocuments(claim.status)
      : !isDraft(claim.status); // done
  if (!allowed) {
    return redirect({ href: `/claims/${claimId}/${isDraft(claim.status) ? "flight" : "done"}`, locale });
  }
  return { user, claim };
}
