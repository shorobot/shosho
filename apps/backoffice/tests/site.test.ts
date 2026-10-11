// BO · Website logic (api-contracts §8.6 / §8.7). The cases here are the ones where a mistake would
// be invisible: a draft that leaks to the storefront, a counter that disagrees with what publishing
// would do, a banner whose state does not match what `banners_live` returns.
import { describe, expect, it } from "vitest";
import {
  BANNERS_LIVE_COLUMNS, BANNER_FIELDS, SETTINGS_ANON_COLUMNS, UNSTAGEABLE_CLEARS, ZONES_ARE_STAGED,
  bannerDraftPatch, bannerState, bannerStoredPath, formatPostalCodes, hasPendingDraft, hoursLabel,
  jsonEqual, leaksDraft, liveBanner, liveBanners, mergeBannerDraft, nextImageIndex, nextSortInSlot,
  parseHm, parsePostalCodes, pendingChanges, publicationSize, publicationSummary, publishResult,
  publishResultSize, settingsDraftFor, siteObjectKeyOf, validateHours,
  type BannerDraftShape, type BannerRow, type SettingsRow,
} from "@/lib/site";
import type { Json } from "@/lib/types";

const NOW = new Date("2026-10-11T12:00:00Z");

function banner(over: Partial<BannerRow> = {}): BannerRow {
  return {
    id: "b1",
    slot: "home_hero",
    image_path: null,
    title_de: "Signature Set",
    title_en: null,
    subtitle_de: null,
    subtitle_en: null,
    cta_label_de: null,
    cta_label_en: null,
    cta_href: null,
    valid_from: null,
    valid_to: null,
    sort: 0,
    active: true,
    draft: null,
    created_at: "2026-10-01T00:00:00Z",
    updated_at: "2026-10-01T00:00:00Z",
    ...over,
  } as BannerRow;
}

function setting(key: string, value: Json, draft: Json | null = null): SettingsRow {
  return { key, value, draft, created_at: "2026-10-01T00:00:00Z", updated_at: "2026-10-01T00:00:00Z" } as SettingsRow;
}

/* ================================================================ the anon surface (task 1) */

describe("the draft column never reaches an anon-readable surface", () => {
  it("SETTINGS_ANON_COLUMNS mirrors the migration's column grant and omits draft", () => {
    // migration 32: `grant select (key, value, created_at, updated_at) on public.settings to anon`
    expect([...SETTINGS_ANON_COLUMNS]).toEqual(["key", "value", "created_at", "updated_at"]);
    expect(SETTINGS_ANON_COLUMNS).not.toContain("draft");
  });

  it("banners_live's column list omits draft, and every editable banner field is accounted for", () => {
    expect(BANNERS_LIVE_COLUMNS).not.toContain("draft");
    // The view deliberately does not expose the three gating columns — its WHERE already applied them.
    for (const gate of ["active", "valid_from", "valid_to"]) {
      expect(BANNERS_LIVE_COLUMNS).not.toContain(gate);
    }
    // Everything else a banner carries IS in the view, so the storefront is not missing content.
    for (const f of BANNER_FIELDS) {
      if (["active", "valid_from", "valid_to"].includes(f)) continue;
      expect(BANNERS_LIVE_COLUMNS).toContain(f);
    }
  });

  it("leaksDraft refuses both the named column and a star select", () => {
    expect(leaksDraft(SETTINGS_ANON_COLUMNS)).toBe(false);
    expect(leaksDraft(BANNERS_LIVE_COLUMNS)).toBe(false);
    expect(leaksDraft(["key", "value", "draft"])).toBe(true);
    // `select *` is the realistic way this gets re-opened — a new column added without thought.
    expect(leaksDraft(["*"])).toBe(true);
  });
});

/* ================================================================ settings drafts (§8.7) */

describe("settings draft is a full replacement, and a no-op edit stages nothing", () => {
  it("stages the complete value when it differs", () => {
    expect(settingsDraftFor({ a: 1 }, { a: 2 })).toEqual({ a: 2 });
  });

  it("stages null when the edit lands back on the live value", () => {
    // Otherwise an edit-and-undo would leave a pending change and publishing would record a
    // change that is not one.
    expect(settingsDraftFor({ a: 1 }, { a: 1 })).toBeNull();
  });

  it("is not fooled by key order or nesting", () => {
    expect(jsonEqual({ a: 1, b: { c: 2, d: 3 } }, { b: { d: 3, c: 2 }, a: 1 })).toBe(true);
    expect(settingsDraftFor({ b: 2, a: 1 }, { a: 1, b: 2 })).toBeNull();
    // Arrays are order-sensitive, which is right: opening hours are ordered.
    expect(jsonEqual([1, 2], [2, 1])).toBe(false);
  });

  it("treats an explicit JSON null as a value, not as absence", () => {
    expect(jsonEqual(null, {})).toBe(false);
    expect(hasPendingDraft(setting("site", {}, null))).toBe(false);
    expect(hasPendingDraft(setting("site", {}, {}))).toBe(true);
  });
});

/* ================================================================ the pending counter (§8.7) */

describe("the unpublished-changes counter", () => {
  it("counts exactly the rows publish_site() would touch — those with a non-null draft", () => {
    const settings = [setting("business", { a: 1 }), setting("site", { a: 1 }, { a: 2 })];
    const banners = [banner({ id: "b1" }), banner({ id: "b2", draft: { title_de: "Neu" } })];
    const pending = pendingChanges(settings, banners);
    expect(pending).toHaveLength(2);
    expect(pending).toEqual([
      { kind: "setting", key: "site" },
      { kind: "banner", id: "b2", name: "Neu" },
    ]);
  });

  it("is zero when nothing is staged", () => {
    expect(pendingChanges([setting("site", { a: 1 })], [banner()])).toEqual([]);
  });

  it("names a staged banner by its DRAFT title, which is what publishing will make live", () => {
    const rows = [banner({ id: "b3", title_de: "Alt", draft: { title_de: "Neu" } })];
    expect(pendingChanges([], rows)[0]).toEqual({ kind: "banner", id: "b3", name: "Neu" });
  });
});

/* ================================================================ banner draft merge (§8.6) */

describe("mergeBannerDraft mirrors publish_site()'s coalesce semantics", () => {
  it("a key present in the draft wins", () => {
    const m = mergeBannerDraft(banner({ title_de: "Alt", draft: { title_de: "Neu" } }));
    expect(m.title_de).toBe("Neu");
  });

  it("a key ABSENT from the draft keeps the live value", () => {
    const m = mergeBannerDraft(banner({ title_de: "Alt", subtitle_de: "Sub", draft: { title_de: "Neu" } }));
    expect(m.subtitle_de).toBe("Sub");
  });

  it("a key explicitly JSON null also keeps the live value — `draft->>'x'` is null either way", () => {
    const m = mergeBannerDraft(banner({ title_de: "Alt", draft: { title_de: null } }));
    expect(m.title_de).toBe("Alt");
  });

  it("carries booleans and numbers, including a staged `active: false`", () => {
    const m = mergeBannerDraft(banner({ active: true, sort: 0, draft: { active: false, sort: 7 } }));
    expect(m.active).toBe(false);
    expect(m.sort).toBe(7);
  });

  it("ignores a slot value that is not a real enum member", () => {
    const m = mergeBannerDraft(banner({ slot: "product", draft: { slot: "nonsense" } }));
    expect(m.slot).toBe("product");
  });

  it("liveBanner deliberately ignores the draft — it is what the storefront sees", () => {
    const row = banner({ title_de: "Alt", active: false, draft: { title_de: "Neu", active: true } });
    expect(liveBanner(row).title_de).toBe("Alt");
    expect(liveBanner(row).active).toBe(false);
  });
});

/* ================================================================ banner draft patch */

describe("bannerDraftPatch stages the minimum, and refuses what publish_site() would choke on", () => {
  const shapeOf = (row: BannerRow, over: Partial<BannerDraftShape> = {}): BannerDraftShape => ({ ...mergeBannerDraft(row), ...over });

  it("is null when nothing changed", () => {
    const row = banner();
    expect(bannerDraftPatch(row, shapeOf(row))).toEqual({ patch: null, clears: [] });
  });

  it("carries only the changed fields", () => {
    const row = banner({ title_de: "Alt", subtitle_de: "Sub" });
    const { patch } = bannerDraftPatch(row, shapeOf(row, { title_de: "Neu" }));
    expect(patch).toEqual({ title_de: "Neu" });
  });

  it("diffs against the LIVE column, so editing back to the live value drops out of the patch", () => {
    // The row already has a pending draft; the operator types the live value back in. If the patch
    // were computed against the draft, the field would stay "pending" forever.
    const row = banner({ title_de: "Alt", draft: { title_de: "Zwischen" } });
    const { patch } = bannerDraftPatch(row, shapeOf(row, { title_de: "Alt" }));
    expect(patch).toBeNull();
  });

  it("stages a cleared TEXT field as an empty string", () => {
    const row = banner({ cta_href: "/sets" });
    const { patch, clears } = bannerDraftPatch(row, shapeOf(row, { cta_href: null }));
    expect(patch).toEqual({ cta_href: "" });
    expect(clears).toEqual([]);
  });

  it("REFUSES to stage a cleared date, and reports it instead", () => {
    // publish_site() casts `(draft->>'valid_to')::timestamptz`. An empty string there raises at
    // publish time and fails the WHOLE publish, including every unrelated pending change.
    const row = banner({ valid_to: "2026-12-01T00:00:00Z" });
    const { patch, clears } = bannerDraftPatch(row, shapeOf(row, { valid_to: null }));
    expect(patch).toBeNull();
    expect(clears).toEqual(["valid_to"]);
    expect(UNSTAGEABLE_CLEARS).toContain("valid_to");
  });

  it("a date being SET is perfectly stageable", () => {
    const row = banner({ valid_from: null });
    const { patch, clears } = bannerDraftPatch(row, shapeOf(row, { valid_from: "2026-11-01T00:00:00Z" }));
    expect(patch).toEqual({ valid_from: "2026-11-01T00:00:00Z" });
    expect(clears).toEqual([]);
  });

  it("stages both a patch and a refused clear in one edit", () => {
    const row = banner({ title_de: "Alt", valid_from: "2026-01-01T00:00:00Z" });
    const { patch, clears } = bannerDraftPatch(row, shapeOf(row, { title_de: "Neu", valid_from: null }));
    expect(patch).toEqual({ title_de: "Neu" });
    expect(clears).toEqual(["valid_from"]);
  });

  it("treats whitespace-only as empty, so a stray space is not a change", () => {
    const row = banner({ title_en: null });
    const { patch } = bannerDraftPatch(row, shapeOf(row, { title_en: "   " }));
    expect(patch).toBeNull();
  });
});

/* ================================================================ banner windows (task 12) */

describe("bannerState answers 'why isn't my banner showing'", () => {
  const w = (over: Partial<BannerDraftShape>) => bannerState({ active: true, valid_from: null, valid_to: null, ...over }, NOW);

  it("active with no window is live", () => {
    expect(w({})).toBe("live");
  });

  it("inactive beats any window", () => {
    expect(w({ active: false, valid_from: "2026-01-01T00:00:00Z", valid_to: "2027-01-01T00:00:00Z" })).toBe("inactive");
  });

  it("a future valid_from is scheduled", () => {
    expect(w({ valid_from: "2026-10-12T00:00:00Z" })).toBe("scheduled");
  });

  it("a past valid_to is expired", () => {
    expect(w({ valid_to: "2026-10-10T00:00:00Z" })).toBe("expired");
  });

  it("inside the window is live", () => {
    expect(w({ valid_from: "2026-10-01T00:00:00Z", valid_to: "2026-10-31T00:00:00Z" })).toBe("live");
  });

  it("the boundaries are inclusive, matching the view's `<=` / `>=`", () => {
    expect(w({ valid_from: NOW.toISOString() })).toBe("live");
    expect(w({ valid_to: NOW.toISOString() })).toBe("live");
  });

  it("scheduled is checked before expired when a window is entirely in the future", () => {
    expect(w({ valid_from: "2026-11-01T00:00:00Z", valid_to: "2026-11-30T00:00:00Z" })).toBe("scheduled");
  });
});

describe("liveBanners reproduces what banners_live returns", () => {
  it("keeps only active, in-window rows and orders them by slot then sort", () => {
    const rows = [
      banner({ id: "strip", slot: "home_strip", sort: 1 }),
      banner({ id: "hero2", slot: "home_hero", sort: 2 }),
      banner({ id: "hero1", slot: "home_hero", sort: 1 }),
      banner({ id: "off", active: false }),
      banner({ id: "later", valid_from: "2026-12-01T00:00:00Z" }),
      banner({ id: "gone", valid_to: "2026-01-01T00:00:00Z" }),
    ];
    expect(liveBanners(rows, NOW).map((r) => r.id)).toEqual(["hero1", "hero2", "strip"]);
  });

  it("reads the LIVE columns, not the merged draft — a staged `active: true` is not live yet", () => {
    const rows = [banner({ id: "staged", active: false, draft: { active: true } })];
    expect(liveBanners(rows, NOW)).toEqual([]);
  });
});

describe("nextSortInSlot", () => {
  it("starts at 0 in an empty slot and otherwise lands last", () => {
    expect(nextSortInSlot([], "home_hero")).toBe(0);
    expect(nextSortInSlot([banner({ sort: 0 }), banner({ id: "b2", sort: 3 })], "home_hero")).toBe(4);
  });

  it("counts the staged sort, so two new banners do not collide on one number", () => {
    expect(nextSortInSlot([banner({ sort: 0, draft: { sort: 9 } })], "home_hero")).toBe(10);
  });

  it("is per slot", () => {
    expect(nextSortInSlot([banner({ slot: "checkout", sort: 7 })], "home_hero")).toBe(0);
  });
});

/* ================================================================ storage paths (§8.6) */

describe("site bucket paths follow the menu bucket's convention", () => {
  it("stores a bucket-qualified path and strips it back", () => {
    expect(bannerStoredPath("b1", 2, "webp")).toBe("site/b1/2.webp");
    expect(siteObjectKeyOf("site/b1/2.webp")).toBe("b1/2.webp");
  });

  it("leaves an absolute URL alone — the seed uses those", () => {
    expect(siteObjectKeyOf("https://example.test/x.jpg")).toBeNull();
  });

  it("handles a missing image", () => {
    expect(siteObjectKeyOf(null)).toBeNull();
    expect(nextImageIndex(null)).toBe(1);
  });

  it("never reuses an index, so a replaced image is not served from cache", () => {
    expect(nextImageIndex("site/b1/1.webp")).toBe(2);
    expect(nextImageIndex("site/b1/7.jpg")).toBe(8);
  });
});

/* ================================================================ publication history */

describe("publish history reads both shapes of the same information", () => {
  it("publicationSummary reads the site_publications row", () => {
    const row = { summary: { settings_keys: ["site", "business"], banner_ids: ["b1"] } };
    expect(publicationSummary(row)).toEqual({ settingsKeys: ["site", "business"], bannerIds: ["b1"] });
    expect(publicationSize(row)).toBe(3);
  });

  it("publishResult reads publish_site()'s own top-level return", () => {
    const res = { id: "p1", settings_keys: ["site"], banner_ids: ["b1", "b2"] };
    expect(publishResult(res)).toEqual({ id: "p1", settingsKeys: ["site"], bannerIds: ["b1", "b2"] });
    expect(publishResultSize(res)).toBe(3);
  });

  it("an empty publish is zero, not a crash", () => {
    expect(publishResultSize({ id: "p1", settings_keys: [], banner_ids: [] })).toBe(0);
    expect(publishResultSize(null)).toBe(0);
    expect(publicationSize({ summary: {} })).toBe(0);
  });
});

/* ================================================================ opening hours */

describe("opening hours validation keeps a typo from closing the shop", () => {
  it("accepts HH:MM, including the seed's 24:00", () => {
    expect(parseHm("11:00")).toBe(660);
    expect(parseHm("24:00")).toBe(1440);
    expect(parseHm("9:30")).toBe(570);
  });

  it("rejects nonsense", () => {
    expect(parseHm("25:00")).toBeNull();
    expect(parseHm("11:70")).toBeNull();
    expect(parseHm("24:30")).toBeNull();
    expect(parseHm("elf")).toBeNull();
    expect(parseHm("")).toBeNull();
  });

  it("flags an unparseable range and a backwards one, per day", () => {
    expect(validateHours({ mon: [["11:00", "23:00"]] })).toEqual([]);
    expect(validateHours({ tue: [["11:00", "oops"]] })).toEqual([{ day: "tue", reason: "format" }]);
    expect(validateHours({ wed: [["23:00", "11:00"]] })).toEqual([{ day: "wed", reason: "order" }]);
    expect(validateHours({ thu: [["11:00", "11:00"]] })).toEqual([{ day: "thu", reason: "order" }]);
  });

  it("a closed day is valid, not an error", () => {
    expect(validateHours({ fri: [] })).toEqual([]);
    expect(validateHours({})).toEqual([]);
  });

  it("labels a day for the read-only row", () => {
    expect(hoursLabel([["11:00", "23:00"]], "geschlossen")).toBe("11:00 — 23:00");
    expect(hoursLabel([], "geschlossen")).toBe("geschlossen");
    expect(hoursLabel(undefined, "geschlossen")).toBe("geschlossen");
  });
});

/* ================================================================ delivery zones */

describe("delivery zones", () => {
  it("are NOT part of the staged publish — they have no draft column (§1.1)", () => {
    // Stated as a constant so the UI copy and this expectation cannot drift apart.
    expect(ZONES_ARE_STAGED).toBe(false);
  });

  it("parses postal codes out of whatever the operator typed", () => {
    expect(parsePostalCodes("10119, 10435 10437;10243")).toEqual(["10119", "10435", "10437", "10243"]);
  });

  it("drops duplicates and blanks", () => {
    expect(parsePostalCodes("10119,,10119 ,  ")).toEqual(["10119"]);
    expect(parsePostalCodes("")).toEqual([]);
  });

  it("round-trips through the text field", () => {
    expect(parsePostalCodes(formatPostalCodes(["10119", "10435"]))).toEqual(["10119", "10435"]);
    expect(formatPostalCodes(null)).toBe("");
  });
});
