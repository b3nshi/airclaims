import { getLocale, getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { canEditKnowledge, getCurrentUser } from "@/lib/supabase/server";
import { signOut } from "@/app/[locale]/login/actions";
import { Button, buttonVariants } from "@/components/ui/button";
import { HeaderMenu } from "@/components/header-menu";
import { LocaleSwitcher } from "@/components/locale-switcher";

export async function SiteHeader() {
  const [t, locale, user] = await Promise.all([getTranslations("Header"), getLocale(), getCurrentUser()]);
  const links = user
    ? [
        ...(canEditKnowledge(user.roles) ? [{ href: "/admin", label: t("admin") }] : []),
        { href: "/claims", label: t("claims") },
        { href: "/profile", label: t("profile") },
      ]
    : [];

  return (
    <header className="relative border-b">
      <div className="mx-auto flex h-14 max-w-5xl items-center gap-3 px-4">
        <Link href="/" aria-label={t("home")} className="mr-auto font-semibold tracking-tight">
          AirClaims
        </Link>
        {user ? (
          <>
            <div className="hidden items-center gap-3 sm:flex">
              <LocaleSwitcher />
              {links.map((l) => (
                <Link key={l.href} href={l.href} className={buttonVariants({ variant: "ghost", size: "sm" })}>
                  {l.label}
                </Link>
              ))}
              <form action={signOut.bind(null, locale)}>
                <Button type="submit" variant="outline" size="sm">
                  {t("signOut")}
                </Button>
              </form>
            </div>
            <HeaderMenu links={links} signOut={signOut.bind(null, locale)} />
          </>
        ) : (
          <>
            <LocaleSwitcher />
            <Link href="/login" className={buttonVariants({ size: "sm" })}>
              {t("signIn")}
            </Link>
          </>
        )}
      </div>
    </header>
  );
}
