"use client";

import { useTranslations } from "next-intl";
import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { requestChallengeDraft } from "@/app/[locale]/claims/_actions/dashboard";
import { initialFormState } from "@/lib/claims/form-state";

export type ChallengeDefaults = {
  request_evidence: boolean;
  contest_delay: boolean;
  decline_offer: boolean;
  include_expenses: boolean;
  mention_aesa: boolean;
  hasExpenses: boolean;
  departsSpain: boolean;
};

/** The passenger chooses what their reply says; the AI writes it in the airline's language. */
export function ChallengeOptionsForm({
  locale,
  claimId,
  responseId,
  defaults,
  delivery,
}: {
  locale: string;
  claimId: string;
  responseId: string;
  defaults: ChallengeDefaults;
  delivery: "email" | "paste";
}) {
  const t = useTranslations("AirlineResponse");
  const tw = useTranslations("Wizard");
  const [state, formAction, pending] = useActionState(
    requestChallengeDraft.bind(null, locale, claimId, responseId),
    initialFormState,
  );
  if (state.status === "saved") return <p role="status" className="text-sm">{t("drafting")}</p>;

  const box = (name: keyof ChallengeDefaults, label: string, hint?: string) => (
    <label className="flex items-start gap-2 text-sm">
      <input type="checkbox" name={name} defaultChecked={Boolean(defaults[name])} className="mt-0.5 size-4" />
      <span>
        {label}
        {hint && <span className="block text-xs text-muted-foreground">{hint}</span>}
      </span>
    </label>
  );

  return (
    <form action={formAction} className="space-y-4">
      <fieldset className="space-y-2">
        <legend className="mb-1 text-sm font-medium">{t("replyIncludes")}</legend>
        {box("request_evidence", t("opt.request_evidence"), t("opt.request_evidenceHint"))}
        {box("contest_delay", t("opt.contest_delay"), t("opt.contest_delayHint"))}
        {box("decline_offer", t("opt.decline_offer"))}
        {defaults.hasExpenses && box("include_expenses", t("opt.include_expenses"))}
        {box("mention_aesa", defaults.departsSpain ? t("opt.mention_aesa") : t("opt.mention_neb"), t("opt.mention_aesaHint"))}
      </fieldset>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="deadline_days" label={t("deadline")}>
          <NativeSelect id="deadline_days" name="deadline_days" defaultValue="14">
            <option value="14">{t("days", { days: 14 })}</option>
            <option value="30">{t("days", { days: 30 })}</option>
          </NativeSelect>
        </Field>
      </div>
      <Field id="passenger_notes" label={t("notes")} optionalLabel={tw("optional")} hint={t("notesHint")}>
        <Textarea id="passenger_notes" name="passenger_notes" rows={3} maxLength={2000} aria-describedby="passenger_notes-hint" />
      </Field>
      <p className="text-xs text-muted-foreground">{delivery === "paste" ? t("deliveryPaste") : t("deliveryEmail")}</p>
      <Button type="submit" disabled={pending}>{t("draftReply")}</Button>
      {state.status === "error" && <p role="alert" className="text-sm text-destructive">{t("draftError")}</p>}
    </form>
  );
}
