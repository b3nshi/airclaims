"use client";

import { ArrowRightIcon, CircleHelpIcon, XIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRef } from "react";
import { Button } from "@/components/ui/button";
import { CLAIM_STAGES, type ClaimStage } from "@/lib/claims/stages";
import { cn } from "@/lib/utils";

// Each scenario is a sequence of stages; the last item can be an outcome instead.
const SCENARIOS: { key: string; flow: (ClaimStage | "paid" | "rejected" | "court")[] }[] = [
  { key: "paid", flow: ["prepare", "send", "airline_wait", "paid"] },
  { key: "rejected", flow: ["airline_wait", "airline_reply", "aesa_file", "aesa_wait", "paid"] },
  { key: "formRefusal", flow: ["send", "airline_reply", "aesa_file", "aesa_wait"] },
  { key: "offer", flow: ["airline_wait", "airline_reply", "paid"] },
  { key: "noAnswer", flow: ["airline_wait", "aesa_file", "aesa_wait", "paid"] },
  { key: "aesaIgnored", flow: ["aesa_wait", "court", "paid"] },
  { key: "lost", flow: ["aesa_wait", "rejected"] },
];

/** (?) button: a popup explaining every stage and how a claim can go. */
export function ClaimPathHelp({ current }: { current: ClaimStage }) {
  const t = useTranslations("ClaimPath");
  const ref = useRef<HTMLDialogElement>(null);
  const label = (item: string) =>
    (CLAIM_STAGES as readonly string[]).includes(item) ? t(`stages.${item}`) : t(`help.end.${item}`);

  return (
    <>
      <Button variant="ghost" size="icon" aria-label={t("help.open")} onClick={() => ref.current?.showModal()}>
        <CircleHelpIcon />
      </Button>
      <dialog
        ref={ref}
        aria-labelledby="claim-path-help-title"
        className="m-auto max-h-[85vh] w-[min(42rem,calc(100vw-2rem))] overflow-y-auto rounded-xl border bg-background p-0 text-foreground shadow-xl backdrop:bg-black/40"
        // Clicking the backdrop closes it.
        onClick={(e) => e.target === ref.current && ref.current?.close()}
      >
        <div className="space-y-6 p-5">
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-1">
              <h2 id="claim-path-help-title" className="text-lg font-semibold">{t("help.title")}</h2>
              <p className="text-sm text-muted-foreground">{t("help.intro")}</p>
            </div>
            <Button variant="ghost" size="icon" aria-label={t("help.close")} onClick={() => ref.current?.close()}>
              <XIcon />
            </Button>
          </div>

          <section className="space-y-2">
            <h3 className="text-sm font-semibold">{t("help.stagesTitle")}</h3>
            <ol className="space-y-2 text-sm">
              {CLAIM_STAGES.map((stage, n) => (
                <li key={stage} className={cn("flex gap-3 rounded-md p-2", stage === current && "bg-muted")}>
                  <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs text-primary-foreground">
                    {n + 1}
                  </span>
                  <span>
                    <span className="font-medium">{t(`stages.${stage}`)}</span>
                    {stage === current && <span className="text-muted-foreground"> · {t("help.youAreHere")}</span>}
                    <span className="block text-muted-foreground">{t(`help.stage.${stage}`)}</span>
                  </span>
                </li>
              ))}
            </ol>
          </section>

          <section className="space-y-3">
            <h3 className="text-sm font-semibold">{t("help.scenariosTitle")}</h3>
            {SCENARIOS.map(({ key, flow }) => (
              <div key={key} className="space-y-2 rounded-lg border p-3">
                <p className="text-sm font-medium">{t(`help.scenario.${key}.title`)}</p>
                <ol className="flex flex-wrap items-center gap-1 text-xs" aria-label={t(`help.scenario.${key}.title`)}>
                  {flow.map((item, i) => (
                    <li key={item} className="flex items-center gap-1">
                      {i > 0 && <ArrowRightIcon className="size-3 text-muted-foreground" aria-hidden />}
                      <span
                        className={cn(
                          "rounded-full px-2 py-0.5",
                          item === "paid" ? "bg-emerald-600 text-white"
                            : item === "rejected" ? "bg-destructive text-white"
                            : item === "court" ? "bg-amber-500 text-black"
                            : "bg-muted",
                        )}
                      >
                        {label(item)}
                      </span>
                    </li>
                  ))}
                </ol>
                <p className="text-sm text-muted-foreground">{t(`help.scenario.${key}.body`)}</p>
              </div>
            ))}
          </section>

          <p className="text-xs text-muted-foreground">{t("help.disclaimer")}</p>
        </div>
      </dialog>
    </>
  );
}
