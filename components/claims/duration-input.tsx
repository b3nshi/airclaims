"use client";

import { useTranslations } from "next-intl";
import { Input } from "@/components/ui/input";

/** Hours + minutes pair, submitted as `${name}_hours` / `${name}_minutes`. */
export function DurationInput({
  id,
  name,
  defaultHours,
  defaultMinutes,
  invalid,
  describedBy,
}: {
  id: string;
  name: string;
  defaultHours: string;
  defaultMinutes: string;
  invalid?: boolean;
  describedBy?: string;
}) {
  const t = useTranslations("Wizard");
  return (
    <div className="flex items-center gap-2" role="group" aria-describedby={describedBy}>
      <Input
        id={id}
        name={`${name}_hours`}
        type="number"
        inputMode="numeric"
        min={0}
        max={96}
        defaultValue={defaultHours}
        aria-label={t("hours")}
        aria-invalid={invalid || undefined}
        className="w-20"
      />
      <span className="text-sm text-muted-foreground">{t("hours")}</span>
      <Input
        name={`${name}_minutes`}
        type="number"
        inputMode="numeric"
        min={0}
        max={59}
        defaultValue={defaultMinutes}
        aria-label={t("minutes")}
        aria-invalid={invalid || undefined}
        className="w-20"
      />
      <span className="text-sm text-muted-foreground">{t("minutes")}</span>
    </div>
  );
}
