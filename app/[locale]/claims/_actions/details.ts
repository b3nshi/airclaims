"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { redirect } from "@/i18n/navigation";
import { invalid, type FormState } from "@/lib/claims/form-state";
import { encodeReason, REASON_CATEGORIES, UPLOAD_MIME_TYPES, type CareProvided } from "@/lib/claims/model";
import { createClient } from "@/lib/supabase/server";
import { guardClaim } from "./guard";

const optionalInt = (max: number) =>
  z.preprocess((v) => (v === "" || v === null || v === undefined ? null : Number(v)), z.number().int().min(0).max(max).nullable());

const disruptionSchema = z.object({
  disruption: z.enum(["delay", "cancellation", "denied_boarding", "missed_connection"]),
  delay_hours: optionalInt(96),
  delay_minutes: optionalInt(59),
  notice_days: optionalInt(365),
  rerouting_offered: z.enum(["yes", "no", ""]),
  earlier_hours: optionalInt(96),
  earlier_minutes: optionalInt(59),
  later_hours: optionalInt(96),
  later_minutes: optionalInt(59),
  reason_category: z.enum(REASON_CATEGORIES),
  reason_details: z.string().trim().max(500),
  care_meals: z.boolean(),
  care_hotel: z.boolean(),
  care_transport: z.boolean(),
  airline_instructions: z.string().trim().max(1000),
});

const toMinutes = (h: number | null, m: number | null) => (h === null && m === null ? null : (h ?? 0) * 60 + (m ?? 0));

export async function saveDisruption(locale: string, claimId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  await guardClaim(locale, claimId, "draft");
  const get = (k: string) => formData.get(k) ?? "";
  const parsed = disruptionSchema.safeParse({
    disruption: get("disruption"),
    delay_hours: get("delay_hours"),
    delay_minutes: get("delay_minutes"),
    notice_days: get("notice_days"),
    rerouting_offered: get("rerouting_offered"),
    earlier_hours: get("earlier_hours"),
    earlier_minutes: get("earlier_minutes"),
    later_hours: get("later_hours"),
    later_minutes: get("later_minutes"),
    reason_category: get("reason_category"),
    reason_details: get("reason_details"),
    care_meals: formData.get("care_meals") === "on",
    care_hotel: formData.get("care_hotel") === "on",
    care_transport: formData.get("care_transport") === "on",
    airline_instructions: get("airline_instructions"),
  });
  if (!parsed.success) return invalid(parsed.error.issues);
  const v = parsed.data;
  const isDelay = v.disruption === "delay" || v.disruption === "missed_connection";
  const isCancellation = v.disruption === "cancellation";

  const care: CareProvided = { meals: v.care_meals, hotel: v.care_hotel, transport: v.care_transport };
  if (isCancellation) {
    const offered = v.rerouting_offered === "yes";
    care.rerouting = {
      offered,
      earlier_departure_minutes: offered ? toMinutes(v.earlier_hours, v.earlier_minutes) : null,
      later_arrival_minutes: offered ? toMinutes(v.later_hours, v.later_minutes) : null,
    };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("claims")
    .update({
      disruption: v.disruption,
      reported_arrival_delay_minutes: isDelay ? toMinutes(v.delay_hours, v.delay_minutes) : null,
      cancellation_notice_days: isCancellation ? v.notice_days : null,
      care_provided: care,
      reason_given_by_airline: encodeReason(v.reason_category, v.reason_details || null),
      airline_instructions: v.airline_instructions || null,
    })
    .eq("id", claimId);
  if (error) return { status: "error" };
  return redirect({ href: `/claims/${claimId}/passengers`, locale });
}

const passengersSchema = z
  .array(
    z.object({
      full_name: z.string().trim().min(2).max(120),
      is_infant_free: z.boolean(),
    }),
  )
  .min(1)
  .max(9)
  .refine((list) => !list[0].is_infant_free, { path: [0] });

export async function savePassengers(locale: string, claimId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  await guardClaim(locale, claimId, "draft");
  let raw: unknown;
  try {
    raw = JSON.parse(String(formData.get("passengers") ?? "[]"));
  } catch {
    return { status: "invalid" };
  }
  const parsed = passengersSchema.safeParse(raw);
  if (!parsed.success) {
    return { status: "invalid", fieldErrors: Object.fromEntries(parsed.error.issues.map((i) => [`p${String(i.path[0])}`, true])) };
  }

  const supabase = await createClient();
  const del = await supabase.from("claim_passengers").delete().eq("claim_id", claimId);
  if (del.error) return { status: "error" };
  const ins = await supabase.from("claim_passengers").insert(
    parsed.data.map((p, i) => ({ claim_id: claimId, full_name: p.full_name, is_infant_free: p.is_infant_free, is_lead: i === 0 })),
  );
  if (ins.error) return { status: "error" };
  return redirect({ href: `/claims/${claimId}/expenses`, locale });
}

const expenseSchema = z.object({
  category: z.enum(["ground_transport", "meal", "hotel", "phone", "rebooking", "other"]),
  amount: z.coerce.number().positive().max(10000),
  currency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/),
  spent_at: z.union([z.iso.date(), z.literal("")]),
  description: z.string().trim().max(300),
  airline_promised: z.boolean(),
  promise_details: z.string().trim().max(1000),
  document_id: z.union([z.uuid(), z.literal("")]),
});

export async function addExpense(locale: string, claimId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  await guardClaim(locale, claimId, "documents");
  const get = (k: string) => String(formData.get(k) ?? "");
  const parsed = expenseSchema.safeParse({
    category: get("category"),
    amount: get("amount").replace(",", "."),
    currency: get("currency") || "EUR",
    spent_at: get("spent_at"),
    description: get("description"),
    airline_promised: formData.get("airline_promised") === "on",
    promise_details: get("promise_details"),
    document_id: get("document_id"),
  });
  if (!parsed.success) return invalid(parsed.error.issues);
  const v = parsed.data;

  const supabase = await createClient();
  if (v.document_id) {
    const { data } = await supabase.from("documents").select("id").eq("id", v.document_id).eq("claim_id", claimId).maybeSingle();
    if (!data) return { status: "invalid", fieldErrors: { document_id: true } };
  }
  const { error } = await supabase.from("claim_expenses").insert({
    claim_id: claimId,
    category: v.category,
    amount: v.amount,
    currency: v.currency,
    spent_at: v.spent_at || null,
    description: v.description || null,
    airline_promised: v.airline_promised,
    promise_details: v.airline_promised ? v.promise_details || null : null,
    document_id: v.document_id || null,
  });
  if (error) return { status: "error" };
  revalidatePath(`/${locale}/claims/${claimId}/expenses`);
  return { status: "saved" };
}

export async function deleteExpense(locale: string, claimId: string, expenseId: string) {
  await guardClaim(locale, claimId, "documents");
  const supabase = await createClient();
  const { data } = await supabase.from("claim_expenses").delete().eq("id", expenseId).eq("claim_id", claimId).select("document_id").maybeSingle();
  if (data?.document_id) await removeDocument(claimId, data.document_id);
  revalidatePath(`/${locale}/claims/${claimId}/expenses`);
}

// ---------------------------------------------------------------------------
// Documents: the browser uploads straight to Storage (RLS: own folder), then
// registers the file here. Path layout: {owner_id}/{claim_id}/{uuid}.{ext}
// ---------------------------------------------------------------------------
const UPLOADABLE = ["boarding_pass", "booking_confirmation", "receipt", "airline_correspondence", "other"] as const;

export async function registerDocument(
  locale: string,
  claimId: string,
  input: { docType: string; storagePath: string; mimeType: string; sha256: string },
): Promise<{ id: string } | { error: true }> {
  const { user } = await guardClaim(locale, claimId, "upload");
  const parsed = z
    .object({
      docType: z.enum(UPLOADABLE),
      storagePath: z.string().regex(new RegExp(`^${user.id}/${claimId}/[0-9a-f-]{36}\\.(pdf|jpg|jpeg|png|webp|heic)$`)),
      mimeType: z.enum(UPLOAD_MIME_TYPES),
      sha256: z.string().regex(/^[0-9a-f]{64}$/),
    })
    .safeParse(input);
  if (!parsed.success) return { error: true };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("documents")
    .insert({
      claim_id: claimId,
      owner_id: user.id,
      doc_type: parsed.data.docType,
      storage_path: parsed.data.storagePath,
      mime_type: parsed.data.mimeType,
      sha256: parsed.data.sha256,
    })
    .select("id")
    .single();
  if (error || !data) return { error: true };
  // M7: notify airclaim-document-validation here.
  revalidatePath(`/${locale}/claims/${claimId}`, "layout");
  return { id: data.id };
}

async function removeDocument(claimId: string, documentId: string) {
  const supabase = await createClient();
  const { data } = await supabase.from("documents").select("storage_path").eq("id", documentId).eq("claim_id", claimId).maybeSingle();
  if (!data) return;
  // Row first: its RLS policy is the one that checks the claim is still editable.
  const { error } = await supabase.from("documents").delete().eq("id", documentId);
  if (!error) await supabase.storage.from("claim-documents").remove([data.storage_path]);
}

export async function deleteDocument(locale: string, claimId: string, documentId: string) {
  await guardClaim(locale, claimId, "documents");
  await removeDocument(claimId, documentId);
  revalidatePath(`/${locale}/claims/${claimId}`, "layout");
}
