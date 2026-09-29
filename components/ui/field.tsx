import * as React from "react";
import { cn } from "@/lib/utils";
import { Label } from "./label";

type FieldProps = {
  id: string;
  label: React.ReactNode;
  hint?: React.ReactNode;
  error?: React.ReactNode;
  optionalLabel?: string;
  className?: string;
  children: React.ReactNode;
};

/** Label + control + hint/error, with the ids wired for aria-describedby. */
function Field({ id, label, hint, error, optionalLabel, className, children }: FieldProps) {
  return (
    <div className={cn("space-y-2", className)}>
      <Label htmlFor={id}>
        {label}
        {optionalLabel && <span className="font-normal text-muted-foreground">({optionalLabel})</span>}
      </Label>
      {children}
      {error ? (
        <p id={`${id}-error`} className="text-xs text-destructive">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="text-xs text-muted-foreground">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

function describedBy(id: string, { hint, error }: { hint?: unknown; error?: unknown }) {
  return error ? `${id}-error` : hint ? `${id}-hint` : undefined;
}

export { Field, describedBy };
