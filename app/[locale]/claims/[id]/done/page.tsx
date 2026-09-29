import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { CopyButton } from "@/components/claims/copy-button";
import { SubmissionForm } from "@/components/claims/submission-form";
import { StepHeader } from "@/components/claims/wizard-shell";
import { airlineReplyDue } from "@/lib/eligibility";
import { assessClaim } from "@/lib/claims/assess";
import { buildClaimText } from "@/lib/claims/claim-text";
import { aliasEmail } from "@/lib/claims/model";
import { loadStep } from "@/lib/claims/server";
import { createClient } from "@/lib/supabase/server";

export default async function DoneStep({ params }: PageProps<"/[locale]/claims/[id]/done">) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const { user, claim } = await loadStep(locale, id, "done");
  const [t, format, supabase] = await Promise.all([getTranslations("Done"), getFormatter(), createClient()]);
  const a = await assessClaim(claim);
  const alias = aliasEmail(claim.alias_code);
  const date = (iso: string) => format.dateTime(new Date(iso), { dateStyle: "long", timeZone: "UTC" });
  const airlineName = a.airline?.name ?? claim.flight_iata.slice(0, 2);

  const [{ data: profile }, channelsRes, formRes] = await Promise.all([
    supabase.from("profiles").select("personal_email").eq("id", user.id).maybeSingle(),
    a.airline ? supabase.rpc("airline_claim_channels", { p_airline_id: a.airline.id }) : Promise.resolve({ data: [] }),
    a.airline
      ? supabase.from("airline_contacts").select("value, submission_steps")
          .eq("airline_id", a.airline.id).eq("purpose", "compensation").eq("channel", "web_form").maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  const channel = channelsRes.data?.[0]?.channel ?? null;
  const webForm = formRes.data;
  const stepsByLocale = (webForm?.submission_steps ?? {}) as Record<string, string[]>;
  const steps = stepsByLocale[locale] ?? stepsByLocale.en ?? [];
  const submitted = claim.submitted_airline_at;

  const claimText = buildClaimText({
    airlineLanguage: a.airline?.preferred_language ?? "en",
    airlineName,
    flight: claim.flight_iata,
    flightDate: claim.flight_date,
    departure: a.labels.departure,
    arrival: a.labels.arrival,
    finalDestination: a.labels.finalDestination,
    bookingReference: claim.booking_reference,
    disruption: claim.disruption,
    arrivalDelayMinutes: claim.reported_arrival_delay_minutes,
    cancellationNoticeDays: claim.cancellation_notice_days,
    perPassengerEur: a.eligibility.perPassengerEur,
    totalEur: a.eligibility.totalEur,
    passengers: a.paidPassengers.map((p) => p.full_name),
    expenses: a.expenses.map((x) => ({ category: x.category, amount: Number(x.amount), currency: x.currency })),
    staffInstructions: claim.airline_instructions,
    aliasEmail: alias,
    departsSpain: a.departsSpain,
  });

  return (
    <Card>
      <CardContent className="space-y-8 py-2">
        <StepHeader title={submitted ? t("submittedTitle") : t("title")} />

        <section className="space-y-2">
          <h3 className="font-medium">{t("aliasTitle")}</h3>
          <div className="flex flex-wrap items-center gap-2">
            <code className="rounded-md bg-muted px-2 py-1 text-sm break-all">{alias}</code>
            <CopyButton value={alias} />
          </div>
          <p className="text-sm text-muted-foreground">{t("aliasBody", { email: profile?.personal_email ?? "" })}</p>
        </section>

        {claim.status === "documents_pending" && (
          <section className="space-y-2 rounded-lg border border-amber-500/50 p-4">
            <h3 className="font-medium">{t("docsPendingTitle")}</h3>
            <p className="text-sm text-muted-foreground">{t("docsPendingBody")}</p>
            <Link href={`/claims/${claim.id}/documents`} className={buttonVariants({ variant: "outline", size: "sm" })}>
              {t("addDocuments")}
            </Link>
          </section>
        )}

        {submitted ? (
          <section className="space-y-1 text-sm">
            <p>
              {t("submittedBody", {
                date: date(submitted),
                due: date(airlineReplyDue(submitted)),
                aesa: claim.aesa_deadline ? date(claim.aesa_deadline) : "—",
              })}
            </p>
            {claim.airline_claim_reference && (
              <p className="text-muted-foreground">{t("reference", { ref: claim.airline_claim_reference })}</p>
            )}
          </section>
        ) : (
          <section className="space-y-4">
            <h3 className="font-medium">{t("nextTitle")}</h3>
            {channel === "email" ? (
              <p className="text-sm">{t("emailBody", { airline: airlineName })}</p>
            ) : (
              <>
                {channel === "web_form" && webForm ? (
                  <>
                    <p className="text-sm">{t("webFormIntro", { airline: airlineName })}</p>
                    <ol className="list-decimal space-y-1 pl-5 text-sm">
                      {steps.map((s, i) => <li key={i}>{s}</li>)}
                    </ol>
                    <a
                      href={webForm.value}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={buttonVariants({ variant: "outline" })}
                    >
                      {t("openForm", { airline: airlineName })}
                    </a>
                  </>
                ) : (
                  <p className="text-sm">{t("unknownBody")}</p>
                )}
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <h4 className="text-sm font-medium">{t("claimText")}</h4>
                    <CopyButton value={claimText.body} />
                  </div>
                  <p className="text-xs text-muted-foreground">{t("claimTextHint")}</p>
                  <pre className="max-h-80 overflow-auto rounded-lg border bg-muted/30 p-4 text-sm whitespace-pre-wrap">
                    {claimText.body}
                  </pre>
                </div>
                {channel === "web_form" && <SubmissionForm locale={locale} claimId={claim.id} />}
              </>
            )}
          </section>
        )}

        <div className="border-t pt-5">
          <Link href="/claims" className={buttonVariants({ variant: "ghost" })}>
            {t("backToClaims")}
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}
