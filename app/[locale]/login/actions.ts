"use server";

import { hasLocale } from "next-intl";
import { z } from "zod";
import { redirect } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { env } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";

export type LoginState = { status: "idle" | "sent" | "invalid" | "error" };

const emailSchema = z.email().max(254);

export async function sendMagicLink(locale: string, _prev: LoginState, formData: FormData): Promise<LoginState> {
  const parsed = emailSchema.safeParse(String(formData.get("email") ?? "").trim().toLowerCase());
  if (!parsed.success) return { status: "invalid" };
  const lang = hasLocale(routing.locales, locale) ? locale : routing.defaultLocale;

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithOtp({
    email: parsed.data,
    options: {
      emailRedirectTo: `${env.siteUrl}/auth/confirm?next=/${lang}/profile`,
      data: { locale: lang }, // read by handle_new_user() on first sign-in
    },
  });
  // Deliberately no detail: don't reveal provider errors or whether the account exists.
  if (error) return { status: "error" };
  return { status: "sent" };
}

export async function signOut(locale: string) {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect({ href: "/", locale });
}
