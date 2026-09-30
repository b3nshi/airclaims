import { getTranslations, setRequestLocale } from "next-intl/server";
import { Card, CardContent } from "@/components/ui/card";
import { FlightForm } from "@/components/claims/flight-form";
import { StepHeader, WizardShell } from "@/components/claims/wizard-shell";
import { claimPath } from "@/lib/claims/stages";
import { requireUser } from "@/lib/claims/server";
import { createClient } from "@/lib/supabase/server";

const NEW_CLAIM_PATH = claimPath({ status: "draft", submittedAt: null, hadAirlineAnswer: false, aesaFiled: false, today: "" });

export default async function NewClaimPage({ params }: PageProps<"/[locale]/claims/new">) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requireUser(locale, "/claims/new");
  const [tw, t, supabase] = await Promise.all([getTranslations("Wizard"), getTranslations("Flight"), createClient()]);
  const { data: airlines } = await supabase.from("airlines").select("id, name, iata").eq("is_active", true).order("name");

  return (
    <WizardShell title={tw("newTitle")} claimId={null} editable path={NEW_CLAIM_PATH}>
      <Card>
        <CardContent className="py-2">
          <StepHeader title={t("title")} description={t("description")} />
          <FlightForm
            locale={locale}
            claimId={null}
            airlines={airlines ?? []}
            initial={{
              flight_iata: "", flight_date: "", dep: null, arr: null, final: null, booking_reference: "", flight_id: "",
              airline_id: "", scheduled_dep_time: "", scheduled_arr: "",
            }}
          />
        </CardContent>
      </Card>
    </WizardShell>
  );
}
