"use client";

import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { withdrawClaim } from "@/app/[locale]/claims/_actions/dashboard";

export function WithdrawClaim({ locale, claimId }: { locale: string; claimId: string }) {
  const t = useTranslations("Dashboard");
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState(false);
  const [pending, startTransition] = useTransition();

  if (!confirming) {
    return (
      <Button variant="ghost" className="text-muted-foreground" onClick={() => setConfirming(true)}>
        {t("withdraw")}
      </Button>
    );
  }
  return (
    <div role="alertdialog" aria-labelledby="withdraw-confirm" className="space-y-3 rounded-lg border border-destructive/40 p-3">
      <p id="withdraw-confirm" className="text-sm">{t("withdrawConfirm")}</p>
      <div className="flex gap-2">
        <Button
          variant="destructive"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              const res = await withdrawClaim(locale, claimId);
              if (!res.ok) setError(true);
            })
          }
        >
          {t("withdrawYes")}
        </Button>
        <Button variant="ghost" disabled={pending} onClick={() => setConfirming(false)}>
          {t("cancel")}
        </Button>
      </div>
      {error && <p role="alert" className="text-sm text-destructive">{t("withdrawError")}</p>}
    </div>
  );
}
