"use client";

import { useTranslations } from "next-intl";
import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { sendMagicLink, type LoginState } from "./actions";

export function LoginForm({ locale }: { locale: string }) {
  const t = useTranslations("Login");
  const [state, formAction, pending] = useActionState<LoginState, FormData>(
    sendMagicLink.bind(null, locale),
    { status: "idle" },
  );

  if (state.status === "sent") {
    return (
      <div role="status" className="space-y-1">
        <p className="font-medium">{t("sentTitle")}</p>
        <p className="text-sm text-muted-foreground">{t("sentBody")}</p>
      </div>
    );
  }

  const error = state.status === "invalid" ? t("errorInvalid") : state.status === "error" ? t("errorSend") : null;

  return (
    <form action={formAction} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="email">{t("email")}</Label>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          aria-invalid={state.status === "invalid" || undefined}
          aria-describedby={error ? "email-error" : undefined}
        />
        {error && (
          <p id="email-error" className="text-sm text-destructive">
            {error}
          </p>
        )}
      </div>
      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? t("sending") : t("submit")}
      </Button>
    </form>
  );
}
