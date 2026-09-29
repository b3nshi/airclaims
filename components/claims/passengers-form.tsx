"use client";

import { useTranslations } from "next-intl";
import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { savePassengers } from "@/app/[locale]/claims/_actions/details";
import { initialFormState } from "@/lib/claims/form-state";
import { WizardNav } from "./wizard-nav";

type Passenger = { key: number; full_name: string; is_infant_free: boolean };
const MAX = 9;

export function PassengersForm({
  locale,
  claimId,
  initial,
}: {
  locale: string;
  claimId: string;
  initial: { full_name: string; is_infant_free: boolean }[];
}) {
  const t = useTranslations("Passengers");
  const [state, formAction] = useActionState(savePassengers.bind(null, locale, claimId), initialFormState);
  const [list, setList] = useState<Passenger[]>(() => initial.map((p, key) => ({ key, ...p })));
  const [nextKey, setNextKey] = useState(initial.length);
  const update = (key: number, patch: Partial<Passenger>) =>
    setList((l) => l.map((p) => (p.key === key ? { ...p, ...patch } : p)));

  return (
    <form action={formAction} className="space-y-6">
      <input
        type="hidden"
        name="passengers"
        value={JSON.stringify(list.map(({ full_name, is_infant_free }) => ({ full_name, is_infant_free })))}
      />
      <ol className="space-y-4">
        {list.map((p, i) => {
          const invalid = state.fieldErrors?.[`p${i}`];
          const id = `pax-${p.key}`;
          return (
            <li key={p.key} className="space-y-3 rounded-lg border p-4">
              <Field
                id={id}
                label={i === 0 ? t("lead") : t("passengerN", { n: i + 1 })}
                error={invalid && (i === 0 && p.is_infant_free ? t("errorLeadFree") : t("fullName"))}
              >
                <Input
                  id={id}
                  required
                  autoComplete={i === 0 ? "name" : "off"}
                  value={p.full_name}
                  onChange={(e) => update(p.key, { full_name: e.target.value })}
                  aria-invalid={invalid || undefined}
                />
              </Field>
              {i > 0 && (
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <label className="flex items-start gap-2 text-sm">
                    <input
                      type="checkbox"
                      className="mt-0.5 size-4"
                      checked={p.is_infant_free}
                      onChange={(e) => update(p.key, { is_infant_free: e.target.checked })}
                      aria-describedby="free-ticket-hint"
                    />
                    {t("freeTicket")}
                  </label>
                  <Button type="button" variant="ghost" size="sm" onClick={() => setList((l) => l.filter((x) => x.key !== p.key))}>
                    {t("remove")}
                  </Button>
                </div>
              )}
            </li>
          );
        })}
      </ol>
      <p id="free-ticket-hint" className="text-xs text-muted-foreground">
        {t("freeTicketHint")}
      </p>
      {list.length < MAX && (
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            setList((l) => [...l, { key: nextKey, full_name: "", is_infant_free: false }]);
            setNextKey((k) => k + 1);
          }}
        >
          {t("add")}
        </Button>
      )}
      <WizardNav backHref={`/claims/${claimId}/disruption`} state={state} />
    </form>
  );
}
