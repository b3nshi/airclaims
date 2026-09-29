import { useTranslations } from "next-intl";
import { setRequestLocale } from "next-intl/server";
import { use } from "react";
import { Link } from "@/i18n/navigation";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EU261, FEE } from "@/lib/eligibility/config";

export default function HomePage({ params }: PageProps<"/[locale]">) {
  const { locale } = use(params);
  setRequestLocale(locale);
  const t = useTranslations("Home");
  const { short, medium, long } = EU261.compensationEur;

  const amounts = [
    { eur: short, label: t("amountShort") },
    { eur: medium, label: t("amountMedium") },
    { eur: long, label: t("amountLong") },
  ];
  const steps = [1, 2, 3] as const;

  return (
    <div className="mx-auto max-w-5xl space-y-16 px-4 py-12 sm:py-20">
      <section className="max-w-2xl space-y-5">
        <p className="text-sm font-medium text-muted-foreground">{t("eyebrow")}</p>
        <h1 className="text-3xl font-semibold tracking-tight text-balance sm:text-5xl">
          {t("title", { long })}
        </h1>
        <p className="text-lg text-muted-foreground">{t("subtitle")}</p>
        <Link href="/claims/new" className={buttonVariants({ size: "lg" })}>
          {t("cta")}
        </Link>
      </section>

      <section className="space-y-4">
        <h2 className="text-xl font-semibold">{t("amountsTitle")}</h2>
        <div className="grid gap-4 sm:grid-cols-3">
          {amounts.map(({ eur, label }) => (
            <Card key={eur}>
              <CardHeader>
                <CardTitle className="text-3xl font-semibold tabular-nums">
                  {new Intl.NumberFormat(locale, { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(eur)}
                </CardTitle>
                <CardDescription>{label}</CardDescription>
              </CardHeader>
            </Card>
          ))}
        </div>
        <p className="max-w-2xl text-sm text-muted-foreground">
          {t("amountsNote", { hours: EU261.minArrivalDelayMinutes / 60 })}
        </p>
      </section>

      <section className="space-y-4">
        <h2 className="text-xl font-semibold">{t("howTitle")}</h2>
        <ol className="grid gap-4 sm:grid-cols-3">
          {steps.map((n) => (
            <li key={n} className="space-y-1">
              <p className="text-sm font-medium text-muted-foreground">{n}</p>
              <h3 className="font-medium">{t(`step${n}Title`)}</h3>
              <p className="text-sm text-muted-foreground">{t(`step${n}Body`)}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>{t("feeTitle")}</CardTitle>
          </CardHeader>
          <CardContent className="text-muted-foreground">
            {t("feeBody", { base: FEE.basePct, min: FEE.minPct })}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>{t("honestyTitle")}</CardTitle>
          </CardHeader>
          <CardContent className="text-muted-foreground">{t("honestyBody")}</CardContent>
        </Card>
      </section>

      {/* Placeholder: fed by the airline_scorecard view once there is data (Phase 2). */}
      <section className="rounded-xl border border-dashed p-6">
        <h2 className="font-semibold">{t("scorecardTitle")}</h2>
        <p className="text-sm text-muted-foreground">{t("scorecardBody")}</p>
      </section>
    </div>
  );
}
