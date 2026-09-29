import { getTranslations, setRequestLocale } from "next-intl/server";
import { Card, CardContent } from "@/components/ui/card";
import { FlightForm } from "@/components/claims/flight-form";
import { StepHeader, WizardShell } from "@/components/claims/wizard-shell";
import { requireUser } from "@/lib/claims/server";

export default async function NewClaimPage({ params }: PageProps<"/[locale]/claims/new">) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requireUser(locale, "/claims/new");
  const [tw, t] = await Promise.all([getTranslations("Wizard"), getTranslations("Flight")]);

  return (
    <WizardShell title={tw("newTitle")} claimId={null} editable>
      <Card>
        <CardContent className="py-2">
          <StepHeader title={t("title")} description={t("description")} />
          <FlightForm
            locale={locale}
            claimId={null}
            initial={{ flight_iata: "", flight_date: "", dep: null, arr: null, final: null, booking_reference: "", flight_id: "" }}
          />
        </CardContent>
      </Card>
    </WizardShell>
  );
}
