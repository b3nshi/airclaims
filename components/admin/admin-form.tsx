"use client";

import { useTranslations } from "next-intl";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";
import type { FormState } from "@/lib/claims/form-state";

function Submit({ label, variant }: { label: string; variant?: "default" | "outline" | "destructive" | "ghost" }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" variant={variant} disabled={pending}>
      {label}
    </Button>
  );
}

/** A server-action form with saved / invalid / error feedback. Fields are passed as children. */
export function AdminForm({
  action,
  submitLabel,
  variant,
  className,
  children,
}: {
  action: (prev: FormState, formData: FormData) => Promise<FormState>;
  submitLabel: string;
  variant?: "default" | "outline" | "destructive" | "ghost";
  className?: string;
  children?: React.ReactNode;
}) {
  const t = useTranslations("Admin");
  const [state, formAction] = useActionState(action, { status: "idle" } as FormState);
  return (
    <form action={formAction} className={className ?? "space-y-3"}>
      {children}
      <div className="flex items-center gap-3">
        <Submit label={submitLabel} variant={variant} />
        <p role="status" className="text-xs">
          {state.status === "saved" && <span className="text-muted-foreground">{t("saved")}</span>}
          {state.status === "invalid" && (
            <span className="text-destructive">
              {t("invalid")}
              {state.fieldErrors ? `: ${Object.keys(state.fieldErrors).join(", ")}` : ""}
            </span>
          )}
          {state.status === "error" && <span className="text-destructive">{t("error")}</span>}
        </p>
      </div>
    </form>
  );
}
