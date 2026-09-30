"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { estimateArrival, formatMinutes, minutesLate } from "@/lib/claims/times";

export type DelayTimesValues = {
  scheduledArr: string;
  actualArr: string;
  scheduledDep: string;
  actualDep: string;
  estimated: boolean;
};

/**
 * Arrival delay from times, not a typed duration. EU261 counts the delay at the final
 * destination (doors open); if the passenger only knows when it left, we estimate arrival
 * as actual departure + scheduled flight time.
 */
export function DelayTimes({
  initial,
  depTz,
  arrTz,
  invalid,
}: {
  initial: DelayTimesValues;
  depTz: string | null;
  arrTz: string | null;
  invalid?: boolean;
}) {
  const t = useTranslations("Disruption");
  const [mode, setMode] = useState<"arrival" | "departure">(initial.estimated ? "departure" : "arrival");
  const [scheduledArr, setScheduledArr] = useState(initial.scheduledArr);
  const [actualArr, setActualArr] = useState(initial.actualArr);
  const [scheduledDep, setScheduledDep] = useState(initial.scheduledDep);
  const [actualDep, setActualDep] = useState(initial.actualDep);

  let delay: number | null = null;
  let arrival: string | null = null;
  try {
    arrival =
      mode === "arrival"
        ? actualArr || null
        : scheduledDep && scheduledArr && actualDep
          ? estimateArrival({ scheduledDep, scheduledArr, actualDep, depTz, arrTz })
          : null;
    delay = scheduledArr && arrival ? minutesLate(scheduledArr, arrival, arrTz) : null;
  } catch {
    delay = null;
  }
  const late = delay !== null ? formatMinutes(Math.max(0, delay)) : null;

  return (
    <fieldset className="space-y-4 rounded-lg border p-4">
      <legend className="px-1 text-sm font-medium">{t("delayLabel")}</legend>
      <input type="hidden" name="arrival_mode" value={mode} />
      <Field id="scheduled_arr" label={t("scheduledArrLabel")} hint={t("localTimeHint")}>
        <Input
          id="scheduled_arr"
          name="scheduled_arr"
          type="datetime-local"
          value={scheduledArr}
          onChange={(e) => setScheduledArr(e.target.value)}
          aria-invalid={invalid || undefined}
          aria-describedby="scheduled_arr-hint"
        />
      </Field>

      <div className="flex flex-wrap gap-4 text-sm" role="radiogroup" aria-label={t("arrivalKnownLabel")}>
        {(["arrival", "departure"] as const).map((m) => (
          <label key={m} className="flex items-center gap-2">
            <input type="radio" name="arrival_mode_choice" checked={mode === m} onChange={() => setMode(m)} className="size-4" />
            {m === "arrival" ? t("modeArrival") : t("modeDeparture")}
          </label>
        ))}
      </div>

      {mode === "arrival" ? (
        <Field id="actual_arr" label={t("actualArrLabel")} hint={t("actualArrHint")}>
          <Input
            id="actual_arr"
            name="actual_arr"
            type="datetime-local"
            value={actualArr}
            onChange={(e) => setActualArr(e.target.value)}
            aria-invalid={invalid || undefined}
            aria-describedby="actual_arr-hint"
          />
        </Field>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="scheduled_dep" label={t("scheduledDepLabel")}>
            <Input id="scheduled_dep" name="scheduled_dep" type="datetime-local" value={scheduledDep}
              onChange={(e) => setScheduledDep(e.target.value)} aria-invalid={invalid || undefined} />
          </Field>
          <Field id="actual_dep" label={t("actualDepLabel")}>
            <Input id="actual_dep" name="actual_dep" type="datetime-local" value={actualDep}
              onChange={(e) => setActualDep(e.target.value)} aria-invalid={invalid || undefined} />
          </Field>
        </div>
      )}
      {mode === "arrival" && <input type="hidden" name="actual_dep" value={actualDep} />}
      {mode === "arrival" && <input type="hidden" name="scheduled_dep" value={scheduledDep} />}

      <p role="status" className="text-sm">
        {late === null
          ? <span className="text-muted-foreground">{t("computedMissing")}</span>
          : delay !== null && delay <= 0
            ? t("onTime")
            : (
              <span className={delay !== null && delay >= 180 ? "font-medium" : undefined}>
                {t(mode === "departure" ? "computedEstimated" : "computed", late)}
              </span>
            )}
      </p>
    </fieldset>
  );
}
