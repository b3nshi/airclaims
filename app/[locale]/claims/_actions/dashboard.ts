"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "@/i18n/navigation";
import { getOwnClaim } from "@/lib/claims/server";
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

export async function withdrawClaim(locale: string, claimId: string): Promise<{ ok: boolean }> {
  await requireOwner(locale, claimId);
  const supabase = await createClient();
  const { error } = await supabase.rpc("withdraw_claim", { p_claim_id: claimId });
  revalidatePath(`/${locale}/claims`, "layout");
  return { ok: !error };
}
