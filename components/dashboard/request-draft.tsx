"use client";

import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { requestEmailDraft } from "@/app/[locale]/claims/_actions/dashboard";

export function RequestDraft({
  locale,
  claimId,
  template,
}: {
  locale: string;
  claimId: string;
  template: "initial_claim" | "follow_up" | "offer_reply";
}) {
  const t = useTranslations("Dashboard");
  const [result, setResult] = useState<"requested" | "unavailable" | null>(null);
  const [pending, startTransition] = useTransition();

  if (result === "requested") return <p role="status" className="text-sm">{t("draftRequested")}</p>;
  return (
    <div className="space-y-2">
      <Button
        variant={template === "initial_claim" ? "outline" : "default"}
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const res = await requestEmailDraft(locale, claimId, template);
            setResult(res.ok ? "requested" : "unavailable");
          })
        }
      >
        {t(template === "follow_up" ? "prepareReminder" : template === "offer_reply" ? "prepareOfferReply" : "prepareEmail")}
      </Button>
      {result === "unavailable" && <p role="alert" className="text-sm text-destructive">{t("draftUnavailable")}</p>}
    </div>
  );
}
