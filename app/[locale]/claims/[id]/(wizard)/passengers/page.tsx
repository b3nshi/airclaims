import { getTranslations, setRequestLocale } from "next-intl/server";
import { Card, CardContent } from "@/components/ui/card";
import { PassengersForm } from "@/components/claims/passengers-form";
import { StepHeader } from "@/components/claims/wizard-shell";
import { loadStep } from "@/lib/claims/server";
import { createClient } from "@/lib/supabase/server";

export default async function PassengersStep({ params }: PageProps<"/[locale]/claims/[id]/passengers">) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const { user, claim } = await loadStep(locale, id, "passengers");
  const t = await getTranslations("Passengers");
  const supabase = await createClient();
  const [{ data: passengers }, { data: profile }] = await Promise.all([
    supabase.from("claim_passengers").select("full_name, is_infant_free, is_lead").eq("claim_id", claim.id).order("is_lead", { ascending: false }),
    supabase.from("profiles").select("full_name").eq("id", user.id).maybeSingle(),
  ]);
  const initial = passengers?.length
    ? passengers.map(({ full_name, is_infant_free }) => ({ full_name, is_infant_free }))
    : [{ full_name: profile?.full_name ?? "", is_infant_free: false }];

  return (
    <Card>
      <CardContent className="py-2">
        <StepHeader title={t("title")} description={t("description")} />
        <PassengersForm locale={locale} claimId={claim.id} initial={initial} />
      </CardContent>
    </Card>
  );
}
