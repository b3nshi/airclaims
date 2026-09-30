import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { env } from "@/lib/env";
import type { Database } from "./database.types";

// Anon-key client bound to the user's session: every query goes through RLS.
export async function createClient() {
  const cookieStore = await cookies();
  return createServerClient<Database>(env.supabaseUrl, env.supabaseAnonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // Called from a Server Component (read-only cookies); proxy.ts refreshes the session.
        }
      },
    },
  });
}

export type Role = "admin" | "kb_editor";

/**
 * Verified JWT claims of the signed-in user, or null. Roles come from app_metadata, which
 * only the service role can set; the database enforces them again through RLS.
 */
export async function getCurrentUser() {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  if (error || !data) return null;
  const meta = (data.claims.app_metadata ?? {}) as { roles?: unknown };
  const roles = (Array.isArray(meta.roles) ? meta.roles : []).filter(
    (r): r is Role => r === "admin" || r === "kb_editor",
  );
  return { id: data.claims.sub, email: data.claims.email as string | undefined, roles };
}

/** kb_editor can curate airline knowledge; admin can do that and handle the review queue. */
export const canEditKnowledge = (roles: Role[]) => roles.includes("kb_editor") || roles.includes("admin");
export const isAdmin = (roles: Role[]) => roles.includes("admin");
