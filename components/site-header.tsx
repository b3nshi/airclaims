import { getLocale, getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { getCurrentUser } from "@/lib/supabase/server";
import { signOut } from "@/app/[locale]/login/actions";
import { Button, buttonVariants } from "@/components/ui/button";
import { LocaleSwitcher } from "@/components/locale-switcher";

export async function SiteHeader() {
  const [t, locale, user] = await Promise.all([getTranslations("Header"), getLocale(), getCurrentUser()]);

  return (
    <header className="border-b">
      <div className="mx-auto flex h-14 max-w-5xl items-center gap-3 px-4">
        <Link href="/" aria-label={t("home")} className="mr-auto font-semibold tracking-tight">
          AirClaims
        </Link>
        <LocaleSwitcher />
        {user ? (
          <>
            <Link href="/profile" className={buttonVariants({ variant: "ghost", size: "sm" })}>
              {t("profile")}
            </Link>
            <form action={signOut.bind(null, locale)}>
              <Button type="submit" variant="outline" size="sm">
                {t("signOut")}
              </Button>
            </form>
          </>
        ) : (
          <Link href="/login" className={buttonVariants({ size: "sm" })}>
            {t("signIn")}
          </Link>
        )}
      </div>
    </header>
  );
}
