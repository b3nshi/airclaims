import "server-only";
import { redirect } from "@/i18n/navigation";
import { canEditDocuments, isDraft } from "@/lib/claims/model";
import { getOwnClaim } from "@/lib/claims/server";
import { getCurrentUser } from "@/lib/supabase/server";

/** For server actions: the signed-in user and their claim in an editable state. */
export async function guardClaim(locale: string, claimId: string, need: "draft" | "documents") {
  const user = await getCurrentUser();
  if (!user) return redirect({ href: "/login", locale });
  const claim = await getOwnClaim(claimId);
  const ok = need === "draft" ? isDraft(claim.status) : canEditDocuments(claim.status);
  if (!ok) return redirect({ href: `/claims/${claim.id}`, locale });
  return { user, claim };
}
