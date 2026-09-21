// 1 CART → 2 DELIVERY → 3 PAYMENT. Done = orange, current = ink, upcoming = sand grey.
export function Stepper({ done, current }: { done: number; current: number }) {
  const steps = ["Cart", "Delivery", "Payment"];
  return (
    <ol className="flex items-center gap-3 text-[12px] font-extrabold leading-[1.3] tracking-[0.06em] uppercase md:gap-3.5" aria-label="Checkout steps">
      {steps.map((s, i) => {
        const n = i + 1;
        const state = n <= done ? "done" : n === current ? "current" : "todo";
        const dot = state === "done" ? "bg-orange text-white" : state === "current" ? "bg-ink text-white" : "bg-[#DDD6CC] text-white";
        return (
          <li key={s} className="contents">
            <a href={`#step-${n}`} className={`flex items-center gap-2 ${state === "todo" ? "text-muted-3" : "text-ink"}`} aria-current={state === "current" ? "step" : undefined}>
              <span className={`h-[22px] w-[22px] rounded-full text-center leading-[22px] ${dot}`}>{state === "done" ? "✓" : n}</span>
              <span className="hidden sm:inline">{s}</span>
              <span className="sm:hidden">{s === "Payment" ? "Pay" : s}</span>
            </a>
            {n < steps.length && <span className="h-px flex-1 bg-[#DDD6CC]" aria-hidden />}
          </li>
        );
      })}
    </ol>
  );
}
