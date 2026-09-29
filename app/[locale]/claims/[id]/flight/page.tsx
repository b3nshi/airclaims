import { getTranslations, setRequestLocale } from "next-intl/server";
import { Card, CardContent } from "@/components/ui/card";
import { FlightForm } from "@/components/claims/flight-form";
import { StepHeader } from "@/components/claims/wizard-shell";
import { airportLabel } from "@/lib/claims/assess";
import { loadStep } from "@/lib/claims/server";
import { createClient } from "@/lib/supabase/server";

export default async function FlightStep({ params }: PageProps<"/[locale]/claims/[id]/flight">) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const { claim } = await loadStep(locale, id, "flight");
  const t = await getTranslations("Flight");

  const codes = [claim.dep_iata, claim.arr_iata, claim.final_destination_iata].filter((c): c is string => !!c);
  const supabase = await createClient();
  const { data: airports } = codes.length
    ? await supabase.from("airports").select("iata, name, city").in("iata", codes)
    : { data: [] };
  const value = (code: string | null) =>
    code ? { iata: code, label: airportLabel(airports?.find((a) => a.iata === code), code) } : null;

  return (
    <Card>
      <CardContent className="py-2">
        <StepHeader title={t("title")} description={t("description")} />
        <FlightForm
          locale={locale}
          claimId={claim.id}
          initial={{
            flight_iata: claim.flight_iata,
            flight_date: claim.flight_date,
            dep: value(claim.dep_iata),
            arr: value(claim.arr_iata),
            final: value(claim.final_destination_iata),
            booking_reference: claim.booking_reference ?? "",
            flight_id: claim.flight_id ?? "",
          }}
        />
      </CardContent>
    </Card>
  );
}
