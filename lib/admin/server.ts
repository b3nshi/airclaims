import "server-only";
import { notFound } from "next/navigation";
import { canEditKnowledge, isAdmin, type Role } from "@/lib/supabase/server";
import { requireUser } from "@/lib/claims/server";

/**
 * Admin pages: signed in and holding the role, else 404 (the area isn't advertised).
 * RLS enforces the same rules in the database.
 */
export async function requireRole(locale: string, returnTo: string, need: "kb_editor" | "admin") {
  const user = await requireUser(locale, returnTo);
  const ok = need === "admin" ? isAdmin(user.roles) : canEditKnowledge(user.roles);
  if (!ok) notFound();
  return user as typeof user & { roles: Role[] };
}

/** One entry per line, trimmed, empty lines dropped. */
export const lines = (value: FormDataEntryValue | null) =>
  String(value ?? "")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
