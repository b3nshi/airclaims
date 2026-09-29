"use client";

import { useTranslations } from "next-intl";
import { useFormStatus } from "react-dom";
import { Link } from "@/i18n/navigation";
import { Button, buttonVariants } from "@/components/ui/button";
import type { FormState } from "@/lib/claims/form-state";

/** Back link + submit button + form-level error for a wizard step. Render inside the <form>. */
export function WizardNav({
  backHref,
  state,
  submitLabel,
  pendingLabel,
}: {
  backHref?: string;
  state?: FormState;
  submitLabel?: string;
  pendingLabel?: string;
}) {
  const t = useTranslations("Wizard");
  const { pending } = useFormStatus();
  return (
    <div className="space-y-3 border-t pt-5">
      {state?.status === "invalid" && <p role="alert" className="text-sm text-destructive">{t("errorInvalid")}</p>}
      {state?.status === "error" && <p role="alert" className="text-sm text-destructive">{t("errorSave")}</p>}
      <div className="flex items-center justify-between gap-3">
        {backHref ? (
          <Link href={backHref} className={buttonVariants({ variant: "ghost" })}>
            {t("back")}
          </Link>
        ) : (
          <span />
        )}
        <Button type="submit" size="lg" disabled={pending}>
          {pending ? (pendingLabel ?? t("saving")) : (submitLabel ?? t("continue"))}
        </Button>
      </div>
    </div>
  );
}
