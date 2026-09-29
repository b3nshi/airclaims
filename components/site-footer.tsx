import { useTranslations } from "next-intl";

export function SiteFooter() {
  const t = useTranslations("Footer");
  return (
    <footer className="border-t">
      <div className="mx-auto max-w-5xl space-y-1 px-4 py-6 text-xs text-muted-foreground">
        <p>{t("disclaimer")}</p>
        <p>{t("operator")}</p>
      </div>
    </footer>
  );
}
