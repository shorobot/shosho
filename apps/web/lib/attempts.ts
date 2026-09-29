// Funnel reporting — `rpc('record_order_attempt')` (api-contracts §1.7). The table and the RPC are
// S2-03's; nothing writes to them until the storefront does, so every attempt figure in the Berichte
// screen reads 0 until this module runs.
//
// Two call sites, both one call (S2's spec, /memory/boots/proposed/S3-record-order-attempt.md):
//   1. a rejected `place_order` — the RPC rejects by raising, so the row cannot be written server-side;
//      the client turns the `problems[]` it just received into the row (CheckoutClient).
//   2. a guest sitting on a blocking `problems[]` state from `quote_order` — out of zone, below the
//      minimum, closed, item unavailable (useAttemptReporting, mounted in CartProvider).
//
// PRIVACY. Only what §1.7 lists ever leaves the browser: type, the opaque session id, postal code,
// subtotal, item ids + quantities, problem codes and the promo code. No name, phone, email, street,
// comment or customer id — the table's CHECK constraint would reject them loudly, and it stays that
// way; this module is written so the question never arises.
import type { OrderAttemptPayload, OrderAttemptProblem, OrderType, Problem } from "./types";

const SESSION_KEY = "shosho.session.v1";

/** Problem codes worth a funnel row: the guest is blocked and may well leave. */
const REPORTABLE = new Set<Problem["code"]>(["out_of_zone", "below_min_order", "closed", "unavailable"]);

/**
 * Opaque per-visit id: `sessionStorage` only, so it dies with the tab. Not a cookie, not
 * `localStorage`, not derived from anything about the person — it exists only so the DB can
 * de-duplicate and rate-limit, which is why no consent banner is involved.
 * Returns null when storage is unavailable (private mode); then nothing is reported at all.
 */
export function sessionHash(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const existing = window.sessionStorage.getItem(SESSION_KEY);
    if (existing) return existing;
    const id = typeof crypto?.randomUUID === "function"
      ? crypto.randomUUID()
      : Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join("");
    window.sessionStorage.setItem(SESSION_KEY, id);
    return id;
  } catch {
    return null;
  }
}

/** Strip a `problems[]` array to the five keys §1.7 keeps. */
export function attemptProblems(problems: Problem[] | undefined): OrderAttemptProblem[] {
  return (problems ?? []).map((p) => {
    const out: OrderAttemptProblem = { code: p.code };
    if (p.item_id) out.item_id = p.item_id;
    if (p.reason) out.reason = p.reason;
    if (p.field) out.field = p.field;
    if (p.promo_code) out.promo_code = p.promo_code;
    return out;
  });
}

/**
 * The blocking problems worth reporting. `out_of_zone` with `reason: 'postal_code_missing'` is not a
 * refusal — it is a guest who has not typed a postal code yet, and reporting it would file a row for
 * every visit that ever opened the cart.
 */
export function reportableProblems(problems: Problem[] | undefined): Problem[] {
  return (problems ?? []).filter((p) => REPORTABLE.has(p.code) && !(p.code === "out_of_zone" && p.reason === "postal_code_missing"));
}

/**
 * Stable signature of a problem state — this is what "once per distinct problem state" counts.
 * Order-independent, so a re-quote that returns the same problems in a different order is the same
 * state; `quote_order` runs on every cart change, and 20 rows per session per minute is the ceiling.
 */
export function problemSignature(problems: Problem[]): string {
  return [...problems].map((p) => [p.code, p.reason ?? "", p.item_id ?? ""].join(":")).sort().join("|");
}

export type AttemptInput = {
  type: OrderType;
  problems: Problem[];
  postal_code?: string;
  subtotal_cents?: number;
  items: { item_id: string; qty: number }[];
  promo_code?: string;
};

export function attemptPayload(input: AttemptInput, session_hash: string): OrderAttemptPayload {
  const payload: OrderAttemptPayload = {
    type: input.type,
    session_hash,
    items: input.items.map((i) => ({ item_id: i.item_id, qty: i.qty })),
    problems: attemptProblems(input.problems),
  };
  const postal = input.postal_code?.trim();
  if (postal) payload.postal_code = postal;
  if (input.subtotal_cents != null) payload.subtotal_cents = input.subtotal_cents;
  const promo = input.promo_code?.trim();
  if (promo) payload.promo_code = promo;
  return payload;
}

export type AttemptTracker = {
  /**
   * Report a blocking quote state. Returns the payload it sent, or null when there was nothing
   * reportable, no session id, or this exact state was already recorded for this session.
   */
  consider(input: AttemptInput): OrderAttemptPayload | null;
  /**
   * Report a rejected `place_order`. Always sends (a refusal at the last step is the funnel's whole
   * point), and marks the state seen so `consider` does not file it a second time.
   */
  reject(input: AttemptInput): OrderAttemptPayload | null;
};

/**
 * `send` is fire-and-forget by contract — `recordOrderAttempt` swallows its own errors, and the
 * guest's screen must not depend on telemetry. `seen` is injected so the caller can persist it
 * across a reload (sessionStorage) and so tests can assert the de-duplication.
 */
export function createAttemptTracker(opts: {
  session: () => string | null;
  send: (payload: OrderAttemptPayload) => void;
  seen?: Set<string>;
}): AttemptTracker {
  const seen = opts.seen ?? new Set<string>();

  const fire = (input: AttemptInput, problems: Problem[]): OrderAttemptPayload | null => {
    const session = opts.session();
    if (!session) return null;
    const payload = attemptPayload({ ...input, problems }, session);
    opts.send(payload);
    return payload;
  };

  return {
    consider(input) {
      const problems = reportableProblems(input.problems);
      if (problems.length === 0) return null;
      const sig = problemSignature(problems);
      if (seen.has(sig)) return null;
      seen.add(sig);
      return fire(input, problems);
    },
    reject(input) {
      if (input.problems.length === 0) return null;
      const reportable = reportableProblems(input.problems);
      if (reportable.length > 0) seen.add(problemSignature(reportable));
      return fire(input, input.problems);
    },
  };
}

const SEEN_KEY = "shosho.attempts.v1";

/** The signatures already recorded this visit, kept in sessionStorage so a reload does not re-file them. */
export function loadSeen(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = JSON.parse(window.sessionStorage.getItem(SEEN_KEY) ?? "[]") as unknown;
    return new Set(Array.isArray(raw) ? raw.filter((x): x is string => typeof x === "string") : []);
  } catch {
    return new Set();
  }
}

export function saveSeen(seen: Set<string>): void {
  try {
    window.sessionStorage.setItem(SEEN_KEY, JSON.stringify([...seen].slice(-40)));
  } catch {
    /* private mode */
  }
}
