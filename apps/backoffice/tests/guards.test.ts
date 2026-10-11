// Route guards for /website and /marketing (boot task 10).
//
// WHY THE GUARD AND NOT JUST THE RLS. S4-03 found that a write a row policy does not admit comes
// back `{ data: [], error: null }` — RLS filters rows, it does not raise. So a kitchen session that
// somehow reached these screens would see empty panels and silent no-op saves rather than a refusal.
// The route check is what actually keeps them out; the RLS is the backstop. This file therefore
// tests the thing that holds: the real page/layout modules, called with a real session, asserting
// where each role is sent.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StaffRole } from "@/lib/types";

/** The session the mocked Supabase server client will report. */
const state = vi.hoisted(() => ({
  user: null as { id: string; email: string } | null,
  staff: null as { id: string; name: string; role: string; active: boolean } | null,
}));

/** `redirect()` throws in Next so the caller never continues; the mock copies that contract. */
class Redirected extends Error {
  constructor(public to: string) {
    super(`redirect:${to}`);
  }
}

vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Redirected(to);
  },
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: state.user } }) },
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: state.staff }) }),
      }),
    }),
  }),
}));

function signIn(role: StaffRole | null, { active = true }: { active?: boolean } = {}) {
  if (role === null) {
    state.user = null;
    state.staff = null;
    return;
  }
  state.user = { id: "u1", email: `${role}@shosho.test` };
  state.staff = { id: "u1", name: "Test", role, active };
}

/** Call a server component / layout and report where it redirected, or `null` if it rendered. */
async function landing(fn: () => Promise<unknown>): Promise<string | null> {
  try {
    await fn();
    return null;
  } catch (e) {
    if (e instanceof Redirected) return e.to;
    throw e;
  }
}

/**
 * The two guarded entry points, by the module that actually carries the guard. A layout is called
 * with its `children` prop; the page takes none, and an extra prop is harmless.
 */
type Entry = { name: string; load: () => Promise<{ default: (props: { children: null }) => Promise<unknown> }> };
const ENTRIES: Entry[] = [
  { name: "/website page", load: () => import("@/app/(shell)/website/page") },
  { name: "/marketing layout", load: () => import("@/app/(shell)/marketing/layout") },
];

beforeEach(() => {
  signIn(null);
});

describe.each(ENTRIES)("$name", ({ load }) => {
  it("refuses a kitchen session and sends it to its own board", async () => {
    signIn("kitchen");
    const mod = await load();
    expect(await landing(() => mod.default({ children: null }))).toBe("/kitchen");
  });

  it("refuses a driver session and sends it to its own board", async () => {
    signIn("driver");
    const mod = await load();
    expect(await landing(() => mod.default({ children: null }))).toBe("/driver");
  });

  it("admits the owner", async () => {
    signIn("owner");
    const mod = await load();
    expect(await landing(() => mod.default({ children: null }))).toBeNull();
  });

  it("admits an operator — they stage edits; publishing is owner-only and enforced in the RPC", async () => {
    signIn("operator");
    const mod = await load();
    expect(await landing(() => mod.default({ children: null }))).toBeNull();
  });

  it("sends an anonymous visitor to the login", async () => {
    signIn(null);
    const mod = await load();
    expect(await landing(() => mod.default({ children: null }))).toBe("/login");
  });

  it("sends a signed-in user with no staff row to no-access", async () => {
    state.user = { id: "u9", email: "stranger@example.test" };
    state.staff = null;
    const mod = await load();
    expect(await landing(() => mod.default({ children: null }))).toBe("/no-access");
  });

  it("treats a DEACTIVATED owner as no staff at all", async () => {
    // getSession() nulls the staff row when `active` is false, so a disabled account cannot walk
    // back in through a role check that only looked at `role`.
    signIn("owner", { active: false });
    const mod = await load();
    expect(await landing(() => mod.default({ children: null }))).toBe("/no-access");
  });
});

describe("the campaign wizard route is behind the same gate", () => {
  it("inherits the /marketing layout's guard rather than carrying its own", async () => {
    // The wizard page renders a client component and has no guard of its own by design: in the App
    // Router a segment layout runs before every page beneath it. This asserts the structure that
    // makes that true, so moving the page out of the segment would fail here rather than silently
    // publishing an unguarded route.
    const page = await import("@/app/(shell)/marketing/campaign/[id]/page");
    expect(typeof page.default).toBe("function");
    const layout = await import("@/app/(shell)/marketing/layout");
    signIn("kitchen");
    expect(await landing(() => layout.default({ children: null }))).toBe("/kitchen");
  });
});

describe("homeFor — where a refused role lands", () => {
  it("never sends kitchen or driver to an operator screen", async () => {
    const { homeFor } = await import("@/lib/auth");
    expect(homeFor("kitchen")).toBe("/kitchen");
    expect(homeFor("driver")).toBe("/driver");
    expect(homeFor("owner")).toBe("/orders");
    expect(homeFor("operator")).toBe("/orders");
  });
});
