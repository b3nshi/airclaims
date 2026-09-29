"use client";

import { useTranslations } from "next-intl";
import { useActionState } from "react";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { signAndSubmit } from "@/app/[locale]/claims/_actions/submit";
import { initialFormState } from "@/lib/claims/form-state";
import type { LegalBlock } from "@/lib/legal/render";
import { WizardNav } from "./wizard-nav";

type Doc = { kind: "terms_of_service" | "privacy_notice" | "email_authorization"; title: string; sha256: string; blocks: LegalBlock[] };

export function SignForm({ locale, claimId, leadName, docs }: { locale: string; claimId: string; leadName: string; docs: Doc[] }) {
  const t = useTranslations("Sign");
  const [state, formAction] = useActionState(signAndSubmit.bind(null, locale, claimId), initialFormState);
  const err = (k: string) => state.fieldErrors?.[k];

  return (
    <form action={formAction} className="space-y-6">
      {state.status === "changed" && (
        <p role="alert" className="rounded-lg border border-destructive/40 p-3 text-sm text-destructive">
          {t("changed")}
        </p>
      )}
      {docs.map((doc) => (
        <section key={doc.kind} className="space-y-3">
          <input type="hidden" name={`hash_${doc.kind}`} value={doc.sha256} />
          <div
            tabIndex={0}
            aria-label={doc.title}
            className="max-h-64 space-y-2 overflow-y-auto rounded-lg border bg-muted/30 p-4 text-sm leading-relaxed"
          >
            {doc.blocks.map((b, i) =>
              b.type === "h1" ? (
                <h2 key={i} className="text-base font-semibold">{b.text}</h2>
              ) : b.type === "h2" ? (
                <h3 key={i} className="pt-2 font-medium">{b.text}</h3>
              ) : b.type === "li" ? (
                <p key={i} className="pl-4 before:-ml-3 before:mr-1.5 before:content-['•']">{b.text}</p>
              ) : (
                <p key={i}>{b.text}</p>
              ),
            )}
          </div>
          <label className="flex items-start gap-2 text-sm font-medium">
            <input
              type="checkbox"
              name={`accept_${doc.kind}`}
              required
              className="mt-0.5 size-4"
              aria-invalid={err(`accept_${doc.kind}`) || undefined}
            />
            {t(`accept.${doc.kind}`)}
          </label>
        </section>
      ))}

      <Field
        id="signed_name"
        label={t("signedName")}
        hint={t("signedNameHint", { name: leadName })}
        error={err("signed_name") && t("signedNameHint", { name: leadName })}
        className="sm:max-w-md"
      >
        <Input
          id="signed_name"
          name="signed_name"
          required
          autoComplete="name"
          aria-invalid={err("signed_name") || undefined}
          aria-describedby={err("signed_name") ? "signed_name-error" : "signed_name-hint"}
        />
      </Field>

      <WizardNav
        backHref={`/claims/${claimId}/review`}
        state={state}
        submitLabel={t("submit")}
        pendingLabel={t("submitting")}
      />
    </form>
  );
}
