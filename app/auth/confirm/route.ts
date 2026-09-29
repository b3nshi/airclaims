import type { EmailOtpType } from "@supabase/supabase-js";
import { hasLocale } from "next-intl";
import { redirect } from "next/navigation";
import type { NextRequest } from "next/server";
import { routing } from "@/i18n/routing";
import { createClient } from "@/lib/supabase/server";

// Only same-origin, locale-prefixed paths: no open redirects.
function safeNext(next: string | null) {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.includes("\\")) return null;
  const locale = next.split("/")[1];
  return hasLocale(routing.locales, locale) ? { path: next, locale } : null;
}

/**
 * Magic-link landing. Supports both:
 *  - token_hash + type (email template pointing here; works across devices)
 *  - code (PKCE redirect from Supabase's default template; same browser only)
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const next = safeNext(params.get("next"));
  const locale = next?.locale ?? routing.defaultLocale;
  const tokenHash = params.get("token_hash");
  const type = params.get("type") as EmailOtpType | null;
  const code = params.get("code");

  const supabase = await createClient();
  let ok = false;
  if (tokenHash && type) {
    ok = !(await supabase.auth.verifyOtp({ type, token_hash: tokenHash })).error;
  } else if (code) {
    ok = !(await supabase.auth.exchangeCodeForSession(code)).error;
  }

  redirect(ok ? (next?.path ?? `/${locale}/profile`) : `/${locale}/login?error=link`);
}
