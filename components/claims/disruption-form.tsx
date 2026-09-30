"use client";

import { useTranslations } from "next-intl";
import { useActionState, useState } from "react";
import { Field, describedBy } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { saveDisruption } from "@/app/[locale]/claims/_actions/details";
import { initialFormState } from "@/lib/claims/form-state";
import { minutesToParts, REASON_CATEGORIES, type CareProvided, type ReasonCategory } from "@/lib/claims/model";
import type { DisruptionType } from "@/lib/supabase/database.types";
import { DelayTimes, type DelayTimesValues } from "./delay-times";
import { DurationInput } from "./duration-input";
import { WizardNav } from "./wizard-nav";

const TYPES: DisruptionType[] = ["delay", "cancellation", "denied_boarding", "missed_connection"];

export type DisruptionFormValues = {
  disruption: DisruptionType;
  times: DelayTimesValues;
  depTz: string | null;
  arrTz: string | null; // final destination
  noticeDays: number | null;
  care: CareProvided;
  reasonCategory: ReasonCategory | null;
  reasonDetails: string;
  instructions: string;
};

export function DisruptionForm({ locale, claimId, initial }: { locale: string; claimId: string; initial: DisruptionFormValues }) {
  const t = useTranslations("Disruption");
  const tw = useTranslations("Wizard");
  const [state, formAction] = useActionState(saveDisruption.bind(null, locale, claimId), initialFormState);
  const [type, setType] = useState<DisruptionType>(initial.disruption);
  const [rerouting, setRerouting] = useState(initial.care.rerouting?.offered ? "yes" : initial.care.rerouting ? "no" : "");
  const err = (k: string) => state.fieldErrors?.[k];
  const earlier = minutesToParts(initial.care.rerouting?.earlier_departure_minutes ?? null);
  const later = minutesToParts(initial.care.rerouting?.later_arrival_minutes ?? null);

  return (
    <form action={formAction} className="space-y-7">
      <fieldset className="space-y-2">
        <legend className="mb-2 text-sm font-medium">{t("type")}</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {TYPES.map((value) => (
            <label
              key={value}
              className="flex cursor-pointer items-center gap-2 rounded-lg border p-3 text-sm has-checked:border-primary has-checked:bg-muted"
            >
              <input
                type="radio"
                name="disruption"
                value={value}
                checked={type === value}
                onChange={() => setType(value)}
                className="size-4"
              />
              {t(`types.${value}`)}
            </label>
          ))}
        </div>
      </fieldset>

      {(type === "delay" || type === "missed_connection") && (
        <DelayTimes
          initial={initial.times}
          depTz={initial.depTz}
          arrTz={initial.arrTz}
          invalid={Boolean(err("scheduled_arr") || err("actual_arr") || err("scheduled_dep") || err("actual_dep"))}
        />
      )}

      {type === "cancellation" && (
        <div className="space-y-5">
          <Field id="notice_days" label={t("noticeLabel")} hint={t("noticeHint")} error={err("notice_days") && tw("errorInvalid")}>
            <Input
              id="notice_days"
              name="notice_days"
              type="number"
              inputMode="numeric"
              min={0}
              max={365}
              defaultValue={initial.noticeDays ?? ""}
              className="w-24"
              aria-invalid={err("notice_days") || undefined}
              aria-describedby={describedBy("notice_days", { hint: true, error: err("notice_days") })}
            />
          </Field>
          <fieldset className="space-y-2">
            <legend className="mb-2 text-sm font-medium">{t("reroutingLabel")}</legend>
            <div className="flex gap-4 text-sm">
              {(["yes", "no"] as const).map((v) => (
                <label key={v} className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="rerouting_offered"
                    value={v}
                    checked={rerouting === v}
                    onChange={() => setRerouting(v)}
                    className="size-4"
                  />
                  {tw(v)}
                </label>
              ))}
            </div>
          </fieldset>
          {rerouting === "yes" && (
            <div className="space-y-5 border-l-2 pl-4">
              <Field id="earlier_hours" label={t("earlierLabel")}>
                <DurationInput id="earlier_hours" name="earlier" defaultHours={earlier.hours} defaultMinutes={earlier.minutes} />
              </Field>
              <Field id="later_hours" label={t("laterLabel")}>
                <DurationInput id="later_hours" name="later" defaultHours={later.hours} defaultMinutes={later.minutes} />
              </Field>
            </div>
          )}
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="reason_category" label={t("reasonLabel")} error={err("reason_category") && tw("errorInvalid")}>
          <NativeSelect
            id="reason_category"
            name="reason_category"
            defaultValue={initial.reasonCategory ?? "none_given"}
            aria-invalid={err("reason_category") || undefined}
          >
            {REASON_CATEGORIES.map((r) => (
              <option key={r} value={r}>
                {t(`reasons.${r}`)}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field id="reason_details" label={t("reasonDetails")} optionalLabel={tw("optional")}>
          <Input id="reason_details" name="reason_details" maxLength={500} defaultValue={initial.reasonDetails} />
        </Field>
      </div>

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">{t("careLabel")}</legend>
        <p className="text-xs text-muted-foreground">{t("careHint")}</p>
        <div className="flex flex-wrap gap-x-5 gap-y-2 pt-1 text-sm">
          {(["meals", "hotel", "transport"] as const).map((k) => (
            <label key={k} className="flex items-center gap-2">
              <input type="checkbox" name={`care_${k}`} defaultChecked={Boolean(initial.care[k])} className="size-4" />
              {t(`care.${k}`)}
            </label>
          ))}
        </div>
      </fieldset>

      <Field id="airline_instructions" label={t("instructionsLabel")} optionalLabel={tw("optional")} hint={t("instructionsHint")}>
        <Textarea
          id="airline_instructions"
          name="airline_instructions"
          maxLength={1000}
          defaultValue={initial.instructions}
          aria-describedby="airline_instructions-hint"
        />
      </Field>

      <WizardNav backHref={`/claims/${claimId}/flight`} state={state} />
    </form>
  );
}
