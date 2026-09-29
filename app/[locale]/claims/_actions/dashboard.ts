"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { redirect } from "@/i18n/navigation";
import { todayInMadrid } from "@/lib/claims/dates";
import { getOwnClaim } from "@/lib/claims/server";
import { callN8n } from "@/lib/n8n/client";
import { createClient, getCurrentUser } from "@/lib/supabase/server";

async function requireOwner(locale: string, claimId: string) {
  if (!(await getCurrentUser())) return redirect({ href: "/login", locale });
  return getOwnClaim(claimId);
}

/**
 * The user's explicit approval of an outbound message (principle 2). approve_email
 * only accepts the owner's own pending drafts; n8n sends it once approved (M4).
 */
export async function approveEmail(locale: string, claimId: string, emailId: string): Promise<{ ok: boolean }> {
  await requireOwner(locale, claimId);
  const supabase = await createClient();
  const { error } = await supabase.rpc("approve_email", { p_email_id: emailId });
  revalidatePath(`/${locale}/claims/${claimId}`);
  return { ok: !error };
}

const draftSchema = z.object({
  subject: z.string().trim().min(1).max(200),
  body: z.string().trim().min(1).max(20000),
});

/** The user rewrites a draft before approving it; it's sent in their name. */
export async function editEmailDraft(
  locale: string,
  claimId: string,
  emailId: string,
  input: { subject: string; body: string },
): Promise<{ ok: boolean }> {
  await requireOwner(locale, claimId);
  const parsed = draftSchema.safeParse(input);
  if (!parsed.success) return { ok: false };
  const supabase = await createClient();
  const { error } = await supabase.rpc("update_email_draft", {
    p_email_id: emailId,
    p_subject: parsed.data.subject,
    p_body: parsed.data.body,
  });
  revalidatePath(`/${locale}/claims/${claimId}`);
  return { ok: !error };
}

/** Discards a draft; a new one can be requested from the dashboard. */
export async function discardEmailDraft(locale: string, claimId: string, emailId: string): Promise<{ ok: boolean }> {
  await requireOwner(locale, claimId);
  const supabase = await createClient();
  const { error } = await supabase.rpc("discard_email_draft", { p_email_id: emailId });
  revalidatePath(`/${locale}/claims/${claimId}`);
  return { ok: !error };
}

export async function withdrawClaim(locale: string, claimId: string): Promise<{ ok: boolean }> {
  await requireOwner(locale, claimId);
  const supabase = await createClient();
  const { error } = await supabase.rpc("withdraw_claim", { p_claim_id: claimId });
  revalidatePath(`/${locale}/claims`, "layout");
  return { ok: !error };
}

/**
 * Asks n8n (airclaim-email-draft) for an AI draft the user will review and approve.
 * The database refuses duplicates (one open draft per claim), so retrying is safe.
 */
export async function requestEmailDraft(
  locale: string,
  claimId: string,
  template: "initial_claim" | "follow_up",
): Promise<{ ok: boolean }> {
  const claim = await requireOwner(locale, claimId);
  const allowed =
    template === "initial_claim"
      ? claim.status === "ready_to_submit" || claim.status === "documents_pending"
      : claim.status === "submitted_airline";
  if (!allowed) return { ok: false };
  try {
    await callN8n("airclaim-email-draft", { claim_id: claimId, template }, {
      idempotencyKey: `email-draft:${template}:${claimId}:${todayInMadrid()}`,
    });
    return { ok: true };
  } catch {
    return { ok: false };
  }
}
