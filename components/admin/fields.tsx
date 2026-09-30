import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";

// Small server-renderable field helpers for the admin forms.

export function TextField({ name, label, defaultValue, type = "text", hint, required, idSuffix = "" }: {
  name: string; label: string; defaultValue?: string | number | null; type?: string; hint?: string; required?: boolean; idSuffix?: string;
}) {
  const id = `f-${name}${idSuffix}`;
  return (
    <div className="space-y-1">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} name={name} type={type} defaultValue={defaultValue ?? ""} required={required} />
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

export function AreaField({ name, label, defaultValue, rows = 4, hint, idSuffix = "" }: {
  name: string; label: string; defaultValue?: string | null; rows?: number; hint?: string; idSuffix?: string;
}) {
  const id = `f-${name}${idSuffix}`;
  return (
    <div className="space-y-1">
      <Label htmlFor={id}>{label}</Label>
      <Textarea id={id} name={name} rows={rows} defaultValue={defaultValue ?? ""} />
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

export function SelectField({ name, label, defaultValue, options, idSuffix = "" }: {
  name: string; label: string; defaultValue?: string | null; options: { value: string; label: string }[]; idSuffix?: string;
}) {
  const id = `f-${name}${idSuffix}`;
  return (
    <div className="space-y-1">
      <Label htmlFor={id}>{label}</Label>
      <NativeSelect id={id} name={name} defaultValue={defaultValue ?? undefined}>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </NativeSelect>
    </div>
  );
}

export function CheckField({ name, label, defaultChecked }: { name: string; label: string; defaultChecked?: boolean }) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <input type="checkbox" name={name} defaultChecked={defaultChecked} className="size-4" />
      {label}
    </label>
  );
}
