"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { invalid, type FormState } from "@/lib/claims/form-state";
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
  template: "initial_claim" | "follow_up" | "offer_reply",
): Promise<{ ok: boolean }> {
  const claim = await requireOwner(locale, claimId);
  const allowed =
    template === "initial_claim"
      ? claim.status === "ready_to_submit" || claim.status === "documents_pending"
      : template === "follow_up"
        ? claim.status === "submitted_airline"
        : claim.status === "submitted_airline" || claim.status === "airline_replied";
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

const responseSchema = z.object({
  channel: z.enum(["web_form", "email", "letter", "phone", "chat", "other"]),
  received_on: z.iso.date(),
  airline_text: z.string().trim().max(20000),
  explanation: z.string().trim().max(5000),
});

/**
 * The passenger reports the airline's answer (e.g. the web form's automatic verdict) and explains
 * what happened; n8n reads it and suggests how to respond.
 */
export async function reportAirlineResponse(locale: string, claimId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  await requireOwner(locale, claimId);
  const parsed = responseSchema.safeParse({
    channel: formData.get("channel"),
    received_on: formData.get("received_on"),
    airline_text: formData.get("airline_text") ?? "",
    explanation: formData.get("explanation") ?? "",
  });
  if (!parsed.success) return invalid(parsed.error.issues);
  const v = parsed.data;
  if (!v.airline_text && !v.explanation) return { status: "invalid", fieldErrors: { airline_text: true } };
  const supabase = await createClient();
  const { data: responseId, error } = await supabase.rpc("report_airline_response", {
    p_claim_id: claimId,
    p_channel: v.channel,
    p_received_on: v.received_on,
    p_airline_text: v.airline_text || null,
    p_explanation: v.explanation || null,
  });
  if (error || !responseId) return { status: "error" };
  await pokeAnswerReader();
  revalidatePath(`/${locale}/claims/${claimId}`, "layout");
  return { status: "saved" };
}

/** Answers are read from a queue (every 2 minutes); a poke just starts a run now. */
async function pokeAnswerReader() {
  try {
    await callN8n("airclaim-airline-response", { reason: "new_answer" });
  } catch {
    // The 2-minute schedule picks it up anyway.
  }
}

/** Retry reading an answer whose analysis failed or never started. */
export async function retryAirlineResponseAnalysis(locale: string, claimId: string, responseId: string): Promise<FormState> {
  await requireOwner(locale, claimId);
  const supabase = await createClient();
  const { error } = await supabase.rpc("retry_airline_response", { p_response_id: responseId });
  if (error) return { status: "error" };
  await pokeAnswerReader();
  revalidatePath(`/${locale}/claims/${claimId}`);
  return { status: "saved" };
}

/**
 * The passenger chose how to answer the airline: n8n drafts the reply (an email to approve, or a
 * text to paste into the airline's form). Nothing is sent without their approval.
 */
export async function requestChallengeDraft(
  locale: string,
  claimId: string,
  responseId: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const claim = await requireOwner(locale, claimId);
  if (!["submitted_airline", "airline_replied", "ready_to_submit", "documents_pending"].includes(claim.status)) {
    return { status: "error" };
  }
  const on = (k: string) => formData.get(k) === "on";
  const deadline = Number(formData.get("deadline_days") ?? 14);
  const options = {
    request_evidence: on("request_evidence"),
    contest_delay: on("contest_delay"),
    decline_offer: on("decline_offer"),
    include_expenses: on("include_expenses"),
    mention_aesa: on("mention_aesa"),
    deadline_days: [14, 30].includes(deadline) ? deadline : 14,
    passenger_notes: String(formData.get("passenger_notes") ?? "").trim().slice(0, 2000),
  };
  try {
    await callN8n("airclaim-email-draft", { claim_id: claimId, template: "challenge", response_id: responseId, options });
  } catch {
    return { status: "error" };
  }
  return { status: "saved" };
}
