"use client";

// The field vocabulary in components/menu/Fields.tsx has no date input — banners, promo codes and
// campaign schedules all need one. Kept here rather than added to the menu's file so the screens
// S6 is testing right now are untouched.
import type { ReactNode } from "react";
import { Label } from "@/components/menu/Fields";
import { isoToLocalInput, localInputToIso } from "@/lib/datetime";

/**
 * A timestamptz as a local date+time. `value` and `onChange` speak ISO instants; the input speaks
 * Europe/Berlin wall time (lib/datetime.ts). Emptying it yields `null`.
 */
export function DateTimeField({
  label, value, onChange, hint, error, disabled = false, min,
}: {
  label: ReactNode;
  value: string | null;
  onChange: (iso: string | null) => void;
  hint?: ReactNode;
  error?: ReactNode;
  disabled?: boolean;
  min?: string | null;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <Label>{label}</Label>
      <input
        type="datetime-local"
        className="field"
        value={isoToLocalInput(value)}
        min={min ? isoToLocalInput(min) : undefined}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value ? localInputToIso(e.target.value) : null)}
      />
      {error ? <span className="text-[11px] font-extrabold text-alert">{error}</span> : hint ? <span className="text-[11px] leading-[1.4] text-muted">{hint}</span> : null}
    </label>
  );
}
