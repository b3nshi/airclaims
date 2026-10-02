import { getTranslations } from "next-intl/server";
import { buttonVariants } from "@/components/ui/button";
import type { ClaimAssessment } from "@/lib/claims/assess";
import { buildClaimText } from "@/lib/claims/claim-text";
import { aliasEmail } from "@/lib/claims/model";
import type { ClaimRow, ContactChannel } from "@/lib/supabase/database.types";
import { createClient } from "@/lib/supabase/server";
import { CopyButton } from "./copy-button";
import { SubmissionForm } from "./submission-form";

/** Claim text for this claim (compensation, expenses, or both in one). */
export function claimTextFor(claim: ClaimRow, a: ClaimAssessment, purpose: "both" | "compensation" | "expenses") {
  return buildClaimText({
    airlineLanguage: a.airline?.preferred_language ?? "en",
    airlineName: a.airline?.name ?? claim.flight_iata.slice(0, 2),
    flight: claim.flight_iata,
    flightDate: claim.flight_date,
    departure: a.labels.departure,
    arrival: a.labels.arrival,
    finalDestination: a.labels.finalDestination,
    bookingReference: claim.booking_reference,
    disruption: claim.disruption,
    arrivalDelayMinutes: claim.reported_arrival_delay_minutes,
    arrivalDelayEstimated: claim.arrival_time_estimated,
    cancellationNoticeDays: claim.cancellation_notice_days,
    perPassengerEur: a.eligibility.perPassengerEur,
    totalEur: a.eligibility.totalEur,
    passengers: a.paidPassengers.map((p) => p.full_name),
    expenses: a.expenses.map((x) => ({ category: x.category, amount: Number(x.amount), currency: x.currency })),
    staffInstructions: claim.airline_instructions,
    aliasEmail: aliasEmail(claim.alias_code),
    departsSpain: a.departsSpain,
    purpose,
  });
}

/** The airline's web-form contact for a purpose (compensation / expenses), if curated. */
export async function webFormContact(airlineId: string | null, purpose: "compensation" | "expenses") {
  if (!airlineId) return null;
  const supabase = await createClient();
  const { data } = await supabase
    .from("airline_contacts")
    .select("value, label, submission_steps")
    .eq("airline_id", airlineId)
    .eq("purpose", purpose)
    .eq("channel", "web_form")
    .maybeSingle();
  return data;
}

/** The airline's preferred compensation channel (curated emails stay hidden). */
export async function airlineChannel(airlineId: string | null): Promise<ContactChannel | null> {
  if (!airlineId) return null;
  const supabase = await createClient();
  const { data } = await supabase.rpc("airline_claim_channels", { p_airline_id: airlineId });
  return data?.[0]?.channel ?? null;
}

/**
 * How to send the claim to the airline: web-form steps + prepared text + reference form,
 * the email-draft notice, or the text alone when we don't know the channel yet.
 */
export async function AirlineSubmission({
  locale,
  claim,
  assessment: a,
  channel,
}: {
  locale: string;
  claim: ClaimRow;
  assessment: ClaimAssessment;
  channel: ContactChannel | null;
}) {
  const t = await getTranslations("Done");
  const airlineName = a.airline?.name ?? claim.flight_iata.slice(0, 2);
  const supabase = await createClient();

  // Curated per-airline tips (admin knowledge base), in the passenger's language.
  const { data: tips } = a.airline
    ? await supabase.rpc("airline_passenger_tips", { p_airline_id: a.airline.id, p_locale: locale })
    : { data: [] as string[] };
  const tipsBlock = tips && tips.length > 0 && (
    <div className="space-y-1 rounded-lg bg-muted/40 p-3">
      <h4 className="text-sm font-medium">{t("tipsTitle", { airline: airlineName })}</h4>
      <ul className="list-disc space-y-1 pl-5 text-sm">
        {tips.map((tip, i) => <li key={i}>{tip}</li>)}
      </ul>
    </div>
  );

  if (channel === "email") {
    return (
      <div className="space-y-3">
        <p className="text-sm">{t("emailBody", { airline: airlineName })}</p>
        {tipsBlock}
      </div>
    );
  }

  const [webForm, expensesForm] = await Promise.all([
    webFormContact(a.airline?.id ?? null, "compensation"),
    webFormContact(a.airline?.id ?? null, "expenses"),
  ]);
  const stepsByLocale = (webForm?.submission_steps ?? {}) as Record<string, string[]>;
  const steps = stepsByLocale[locale] ?? stepsByLocale.en ?? [];
  // Airlines with a separate expenses form get a compensation-only text here.
  const claimText = claimTextFor(claim, a, expensesForm ? "compensation" : "both");

  return (
    <div className="space-y-4">
      {channel === "web_form" && webForm ? (
        <>
          <p className="text-sm">{t("webFormIntro", { airline: airlineName })}</p>
          {/* The steps refer to this button ("above"), so it comes first. */}
          <a href={webForm.value} target="_blank" rel="noopener noreferrer" className={buttonVariants()}>
            {t("openForm", { airline: airlineName })}
          </a>
          <ol className="list-decimal space-y-1 pl-5 text-sm">
            {steps.map((s, i) => <li key={i}>{s}</li>)}
          </ol>
        </>
      ) : (
        <p className="text-sm">{t("unknownBody")}</p>
      )}
      {tipsBlock}
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <h4 className="text-sm font-medium">{t("claimText")}</h4>
          <CopyButton value={claimText.body} />
        </div>
        <p className="text-xs text-muted-foreground">{t("claimTextHint")}</p>
        <pre className="max-h-80 overflow-auto rounded-lg border bg-muted/30 p-4 text-sm whitespace-pre-wrap [overflow-wrap:anywhere]">{claimText.body}</pre>
      </div>
      {channel === "web_form" && <SubmissionForm locale={locale} claimId={claim.id} />}
    </div>
  );
}
