"use client";

import { useTranslations } from "next-intl";
import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { recordExpensesSubmission } from "@/app/[locale]/claims/_actions/submit";
import { initialFormState } from "@/lib/claims/form-state";

export function ExpensesReferenceForm({ locale, claimId }: { locale: string; claimId: string }) {
  const t = useTranslations("Done");
  const tw = useTranslations("Wizard");
  const [state, formAction, pending] = useActionState(recordExpensesSubmission.bind(null, locale, claimId), initialFormState);
  if (state.status === "saved") return <p role="status" className="text-sm">{t("expensesRecorded")}</p>;
  return (
    <form action={formAction} className="flex flex-wrap items-end gap-3">
      <Field id="expenses_reference" label={t("expensesReference")} optionalLabel={tw("optional")} className="min-w-60 flex-1">
        <Input id="expenses_reference" name="reference" maxLength={100} />
      </Field>
      <Button type="submit" variant="outline" disabled={pending}>
        {t("markExpensesSubmitted")}
      </Button>
      {state.status === "error" && <p role="alert" className="w-full text-sm text-destructive">{tw("errorSave")}</p>}
    </form>
  );
}
