import { getTranslations, setRequestLocale } from "next-intl/server";
import { Card, CardContent } from "@/components/ui/card";
import { DisruptionForm } from "@/components/claims/disruption-form";
import { StepHeader } from "@/components/claims/wizard-shell";
import { decodeReason, parseCare } from "@/lib/claims/model";
import { loadStep } from "@/lib/claims/server";
import { instantToLocal } from "@/lib/claims/times";
import { createClient } from "@/lib/supabase/server";

export default async function DisruptionStep({ params }: PageProps<"/[locale]/claims/[id]/disruption">) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const { claim } = await loadStep(locale, id, "disruption");
  const t = await getTranslations("Disruption");
  const reason = decodeReason(claim.reason_given_by_airline);

  // Prefill times from what the passenger reported, else from our flight data (in each
  // airport's local time). With a connection, the flight's arrival isn't the final one.
  const supabase = await createClient();
  const finalIata = claim.final_destination_iata ?? claim.arr_iata;
  const [{ data: zones }, { data: flight }] = await Promise.all([
    supabase.from("airports").select("iata, timezone").in("iata", [claim.dep_iata, finalIata].filter((x): x is string => !!x)),
    claim.flight_id
      ? supabase.from("flights").select("arr_iata, scheduled_dep, scheduled_arr, actual_dep, actual_arr").eq("id", claim.flight_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  const tz = (code: string | null) => zones?.find((z) => z.iata === code)?.timezone ?? null;
  const sameArrival = flight?.arr_iata === finalIata;
  const local = (v: string | null | undefined) => v?.slice(0, 16) ?? "";
  const fromFlight = (instant: string | null | undefined, code: string | null) => (instant ? instantToLocal(instant, tz(code)) : "");
  const scheduledDepFallback = claim.reported_scheduled_dep_local ?? null;

  const times = {
    scheduledArr: local(claim.reported_scheduled_arr_local) || (sameArrival ? fromFlight(flight?.scheduled_arr, finalIata) : ""),
    actualArr: claim.arrival_time_estimated
      ? ""
      : local(claim.reported_actual_arr_local) || (sameArrival ? fromFlight(flight?.actual_arr, finalIata) : ""),
    scheduledDep: local(scheduledDepFallback) || fromFlight(flight?.scheduled_dep, claim.dep_iata),
    actualDep: local(claim.reported_actual_dep_local) || fromFlight(flight?.actual_dep, claim.dep_iata),
    estimated: claim.arrival_time_estimated,
  };

  return (
    <Card>
      <CardContent className="py-2">
        <StepHeader title={t("title")} />
        <DisruptionForm
          locale={locale}
          claimId={claim.id}
          initial={{
            disruption: claim.disruption,
            times,
            depTz: tz(claim.dep_iata),
            arrTz: tz(finalIata),
            noticeDays: claim.cancellation_notice_days,
            care: parseCare(claim.care_provided),
            reasonCategory: reason.category,
            reasonDetails: reason.details,
            instructions: claim.airline_instructions ?? "",
          }}
        />
      </CardContent>
    </Card>
  );
}
