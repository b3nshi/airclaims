"use client";

import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { approveEmail, discardEmailDraft, editEmailDraft } from "@/app/[locale]/claims/_actions/dashboard";
import { CopyButton } from "@/components/claims/copy-button";

type Mode = "view" | "edit" | "confirm_send" | "confirm_discard";

/**
 * A draft waiting for the user: read it in full, edit it, discard it, or approve it.
 * Approval is two-step and names the recipient label and the sender alias (principle 2).
 */
export function EmailDraft({
  locale,
  claimId,
  email,
  alias,
  mode: delivery = "send",
}: {
  locale: string;
  claimId: string;
  email: { id: string; subject: string; body: string; recipient: string };
  alias: string;
  // send: an email to approve; paste: a text for the passenger to paste into the airline's form.
  mode?: "send" | "paste";
}) {
  const t = useTranslations("Dashboard");
  const [mode, setMode] = useState<Mode>("view");
  const [subject, setSubject] = useState(email.subject);
  const [body, setBody] = useState(email.body);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const run = (action: () => Promise<{ ok: boolean }>, errorKey: string, after?: () => void) =>
    startTransition(async () => {
      setError(null);
      const res = await action();
      if (!res.ok) setError(t(errorKey));
      else after?.();
    });

  if (mode === "edit") {
    return (
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          run(() => editEmailDraft(locale, claimId, email.id, { subject, body }), "editError", () => setMode("view"));
        }}
      >
        <div className="space-y-1">
          <Label htmlFor={`subject-${email.id}`}>{t("subject")}</Label>
          <Input id={`subject-${email.id}`} value={subject} maxLength={200} required onChange={(e) => setSubject(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label htmlFor={`body-${email.id}`}>{t("body")}</Label>
          <Textarea
            id={`body-${email.id}`}
            value={body}
            maxLength={20000}
            required
            rows={16}
            onChange={(e) => setBody(e.target.value)}
          />
          <p className="text-xs text-muted-foreground">{t("editHint")}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={pending}>{t("saveDraft")}</Button>
          <Button
            type="button"
            variant="ghost"
            disabled={pending}
            onClick={() => {
              setSubject(email.subject);
              setBody(email.body);
              setMode("view");
            }}
          >
            {t("cancel")}
          </Button>
        </div>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      </form>
    );
  }

  return (
    <div className="space-y-3">
      <pre className="max-h-96 overflow-auto rounded-md bg-muted/40 p-3 font-sans text-sm whitespace-pre-wrap [overflow-wrap:anywhere]">{email.body}</pre>

      {mode === "view" && (
        <div className="flex flex-wrap gap-2">
          {delivery === "paste" ? (
            <CopyButton value={email.body} />
          ) : (
            <Button onClick={() => setMode("confirm_send")}>{t("approve")}</Button>
          )}
          <Button variant="outline" onClick={() => setMode("edit")}>{t("edit")}</Button>
          <Button variant="ghost" className="text-muted-foreground" onClick={() => setMode("confirm_discard")}>
            {t("discard")}
          </Button>
        </div>
      )}
      {mode === "view" && delivery === "paste" && <p className="text-xs text-muted-foreground">{t("pasteHint")}</p>}

      {mode === "confirm_send" && (
        <div role="alertdialog" aria-labelledby={`send-${email.id}`} className="space-y-3 rounded-lg border p-3">
          <p id={`send-${email.id}`} className="text-sm">{t("confirmSend", { recipient: email.recipient, alias })}</p>
          <div className="flex flex-wrap gap-2">
            <Button disabled={pending} onClick={() => run(() => approveEmail(locale, claimId, email.id), "approveError")}>
              {t("confirmYes")}
            </Button>
            <Button variant="ghost" disabled={pending} onClick={() => setMode("view")}>{t("cancel")}</Button>
          </div>
        </div>
      )}

      {mode === "confirm_discard" && (
        <div role="alertdialog" aria-labelledby={`discard-${email.id}`} className="space-y-3 rounded-lg border border-destructive/40 p-3">
          <p id={`discard-${email.id}`} className="text-sm">{t("discardConfirm")}</p>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="destructive"
              disabled={pending}
              onClick={() => run(() => discardEmailDraft(locale, claimId, email.id), "discardError")}
            >
              {t("discardYes")}
            </Button>
            <Button variant="ghost" disabled={pending} onClick={() => setMode("view")}>{t("cancel")}</Button>
          </div>
        </div>
      )}

      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
