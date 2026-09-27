import { beforeAll, describe, expect, it } from "vitest";
import { admin, anon, openAllDay, rpc, signIn, type Db } from "./helpers";

beforeAll(openAllDay);

/**
 * §6.9 rows 1, 2 and 6 — what each role may read of `settings` and `staff`.
 *   public set  (anon + everyone) business, opening_hours, site, payments.enabled, kitchen.status
 *   staff set   (+ every role)    ops
 *   owner/operator only           payments, kitchen
 */
const PUBLIC_KEYS = ["business", "kitchen.status", "opening_hours", "payments.enabled", "site"];
const STAFF_KEYS = [...PUBLIC_KEYS, "ops"].sort();
const PRIVATE_KEYS = ["kitchen", "payments"];

describe("settings key sets", () => {
  let owner: Db, operator: Db, kitchen: Db, driver: Db;
  beforeAll(async () => {
    [owner, operator, kitchen, driver] = await Promise.all([
      signIn("owner"), signIn("operator"), signIn("kitchen"), signIn("driver"),
    ]);
  });

  it("anon still sees the public set only", async () => {
    const { data } = await anon().from("settings").select("key");
    expect(data!.map((s) => s.key).sort()).toEqual(PUBLIC_KEYS);
  });

  it("kitchen and driver see the public set plus `ops`, never `payments` or `kitchen`", async () => {
    for (const [role, c] of [["kitchen", kitchen], ["driver", driver]] as const) {
      const { data, error } = await c.from("settings").select("key");
      expect(error, role).toBeNull();
      expect(data!.map((s) => s.key).sort(), role).toEqual(STAFF_KEYS);
      for (const k of PRIVATE_KEYS) {
        const { data: priv } = await c.from("settings").select("key, value").eq("key", k);
        expect(priv, `${role} must not read ${k}`).toEqual([]);
      }
    }
  });

  it("kitchen reads the ops values it was blocked on (prep minutes, rush extra, pre-order window)", async () => {
    const { data } = await kitchen.from("settings").select("value").eq("key", "ops").single();
    expect(data!.value).toMatchObject({ prep_default_min: 22, rush_extra_min: 15, preorder_max_days: 7 });
  });

  it("owner and operator still read every key", async () => {
    for (const [role, c] of [["owner", owner], ["operator", operator]] as const) {
      const { data } = await c.from("settings").select("key");
      const keys = data!.map((s) => s.key);
      for (const k of [...STAFF_KEYS, ...PRIVATE_KEYS]) expect(keys, `${role} / ${k}`).toContain(k);
    }
  });

  it("neither role may write settings (owner only)", async () => {
    for (const [role, c] of [["kitchen", kitchen], ["driver", driver], ["operator", operator]] as const) {
      const { data } = await c.from("settings").update({ value: { hacked: true } }).eq("key", "ops").select();
      expect(data ?? [], role).toEqual([]);
    }
    const { data: still } = await admin().from("settings").select("value").eq("key", "ops").single();
    expect(still!.value).toMatchObject({ prep_default_min: 22 });
  });
});

describe("staff_directory view", () => {
  it("every staff role reads id, name, role, active for the whole team", async () => {
    for (const role of ["owner", "operator", "kitchen", "driver"] as const) {
      const c = await signIn(role);
      const { data, error } = await c.from("staff_directory").select("*").order("role");
      expect(error, role).toBeNull();
      expect(data!.length, role).toBe(4);
      expect(Object.keys(data![0]).sort(), role).toEqual(["active", "id", "name", "role"]);
      expect(data!.map((s) => s.name), role).toContain("Jonas M.");
    }
  });

  it("the view cannot be asked for phone (or anything else on `staff`)", async () => {
    const kitchen = await signIn("kitchen");
    const { error } = await kitchen.from("staff_directory").select("id, phone");
    expect(error).not.toBeNull();          // 42703 undefined_column — the view has four columns
    expect(error!.message.toLowerCase()).toContain("phone");
  });

  it("the base table still hides phone from kitchen and driver", async () => {
    for (const role of ["kitchen", "driver"] as const) {
      const c = await signIn(role);
      const { data } = await c.from("staff").select("id, phone");
      expect(data!.length, role).toBe(1);   // own row only, unchanged by S2-03
      const other = data!.find((s) => s.id !== (role === "kitchen"
        ? "10000000-0000-4000-8000-000000000003"
        : "10000000-0000-4000-8000-000000000004"));
      expect(other, `${role} sees another staff row`).toBeUndefined();
    }
  });

  it("anon sees nothing", async () => {
    const { data, error } = await anon().from("staff_directory").select("*");
    // the anon grant is revoked, so this is either an error or an empty set — never a row
    expect(error ? [] : data).toEqual([]);
  });
});

describe("kitchen capacity (§6.9 row 6)", () => {
  it("settings['kitchen.status'].capacity defaults to 8 and is readable by every role", async () => {
    for (const c of [anon(), await signIn("kitchen"), await signIn("driver")]) {
      const { data } = await c.from("settings").select("value").eq("key", "kitchen.status").single();
      expect(data!.value).toMatchObject({ capacity: 8 });
    }
  });

  it("kitchen_pause keeps the capacity (it merges instead of replacing the value)", async () => {
    const operator = await signIn("operator");
    await admin().from("settings").update({ value: { paused: false, since: null, capacity: 12 } }).eq("key", "kitchen.status");
    try {
      const { data: paused } = await rpc(operator, "kitchen_pause", { paused: true });
      expect(paused).toMatchObject({ paused: true, capacity: 12 });
      const { data: resumed } = await rpc(operator, "kitchen_pause", { paused: false });
      expect(resumed).toMatchObject({ paused: false, capacity: 12 });
    } finally {
      await admin().from("settings").update({ value: { paused: false, since: null, capacity: 8 } }).eq("key", "kitchen.status");
    }
  });

  it("kitchen_pause refuses a non-staff caller (NULL role must not pass the gate)", async () => {
    const { error } = await rpc(anon(), "kitchen_pause", { paused: true });
    expect(error).not.toBeNull();   // execute is revoked from anon (migration 18) — 404/403, never a pause
    const { data: status } = await anon().from("settings").select("value").eq("key", "kitchen.status").single();
    expect(status!.value).toMatchObject({ paused: false });
  });
});
