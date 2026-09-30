"use client";

import { useTranslations } from "next-intl";
import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { markAesaFiled, recordClaimOutcome } from "@/app/[locale]/claims/_actions/dashboard";
import { initialFormState } from "@/lib/claims/form-state";

/** The passenger tells us what happened outside AirClaims: they filed with AESA, or the claim ended. */
export function ClaimProgressForms({
  locale,
  claimId,
  canFileAesa,
  today,
}: {
  locale: string;
  claimId: string;
  canFileAesa: boolean;
  today: string;
}) {
  const t = useTranslations("ClaimPath.record");
  return (
    <div className="space-y-3">
      <h2 className="text-sm font-semibold">{t("title")}</h2>
      {canFileAesa && (
        <details className="rounded-lg border p-3">
          <summary className="cursor-pointer text-sm font-medium">{t("aesa.summary")}</summary>
          <AesaForm locale={locale} claimId={claimId} today={today} />
        </details>
      )}
      <details className="rounded-lg border p-3">
        <summary className="cursor-pointer text-sm font-medium">{t("outcome.summary")}</summary>
        <OutcomeForm locale={locale} claimId={claimId} />
      </details>
    </div>
  );
}

function AesaForm({ locale, claimId, today }: { locale: string; claimId: string; today: string }) {
  const t = useTranslations("ClaimPath.record");
  const tw = useTranslations("Wizard");
  const [state, formAction, pending] = useActionState(markAesaFiled.bind(null, locale, claimId), initialFormState);
  return (
    <form action={formAction} className="mt-3 space-y-3">
      <p className="text-sm text-muted-foreground">{t("aesa.body")}</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field id="aesa_filed_on" label={t("aesa.date")} error={state.fieldErrors?.filed_on && t("aesa.dateError")}>
          <Input id="aesa_filed_on" name="filed_on" type="date" max={today} defaultValue={today} required />
        </Field>
        <Field id="aesa_reference" label={t("aesa.reference")} optionalLabel={tw("optional")}>
          <Input id="aesa_reference" name="reference" maxLength={100} />
        </Field>
      </div>
      <Button type="submit" disabled={pending}>{t("aesa.submit")}</Button>
      {state.status === "error" && <p role="alert" className="text-sm text-destructive">{tw("errorSave")}</p>}
    </form>
  );
}

function OutcomeForm({ locale, claimId }: { locale: string; claimId: string }) {
  const t = useTranslations("ClaimPath.record");
  const tw = useTranslations("Wizard");
  const [outcome, setOutcome] = useState("won");
  const [state, formAction, pending] = useActionState(recordClaimOutcome.bind(null, locale, claimId), initialFormState);
  return (
    <form action={formAction} className="mt-3 space-y-3">
      <p className="text-sm text-muted-foreground">{t("outcome.body")}</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field id="claim_outcome" label={t("outcome.label")}>
          <NativeSelect id="claim_outcome" name="outcome" value={outcome} onChange={(e) => setOutcome(e.target.value)}>
            {(["won", "partially_won", "lost"] as const).map((o) => (
              <option key={o} value={o}>{t(`outcome.options.${o}`)}</option>
            ))}
          </NativeSelect>
        </Field>
        {outcome !== "lost" && (
          <Field id="claim_amount" label={t("outcome.amount")} error={state.fieldErrors?.amount && t("outcome.amountError")}>
            <Input id="claim_amount" name="amount" type="number" inputMode="decimal" min={0} max={100000} step="0.01" required />
          </Field>
        )}
      </div>
      <Button type="submit" variant="outline" disabled={pending}>{t("outcome.submit")}</Button>
      {state.status === "error" && <p role="alert" className="text-sm text-destructive">{tw("errorSave")}</p>}
    </form>
  );
}
