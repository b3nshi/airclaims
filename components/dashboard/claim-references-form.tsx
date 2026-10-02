"use client";

import { useTranslations } from "next-intl";
import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { updateClaimReferences } from "@/app/[locale]/claims/_actions/dashboard";
import { initialFormState } from "@/lib/claims/form-state";

/** The airline's claim numbers, shown and editable in one place. */
export function ClaimReferencesForm({
  locale,
  claimId,
  compensation,
  expenses,
  showExpenses,
}: {
  locale: string;
  claimId: string;
  compensation: string | null;
  expenses: string | null;
  showExpenses: boolean;
}) {
  const t = useTranslations("AirlineResponse.references");
  const tw = useTranslations("Wizard");
  const [state, formAction, pending] = useActionState(updateClaimReferences.bind(null, locale, claimId), initialFormState);
  const rows = [
    { key: "compensation", value: compensation },
    ...(showExpenses ? [{ key: "expenses", value: expenses }] : []),
  ] as const;

  return (
    <details className="rounded-xl border p-4">
      <summary className="cursor-pointer text-sm">
        <span className="font-medium">{t("title")}</span>
        <span className="text-muted-foreground">
          {" · "}
          {rows.map((r) => `${t(r.key)}: ${r.value ?? t("none")}`).join(" · ")}
        </span>
      </summary>
      <form action={formAction} className="mt-4 space-y-4">
        <p className="text-sm text-muted-foreground">{t("hint")}</p>
        <div className="grid gap-4 sm:grid-cols-2">
          {rows.map((r) => (
            <Field key={r.key} id={`ref_${r.key}`} label={t(r.key)} optionalLabel={tw("optional")}>
              <Input id={`ref_${r.key}`} name={r.key} maxLength={100} defaultValue={r.value ?? ""} />
            </Field>
          ))}
        </div>
        {/* Keep the expenses number when the field isn't shown. */}
        {!showExpenses && <input type="hidden" name="expenses" value={expenses ?? ""} />}
        <div className="flex items-center gap-3">
          <Button type="submit" variant="outline" disabled={pending}>{t("save")}</Button>
          {state.status === "saved" && <p role="status" className="text-sm text-muted-foreground">{t("saved")}</p>}
          {state.status !== "saved" && state.status !== "idle" && (
            <p role="alert" className="text-sm text-destructive">{tw("errorSave")}</p>
          )}
        </div>
      </form>
    </details>
  );
}
