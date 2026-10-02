import { CheckIcon } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { AdminForm } from "@/components/admin/admin-form";
import { buttonVariants } from "@/components/ui/button";
import { markReplyPasted } from "@/app/[locale]/claims/_actions/dashboard";
import { ANSWER_STEPS, type AnswerSteps as AnswerStepsData } from "@/lib/claims/answer-steps";
import { cn } from "@/lib/utils";

/**
 * Where this answer is and what the passenger does next: paste it → we read it → choose the
 * reply → send it (approve, or copy into the airline's form) → wait for the airline.
 */
export async function AnswerSteps({
  locale,
  claimId,
  steps,
  replyEmailId,
}: {
  locale: string;
  claimId: string;
  steps: AnswerStepsData;
  replyEmailId: string | null;
}) {
  const t = await getTranslations("AirlineResponse.steps");
  const index = ANSWER_STEPS.indexOf(steps.current);

  return (
    <ol className="space-y-0" aria-label={t("label")}>
      {ANSWER_STEPS.map((step, n) => {
        const state = n < index ? "done" : n === index ? "current" : "todo";
        const last = n === ANSWER_STEPS.length - 1;
        return (
          <li key={step} className="relative flex gap-3 pb-4 last:pb-0" aria-current={state === "current" ? "step" : undefined}>
            {!last && (
              <span aria-hidden className={cn("absolute top-7 bottom-1 left-3 w-px", state === "done" ? "bg-emerald-600/50" : "bg-border")} />
            )}
            <span
              aria-hidden
              className={cn(
                "flex size-6 shrink-0 items-center justify-center rounded-full text-xs",
                state === "done" && "bg-emerald-600/15 text-emerald-800 dark:text-emerald-300",
                state === "current" && "bg-primary text-primary-foreground",
                state === "todo" && "border text-muted-foreground",
              )}
            >
              {state === "done" ? <CheckIcon className="size-3.5" /> : n + 1}
            </span>
            <div className="min-w-0 space-y-1 pt-0.5">
              <p className={cn("text-sm", state === "current" ? "font-medium" : state === "todo" && "text-muted-foreground")}>
                {t(`${step}.title`)}
                <span className="sr-only"> ({t(`state.${state}`)})</span>
              </p>
              {state === "current" && (
                <>
                  <p className={cn("text-sm", steps.detail?.endsWith("failed") ? "text-destructive" : "text-muted-foreground")}>
                    {t(steps.detail ? `detail.${steps.detail}` : `${step}.now`)}
                  </p>
                  {step === "send" && replyEmailId && (
                    <div className="flex flex-wrap items-center gap-2 pt-1">
                      <a href={`#email-${replyEmailId}`} className={buttonVariants({ size: "sm" })}>
                        {t("openReply")}
                      </a>
                      {steps.detail === "copy" && (
                        <AdminForm
                          action={markReplyPasted.bind(null, locale, claimId, replyEmailId)}
                          submitLabel={t("pasted")}
                          variant="outline"
                        />
                      )}
                    </div>
                  )}
                </>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
