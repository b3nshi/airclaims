"use client";

import { useTranslations } from "next-intl";
import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { recordSubmission } from "@/app/[locale]/claims/_actions/submit";
import { initialFormState } from "@/lib/claims/form-state";

export function SubmissionForm({ locale, claimId }: { locale: string; claimId: string }) {
  const t = useTranslations("Done");
  const tw = useTranslations("Wizard");
  const [state, formAction, pending] = useActionState(recordSubmission.bind(null, locale, claimId), initialFormState);
  return (
    <form action={formAction} className="flex flex-wrap items-end gap-3">
      <Field
        id="reference"
        label={t("referenceLabel")}
        optionalLabel={tw("optional")}
        hint={t("referenceHint")}
        error={state.status === "invalid" && tw("errorInvalid")}
        className="min-w-60 flex-1"
      >
        <Input id="reference" name="reference" maxLength={100} aria-describedby="reference-hint" />
      </Field>
      <Button type="submit" disabled={pending}>
        {t("markSubmitted")}
      </Button>
      {state.status === "error" && (
        <p role="alert" className="w-full text-sm text-destructive">
          {tw("errorSave")}
        </p>
      )}
    </form>
  );
}
