import { getFormatter, getTranslations } from "next-intl/server";
import { AdminForm } from "@/components/admin/admin-form";
import type { AirlineResponseAnalysis, AirlineResponseRow, ClaimRow } from "@/lib/supabase/database.types";
import { retryAirlineResponseAnalysis } from "@/app/[locale]/claims/_actions/dashboard";
import { AirlineResponseForm } from "./airline-response-form";
import { AutoRefresh } from "./auto-refresh";
import { ChallengeOptionsForm } from "./challenge-options-form";
import { Section } from "./sections";

/**
 * "The airline answered": report it, read our analysis (what they claim, where it conflicts with
 * the facts, the options) and choose what the reply says.
 */
export async function AirlineResponsePanel({
  locale,
  claim,
  userId,
  responses,
  hasExpenses,
  departsSpain,
  delivery,
  hasOpenDraft,
}: {
  locale: string;
  claim: ClaimRow;
  userId: string;
  responses: AirlineResponseRow[];
  hasExpenses: boolean;
  departsSpain: boolean;
  delivery: "email" | "paste";
  hasOpenDraft: boolean;
}) {
  const [t, format] = await Promise.all([getTranslations("AirlineResponse"), getFormatter()]);
  const latest = responses[0];
  const analysis = latest?.status === "analyzed" ? (latest.analysis as unknown as AirlineResponseAnalysis) : null;
  const recommended = (code: string) => analysis?.options.some((o) => o.code === code && o.recommended) ?? false;

  return (
    <Section id="airline-answer" title={t("title")}>
      {latest ? (
        <div className="space-y-4 rounded-xl border p-4">
          <p className="text-xs text-muted-foreground">
            {t(`sources.${latest.source}`)} · {t(`channels.${latest.channel}`)} · {format.dateTime(new Date(latest.received_on), { dateStyle: "long", timeZone: "UTC" })}
          </p>
          {latest.airline_text && (
            <details className="text-sm">
              <summary className="cursor-pointer text-muted-foreground">{t("theirAnswer")}</summary>
              <pre className="mt-2 max-h-60 overflow-auto rounded-md bg-muted/40 p-3 font-sans whitespace-pre-wrap">{latest.airline_text}</pre>
            </details>
          )}

          {latest.status === "pending" && (
            <>
              <p role="status" className="text-sm">{t("analyzing")}</p>
              <AutoRefresh />
              <AdminForm action={retryAirlineResponseAnalysis.bind(null, locale, claim.id, latest.id)} submitLabel={t("retry")} variant="ghost" />
            </>
          )}
          {latest.status === "failed" && (
            <>
              <p role="alert" className="text-sm text-destructive">{t("analysisFailed")}</p>
              <AdminForm action={retryAirlineResponseAnalysis.bind(null, locale, claim.id, latest.id)} submitLabel={t("retry")} variant="outline" />
            </>
          )}

          {analysis && (
            <div className="space-y-4">
              <p className="text-sm">{analysis.summary}</p>
              {analysis.conflicts.length > 0 && (
                <div className="space-y-1">
                  <h3 className="text-sm font-medium">{t("conflicts")}</h3>
                  <ul className="list-disc space-y-1 pl-5 text-sm">
                    {analysis.conflicts.map((c, i) => <li key={i}>{c}</li>)}
                  </ul>
                </div>
              )}
              {analysis.options.length > 0 && (
                <div className="space-y-1">
                  <h3 className="text-sm font-medium">{t("options")}</h3>
                  <ul className="space-y-2 text-sm">
                    {analysis.options.map((o) => (
                      <li key={o.code}>
                        <span className="font-medium">{t(`optionCodes.${o.code}`)}</span>
                        {o.recommended && <span className="ml-2 rounded-full bg-primary px-2 py-0.5 text-xs text-primary-foreground">{t("recommended")}</span>}
                        <span className="block text-muted-foreground">{o.explanation}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {analysis.aesa_advice && (
                <p className="rounded-lg bg-muted/40 p-3 text-sm"><span className="font-medium">AESA: </span>{analysis.aesa_advice}</p>
              )}
              {hasOpenDraft ? (
                <p className="text-sm text-muted-foreground">{t("draftWaiting")}</p>
              ) : (
                <div className="space-y-2 border-t pt-4">
                  <h3 className="font-medium">{t("replyTitle")}</h3>
                  <ChallengeOptionsForm
                    locale={locale}
                    claimId={claim.id}
                    responseId={latest.id}
                    delivery={delivery}
                    defaults={{
                      request_evidence: recommended("request_evidence") || analysis.reasons.some((r) => r.code.startsWith("extraordinary")),
                      contest_delay: recommended("contest_delay_calculation"),
                      decline_offer: recommended("decline_offer"),
                      include_expenses: false,
                      // A factual next step with a deadline; AESA asks for the airline's answer anyway.
                      mention_aesa: departsSpain,
                      hasExpenses,
                      departsSpain,
                    }}
                  />
                </div>
              )}
            </div>
          )}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">{t("intro")}</p>
      )}
      <details className="rounded-xl border border-dashed p-4">
        <summary className="cursor-pointer text-sm font-medium">{latest ? t("reportAnother") : t("report")}</summary>
        <div className="mt-4">
          <AirlineResponseForm locale={locale} claimId={claim.id} userId={userId} />
        </div>
      </details>
    </Section>
  );
}
