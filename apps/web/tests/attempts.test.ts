import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  attemptPayload,
  attemptProblems,
  createAttemptTracker,
  problemSignature,
  reportableProblems,
  sessionHash,
} from "@/lib/attempts";
import type { AttemptInput } from "@/lib/attempts";
import type { OrderAttemptPayload, Problem } from "@/lib/types";

const base: AttemptInput = {
  type: "delivery",
  problems: [],
  postal_code: "99999",
  subtotal_cents: 1490,
  items: [{ item_id: "item-1", qty: 2 }],
};

function trackerWith(seen = new Set<string>()) {
  const sent: OrderAttemptPayload[] = [];
  const tracker = createAttemptTracker({ session: () => "sess-1", seen, send: (p) => sent.push(p) });
  return { tracker, sent };
}

describe("reportableProblems", () => {
  it("keeps the four states that mean the guest is blocked", () => {
    const problems: Problem[] = [
      { code: "out_of_zone", postal_code: "99999" },
      { code: "below_min_order" },
      { code: "closed", reason: "outside_hours" },
      { code: "unavailable", item_id: "item-1" },
    ];
    expect(reportableProblems(problems)).toHaveLength(4);
  });

  it("ignores the ones that are not a refusal", () => {
    expect(reportableProblems([{ code: "promo_invalid" }, { code: "empty_cart" }, { code: "invalid_input", field: "contact.name" }, { code: "invalid_options" }])).toEqual([]);
  });

  it("ignores a missing postal code — that is a guest still typing, not a refusal", () => {
    expect(reportableProblems([{ code: "out_of_zone", reason: "postal_code_missing" }])).toEqual([]);
    expect(reportableProblems([{ code: "out_of_zone", reason: "not_covered" }])).toHaveLength(1);
  });

  it("handles undefined", () => {
    expect(reportableProblems(undefined)).toEqual([]);
  });
});

describe("problemSignature", () => {
  it("is order-independent, so a re-quote is the same state", () => {
    const a: Problem[] = [{ code: "unavailable", item_id: "i1" }, { code: "below_min_order" }];
    const b: Problem[] = [{ code: "below_min_order" }, { code: "unavailable", item_id: "i1" }];
    expect(problemSignature(a)).toBe(problemSignature(b));
  });

  it("separates different items and different reasons", () => {
    expect(problemSignature([{ code: "unavailable", item_id: "i1" }])).not.toBe(problemSignature([{ code: "unavailable", item_id: "i2" }]));
    expect(problemSignature([{ code: "closed", reason: "outside_hours" }])).not.toBe(problemSignature([{ code: "closed", reason: "kitchen_paused" }]));
  });
});

describe("attempt payload — PII-free by construction", () => {
  it("sends only the keys §1.7 defines", () => {
    const payload = attemptPayload({ ...base, problems: [{ code: "out_of_zone" }], promo_code: "WELCOME10" }, "sess-1");
    expect(Object.keys(payload).sort()).toEqual(["items", "postal_code", "problems", "promo_code", "session_hash", "subtotal_cents", "type"]);
  });

  it("strips everything from a problem but code / item_id / reason / field / promo_code", () => {
    const problems: Problem[] = [{ code: "below_min_order", min_order_cents: 1500, subtotal_cents: 1490, postal_code: "10115" }];
    expect(attemptProblems(problems)).toEqual([{ code: "below_min_order" }]);
  });

  it("reduces cart lines to item_id + qty, dropping option ids", () => {
    const payload = attemptPayload({ ...base, problems: [{ code: "closed" }], items: [{ item_id: "i1", qty: 3 }] }, "s");
    expect(payload.items).toEqual([{ item_id: "i1", qty: 3 }]);
  });

  it("omits an empty postal code and promo instead of sending blanks", () => {
    const payload = attemptPayload({ ...base, postal_code: "  ", promo_code: "  ", problems: [] }, "s");
    expect(payload.postal_code).toBeUndefined();
    expect(payload.promo_code).toBeUndefined();
  });
});

describe("attempt tracker — once per state, not per render", () => {
  it("fires once and then stays quiet for the same state", () => {
    const { tracker, sent } = trackerWith();
    const input = { ...base, problems: [{ code: "out_of_zone" } as Problem] };
    expect(tracker.consider(input)).not.toBeNull();
    expect(tracker.consider(input)).toBeNull();
    expect(tracker.consider(input)).toBeNull();
    expect(sent).toHaveLength(1);
  });

  it("treats a re-quote returning the same problems in another order as the same state", () => {
    const { tracker, sent } = trackerWith();
    tracker.consider({ ...base, problems: [{ code: "below_min_order" }, { code: "unavailable", item_id: "i1" }] });
    tracker.consider({ ...base, problems: [{ code: "unavailable", item_id: "i1" }, { code: "below_min_order" }] });
    expect(sent).toHaveLength(1);
  });

  it("fires again when the guest reaches a genuinely different state", () => {
    const { tracker, sent } = trackerWith();
    tracker.consider({ ...base, problems: [{ code: "out_of_zone" }] });
    tracker.consider({ ...base, problems: [{ code: "below_min_order" }] });
    expect(sent).toHaveLength(2);
  });

  it("ignores states that are not a refusal, however often they come back", () => {
    const { tracker, sent } = trackerWith();
    for (let i = 0; i < 20; i++) tracker.consider({ ...base, problems: [{ code: "promo_invalid" }] });
    expect(sent).toEqual([]);
  });

  it("records nothing at all without a session id (private mode)", () => {
    const sent: OrderAttemptPayload[] = [];
    const tracker = createAttemptTracker({ session: () => null, send: (p) => sent.push(p) });
    expect(tracker.consider({ ...base, problems: [{ code: "out_of_zone" }] })).toBeNull();
    expect(sent).toEqual([]);
  });

  it("carries a seen-set across a reload, so the same state is not re-filed", () => {
    const seen = new Set<string>();
    const first = trackerWith(seen);
    first.tracker.consider({ ...base, problems: [{ code: "closed", reason: "outside_hours" }] });
    const afterReload = createAttemptTracker({ session: () => "sess-1", seen, send: () => { throw new Error("must not re-file"); } });
    expect(afterReload.consider({ ...base, problems: [{ code: "closed", reason: "outside_hours" }] })).toBeNull();
  });
});

describe("attempt tracker — a rejected place_order", () => {
  it("always records, even for problems the quote side would ignore", () => {
    const { tracker, sent } = trackerWith();
    const payload = tracker.reject({ ...base, problems: [{ code: "invalid_input", field: "contact.phone" }] });
    expect(payload).not.toBeNull();
    expect(sent).toHaveLength(1);
    expect(sent[0]?.problems).toEqual([{ code: "invalid_input", field: "contact.phone" }]);
  });

  it("sends the whole problems[] the server rejected with, not just the blocking ones", () => {
    const { sent, tracker } = trackerWith();
    tracker.reject({ ...base, problems: [{ code: "unavailable", item_id: "i1" }, { code: "empty_cart" }] });
    expect(sent[0]?.problems).toHaveLength(2);
  });

  it("stops the quote side from filing the same state a second time", () => {
    const { tracker, sent } = trackerWith();
    const problems: Problem[] = [{ code: "unavailable", item_id: "i1" }];
    tracker.reject({ ...base, problems });
    expect(tracker.consider({ ...base, problems })).toBeNull();
    expect(sent).toHaveLength(1);
  });

  it("does nothing when there is nothing to report", () => {
    const { tracker, sent } = trackerWith();
    expect(tracker.reject({ ...base, problems: [] })).toBeNull();
    expect(sent).toEqual([]);
  });
});

describe("sessionHash", () => {
  beforeEach(() => window.sessionStorage.clear());

  it("is opaque, stable for the visit, and lives only in sessionStorage", () => {
    const first = sessionHash();
    expect(first).toMatch(/^[0-9a-f-]{16,}$/);
    expect(sessionHash()).toBe(first);
    expect(window.localStorage.getItem("shosho.session.v1")).toBeNull();
    expect(document.cookie).not.toContain(first!);
  });

  it("returns null rather than throwing when storage is blocked", () => {
    const spy = vi.spyOn(window.sessionStorage.__proto__, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(sessionHash()).toBeNull();
    spy.mockRestore();
  });
});
