"use client";

// The form vocabulary the Artikel editor and the dialogs share: caps label + inset field, the
// switch row, a section card and the money input that speaks cents but shows euros.
import { useEffect, useState, type ReactNode } from "react";

export function Section({ title, hint, children, right }: { title: ReactNode; hint?: ReactNode; children: ReactNode; right?: ReactNode }) {
  return (
    <section className="card flex flex-col gap-3.5 rounded-[18px] p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-[15px] font-extrabold">{title}</h2>
        {hint && <span className="text-[11px] text-muted">{hint}</span>}
        {right}
      </div>
      {children}
    </section>
  );
}

export function Label({ children }: { children: ReactNode }) {
  return <span className="label-caps">{children}</span>;
}

export function Row({ children, cols = 2 }: { children: ReactNode; cols?: 1 | 2 | 3 | 4 }) {
  const c = { 1: "sm:grid-cols-1", 2: "sm:grid-cols-2", 3: "sm:grid-cols-3", 4: "sm:grid-cols-4" }[cols];
  return <div className={`grid grid-cols-1 gap-3 ${c}`}>{children}</div>;
}

export function TextField({
  label, value, onChange, placeholder, hint, error, kana = false, disabled = false, maxLength,
}: {
  label: ReactNode; value: string; onChange: (v: string) => void; placeholder?: string; hint?: ReactNode; error?: ReactNode; kana?: boolean; disabled?: boolean; maxLength?: number;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <Label>{label}</Label>
      <input
        className={`field ${kana ? "kana" : ""}`}
        value={value}
        placeholder={placeholder}
        disabled={disabled}
        maxLength={maxLength}
        onChange={(e) => onChange(e.target.value)}
      />
      {error ? <span className="text-[11px] font-extrabold text-alert">{error}</span> : hint ? <span className="text-[11px] leading-[1.4] text-muted">{hint}</span> : null}
    </label>
  );
}

export function TextArea({ label, value, onChange, placeholder, rows = 3, disabled = false }: { label: ReactNode; value: string; onChange: (v: string) => void; placeholder?: string; rows?: number; disabled?: boolean }) {
  return (
    <label className="flex flex-col gap-1.5">
      <Label>{label}</Label>
      <textarea className="field resize-y" rows={rows} value={value} placeholder={placeholder} disabled={disabled} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

export function Select<T extends string>({ label, value, onChange, options, disabled = false }: { label?: ReactNode; value: T; onChange: (v: T) => void; options: { value: T; label: ReactNode }[]; disabled?: boolean }) {
  return (
    <label className="flex flex-col gap-1.5">
      {label && <Label>{label}</Label>}
      <select className="field appearance-none pr-8" value={value} disabled={disabled} onChange={(e) => onChange(e.target.value as T)}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {typeof o.label === "string" ? o.label : String(o.value)}
          </option>
        ))}
      </select>
    </label>
  );
}

/** Integer field that stays empty when the value is null ("Unbegrenzt"). */
export function NumberField({
  label, value, onChange, placeholder, suffix, min = 0, disabled = false,
}: {
  label: ReactNode; value: number | null; onChange: (v: number | null) => void; placeholder?: string; suffix?: string; min?: number; disabled?: boolean;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <Label>{label}</Label>
      <span className="relative block">
        <input
          type="number"
          inputMode="numeric"
          min={min}
          className="field"
          value={value ?? ""}
          placeholder={placeholder}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value === "" ? null : Math.max(min, Math.trunc(Number(e.target.value) || 0)))}
        />
        {suffix && <span className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-[11px] text-muted">{suffix}</span>}
      </span>
    </label>
  );
}

/** Money in integer cents; the operator types "14,90". Local string state so a half-typed
    "14," is not rewritten under the cursor. */
export function MoneyField({ label, cents, onChange, nullable = false, disabled = false }: { label: ReactNode; cents: number | null; onChange: (c: number | null) => void; nullable?: boolean; disabled?: boolean }) {
  const [text, setText] = useState(() => centsToText(cents));
  useEffect(() => {
    setText((prev) => (textToCents(prev) === cents ? prev : centsToText(cents)));
  }, [cents]);
  return (
    <label className="flex flex-col gap-1.5">
      <Label>{label}</Label>
      <span className="relative block">
        <input
          className="field pr-8"
          inputMode="decimal"
          value={text}
          disabled={disabled}
          placeholder={nullable ? "—" : "0,00"}
          onChange={(e) => {
            const raw = e.target.value.replace(/[^0-9.,]/g, "");
            setText(raw);
            const parsed = textToCents(raw);
            onChange(parsed == null && nullable ? null : (parsed ?? 0));
          }}
        />
        <span className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-[12px] text-muted">€</span>
      </span>
    </label>
  );
}

export function centsToText(cents: number | null | undefined): string {
  if (cents == null) return "";
  return (cents / 100).toFixed(2).replace(".", ",");
}

export function textToCents(text: string): number | null {
  const t = text.trim().replace(",", ".");
  if (!t) return null;
  const n = Number(t);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100);
}

export function Switch({ checked, onChange, label, hint, disabled = false }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode; hint?: ReactNode; disabled?: boolean }) {
  return (
    <label className={`flex items-start gap-3 ${disabled ? "opacity-60" : "cursor-pointer"}`}>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={`mt-0.5 h-[22px] w-[38px] flex-none rounded-full p-[3px] transition-micro ${checked ? "bg-ok" : "bg-field shadow-(--shadow-inset)"}`}
      >
        <span className={`block h-4 w-4 rounded-full bg-paper shadow-(--shadow-pill) transition-micro ${checked ? "translate-x-4" : ""}`} />
      </button>
      <span className="flex flex-col gap-0.5">
        <span className="text-[13px] font-extrabold leading-[1.3]">{label}</span>
        {hint && <span className="text-[11px] leading-[1.4] text-muted">{hint}</span>}
      </span>
    </label>
  );
}

/** Multi-select chips — allergens, tags, weekdays. */
export function Chips<T extends string | number>({ values, selected, onToggle, render, disabled = false }: { values: readonly T[]; selected: T[]; onToggle: (v: T) => void; render: (v: T) => ReactNode; disabled?: boolean }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {values.map((v) => {
        const on = selected.includes(v);
        return (
          <button
            key={String(v)}
            type="button"
            disabled={disabled}
            aria-pressed={on}
            onClick={() => onToggle(v)}
            className={`rounded-full px-3 py-1.5 text-[11px] leading-[1.3] transition-micro ${on ? "bg-ink font-extrabold text-cream" : "bg-field font-medium text-ink-2 hover:text-ink"}`}
          >
            {render(v)}
          </button>
        );
      })}
    </div>
  );
}
