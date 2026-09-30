import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { buttonVariants } from "@/components/ui/button";
import { requireRole } from "@/lib/admin/server";
import { isAdmin } from "@/lib/supabase/server";

export default async function AdminLayout({ params, children }: LayoutProps<"/[locale]/admin">) {
  const { locale } = await params;
  setRequestLocale(locale);
  const user = await requireRole(locale, "/admin", "kb_editor");
  const t = await getTranslations("Admin");
  const nav = [
    { href: "/admin", label: t("nav.stats") },
    { href: "/admin/airlines", label: t("nav.airlines") },
    ...(isAdmin(user.roles) ? [{ href: "/admin/review", label: t("nav.review") }] : []),
    { href: "/admin/audit", label: t("nav.audit") },
  ];
  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 py-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
        <p className="text-xs text-muted-foreground">{t(isAdmin(user.roles) ? "roleAdmin" : "roleKb")}</p>
      </div>
      <nav className="flex flex-wrap gap-1 border-b pb-2">
        {nav.map((n) => (
          <Link key={n.href} href={n.href} className={buttonVariants({ variant: "ghost", size: "sm" })}>
            {n.label}
          </Link>
        ))}
      </nav>
      {children}
    </div>
  );
}
