"use client";

import { useTranslations } from "next-intl";
import { Link, usePathname } from "@/i18n/navigation";
import { WIZARD_STEPS, type WizardStep } from "@/lib/claims/model";
import { cn } from "@/lib/utils";

/** Progress bar for the claim wizard. Completed steps are links while the claim is a draft. */
export function WizardSteps({ claimId, editable }: { claimId: string | null; editable: boolean }) {
  const t = useTranslations("Wizard");
  const pathname = usePathname();
  const current = (WIZARD_STEPS.find((s) => pathname.endsWith(`/${s}`)) ?? "flight") as WizardStep;
  const index = WIZARD_STEPS.indexOf(current);

  return (
    <nav aria-label={t("stepOf", { n: index + 1, total: WIZARD_STEPS.length })} className="space-y-2">
      <p className="text-xs text-muted-foreground sm:hidden">
        {t("stepOf", { n: index + 1, total: WIZARD_STEPS.length })} · {t(`steps.${current}`)}
      </p>
      <ol className="flex gap-1">
        {WIZARD_STEPS.map((step, i) => {
          const state = i < index ? "done" : i === index ? "current" : "todo";
          const bar = (
            <span
              className={cn(
                "block h-1.5 rounded-full",
                state === "todo" ? "bg-muted" : "bg-primary",
                state === "done" && "opacity-60",
              )}
            />
          );
          const label = (
            <span className={cn("mt-1.5 hidden text-xs sm:block", state === "current" ? "font-medium" : "text-muted-foreground")}>
              {t(`steps.${step}`)}
            </span>
          );
          return (
            <li key={step} className="flex-1" aria-current={state === "current" ? "step" : undefined}>
              {claimId && editable && state === "done" && step !== "done" ? (
                <Link href={`/claims/${claimId}/${step}`} className="block hover:opacity-80">
                  {bar}
                  {label}
                </Link>
              ) : (
                <>
                  {bar}
                  {label}
                </>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
