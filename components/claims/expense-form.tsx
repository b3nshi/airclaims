"use client";

import { useTranslations } from "next-intl";
import { useActionState, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { addExpense } from "@/app/[locale]/claims/_actions/details";
import { initialFormState, type FormState } from "@/lib/claims/form-state";
import { DocumentUploader } from "./document-uploader";

const CATEGORIES = ["ground_transport", "meal", "hotel", "phone", "rebooking", "other"] as const;
const CURRENCIES = ["EUR", "GBP", "CHF", "USD", "DKK", "SEK", "NOK", "PLN", "CZK", "HUF", "RON", "MAD", "TRY"];

export function ExpenseForm({ locale, claimId, userId }: { locale: string; claimId: string; userId: string }) {
  const t = useTranslations("Expenses");
  const tw = useTranslations("Wizard");
  const [promised, setPromised] = useState(false);
  const [receiptId, setReceiptId] = useState("");
  const form = useRef<HTMLFormElement>(null);
  const [state, formAction, pending] = useActionState(async (prev: FormState, formData: FormData) => {
    const result = await addExpense(locale, claimId, prev, formData);
    if (result.status === "saved") {
      form.current?.reset();
      setPromised(false);
      setReceiptId("");
    }
    return result;
  }, initialFormState);
  const err = (k: string) => state.fieldErrors?.[k];

  return (
    <form ref={form} action={formAction} className="space-y-4 rounded-lg border p-4">
      <input type="hidden" name="document_id" value={receiptId} />
      <div className="grid gap-4 sm:grid-cols-3">
        <Field id="category" label={t("category")}>
          <NativeSelect id="category" name="category" defaultValue="meal">
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {t(`categories.${c}`)}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field id="amount" label={t("amount")} error={err("amount") && tw("errorInvalid")}>
          <Input id="amount" name="amount" inputMode="decimal" required aria-invalid={err("amount") || undefined} />
        </Field>
        <Field id="currency" label={t("currency")}>
          <NativeSelect id="currency" name="currency" defaultValue="EUR">
            {CURRENCIES.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </NativeSelect>
        </Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field id="spent_at" label={t("date")} optionalLabel={tw("optional")}>
          <Input id="spent_at" name="spent_at" type="date" />
        </Field>
        <Field id="description" label={t("descriptionLabel")} optionalLabel={tw("optional")} className="sm:col-span-2">
          <Input id="description" name="description" maxLength={300} />
        </Field>
      </div>
      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          name="airline_promised"
          className="mt-0.5 size-4"
          checked={promised}
          onChange={(e) => setPromised(e.target.checked)}
        />
        {t("promised")}
      </label>
      {promised && (
        <Field id="promise_details" label={t("promiseDetails")}>
          <Textarea id="promise_details" name="promise_details" maxLength={1000} />
        </Field>
      )}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-1">
          <p className="text-sm font-medium">{t("receipt")}</p>
          {receiptId ? (
            <p className="text-sm text-muted-foreground">{t("receiptAttached")}</p>
          ) : (
            <DocumentUploader locale={locale} claimId={claimId} userId={userId} docType="receipt" onUploaded={setReceiptId} />
          )}
        </div>
        <Button type="submit" variant="secondary" disabled={pending}>
          {t("add")}
        </Button>
      </div>
      <p role="status" className="text-sm">
        {state.status === "saved" && <span className="text-muted-foreground">{t("added")}</span>}
        {state.status === "invalid" && <span className="text-destructive">{tw("errorInvalid")}</span>}
        {state.status === "error" && <span className="text-destructive">{tw("errorSave")}</span>}
      </p>
    </form>
  );
}
