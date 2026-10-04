import * as React from "react";
import { cn } from "@/lib/utils";
import { fieldHint, fieldLabel } from "@/lib/ui";

/**
 * Label + control + optional hint, stacked. The one form-field pattern.
 * Put the hint only when it adds information the label doesn't (units, constraints).
 *
 *   <Field label="Move time" hint="ms" htmlFor="move-time">
 *     <Input id="move-time" type="number" ... />
 *   </Field>
 */
function Field({
  label,
  hint,
  htmlFor,
  className,
  children
}: {
  label: React.ReactNode;
  hint?: React.ReactNode;
  htmlFor?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("grid min-w-0 gap-1.5", className)}>
      <label
        htmlFor={htmlFor}
        className={cn(fieldLabel, "flex items-baseline justify-between gap-2")}
      >
        <span>{label}</span>
        {hint ? <span className={cn(fieldHint, "font-normal")}>{hint}</span> : null}
      </label>
      {children}
    </div>
  );
}

/**
 * Horizontal setting: label (+ optional one-line description) on the left, control on the right.
 * Use for toggles and compact selects in Settings and Review settings.
 *
 *   <SettingRow label="Move sounds" control={<Switch checked={on} onCheckedChange={set} />} />
 */
function SettingRow({
  label,
  description,
  control,
  htmlFor,
  className
}: {
  label: React.ReactNode;
  description?: React.ReactNode;
  control: React.ReactNode;
  htmlFor?: string;
  className?: string;
}) {
  return (
    <div className={cn("flex min-h-10 items-center justify-between gap-4 py-1.5", className)}>
      <div className="grid min-w-0 gap-0.5">
        <label htmlFor={htmlFor} className="text-sm text-fg-secondary">
          {label}
        </label>
        {description ? <p className="text-xs leading-5 text-fg-subtle">{description}</p> : null}
      </div>
      <div className="flex shrink-0 items-center gap-2">{control}</div>
    </div>
  );
}

export { Field, SettingRow };
