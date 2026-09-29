import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { StepHeader } from "@/components/claims/wizard-shell";
import { confirmReview } from "@/app/[locale]/claims/_actions/submit";
import { assessClaim } from "@/lib/claims/assess";
import { loadStep } from "@/lib/claims/server";
import { cn } from "@/lib/utils";

export default async function ReviewStep({ params }: PageProps<"/[locale]/claims/[id]/review">) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const { claim } = await loadStep(locale, id, "review");
  const [t, tw, td, format] = await Promise.all([
    getTranslations("Review"),
    getTranslations("Wizard"),
    getTranslations("Disruption"),
    getFormatter(),
  ]);
  const a = await assessClaim(claim);
  const e = a.eligibility;
  const eur = (n: number) => format.number(n, { style: "currency", currency: "EUR", maximumFractionDigits: 2 });
  const expensesEur = a.expenses.filter((x) => x.currency === "EUR").reduce((s, x) => s + Number(x.amount), 0);
  const tone = { likely: "border-primary", possible: "border-amber-500", unlikely: "border-destructive", unknown: "border-muted-foreground" }[e.verdict];
  const delay = claim.reported_arrival_delay_minutes;

  const answers: { label: string; value: string; step: string | null }[] = [
    { label: tw("steps.flight"), value: `${claim.flight_iata} · ${format.dateTime(new Date(claim.flight_date), { dateStyle: "medium", timeZone: "UTC" })}`, step: "flight" },
    {
      label: t("route"),
      value: [a.labels.departure, a.labels.arrival, claim.final_destination_iata && a.labels.finalDestination].filter(Boolean).join(" → ") +
        (e.distanceKm !== null ? ` · ${t("distance", { km: format.number(e.distanceKm) })}` : ""),
      step: "flight",
    },
    {
      label: tw("steps.disruption"),
      value: [
        td(`types.${claim.disruption}`),
        delay !== null && t("delay", { hours: Math.floor(delay / 60), minutes: delay % 60 }),
        claim.cancellation_notice_days !== null && t("noticeDays", { days: claim.cancellation_notice_days }),
        a.reason.category && td(`reasons.${a.reason.category}`),
      ].filter(Boolean).join(" · "),
      step: "disruption",
    },
    ...(a.flight
      ? [{
          label: t("flightData"),
          value: a.flight.data_status !== "final"
            ? t("flightDataPending")
            : /^cancel/i.test(a.flight.status ?? "")
              ? t("flightDataCancelled")
              : a.flight.arrival_delay_minutes !== null && a.flight.arrival_delay_minutes >= 15
                ? t("flightDataDelay", {
                    hours: Math.floor(a.flight.arrival_delay_minutes / 60),
                    minutes: a.flight.arrival_delay_minutes % 60,
                  })
                : t("flightDataOnTime"),
          step: null,
        }]
      : []),
    { label: tw("steps.passengers"), value: a.passengers.map((p) => p.full_name).join(", "), step: "passengers" },
    {
      label: tw("steps.expenses"),
      value: a.expenses.length ? a.expenses.map((x) => format.number(Number(x.amount), { style: "currency", currency: x.currency })).join(" + ") : "—",
      step: "expenses",
    },
  ];

  return (
    <Card>
      <CardContent className="space-y-6 py-2">
        <StepHeader title={t("title")} description={t("disclaimer")} />

        <section className={cn("space-y-4 rounded-lg border-l-4 bg-muted/40 p-4", tone)}>
          <h3 className="text-lg font-semibold">{t(`verdict.${e.verdict}`)}</h3>
          {e.totalEur !== null && e.perPassengerEur !== null && (
            <dl className="grid gap-3 sm:grid-cols-3">
              <div>
                <dt className="text-xs text-muted-foreground">{t("compensation")}</dt>
                <dd className="text-2xl font-semibold tabular-nums">{eur(e.totalEur)}</dd>
                <dd className="text-xs text-muted-foreground">
                  {t("perPassenger", { amount: eur(e.perPassengerEur), count: a.paidPassengers.length })}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">{t("fee")}</dt>
                <dd className="text-2xl font-semibold tabular-nums">{eur(a.feeEur ?? 0)}</dd>
                <dd className="text-xs text-muted-foreground">{t("feeDetail", { pct: a.feePct })}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">{t("youKeep")}</dt>
                <dd className="text-2xl font-semibold tabular-nums">{eur(e.totalEur - (a.feeEur ?? 0))}</dd>
                {expensesEur > 0 && <dd className="text-xs text-muted-foreground">+ {eur(expensesEur)} · {t("expenses")}</dd>}
              </div>
            </dl>
          )}
          {e.reasons.length > 0 && (
            <div className="space-y-1">
              <h4 className="text-sm font-medium">{t("why")}</h4>
              <ul className="list-disc space-y-1 pl-5 text-sm">
                {e.reasons.map((r) => <li key={r}>{t(`reasons.${r}`)}</li>)}
              </ul>
            </div>
          )}
          {(e.flags.length > 0 || a.riskFlags.length > 0) && (
            <div className="space-y-1">
              <h4 className="text-sm font-medium">{t("toKnow")}</h4>
              <ul className="list-disc space-y-1 pl-5 text-sm">
                {e.flags.map((f) => <li key={f}>{t(`flags.${f}`)}</li>)}
                {a.riskFlags.map((f) => <li key={f.id}>{t("riskFlag", { type: t(`riskTypes.${f.flag_type}`) })}</li>)}
              </ul>
            </div>
          )}
          {e.verdict === "unlikely" && <p className="text-sm text-muted-foreground">{t("unlikelyNote")}</p>}
        </section>

        <section className="space-y-2">
          <h3 className="font-medium">{t("answers")}</h3>
          <dl className="divide-y rounded-lg border text-sm">
            {answers.map((row) => (
              <div key={row.label} className="flex items-start justify-between gap-3 p-3">
                <div className="min-w-0">
                  <dt className="text-xs text-muted-foreground">{row.label}</dt>
                  <dd>{row.value}</dd>
                </div>
                {row.step && (
                  <Link href={`/claims/${claim.id}/${row.step}`} className={buttonVariants({ variant: "ghost", size: "sm" })}>
                    {t("edit")}
                  </Link>
                )}
              </div>
            ))}
          </dl>
        </section>

        <form action={confirmReview.bind(null, locale, claim.id)} className="flex items-center justify-between gap-3 border-t pt-5">
          <Link href={`/claims/${claim.id}/documents`} className={buttonVariants({ variant: "ghost" })}>
            {tw("back")}
          </Link>
          <Button type="submit" size="lg" variant={e.verdict === "unlikely" ? "outline" : "default"}>
            {e.verdict === "unlikely" ? t("continueAnyway") : tw("continue")}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
