import { CheckIcon } from "lucide-react";
import { getFormatter, getTranslations } from "next-intl/server";
import { CLAIM_STAGES, type ClaimPath as ClaimPathData, type StageState } from "@/lib/claims/stages";
import { cn } from "@/lib/utils";
import { ClaimPathHelp } from "./claim-path-help";

// Chevron shapes (Salesforce-style path). The notch is 12px; neighbours overlap by 10px, leaving a 2px gap.
const SHAPE = {
  first: "polygon(0 0, calc(100% - 12px) 0, 100% 50%, calc(100% - 12px) 100%, 0 100%)",
  middle: "polygon(0 0, calc(100% - 12px) 0, 100% 50%, calc(100% - 12px) 100%, 0 100%, 12px 50%)",
  last: "polygon(0 0, 100% 0, 100% 100%, 0 100%, 12px 50%)",
};

const TONE: Record<StageState, string> = {
  done: "bg-emerald-600/15 text-emerald-900 dark:text-emerald-200",
  current: "bg-primary text-primary-foreground",
  todo: "bg-muted text-muted-foreground",
  skipped: "bg-muted/50 text-muted-foreground/70",
};

const OUTCOME_TONE = {
  won: "bg-emerald-600 text-white",
  partially_won: "bg-emerald-600 text-white",
  lost: "bg-destructive text-white",
  withdrawn: "bg-muted-foreground text-background",
};

/** The claim's general stages; the wizard's steps (or the next action) sit under it. */
export async function ClaimPath({ path }: { path: ClaimPathData }) {
  const [t, format] = await Promise.all([getTranslations("ClaimPath"), getFormatter()]);
  const index = CLAIM_STAGES.indexOf(path.current);
  const subtitle = path.outcome ? t(`outcome.${path.outcome}`) : path.inCourt ? t("court") : null;
  const caption = t(`caption.${path.current}`, {
    due: path.due ? format.dateTime(new Date(path.due), { dateStyle: "long", timeZone: "UTC" }) : "",
  });

  return (
    <div className="space-y-2">
      <nav aria-label={t("label")} className="flex items-center gap-2">
        <ol className="flex min-w-0 flex-1">
          {CLAIM_STAGES.map((stage, n) => {
            const state = path.states[stage];
            const current = state === "current";
            const tone = current && path.outcome ? OUTCOME_TONE[path.outcome] : TONE[state];
            return (
              <li
                key={stage}
                aria-current={current ? "step" : undefined}
                className={cn(
                  "flex h-11 min-w-0 items-center overflow-hidden justify-center gap-1 px-4 text-xs leading-tight",
                  n > 0 && "-ml-2.5",
                  current ? "flex-[3] font-semibold sm:flex-[1.4]" : "flex-1",
                  tone,
                )}
                style={{ clipPath: n === 0 ? SHAPE.first : n === CLAIM_STAGES.length - 1 ? SHAPE.last : SHAPE.middle }}
              >
                {state === "done" && <CheckIcon className="size-3.5 shrink-0" aria-hidden />}
                <span className={cn("text-center break-words", !current && "hidden md:inline", state === "skipped" && "line-through")}>
                  {t(`stages.${stage}`)}
                  {current && subtitle && <span className="block text-[10px] font-normal opacity-90">{subtitle}</span>}
                </span>
                <span className="sr-only">
                  {!current && `${t(`stages.${stage}`)}: `}
                  {t(`state.${state}`)}
                </span>
              </li>
            );
          })}
        </ol>
        <ClaimPathHelp current={path.current} />
      </nav>
      <p className="text-sm text-muted-foreground">
        <span className="font-medium text-foreground">
          {t("stageOf", { n: index + 1, total: CLAIM_STAGES.length })} · {t(`stages.${path.current}`)}
          {subtitle ? ` (${subtitle})` : ""}
        </span>
        {" — "}
        {caption}
      </p>
    </div>
  );
}
