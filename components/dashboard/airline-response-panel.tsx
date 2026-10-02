import { getFormatter, getTranslations } from "next-intl/server";
import { AdminForm } from "@/components/admin/admin-form";
import { answerSteps, type AnswerSteps as AnswerStepsData } from "@/lib/claims/answer-steps";
import type {
  AirlineResponseAnalysis,
  AirlineResponsePurpose,
  AirlineResponseRow,
  ClaimRow,
  EmailStatus,
} from "@/lib/supabase/database.types";
import { moveAirlineResponse, retryAirlineResponseAnalysis } from "@/app/[locale]/claims/_actions/dashboard";
import { AirlineResponseForm } from "./airline-response-form";
import { AnswerSteps } from "./answer-steps";
import { AutoRefresh } from "./auto-refresh";
import { ChallengeOptionsForm } from "./challenge-options-form";
import { ClaimReferencesForm } from "./claim-references-form";
import { ClaimTabs } from "./claim-tabs";
import { Section } from "./sections";

/** The reply drafted for an answer: its email and whether the passenger pasted it into the airline's form. */
export type AnswerReply = { emailId: string; status: EmailStatus; pasted: boolean };

type PanelProps = {
  locale: string;
  claim: ClaimRow;
  userId: string;
  responses: AirlineResponseRow[]; // newest first
  replies: Record<string, AnswerReply>; // by response id
  hasExpenses: boolean;
  hasExpensesFlow: boolean; // the expenses are (or will be) a separate claim with its own answers
  departsSpain: boolean;
  delivery: "email" | "paste";
  hasOpenDraft: boolean;
};

const stepsFor = (response: AirlineResponseRow | undefined, reply: AnswerReply | undefined): AnswerStepsData =>
  answerSteps({ response: response?.status ?? "none", reply: reply ?? null });

/**
 * "The airline answered": per claim (compensation, and expenses when the airline handles them
 * separately, as tabs), paste the answer, follow what happens to it and choose the reply.
 * The claim numbers can be corrected here too.
 */
export async function AirlineResponsePanel(props: PanelProps) {
  const { locale, claim, responses, replies, hasExpensesFlow } = props;
  const t = await getTranslations("AirlineResponse");
  const flows: AirlineResponsePurpose[] = hasExpensesFlow ? ["compensation", "expenses"] : ["compensation"];
  const latest = (p: AirlineResponsePurpose) => responses.find((r) => r.purpose === p);

  return (
    <Section id="airline-answer" title={t("title")}>
      <p className="text-sm text-muted-foreground">{t(hasExpensesFlow ? "introTwoClaims" : "intro")}</p>
      <ClaimReferencesForm
        locale={locale}
        claimId={claim.id}
        compensation={claim.airline_claim_reference}
        expenses={claim.airline_expenses_reference}
        showExpenses={hasExpensesFlow}
      />
      {flows.length > 1 ? (
        <ClaimTabs
          nested
          label={t("flowsLabel")}
          tabs={flows.map((purpose) => {
            const r = latest(purpose);
            const step = stepsFor(r, r && replies[r.id]).current;
            return {
              id: `answer-${purpose}`,
              label: t(`references.${purpose}`),
              // Something to do: choose a reply, or approve / paste it.
              attention: !!r && (step === "choose" || step === "send"),
              content: <Flow {...props} purpose={purpose} responses={responses.filter((x) => x.purpose === purpose)} />,
            };
          })}
        />
      ) : (
        <Flow {...props} purpose="compensation" responses={responses.filter((x) => x.purpose === "compensation")} />
      )}
    </Section>
  );
}

async function Flow(props: PanelProps & { purpose: AirlineResponsePurpose }) {
  const { locale, claim, userId, responses, replies, purpose } = props;
  const [t, format] = await Promise.all([getTranslations("AirlineResponse"), getFormatter()]);
  const [latest, ...earlier] = responses;
  const reply = latest ? replies[latest.id] : undefined;
  const steps = stepsFor(latest, reply);
  const date = (d: string) => format.dateTime(new Date(d), { dateStyle: "long", timeZone: "UTC" });
  const reference = purpose === "compensation" ? claim.airline_claim_reference : claim.airline_expenses_reference;
  const form = <AirlineResponseForm locale={locale} claimId={claim.id} userId={userId} purpose={purpose} />;

  return (
    <div className="space-y-4">
      {reference && <p className="text-xs text-muted-foreground">{t("referenceShort", { reference })}</p>}
      <div className="rounded-xl bg-muted/30 p-4">
        <AnswerSteps locale={locale} claimId={claim.id} steps={steps} replyEmailId={reply && reply.status !== "ignored" ? reply.emailId : null} />
      </div>

      {latest ? (
        <ResponseCard {...props} response={latest} steps={steps} />
      ) : (
        // Nothing yet: the form is the next step, so it's open.
        <div className="rounded-xl border p-4">{form}</div>
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
      {latest && (
        // Their next answer: open once the reply is out and we're waiting for it.
        <details open={steps.current === "wait"} className="rounded-xl border border-dashed p-4">
          <summary className="cursor-pointer text-sm font-medium">{t("pasteNext")}</summary>
          <div className="mt-4">{form}</div>
        </details>
      )}
    </div>
  );
}

async function ResponseCard({
  locale,
  claim,
  response,
  steps,
  hasExpenses,
  hasExpensesFlow,
  departsSpain,
  delivery,
  hasOpenDraft,
}: PanelProps & { response: AirlineResponseRow; steps: AnswerStepsData }) {
  const [t, format] = await Promise.all([getTranslations("AirlineResponse"), getFormatter()]);
  const analysis = response.status === "analyzed" ? (response.analysis as unknown as AirlineResponseAnalysis) : null;
  const recommended = (code: string) => analysis?.options.some((o) => o.code === code && o.recommended) ?? false;
  const other: AirlineResponsePurpose = response.purpose === "compensation" ? "expenses" : "compensation";
  const choosing = steps.current === "choose";

  const reading = (
    <div className="space-y-4">
      {hasExpensesFlow && analysis?.concerns && analysis.concerns !== response.purpose && analysis.concerns !== "unclear" && (
        <p className="rounded-lg bg-amber-500/15 p-3 text-sm">{t(`concernsHint.${analysis.concerns}`)}</p>
      )}
      <p className="text-sm">{analysis?.summary}</p>
      {!!analysis?.conflicts.length && (
        <div className="space-y-1">
          <h4 className="text-sm font-medium">{t("conflicts")}</h4>
          <ul className="list-disc space-y-1 pl-5 text-sm">
            {analysis.conflicts.map((c, i) => <li key={i}>{c}</li>)}
          </ul>
        </div>
      )}
      {!!analysis?.options.length && (
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
      {analysis?.aesa_advice && (
        <p className="rounded-lg bg-muted/40 p-3 text-sm"><span className="font-medium">AESA: </span>{analysis.aesa_advice}</p>
      )}
    </div>
  );

  return (
    <div className="space-y-4 rounded-xl border p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          {t(`sources.${response.source}`)} · {t(`channels.${response.channel}`)} ·{" "}
          {format.dateTime(new Date(response.received_on), { dateStyle: "long", timeZone: "UTC" })}
        </p>
        {hasExpensesFlow && (
          <AdminForm
            action={moveAirlineResponse.bind(null, locale, claim.id, response.id, other)}
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
          <AutoRefresh />
          <AdminForm action={retryAirlineResponseAnalysis.bind(null, locale, claim.id, response.id)} submitLabel={t("retry")} variant="ghost" />
        </>
      )}
      {response.status === "failed" && (
        <AdminForm action={retryAirlineResponseAnalysis.bind(null, locale, claim.id, response.id)} submitLabel={t("retry")} variant="outline" />
      )}

      {analysis &&
        (choosing ? (
          reading
        ) : (
          // Once the reply is drafted, our reading of their answer is reference material.
          <details className="text-sm">
            <summary className="cursor-pointer text-muted-foreground">{t("ourReading")}</summary>
            <div className="mt-3">{reading}</div>
          </details>
        ))}

      {analysis && choosing &&
        (hasOpenDraft ? (
          <p className="text-sm text-muted-foreground">{t("draftWaitingOther")}</p>
        ) : (
          <div className="space-y-2 border-t pt-4">
            <h4 className="font-medium">{t("replyTitle")}</h4>
            <ChallengeOptionsForm
              locale={locale}
              claimId={claim.id}
              responseId={response.id}
              delivery={delivery}
              defaults={{
                request_evidence: recommended("request_evidence") || analysis.reasons.some((r) => r.code.startsWith("extraordinary")),
                contest_delay: recommended("contest_delay_calculation"),
                decline_offer: recommended("decline_offer"),
                include_expenses: false,
                // A factual next step with a deadline; AESA asks for the airline's answer anyway.
                mention_aesa: departsSpain,
                hasExpenses: hasExpenses && response.purpose === "compensation",
                departsSpain,
                aboutDelay: response.purpose === "compensation",
              }}
            />
          </div>
        ))}
    </div>
  );
}
