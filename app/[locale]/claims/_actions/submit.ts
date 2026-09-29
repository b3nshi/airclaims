"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { z } from "zod";
import { redirect } from "@/i18n/navigation";
import { assessClaim } from "@/lib/claims/assess";
import type { FormState } from "@/lib/claims/form-state";
import { renderClaimAgreements, sameName } from "@/lib/claims/legal-vars";
import { getOwnClaim } from "@/lib/claims/server";
import { callN8n, N8nNotConfiguredError } from "@/lib/n8n/client";
import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { guardClaim } from "./guard";

/** Review → stores the estimate and continues to signing. */
export async function confirmReview(locale: string, claimId: string) {
  const { claim } = await guardClaim(locale, claimId, "draft");
  const a = await assessClaim(claim);
  if (!a.passengers.some((p) => p.is_lead)) return redirect({ href: `/claims/${claimId}/passengers`, locale });

  const supabase = await createClient();
  await supabase.from("claims").update({ compensation_eur: a.eligibility.totalEur }).eq("id", claimId);
  await Promise.all(
    a.passengers.map((p) =>
      supabase
        .from("claim_passengers")
        .update({ compensation_eur: p.is_infant_free ? 0 : a.eligibility.perPassengerEur })
        .eq("id", p.id),
    ),
  );
  return redirect({ href: `/claims/${claimId}/sign`, locale });
}

const ipSchema = z.union([z.ipv4(), z.ipv6()]);

export async function signAndSubmit(locale: string, claimId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  const { user, claim } = await guardClaim(locale, claimId, "draft");
  const assessment = await assessClaim(claim);
  const lead = assessment.passengers.find((p) => p.is_lead);
  if (!lead) return redirect({ href: `/claims/${claimId}/passengers`, locale });

  const fieldErrors: Record<string, true> = {};
  for (const k of ["accept_terms_of_service", "accept_privacy_notice", "accept_email_authorization"]) {
    if (formData.get(k) !== "on") fieldErrors[k] = true;
  }
  const signedName = String(formData.get("signed_name") ?? "").trim();
  if (!sameName(signedName, lead.full_name)) fieldErrors.signed_name = true;
  if (Object.keys(fieldErrors).length) return { status: "invalid", fieldErrors };

  // What we store must be exactly what the user saw.
  const docs = await renderClaimAgreements(claim, assessment, locale);
  if (docs.some((d) => formData.get(`hash_${d.kind}`) !== d.sha256)) return { status: "changed" };

  const h = await headers();
  const ip = ipSchema.safeParse(h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? h.get("x-real-ip") ?? "");
  const supabase = await createClient();
  const { error } = await supabase.from("agreements").insert(
    docs.map((d) => ({
      user_id: user.id,
      claim_id: claimId,
      kind: d.kind,
      version: d.version,
      locale,
      signed_name: signedName.slice(0, 120),
      ip_address: ip.success ? ip.data : null,
      user_agent: h.get("user-agent")?.slice(0, 500) ?? null,
      document_sha256: d.sha256,
    })),
  );
  if (error) return { status: "error" };

  const submitted = await supabase.rpc("submit_claim", { p_claim_id: claimId });
  if (submitted.error) return { status: "error" };

  // Airlines that take claims by email: ask n8n (M4) for a draft the user will approve.
  if (assessment.airline) {
    const { data: channels } = await supabase.rpc("airline_claim_channels", { p_airline_id: assessment.airline.id });
    if (channels?.[0]?.channel === "email") {
      try {
        await callN8n("airclaim-email-draft", { claim_id: claimId, template: "initial_claim" }, {
          idempotencyKey: `email-draft:initial_claim:${claimId}`,
        });
      } catch (e) {
        if (!(e instanceof N8nNotConfiguredError)) console.error("airclaim-email-draft failed", { claimId });
      }
    }
  }
  return redirect({ href: `/claims/${claimId}/done`, locale });
}

/** Documents added after signing: re-check whether the claim is now complete. */
export async function recheckDocuments(locale: string, claimId: string) {
  await guardClaim(locale, claimId, "documents");
  const supabase = await createClient();
  await supabase.rpc("submit_claim", { p_claim_id: claimId });
  return redirect({ href: `/claims/${claimId}/done`, locale });
}

export async function recordSubmission(locale: string, claimId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  if (!(await getCurrentUser())) return redirect({ href: "/login", locale });
  await getOwnClaim(claimId);
  const reference = String(formData.get("reference") ?? "").trim();
  if (reference.length > 100) return { status: "invalid", fieldErrors: { reference: true } };
  const supabase = await createClient();
  const { error } = await supabase.rpc("record_airline_submission", { p_claim_id: claimId, p_reference: reference || null });
  if (error) return { status: "error" };
  revalidatePath(`/${locale}/claims/${claimId}/done`);
  return { status: "saved" };
}
