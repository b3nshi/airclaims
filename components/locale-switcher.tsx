"use client";

import { useLocale, useTranslations } from "next-intl";
import { useTransition } from "react";
import { usePathname, useRouter } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { localeName } from "@/lib/locale-name";

export function LocaleSwitcher() {
  const t = useTranslations("LocaleSwitcher");
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const [isPending, startTransition] = useTransition();

  return (
    <select
      aria-label={t("label")}
      value={locale}
      disabled={isPending}
      onChange={(e) => startTransition(() => router.replace(pathname, { locale: e.target.value }))}
      className="h-7 rounded-md border border-input bg-transparent px-1.5 text-sm"
    >
      {routing.locales.map((l) => (
        <option key={l} value={l}>
          {localeName(l)}
        </option>
      ))}
    </select>
  );
}
