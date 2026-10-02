"use client";

import { MenuIcon, XIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Link } from "@/i18n/navigation";
import { Button, buttonVariants } from "@/components/ui/button";
import { LocaleSwitcher } from "@/components/locale-switcher";

/** Phones: the signed-in links, language and sign-out collapse into one menu (they don't fit in a row). */
export function HeaderMenu({
  links,
  signOut,
}: {
  links: { href: string; label: string }[];
  signOut: () => Promise<void>;
}) {
  const t = useTranslations("Header");
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);

  return (
    <div className="sm:hidden" onKeyDown={(e) => e.key === "Escape" && close()}>
      <Button
        variant="ghost"
        size="icon"
        aria-label={t(open ? "closeMenu" : "menu")}
        aria-expanded={open}
        aria-controls="header-menu"
        onClick={() => setOpen(!open)}
      >
        {open ? <XIcon /> : <MenuIcon />}
      </Button>
      {open && (
        <div id="header-menu" className="absolute inset-x-0 top-14 z-40 border-b bg-background shadow-md">
          <nav className="mx-auto flex max-w-5xl flex-col gap-1 px-4 py-3">
            {links.map((l) => (
              <Link key={l.href} href={l.href} onClick={close} className={buttonVariants({ variant: "ghost", className: "justify-start" })}>
                {l.label}
              </Link>
            ))}
            <div className="flex items-center justify-between gap-3 border-t pt-3">
              <LocaleSwitcher />
              <form action={signOut}>
                <Button type="submit" variant="outline" size="sm">
                  {t("signOut")}
                </Button>
              </form>
            </div>
          </nav>
        </div>
      )}
    </div>
  );
}
