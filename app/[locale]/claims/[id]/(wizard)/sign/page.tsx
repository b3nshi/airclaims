import { getTranslations, setRequestLocale } from "next-intl/server";
import { redirect } from "@/i18n/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { SignForm } from "@/components/claims/sign-form";
import { StepHeader } from "@/components/claims/wizard-shell";
import { assessClaim } from "@/lib/claims/assess";
import { renderClaimAgreements } from "@/lib/claims/legal-vars";
import { loadStep } from "@/lib/claims/server";

export default async function SignStep({ params }: PageProps<"/[locale]/claims/[id]/sign">) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const { claim } = await loadStep(locale, id, "sign");
  const assessment = await assessClaim(claim);
  const lead = assessment.passengers.find((p) => p.is_lead);
  if (!lead) return redirect({ href: `/claims/${claim.id}/passengers`, locale });
  const [t, docs] = await Promise.all([getTranslations("Sign"), renderClaimAgreements(claim, assessment, locale)]);

  return (
    <Card>
      <CardContent className="py-2">
        <StepHeader title={t("title")} description={t("description")} />
        <SignForm
          locale={locale}
          claimId={claim.id}
          leadName={lead.full_name}
          docs={docs.map(({ kind, title, sha256, blocks }) => ({ kind, title, sha256, blocks }))}
        />
      </CardContent>
    </Card>
  );
}
