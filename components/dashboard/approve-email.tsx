"use client";

import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { approveEmail } from "@/app/[locale]/claims/_actions/dashboard";

/** Two-step approval: the user confirms the recipient label and sender before sending. */
export function ApproveEmail({
  locale,
  claimId,
  emailId,
  recipient,
  alias,
}: {
  locale: string;
  claimId: string;
  emailId: string;
  recipient: string;
  alias: string;
}) {
  const t = useTranslations("Dashboard");
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState(false);
  const [pending, startTransition] = useTransition();

  if (!confirming) {
    return <Button onClick={() => setConfirming(true)}>{t("approve")}</Button>;
  }
  return (
    <div role="alertdialog" aria-labelledby={`confirm-${emailId}`} className="space-y-3 rounded-lg border p-3">
      <p id={`confirm-${emailId}`} className="text-sm">
        {t("confirmSend", { recipient, alias })}
      </p>
      <div className="flex flex-wrap gap-2">
        <Button
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              const res = await approveEmail(locale, claimId, emailId);
              if (!res.ok) setError(true);
            })
          }
        >
          {t("confirmYes")}
        </Button>
        <Button variant="ghost" disabled={pending} onClick={() => setConfirming(false)}>
          {t("cancel")}
        </Button>
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {t("approveError")}
        </p>
      )}
    </div>
  );
}
