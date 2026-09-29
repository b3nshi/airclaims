"use client";

import { useTranslations } from "next-intl";
import { useActionState } from "react";
import { routing } from "@/i18n/routing";
import { localeName } from "@/lib/locale-name";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { updateProfile, type ProfileState } from "./actions";

type Props = {
  locale: string;
  profile: { full_name: string | null; personal_email: string | null; preferred_locale: string };
};

export function ProfileForm({ locale, profile }: Props) {
  const t = useTranslations("Profile");
  const [state, formAction, pending] = useActionState<ProfileState, FormData>(
    updateProfile.bind(null, locale),
    { status: "idle" },
  );
  const invalid = (field: keyof NonNullable<ProfileState["fieldErrors"]>) => state.fieldErrors?.[field] || undefined;

  return (
    <form action={formAction} className="space-y-5">
      <div className="space-y-2">
        <Label htmlFor="full_name">{t("fullName")}</Label>
        <Input
          id="full_name"
          name="full_name"
          autoComplete="name"
          required
          defaultValue={profile.full_name ?? ""}
          aria-invalid={invalid("full_name")}
          aria-describedby="full_name-hint"
        />
        <p id="full_name-hint" className="text-xs text-muted-foreground">
          {t("fullNameHint")}
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="personal_email">{t("personalEmail")}</Label>
        <Input
          id="personal_email"
          name="personal_email"
          type="email"
          autoComplete="email"
          required
          defaultValue={profile.personal_email ?? ""}
          aria-invalid={invalid("personal_email")}
          aria-describedby="personal_email-hint"
        />
        <p id="personal_email-hint" className="text-xs text-muted-foreground">
          {t("personalEmailHint")}
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="preferred_locale">{t("locale")}</Label>
        <select
          id="preferred_locale"
          name="preferred_locale"
          defaultValue={profile.preferred_locale}
          aria-invalid={invalid("preferred_locale")}
          className="h-8 w-full rounded-lg border border-input bg-transparent px-2 text-sm"
        >
          {routing.locales.map((l) => (
            <option key={l} value={l}>
              {localeName(l)}
            </option>
          ))}
        </select>
      </div>

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? t("saving") : t("save")}
        </Button>
        <p role="status" className="text-sm">
          {state.status === "saved" && <span className="text-muted-foreground">{t("saved")}</span>}
          {state.status === "invalid" && <span className="text-destructive">{t("errorInvalid")}</span>}
          {state.status === "error" && <span className="text-destructive">{t("errorSave")}</span>}
        </p>
      </div>
    </form>
  );
}
