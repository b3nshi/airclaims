"use client";

import { useId, useRef, useState, useTransition } from "react";
import { Input } from "@/components/ui/input";
import { searchAirports, type AirportOption } from "@/app/[locale]/claims/_actions/flight";

export type AirportValue = { iata: string; label: string };

type Props = {
  id: string;
  name: string;
  value: AirportValue | null;
  onChange: (value: AirportValue | null) => void;
  placeholder: string;
  invalid?: boolean;
  describedBy?: string;
};

const optionLabel = (a: AirportOption) => `${a.city || a.name} (${a.iata})`;

/** Airport combobox: type a city, name or IATA code; submits the IATA code. */
export function AirportField({ id, name, value, onChange, placeholder, invalid, describedBy }: Props) {
  const listId = useId();
  const [text, setText] = useState(value?.label ?? "");
  const [options, setOptions] = useState<AirportOption[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [, startTransition] = useTransition();
  const debounce = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Show the label when the parent sets a value (e.g. from the flight lookup).
  // Clearing (value → null while typing) must keep what the user typed.
  const [prevValue, setPrevValue] = useState(value);
  if (value !== prevValue) {
    setPrevValue(value);
    if (value) setText(value.label);
  }

  function search(q: string) {
    clearTimeout(debounce.current);
    debounce.current = setTimeout(() => {
      startTransition(async () => {
        const results = await searchAirports(q);
        setOptions(results);
        setActive(results.length ? 0 : -1);
        setOpen(results.length > 0);
      });
    }, 200);
  }

  function choose(a: AirportOption) {
    onChange({ iata: a.iata, label: optionLabel(a) });
    setText(optionLabel(a));
    setOpen(false);
  }

  return (
    <div className="relative">
      <input type="hidden" name={name} value={value?.iata ?? ""} />
      <Input
        id={id}
        role="combobox"
        autoComplete="off"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open && active >= 0 ? `${listId}-${active}` : undefined}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        placeholder={placeholder}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          onChange(null);
          if (e.target.value.trim().length >= 2) search(e.target.value);
          else setOpen(false);
        }}
        onKeyDown={(e) => {
          if (!open) return;
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setActive((i) => Math.min(i + 1, options.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((i) => Math.max(i - 1, 0));
          } else if (e.key === "Enter" && active >= 0) {
            e.preventDefault();
            choose(options[active]);
          } else if (e.key === "Escape") {
            setOpen(false);
          }
        }}
        onBlur={() => {
          setTimeout(() => setOpen(false), 150);
          // A bare 3-letter code is accepted as-is; the server checks it exists.
          const code = text.trim().toUpperCase();
          if (!value && /^[A-Z]{3}$/.test(code)) onChange({ iata: code, label: code });
        }}
      />
      {open && (
        <ul
          id={listId}
          role="listbox"
          className="absolute z-10 mt-1 max-h-64 w-full overflow-auto rounded-lg border bg-popover p-1 text-sm shadow-md"
        >
          {options.map((a, i) => (
            <li
              key={a.iata}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              className={`cursor-pointer rounded-md px-2 py-1.5 ${i === active ? "bg-muted" : ""}`}
              onMouseDown={(e) => {
                e.preventDefault();
                choose(a);
              }}
              onMouseEnter={() => setActive(i)}
            >
              <span className="font-medium">{optionLabel(a)}</span>
              <span className="block truncate text-xs text-muted-foreground">
                {a.name} · {a.country_code}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
