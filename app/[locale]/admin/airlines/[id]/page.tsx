import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { AdminForm } from "@/components/admin/admin-form";
import { AreaField, CheckField, SelectField, TextField } from "@/components/admin/fields";
import { routing } from "@/i18n/routing";
import { localeName } from "@/lib/locale-name";
import type { AirlineContactRow } from "@/lib/supabase/database.types";
import { createClient } from "@/lib/supabase/server";
import {
  addInsight,
  deleteContact,
  deleteInsight,
  saveContact,
  saveKnowledge,
  setInsightVerified,
  updateAirline,
} from "../../_actions";

const PURPOSES = ["compensation", "expenses", "refund", "baggage", "general", "legal"];
const CHANNELS = ["email", "web_form", "postal", "phone"];
const TOPICS = ["claim_process", "payment_practice", "response_time", "rejection_pattern", "punctuality", "escalation", "tip", "other"];
const RELIABILITY = ["official", "enforcement_body", "competitor", "forum", "own_data"];

const perLocaleLines = (value: unknown, locale: string) => {
  const v = (value ?? {}) as Record<string, string[]>;
  return (v[locale] ?? []).join("\n");
};

function Card({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <section className="space-y-4 rounded-xl border p-5">
      <div>
        <h2 className="font-semibold">{title}</h2>
        {description && <p className="text-sm text-muted-foreground">{description}</p>}
      </div>
      {children}
    </section>
  );
}

export default async function AdminAirline({ params }: PageProps<"/[locale]/admin/airlines/[id]">) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const [t, format, supabase] = await Promise.all([getTranslations("Admin"), getFormatter(), createClient()]);
  const [{ data: airline }, { data: knowledge }, { data: contacts }, { data: insights }] = await Promise.all([
    supabase.from("airlines").select("*").eq("id", id).maybeSingle(),
    supabase.from("airline_knowledge").select("*").eq("airline_id", id).maybeSingle(),
    supabase.from("airline_contacts").select("*").eq("airline_id", id).order("purpose"),
    supabase.from("airline_insights").select("*").eq("airline_id", id).order("observed_on", { ascending: false }),
  ]);
  if (!airline) notFound();
  const date = (d: string | null) => (d ? format.dateTime(new Date(d), { dateStyle: "medium" }) : "—");
  const opts = (values: string[], ns: string) => values.map((v) => ({ value: v, label: t(`${ns}.${v}`) }));

  const contactFields = (c: AirlineContactRow | null) => {
    const sfx = c ? `-${c.id}` : "-new";
    return (
      <>
        <div className="grid gap-3 sm:grid-cols-3">
          <SelectField name="purpose" idSuffix={sfx} label={t("contact.purpose")} defaultValue={c?.purpose ?? "compensation"} options={opts(PURPOSES, "purposes")} />
          <SelectField name="channel" idSuffix={sfx} label={t("contact.channel")} defaultValue={c?.channel ?? "web_form"} options={opts(CHANNELS, "channels")} />
          <SelectField
            name="language"
            idSuffix={sfx}
            label={t("contact.language")}
            defaultValue={c?.language ?? ""}
            options={[{ value: "", label: "—" }, ...["en", "es", "ca", "fr", "de", "it", "pt"].map((l) => ({ value: l, label: l }))]}
          />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <TextField name="label" idSuffix={sfx} label={t("contact.label")} defaultValue={c?.label} hint={t("contact.labelHint")} required />
          <TextField name="value" idSuffix={sfx} label={t("contact.value")} defaultValue={c?.value} hint={t("contact.valueHint")} required />
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          {routing.locales.map((l) => (
            <AreaField
              key={l}
              name={`steps_${l}`}
              idSuffix={sfx}
              rows={6}
              label={`${t("contact.steps")} · ${localeName(l)}`}
              defaultValue={perLocaleLines(c?.submission_steps, l)}
            />
          ))}
        </div>
        <p className="text-xs text-muted-foreground">{t("contact.stepsHint")}</p>
        <AreaField name="notes" idSuffix={sfx} rows={2} label={t("contact.notes")} defaultValue={c?.notes} />
        <CheckField name="mark_verified" label={t("contact.markVerified")} />
      </>
    );
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold">{airline.name}</h2>
        <p className="text-sm text-muted-foreground">{[airline.iata, airline.icao, airline.country_code].filter(Boolean).join(" · ")}</p>
      </div>

      <Card title={t("airline.title")}>
        <AdminForm action={updateAirline.bind(null, locale, id)} submitLabel={t("save")}>
          <div className="grid gap-3 sm:grid-cols-3">
            <TextField name="name" label={t("airline.name")} defaultValue={airline.name} required />
            <TextField name="preferred_language" label={t("airline.language")} defaultValue={airline.preferred_language} hint={t("airline.languageHint")} />
            <TextField name="website" type="url" label={t("airline.website")} defaultValue={airline.website} />
          </div>
          <div className="flex flex-wrap gap-5">
            <CheckField name="is_eu_carrier" label={t("airline.euCarrier")} defaultChecked={airline.is_eu_carrier} />
            <CheckField name="is_active" label={t("airline.active")} defaultChecked={airline.is_active} />
          </div>
          <AreaField name="notes" rows={2} label={t("airline.notes")} defaultValue={airline.notes} />
        </AdminForm>
      </Card>

      <Card title={t("knowledge.title")} description={t("knowledge.description", { date: date(knowledge?.updated_at ?? null) })}>
        <AdminForm action={saveKnowledge.bind(null, locale, id)} submitLabel={t("save")}>
          <div className="grid gap-3 sm:grid-cols-3">
            {routing.locales.map((l) => (
              <AreaField
                key={l}
                name={`tips_${l}`}
                rows={6}
                label={`${t("knowledge.tips")} · ${localeName(l)}`}
                defaultValue={perLocaleLines(knowledge?.passenger_tips, l)}
              />
            ))}
          </div>
          <p className="text-xs text-muted-foreground">{t("knowledge.tipsHint")}</p>
          <AreaField name="drafting_notes" rows={3} label={t("knowledge.drafting")} defaultValue={knowledge?.drafting_notes} hint={t("knowledge.draftingHint")} />
          <AreaField name="claim_form_notes" rows={3} label={t("knowledge.formNotes")} defaultValue={knowledge?.claim_form_notes} hint={t("knowledge.formNotesHint")} />
          <div className="grid gap-3 sm:grid-cols-5">
            <TextField name="stated_reply_days" type="number" label={t("knowledge.statedDays")} defaultValue={knowledge?.stated_reply_days} />
            <TextField name="typical_reply_days_min" type="number" label={t("knowledge.typicalMin")} defaultValue={knowledge?.typical_reply_days_min} />
            <TextField name="typical_reply_days_max" type="number" label={t("knowledge.typicalMax")} defaultValue={knowledge?.typical_reply_days_max} />
            <TextField name="attachments_max_mb" type="number" label={t("knowledge.maxMb")} defaultValue={knowledge?.attachments_max_mb} />
            <SelectField
              name="offers_credit_first"
              label={t("knowledge.creditFirst")}
              defaultValue={knowledge?.offers_credit_first == null ? "unknown" : knowledge.offers_credit_first ? "yes" : "no"}
              options={[
                { value: "unknown", label: t("unknown") },
                { value: "yes", label: t("yes") },
                { value: "no", label: t("no") },
              ]}
            />
          </div>
        </AdminForm>
      </Card>

      <Card title={t("contact.title")} description={t("contact.description")}>
        {(contacts ?? []).map((c) => (
          <details key={c.id} className="rounded-lg border p-3">
            <summary className="cursor-pointer text-sm">
              <span className="font-medium">{c.label}</span>{" "}
              <span className="text-muted-foreground">
                · {t(`channels.${c.channel}`)} · {t(`purposes.${c.purpose}`)} · {t("contact.verifiedOn", { date: date(c.verified_at) })}
              </span>
            </summary>
            <div className="mt-3 space-y-3">
              <AdminForm action={saveContact.bind(null, locale, id, c.id)} submitLabel={t("save")}>
                {contactFields(c)}
              </AdminForm>
              <AdminForm action={deleteContact.bind(null, locale, id, c.id)} submitLabel={t("contact.delete")} variant="ghost" />
            </div>
          </details>
        ))}
        <details className="rounded-lg border border-dashed p-3">
          <summary className="cursor-pointer text-sm font-medium">{t("contact.add")}</summary>
          <div className="mt-3">
            <AdminForm action={saveContact.bind(null, locale, id, null)} submitLabel={t("contact.add")}>
              {contactFields(null)}
            </AdminForm>
          </div>
        </details>
      </Card>

      <Card title={t("insights.title")} description={t("insights.description")}>
        <ul className="divide-y rounded-lg border text-sm">
          {(insights ?? []).map((i) => (
            <li key={i.id} className="space-y-1 p-3">
              <p className="text-xs text-muted-foreground">
                {t(`topics.${i.topic}`)} · {t(`reliability.${i.reliability}`)} · {date(i.observed_on)} ·{" "}
                {i.verified ? t("insights.verified") : t("insights.unverified")}
              </p>
              <p>{i.summary}</p>
              <p className="text-xs">
                {i.source_url ? (
                  <a href={i.source_url} target="_blank" rel="noopener noreferrer" className="underline">{i.source_name}</a>
                ) : (
                  i.source_name
                )}
              </p>
              <div className="flex gap-2">
                <AdminForm
                  action={setInsightVerified.bind(null, locale, i.id, !i.verified)}
                  submitLabel={i.verified ? t("insights.unverify") : t("insights.verify")}
                  variant="outline"
                />
                <AdminForm action={deleteInsight.bind(null, locale, i.id)} submitLabel={t("insights.delete")} variant="ghost" />
              </div>
            </li>
          ))}
        </ul>
        <details className="rounded-lg border border-dashed p-3">
          <summary className="cursor-pointer text-sm font-medium">{t("insights.add")}</summary>
          <div className="mt-3">
            <AdminForm action={addInsight.bind(null, locale, id)} submitLabel={t("insights.add")}>
              <div className="grid gap-3 sm:grid-cols-3">
                <SelectField name="topic" label={t("insights.topic")} options={opts(TOPICS, "topics")} />
                <SelectField name="reliability" label={t("insights.reliability")} options={opts(RELIABILITY, "reliability")} />
                <TextField name="observed_on" type="date" label={t("insights.observedOn")} defaultValue={new Date().toISOString().slice(0, 10)} />
              </div>
              <AreaField name="summary" rows={3} label={t("insights.summary")} hint={t("insights.summaryHint")} />
              <div className="grid gap-3 sm:grid-cols-2">
                <TextField name="source_name" label={t("insights.sourceName")} required />
                <TextField name="source_url" type="url" label={t("insights.sourceUrl")} />
              </div>
              <CheckField name="verified" label={t("insights.verifiedCheck")} />
            </AdminForm>
          </div>
        </details>
      </Card>
    </div>
  );
}
