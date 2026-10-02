import { getFormatter, getTranslations } from "next-intl/server";
import { AdminForm } from "@/components/admin/admin-form";
import type {
  AirlineResponseAnalysis,
  AirlineResponsePurpose,
  AirlineResponseRow,
  ClaimRow,
} from "@/lib/supabase/database.types";
import { moveAirlineResponse, retryAirlineResponseAnalysis } from "@/app/[locale]/claims/_actions/dashboard";
import { AirlineResponseForm } from "./airline-response-form";
import { AutoRefresh } from "./auto-refresh";
import { ChallengeOptionsForm } from "./challenge-options-form";
import { ClaimReferencesForm } from "./claim-references-form";
import { Section } from "./sections";

type PanelProps = {
  locale: string;
  claim: ClaimRow;
  userId: string;
  responses: AirlineResponseRow[]; // newest first
  hasExpenses: boolean;
  hasExpensesFlow: boolean; // the expenses are (or will be) a separate claim with its own answers
  departsSpain: boolean;
  delivery: "email" | "paste";
  hasOpenDraft: boolean;
};

/**
 * "The airline answered": per claim (compensation, and expenses when the airline handles them
 * separately), paste the answer, read our analysis and choose what the reply says. The claim
 * numbers can be corrected here too.
 */
export async function AirlineResponsePanel(props: PanelProps) {
  const { locale, claim, responses, hasExpensesFlow } = props;
  const t = await getTranslations("AirlineResponse");
  const flows: AirlineResponsePurpose[] = hasExpensesFlow ? ["compensation", "expenses"] : ["compensation"];

  return (
    <Section id="airline-answer" title={t("title")}>
      {responses.length === 0 && <p className="text-sm text-muted-foreground">{t("intro")}</p>}
      <ClaimReferencesForm
        locale={locale}
        claimId={claim.id}
        compensation={claim.airline_claim_reference}
        expenses={claim.airline_expenses_reference}
        showExpenses={hasExpensesFlow}
      />
      {flows.map((purpose) => (
        <Flow key={purpose} {...props} purpose={purpose} titled={flows.length > 1}
          responses={responses.filter((r) => r.purpose === purpose)} />
      ))}
    </Section>
  );
}

async function Flow({
  locale,
  claim,
  userId,
  responses,
  purpose,
  titled,
  hasExpenses,
  hasExpensesFlow,
  departsSpain,
  delivery,
  hasOpenDraft,
}: PanelProps & { purpose: AirlineResponsePurpose; titled: boolean }) {
  const [t, format] = await Promise.all([getTranslations("AirlineResponse"), getFormatter()]);
  const [latest, ...earlier] = responses;
  const date = (d: string) => format.dateTime(new Date(d), { dateStyle: "long", timeZone: "UTC" });
  const reference = purpose === "compensation" ? claim.airline_claim_reference : claim.airline_expenses_reference;

  return (
    <div className="space-y-3">
      {titled && (
        <h3 className="flex flex-wrap items-baseline gap-x-2 font-medium">
          {t(`flows.${purpose}`)}
          {reference && <span className="text-xs font-normal text-muted-foreground">{t("referenceShort", { reference })}</span>}
        </h3>
      )}
      {latest ? (
        <ResponseCard
          locale={locale}
          claimId={claim.id}
          response={latest}
          hasExpenses={hasExpenses && purpose === "compensation"}
          canMove={hasExpensesFlow}
          departsSpain={departsSpain}
          delivery={delivery}
          hasOpenDraft={hasOpenDraft}
        />
      ) : (
        titled && <p className="text-sm text-muted-foreground">{t("noAnswerYet")}</p>
      )}
      {earlier.length > 0 && (
        <details className="text-sm">
          <summary className="cursor-pointer text-muted-foreground">{t("earlier", { count: earlier.length })}</summary>
          <ul className="mt-2 space-y-2">
            {earlier.map((r) => (
              <li key={r.id} className="rounded-lg border p-3">
                <p className="text-xs text-muted-foreground">
                  {t(`channels.${r.channel}`)} · {date(r.received_on)}
                </p>
                <p className="[overflow-wrap:anywhere]">
                  {(r.analysis as AirlineResponseAnalysis | null)?.summary ?? r.airline_text ?? r.user_explanation}
                </p>
              </li>
            ))}
          </ul>
        </details>
      )}
      <details className="rounded-xl border border-dashed p-4">
        <summary className="cursor-pointer text-sm font-medium">
          {t(latest ? "pasteAnother" : "paste", { flow: t(`flows.${purpose}`).toLowerCase() })}
        </summary>
        <div className="mt-4">
          <AirlineResponseForm locale={locale} claimId={claim.id} userId={userId} purpose={purpose} />
        </div>
      </details>
    </div>
  );
}

async function ResponseCard({
  locale,
  claimId,
  response,
  hasExpenses,
  canMove,
  departsSpain,
  delivery,
  hasOpenDraft,
}: {
  locale: string;
  claimId: string;
  response: AirlineResponseRow;
  hasExpenses: boolean;
  canMove: boolean;
  departsSpain: boolean;
  delivery: "email" | "paste";
  hasOpenDraft: boolean;
}) {
  const [t, format] = await Promise.all([getTranslations("AirlineResponse"), getFormatter()]);
  const analysis = response.status === "analyzed" ? (response.analysis as unknown as AirlineResponseAnalysis) : null;
  const recommended = (code: string) => analysis?.options.some((o) => o.code === code && o.recommended) ?? false;
  const other: AirlineResponsePurpose = response.purpose === "compensation" ? "expenses" : "compensation";

  return (
    <div className="space-y-4 rounded-xl border p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          {t(`sources.${response.source}`)} · {t(`channels.${response.channel}`)} ·{" "}
          {format.dateTime(new Date(response.received_on), { dateStyle: "long", timeZone: "UTC" })}
        </p>
        {canMove && (
          <AdminForm
            action={moveAirlineResponse.bind(null, locale, claimId, response.id, other)}
            submitLabel={t("moveTo", { flow: t(`flows.${other}`).toLowerCase() })}
            variant="ghost"
          />
        )}
      </div>
      {response.airline_text && (
        <details className="text-sm">
          <summary className="cursor-pointer text-muted-foreground">{t("theirAnswer")}</summary>
          <pre className="mt-2 max-h-60 overflow-auto rounded-md bg-muted/40 p-3 font-sans whitespace-pre-wrap [overflow-wrap:anywhere]">{response.airline_text}</pre>
        </details>
      )}

      {response.status === "pending" && (
        <>
          <p role="status" className="text-sm">{t("analyzing")}</p>
          <AutoRefresh />
          <AdminForm action={retryAirlineResponseAnalysis.bind(null, locale, claimId, response.id)} submitLabel={t("retry")} variant="ghost" />
        </>
      )}
      {response.status === "failed" && (
        <>
          <p role="alert" className="text-sm text-destructive">{t("analysisFailed")}</p>
          <AdminForm action={retryAirlineResponseAnalysis.bind(null, locale, claimId, response.id)} submitLabel={t("retry")} variant="outline" />
        </>
      )}

      {analysis && (
        <div className="space-y-4">
          {canMove && analysis.concerns && analysis.concerns !== response.purpose && analysis.concerns !== "unclear" && (
            <p className="rounded-lg bg-amber-500/15 p-3 text-sm">{t(`concernsHint.${analysis.concerns}`)}</p>
          )}
          <p className="text-sm">{analysis.summary}</p>
          {analysis.conflicts.length > 0 && (
            <div className="space-y-1">
              <h4 className="text-sm font-medium">{t("conflicts")}</h4>
              <ul className="list-disc space-y-1 pl-5 text-sm">
                {analysis.conflicts.map((c, i) => <li key={i}>{c}</li>)}
              </ul>
            </div>
          )}
          {analysis.options.length > 0 && (
            <div className="space-y-1">
              <h4 className="text-sm font-medium">{t("options")}</h4>
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
              <h4 className="font-medium">{t("replyTitle")}</h4>
              <ChallengeOptionsForm
                locale={locale}
                claimId={claimId}
                responseId={response.id}
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
  );
}
