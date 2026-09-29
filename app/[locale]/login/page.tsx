import { getTranslations, setRequestLocale } from "next-intl/server";
import { redirect } from "@/i18n/navigation";
import { getCurrentUser } from "@/lib/supabase/server";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { LoginForm } from "./login-form";

export default async function LoginPage({ params, searchParams }: PageProps<"/[locale]/login">) {
  const { locale } = await params;
  setRequestLocale(locale);
  if (await getCurrentUser()) redirect({ href: "/profile", locale });

  const { error } = await searchParams;
  const t = await getTranslations("Login");

  return (
    <div className="mx-auto max-w-sm px-4 py-16">
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">{t("title")}</CardTitle>
          <CardDescription>{t("description")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {error === "link" && (
            <p role="alert" className="text-sm text-destructive">
              {t("errorLink")}
            </p>
          )}
          <LoginForm locale={locale} />
          <p className="text-xs text-muted-foreground">{t("privacy")}</p>
        </CardContent>
      </Card>
    </div>
  );
}
