import { getFormatter, getTranslations } from "next-intl/server";
import { WizardShell } from "@/components/claims/wizard-shell";
import { isDraft } from "@/lib/claims/model";
import { getOwnClaim, requireUser } from "@/lib/claims/server";

export default async function ClaimLayout({ params, children }: LayoutProps<"/[locale]/claims/[id]">) {
  const { locale, id } = await params;
  await requireUser(locale, `/claims/${id}`);
  const claim = await getOwnClaim(id);
  const [t, format] = await Promise.all([getTranslations("Wizard"), getFormatter()]);
  const date = format.dateTime(new Date(claim.flight_date), { dateStyle: "medium", timeZone: "UTC" });

  return (
    <WizardShell title={t("title", { flight: claim.flight_iata, date })} claimId={claim.id} editable={isDraft(claim.status)}>
      {children}
    </WizardShell>
  );
}
