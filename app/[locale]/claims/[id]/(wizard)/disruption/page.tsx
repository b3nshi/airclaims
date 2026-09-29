import { getTranslations, setRequestLocale } from "next-intl/server";
import { Card, CardContent } from "@/components/ui/card";
import { DisruptionForm } from "@/components/claims/disruption-form";
import { StepHeader } from "@/components/claims/wizard-shell";
import { decodeReason, parseCare } from "@/lib/claims/model";
import { loadStep } from "@/lib/claims/server";
import { createClient } from "@/lib/supabase/server";

export default async function DisruptionStep({ params }: PageProps<"/[locale]/claims/[id]/disruption">) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const { claim } = await loadStep(locale, id, "disruption");
  const t = await getTranslations("Disruption");
  const reason = decodeReason(claim.reason_given_by_airline);

  // Prefill the delay from flight data when the user hasn't answered yet (they confirm it).
  let delayMinutes = claim.reported_arrival_delay_minutes;
  if (delayMinutes === null && claim.flight_id) {
    const supabase = await createClient();
    const { data } = await supabase.from("flights").select("arrival_delay_minutes").eq("id", claim.flight_id).maybeSingle();
    delayMinutes = data?.arrival_delay_minutes && data.arrival_delay_minutes > 0 ? data.arrival_delay_minutes : null;
  }

  return (
    <Card>
      <CardContent className="py-2">
        <StepHeader title={t("title")} />
        <DisruptionForm
          locale={locale}
          claimId={claim.id}
          initial={{
            disruption: claim.disruption,
            delayMinutes,
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
