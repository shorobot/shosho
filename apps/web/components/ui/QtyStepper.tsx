"use client";

// Inset pill with two round knobs. `accent` = orange "+" (cart rows), otherwise both knobs white (product page).
export function QtyStepper({
  value,
  onChange,
  min = 0,
  max,
  size = "md",
  accent = false,
  label = "Quantity",
}: {
  value: number;
  onChange: (next: number) => void;
  min?: number;
  max?: number | null;
  size?: "sm" | "md";
  accent?: boolean;
  label?: string;
}) {
  const knob = size === "sm" ? "h-6 w-6 text-[14px] leading-6" : "h-[34px] w-[34px] text-[18px] leading-[34px]";
  const pad = size === "sm" ? "gap-2 p-[5px]" : "gap-3 p-2";
  const num = size === "sm" ? "min-w-[10px] text-[13px]" : "min-w-[14px] text-[16px]";
  const canDec = value > min;
  const canInc = max == null || value < max;
  return (
    <div className={`inline-flex items-center rounded-full bg-field shadow-(--shadow-inset-sm) ${pad}`} role="group" aria-label={label}>
      <button
        type="button"
        aria-label="Decrease"
        disabled={!canDec}
        onClick={() => onChange(value - 1)}
        className={`rounded-full bg-paper text-center font-medium text-ink-2 shadow-(--shadow-knob) transition-micro disabled:opacity-40 ${knob}`}
      >
        −
      </button>
      <span className={`text-center font-extrabold tabular-nums ${num}`} aria-live="polite">
        {value}
      </span>
      <button
        type="button"
        aria-label="Increase"
        disabled={!canInc}
        onClick={() => onChange(value + 1)}
        className={`rounded-full text-center transition-micro disabled:opacity-40 ${knob} ${
          accent ? "bg-orange font-extrabold text-white" : "bg-paper font-medium text-ink-2 shadow-(--shadow-knob)"
        }`}
      >
        +
      </button>
    </div>
  );
}
