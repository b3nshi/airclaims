import { redirect } from "@/i18n/navigation";
import { isDraft } from "@/lib/claims/model";
import { getOwnClaim, requireUser } from "@/lib/claims/server";

export default async function ClaimIndex({ params }: PageProps<"/[locale]/claims/[id]">) {
  const { locale, id } = await params;
  await requireUser(locale, `/claims/${id}`);
  const claim = await getOwnClaim(id);
  return redirect({ href: `/claims/${id}/${isDraft(claim.status) ? "flight" : "done"}`, locale });
}
