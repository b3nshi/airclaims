"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { lines, requireRole } from "@/lib/admin/server";
import { invalid, type FormState } from "@/lib/claims/form-state";
import { routing } from "@/i18n/routing";
import type { Json } from "@/lib/supabase/database.types";
import { createClient } from "@/lib/supabase/server";

// Every action re-checks the role; RLS and the admin RPCs check it again in the database.
const kb = (locale: string) => requireRole(locale, "/admin", "kb_editor");
const admin = (locale: string) => requireRole(locale, "/admin/review", "admin");

const optionalInt = z.preprocess((v) => (v === "" || v == null ? null : Number(v)), z.number().int().positive().nullable());
const perLocale = (formData: FormData, prefix: string): Json =>
  Object.fromEntries(routing.locales.map((l) => [l, lines(formData.get(`${prefix}_${l}`))]).filter(([, v]) => v.length));

export async function updateAirline(locale: string, airlineId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  await kb(locale);
  const parsed = z
    .object({
      name: z.string().trim().min(2).max(120),
      preferred_language: z.string().trim().toLowerCase().regex(/^[a-z]{2}$/),
      website: z.union([z.url(), z.literal("")]),
      notes: z.string().trim().max(2000),
    })
    .safeParse({
      name: formData.get("name"),
      preferred_language: formData.get("preferred_language"),
      website: String(formData.get("website") ?? "").trim(),
      notes: formData.get("notes") ?? "",
    });
  if (!parsed.success) return invalid(parsed.error.issues);
  const supabase = await createClient();
  const { error } = await supabase
    .from("airlines")
    .update({
      ...parsed.data,
      website: parsed.data.website || null,
      notes: parsed.data.notes || null,
      is_eu_carrier: formData.get("is_eu_carrier") === "on",
      is_active: formData.get("is_active") === "on",
    })
    .eq("id", airlineId);
  if (error) return { status: "error" };
  revalidatePath(`/${locale}/admin`, "layout");
  return { status: "saved" };
}

export async function saveKnowledge(locale: string, airlineId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  const user = await kb(locale);
  const parsed = z
    .object({
      drafting_notes: z.string().trim().max(4000),
      claim_form_notes: z.string().trim().max(4000),
      attachments_max_mb: optionalInt,
      stated_reply_days: optionalInt,
      typical_reply_days_min: optionalInt,
      typical_reply_days_max: optionalInt,
      offers_credit_first: z.enum(["yes", "no", "unknown"]),
    })
    .refine((v) => !v.typical_reply_days_min || !v.typical_reply_days_max || v.typical_reply_days_max >= v.typical_reply_days_min, {
      path: ["typical_reply_days_max"],
    })
    .safeParse({
      drafting_notes: formData.get("drafting_notes") ?? "",
      claim_form_notes: formData.get("claim_form_notes") ?? "",
      attachments_max_mb: formData.get("attachments_max_mb"),
      stated_reply_days: formData.get("stated_reply_days"),
      typical_reply_days_min: formData.get("typical_reply_days_min"),
      typical_reply_days_max: formData.get("typical_reply_days_max"),
      offers_credit_first: formData.get("offers_credit_first") ?? "unknown",
    });
  if (!parsed.success) return invalid(parsed.error.issues);
  const v = parsed.data;
  const supabase = await createClient();
  const { error } = await supabase.from("airline_knowledge").upsert({
    airline_id: airlineId,
    passenger_tips: perLocale(formData, "tips"),
    drafting_notes: v.drafting_notes || null,
    claim_form_notes: v.claim_form_notes || null,
    attachments_max_mb: v.attachments_max_mb,
    stated_reply_days: v.stated_reply_days,
    typical_reply_days_min: v.typical_reply_days_min,
    typical_reply_days_max: v.typical_reply_days_max,
    offers_credit_first: v.offers_credit_first === "unknown" ? null : v.offers_credit_first === "yes",
    updated_by: user.id,
  });
  if (error) return { status: "error" };
  revalidatePath(`/${locale}/admin`, "layout");
  return { status: "saved" };
}

const contactSchema = z
  .object({
    purpose: z.enum(["compensation", "expenses", "refund", "baggage", "general", "legal"]),
    channel: z.enum(["email", "web_form", "postal", "phone"]),
    label: z.string().trim().min(3).max(120),
    value: z.string().trim().min(3).max(500),
    language: z.union([z.string().trim().toLowerCase().regex(/^[a-z]{2}$/), z.literal("")]),
    notes: z.string().trim().max(2000),
  })
  .refine((c) => c.channel !== "email" || z.email().safeParse(c.value).success, { path: ["value"] })
  .refine((c) => c.channel !== "web_form" || z.url().safeParse(c.value).success, { path: ["value"] });

export async function saveContact(
  locale: string,
  airlineId: string,
  contactId: string | null,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  await kb(locale);
  const parsed = contactSchema.safeParse({
    purpose: formData.get("purpose"),
    channel: formData.get("channel"),
    label: formData.get("label"),
    value: formData.get("value"),
    language: formData.get("language") ?? "",
    notes: formData.get("notes") ?? "",
  });
  if (!parsed.success) return invalid(parsed.error.issues);
  const row = {
    ...parsed.data,
    airline_id: airlineId,
    language: parsed.data.language || null,
    notes: parsed.data.notes || null,
    submission_steps: perLocale(formData, "steps"),
    ...(formData.get("mark_verified") === "on" ? { verified_at: new Date().toISOString() } : {}),
  };
  const supabase = await createClient();
  const { error } = contactId
    ? await supabase.from("airline_contacts").update(row).eq("id", contactId).eq("airline_id", airlineId)
    : await supabase.from("airline_contacts").insert(row);
  if (error) return { status: "error" };
  revalidatePath(`/${locale}/admin`, "layout");
  return { status: "saved" };
}

export async function deleteContact(locale: string, airlineId: string, contactId: string): Promise<FormState> {
  await kb(locale);
  const supabase = await createClient();
  const { error } = await supabase.from("airline_contacts").delete().eq("id", contactId).eq("airline_id", airlineId);
  revalidatePath(`/${locale}/admin`, "layout");
  return { status: error ? "error" : "saved" };
}

export async function addInsight(locale: string, airlineId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  const user = await kb(locale);
  const parsed = z
    .object({
      topic: z.enum(["claim_process", "payment_practice", "response_time", "rejection_pattern", "punctuality", "escalation", "tip", "other"]),
      summary: z.string().trim().min(10).max(2000),
      source_name: z.string().trim().min(2).max(200),
      source_url: z.union([z.url(), z.literal("")]),
      reliability: z.enum(["official", "enforcement_body", "competitor", "forum", "own_data"]),
      observed_on: z.iso.date(),
    })
    .safeParse({
      topic: formData.get("topic"),
      summary: formData.get("summary"),
      source_name: formData.get("source_name"),
      source_url: String(formData.get("source_url") ?? "").trim(),
      reliability: formData.get("reliability"),
      observed_on: formData.get("observed_on"),
    });
  if (!parsed.success) return invalid(parsed.error.issues);
  const supabase = await createClient();
  const { error } = await supabase.from("airline_insights").insert({
    ...parsed.data,
    airline_id: airlineId,
    source_url: parsed.data.source_url || null,
    verified: formData.get("verified") === "on",
    created_by: user.id,
  });
  if (error) return { status: "error" };
  revalidatePath(`/${locale}/admin`, "layout");
  return { status: "saved" };
}

export async function setInsightVerified(locale: string, insightId: string, verified: boolean): Promise<FormState> {
  await kb(locale);
  const supabase = await createClient();
  const { error } = await supabase.from("airline_insights").update({ verified }).eq("id", insightId);
  revalidatePath(`/${locale}/admin`, "layout");
  return { status: error ? "error" : "saved" };
}

export async function deleteInsight(locale: string, insightId: string): Promise<FormState> {
  await kb(locale);
  const supabase = await createClient();
  const { error } = await supabase.from("airline_insights").delete().eq("id", insightId);
  revalidatePath(`/${locale}/admin`, "layout");
  return { status: error ? "error" : "saved" };
}

export async function resolveReview(locale: string, reviewId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  await admin(locale);
  const note = String(formData.get("note") ?? "").trim().slice(0, 1000);
  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_resolve_review", { p_id: reviewId, p_note: note || null });
  if (error) return { status: "error" };
  revalidatePath(`/${locale}/admin/review`);
  return { status: "saved" };
}

export async function linkEmailToClaim(locale: string, emailId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  await admin(locale);
  // Accepts the alias code or the full alias address.
  const raw = String(formData.get("alias") ?? "").trim().toLowerCase();
  const code = raw.match(/^(?:airclaims_)?([a-z0-9]{6})(?:@airclaims\.klivr\.com)?$/)?.[1];
  if (!code) return { status: "invalid", fieldErrors: { alias: true } };
  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_link_email_to_claim", { p_email_id: emailId, p_alias_code: code });
  if (error) return { status: "error" };
  revalidatePath(`/${locale}/admin/review`);
  return { status: "saved" };
}
