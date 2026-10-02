"use client";

import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useActionState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { DocumentUploader } from "@/components/claims/document-uploader";
import { reportAirlineResponse } from "@/app/[locale]/claims/_actions/dashboard";
import { initialFormState } from "@/lib/claims/form-state";

const CHANNELS = ["web_form", "email", "letter", "phone", "chat", "other"] as const;

/**
 * The passenger pastes what the airline answered (or explains it, with screenshots), for the
 * compensation claim or the separate expenses claim, and the claim number it gives, if any.
 */
export function AirlineResponseForm({
  locale,
  claimId,
  userId,
  purpose,
}: {
  locale: string;
  claimId: string;
  userId: string;
  purpose: "compensation" | "expenses";
}) {
  const t = useTranslations("AirlineResponse");
  const tw = useTranslations("Wizard");
  const router = useRouter();
  const [state, formAction, pending] = useActionState(reportAirlineResponse.bind(null, locale, claimId), initialFormState);
  const today = new Date().toISOString().slice(0, 10);
  useEffect(() => {
    if (state.status === "saved") router.refresh();
  }, [state, router]);

  if (state.status === "saved") return <p role="status" className="text-sm">{t("reported")}</p>;
  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="purpose" value={purpose} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id={`${purpose}_channel`} label={t("channel")}>
          <NativeSelect id={`${purpose}_channel`} name="channel" defaultValue="web_form">
            {CHANNELS.map((c) => <option key={c} value={c}>{t(`channels.${c}`)}</option>)}
          </NativeSelect>
        </Field>
        <Field id={`${purpose}_received_on`} label={t("receivedOn")}>
          <Input id={`${purpose}_received_on`} name="received_on" type="date" max={today} defaultValue={today} required />
        </Field>
      </div>
      <Field id={`${purpose}_answer_reference`} label={t("answerReference")} optionalLabel={tw("optional")} hint={t("answerReferenceHint")}>
        <Input id={`${purpose}_answer_reference`} name="reference" maxLength={100} aria-describedby={`${purpose}_answer_reference-hint`} />
      </Field>
      <Field id={`${purpose}_airline_text`} label={t("airlineText")} hint={t("airlineTextHint")}
        error={state.fieldErrors?.airline_text && t("needText")}>
        <Textarea id={`${purpose}_airline_text`} name="airline_text" rows={7} maxLength={20000} aria-describedby={`${purpose}_airline_text-hint`} />
      </Field>
      <Field id={`${purpose}_explanation`} label={t("explanation")} optionalLabel={tw("optional")} hint={t("explanationHint")}>
        <Textarea id={`${purpose}_explanation`} name="explanation" rows={4} maxLength={5000} aria-describedby={`${purpose}_explanation-hint`} />
      </Field>
      <div className="space-y-1">
        <p className="text-sm font-medium">{t("screenshots")}</p>
        <p className="text-xs text-muted-foreground">{t("screenshotsHint")}</p>
        <DocumentUploader locale={locale} claimId={claimId} userId={userId} docType="airline_correspondence" label={t("addScreenshot")} />
      </div>
      <Button type="submit" disabled={pending}>{pending ? tw("saving") : t("submit")}</Button>
      {state.status === "invalid" && <p role="alert" className="text-sm text-destructive">{tw("errorInvalid")}</p>}
      {state.status === "error" && <p role="alert" className="text-sm text-destructive">{tw("errorSave")}</p>}
    </form>
  );
}
