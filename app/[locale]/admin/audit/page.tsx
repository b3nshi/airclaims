import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import type { Json } from "@/lib/supabase/database.types";
import { createClient } from "@/lib/supabase/server";

// Fields that changed between before/after (inserts and deletes show all fields).
function changes(before: Json | null, after: Json | null): { key: string; from: string; to: string }[] {
  const b = (before ?? {}) as Record<string, unknown>;
  const a = (after ?? {}) as Record<string, unknown>;
  const show = (v: unknown) => (v === undefined || v === null ? "—" : typeof v === "string" ? v : JSON.stringify(v));
  return [...new Set([...Object.keys(b), ...Object.keys(a)])]
    .filter((k) => !["updated_at", "created_at"].includes(k) && JSON.stringify(b[k]) !== JSON.stringify(a[k]))
    .map((k) => ({ key: k, from: show(b[k]), to: show(a[k]) }));
}

export default async function AdminAudit({ params }: PageProps<"/[locale]/admin/audit">) {
  const { locale } = await params;
  setRequestLocale(locale);
  const [t, format, supabase] = await Promise.all([getTranslations("Admin"), getFormatter(), createClient()]);
  // RLS: kb editors see knowledge-base changes; admins see everything.
  const { data, error } = await supabase.from("admin_audit_log").select("*").order("created_at", { ascending: false }).limit(200);
  if (error) throw error;

  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-lg font-semibold">{t("audit.title")}</h2>
        <p className="text-sm text-muted-foreground">{t("audit.description")}</p>
      </div>
      <ul className="divide-y rounded-lg border text-sm">
        {(data ?? []).map((row) => (
          <li key={row.id} className="space-y-1 p-3">
            <p className="text-xs text-muted-foreground">
              {format.dateTime(new Date(row.created_at), { dateStyle: "medium", timeStyle: "short" })} · {row.table_name} · {row.action} ·{" "}
              {row.actor_id ? row.actor_id.slice(0, 8) : t("audit.system")}
            </p>
            <ul className="space-y-0.5">
              {changes(row.before, row.after).slice(0, 12).map((c) => (
                <li key={c.key} className="break-words">
                  <span className="font-medium">{c.key}</span>: <span className="text-muted-foreground line-through">{c.from.slice(0, 200)}</span> → {c.to.slice(0, 200)}
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </section>
  );
}
