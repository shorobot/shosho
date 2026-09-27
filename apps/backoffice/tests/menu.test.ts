import { describe, expect, it } from "vitest";
import {
  ALLERGENS, applyPricePct, completeness, contributionCents, daysLabel, duplicateInsert, extForMime, filterItems,
  isOnSale, isStopped, isValidSchedule, marginPct, matchesItemSearch, movePhoto, nextPhotoIndex, objectKeyOf,
  parseSchedule, photoObjectKey, photoPaths, photoStoredPath, rejectPhoto, reorder, ruleOf, ruleShape, slugify,
  sortValues, suggestSku, uniqueSlug, validateGroup, wantsSecondPhoto, withoutIdentity,
} from "@/lib/menu";
import { cropWindow } from "@/lib/image";
import type { MenuItemRow } from "@/lib/types";

const TODAY = "2026-09-27";

function item(p: Partial<MenuItemRow> = {}): MenuItemRow {
  return {
    id: "item-1",
    sku: "RL-014",
    category_id: "cat-rolls",
    name_de: "Philadelphia Deluxe",
    name_en: "Philadelphia Deluxe",
    name_ja: "フィラデルフィア",
    transliteration: null,
    description_de: "Norwegischer Lachs, Frischkäse, Avocado und Gurke, mit Tobiko.",
    description_en: "Norwegian salmon, cream cheese, avocado and cucumber, with tobiko.",
    base_price_cents: 1490,
    cost_cents: 510,
    photos: ["menu/item-1/1.jpg"],
    available: true,
    stoplist_until: null,
    stock_remaining: 24,
    max_per_order: null,
    tags: ["hit"],
    prep_minutes: 12,
    station: "Sushi",
    kitchen_note: null,
    allergens: ["A", "D", "G"],
    weight_g: 320,
    kcal_per_100g: 186,
    vat_delivery_pct: 7,
    vat_onsite_pct: 19,
    sort: 10,
    recommended_item_ids: [],
    created_at: "2026-09-01T10:00:00Z",
    updated_at: "2026-09-01T10:00:00Z",
    ...p,
  };
}

describe("margin", () => {
  it("is the contribution over the selling price", () => {
    // the canvas's own figures: 14,90 € at 5,10 € cost → 65,8 % and 9,80 € contribution
    expect(marginPct(1490, 510)).toBeCloseTo(65.77, 2);
    expect(contributionCents(1490, 510)).toBe(980);
  });

  it("has no opinion without a cost or without a price", () => {
    expect(marginPct(1490, null)).toBeNull();
    expect(contributionCents(1490, null)).toBeNull();
    expect(marginPct(0, 100)).toBeNull();
  });

  it("goes negative when the item is sold below cost", () => {
    expect(marginPct(400, 500)).toBeCloseTo(-25, 5);
    expect(contributionCents(400, 500)).toBe(-100);
  });
});

describe("bulk price math", () => {
  it("rounds to the cent", () => {
    expect(applyPricePct(1490, 10)).toBe(1639);
    expect(applyPricePct(1490, -10)).toBe(1341);
    expect(applyPricePct(333, 5)).toBe(350); // 349.65 → 350
  });

  it("never goes below zero and is a no-op at 0 %", () => {
    expect(applyPricePct(500, -200)).toBe(0);
    expect(applyPricePct(1490, 0)).toBe(1490);
  });

  it("is not exactly reversible, which is why undo restores the old rows", () => {
    // +10 % then −10 % lands on 1475, not 1490 — the UndoBar writes the snapshot back instead.
    expect(applyPricePct(applyPricePct(1490, 10), -10)).not.toBe(1490);
  });
});

describe("stoplist and on-sale", () => {
  it("is stopped while the date has not passed", () => {
    expect(isStopped(TODAY, TODAY)).toBe(true);
    expect(isStopped("2026-09-26", TODAY)).toBe(false);
    expect(isStopped(null, TODAY)).toBe(false);
  });

  it("matches the DB rule: available, not stopped, category active", () => {
    const active = { active: true };
    expect(isOnSale(item(), active, TODAY)).toBe(true);
    expect(isOnSale(item({ available: false }), active, TODAY)).toBe(false);
    expect(isOnSale(item({ stoplist_until: TODAY }), active, TODAY)).toBe(false);
    expect(isOnSale(item(), { active: false }, TODAY)).toBe(false);
    expect(isOnSale(item(), undefined, TODAY)).toBe(false);
  });
});

describe("completeness flags", () => {
  it("is empty for a finished item", () => {
    expect(completeness(item())).toEqual([]);
  });

  it("flags a missing EN name, EN description, photo and allergens", () => {
    expect(completeness(item({ name_en: "" }))).toContain("name_en");
    expect(completeness(item({ description_en: "   " }))).toContain("description_en");
    expect(completeness(item({ photos: [] }))).toContain("photo");
    expect(completeness(item({ allergens: [] }))).toContain("allergens");
  });

  it("does not ask for a translation of a description that does not exist", () => {
    expect(completeness(item({ description_de: null, description_en: null }))).not.toContain("description_en");
  });

  it("treats a non-array photos column as no photos", () => {
    expect(completeness(item({ photos: null }))).toContain("photo");
  });

  it("asks for a second photo only when there is exactly one", () => {
    expect(wantsSecondPhoto(["menu/i/1.jpg"])).toBe(true);
    expect(wantsSecondPhoto([])).toBe(false);
    expect(wantsSecondPhoto(["menu/i/1.jpg", "menu/i/2.jpg"])).toBe(false);
  });
});

describe("photo paths (§6.8)", () => {
  it("builds the object key and the bucket-qualified path", () => {
    expect(photoObjectKey("abc", 2, "webp")).toBe("abc/2.webp");
    expect(photoStoredPath("abc", 2, "webp")).toBe("menu/abc/2.webp");
  });

  it("round-trips the bucket prefix", () => {
    expect(objectKeyOf("menu/abc/2.webp")).toBe("abc/2.webp");
    expect(objectKeyOf("abc/2.webp")).toBe("abc/2.webp");
    expect(objectKeyOf("https://cdn.example/x.jpg")).toBeNull();
  });

  it("never reuses an index, so a replace cannot be served from cache", () => {
    expect(nextPhotoIndex([])).toBe(1);
    expect(nextPhotoIndex(["menu/a/1.jpg"])).toBe(2);
    expect(nextPhotoIndex(["menu/a/1.jpg", "menu/a/7.webp"])).toBe(8);
    expect(nextPhotoIndex(["https://cdn/x.jpg"])).toBe(1);
  });

  it("maps mime to extension", () => {
    expect(extForMime("image/png")).toBe("png");
    expect(extForMime("image/webp")).toBe("webp");
    expect(extForMime("image/avif")).toBe("avif");
    expect(extForMime("image/jpeg")).toBe("jpg");
  });

  it("rejects the wrong type and the oversized file with a reason", () => {
    expect(rejectPhoto({ type: "image/jpeg", size: 1000, name: "a.jpg" })).toBeNull();
    expect(rejectPhoto({ type: "image/gif", size: 1000, name: "a.gif" })?.reason).toBe("type");
    expect(rejectPhoto({ type: "application/pdf", size: 10, name: "a.pdf" })?.reason).toBe("type");
    expect(rejectPhoto({ type: "image/png", size: 6 * 1024 * 1024, name: "a.png" })?.reason).toBe("size");
  });

  it("keeps only strings out of the jsonb column", () => {
    expect(photoPaths(["a", 3, null, "b"])).toEqual(["a", "b"]);
    expect(photoPaths("nope")).toEqual([]);
  });

  it("reorders, and the first photo is the card image", () => {
    expect(movePhoto(["a", "b", "c"], 2, 0)).toEqual(["c", "a", "b"]);
    expect(movePhoto(["a", "b", "c"], 0, 0)).toEqual(["a", "b", "c"]);
    expect(movePhoto(["a", "b"], 0, 5)).toEqual(["a", "b"]);
  });
});

describe("option rules", () => {
  it("names the three rules the design uses", () => {
    expect(ruleOf({ min_select: 0, max_select: null })).toBe("any");
    expect(ruleOf({ min_select: 1, max_select: 1 })).toBe("one");
    expect(ruleOf({ min_select: 0, max_select: 3 })).toBe("range");
  });

  it("round-trips a rule through its shape", () => {
    expect(ruleOf(ruleShape("any"))).toBe("any");
    expect(ruleOf(ruleShape("one"))).toBe("one");
    expect(ruleShape("one").required).toBe(true);
    expect(ruleOf(ruleShape("range"))).toBe("range");
  });

  const ok = { name_de: "Sojasauce", min_select: 1, max_select: 1, required: true, options: [{ name_de: "Hell", price_cents: 0 }] };

  it("accepts a well-formed group", () => {
    expect(validateGroup(ok)).toEqual([]);
  });

  it("rejects an empty name, an impossible range, options without names and negative prices", () => {
    expect(validateGroup({ ...ok, name_de: " " })).toContain("name");
    expect(validateGroup({ ...ok, min_select: 2, max_select: 1 })).toContain("range");
    expect(validateGroup({ ...ok, options: [] })).toContain("no_options");
    expect(validateGroup({ ...ok, options: [{ name_de: "", price_cents: 0 }] })).toContain("option_name");
    expect(validateGroup({ ...ok, options: [{ name_de: "Extra", price_cents: -50 }] })).toContain("option_price");
  });

  it("rejects a required group that allows choosing nothing", () => {
    expect(validateGroup({ ...ok, required: true, min_select: 0, max_select: 3 })).toContain("required_min");
  });

  it("allows an open maximum", () => {
    expect(validateGroup({ ...ok, min_select: 0, max_select: null, required: false })).toEqual([]);
  });
});

describe("category schedule", () => {
  it("parses the lunch window from §1.2", () => {
    expect(parseSchedule({ days: [1, 2, 3, 4, 5], until: "15:00" })).toEqual({ days: [1, 2, 3, 4, 5], until: "15:00" });
  });

  it("treats anything malformed as no schedule", () => {
    expect(parseSchedule(null)).toBeNull();
    expect(parseSchedule({ days: [], until: "15:00" })).toBeNull();
    expect(parseSchedule({ days: [1], until: "25:00" })).toBeNull();
    expect(parseSchedule({ days: [1] })).toBeNull();
    expect(parseSchedule([1, 2])).toBeNull();
  });

  it("drops out-of-range days and sorts what is left", () => {
    expect(parseSchedule({ days: [5, 9, 1, 1], until: "15:00" })?.days).toEqual([1, 5]);
  });

  it("validates before saving", () => {
    expect(isValidSchedule({ days: [1], until: "15:00" })).toBe(true);
    expect(isValidSchedule({ days: [], until: "15:00" })).toBe(false);
    expect(isValidSchedule({ days: [1], until: "9:00" })).toBe(false);
  });

  it("writes a run of days as a range", () => {
    const names = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];
    expect(daysLabel([1, 2, 3, 4, 5], names)).toBe("Mo–Fr");
    expect(daysLabel([1, 3, 5], names)).toBe("Mo, Mi, Fr");
    expect(daysLabel([6, 7], names)).toBe("Sa, So");
    expect(daysLabel([], names)).toBe("");
  });
});

describe("list filters", () => {
  const categories = new Map([
    ["cat-rolls", { active: true }],
    ["cat-off", { active: false }],
  ]);
  const rows = [
    item({ id: "a", name_de: "Philadelphia Deluxe" }),
    item({ id: "b", name_de: "Ebi Tempura", name_en: "", sku: "MN-003", stoplist_until: TODAY, name_ja: "天ぷら" }),
    item({ id: "c", name_de: "Matcha Mochi", sku: "DS-002", allergens: [], name_ja: "もち" }),
    item({ id: "d", name_de: "Versteckt", available: false, sku: "RL-099" }),
    item({ id: "e", name_de: "Aus Kategorie", category_id: "cat-off", sku: "OF-001" }),
  ];
  const opts = { query: "", categoryId: null, today: TODAY, categories };

  it("counts everything under Alle", () => {
    expect(filterItems(rows, { ...opts, filter: "all" }).map((r) => r.id)).toEqual(["a", "b", "c", "d", "e"]);
  });

  it("Aktiv is exactly the on-sale rule", () => {
    expect(filterItems(rows, { ...opts, filter: "active" }).map((r) => r.id)).toEqual(["a", "c"]);
  });

  it("Stoppliste is today's stoplist", () => {
    expect(filterItems(rows, { ...opts, filter: "stoplist" }).map((r) => r.id)).toEqual(["b"]);
  });

  it("Unvollständig is anything with a flag", () => {
    expect(filterItems(rows, { ...opts, filter: "incomplete" }).map((r) => r.id)).toEqual(["b", "c"]);
  });

  it("narrows to one category", () => {
    expect(filterItems(rows, { ...opts, filter: "all", categoryId: "cat-off" }).map((r) => r.id)).toEqual(["e"]);
  });

  it("searches name, kana and SKU", () => {
    expect(matchesItemSearch(rows[1] as never, "tempura")).toBe(true);
    expect(matchesItemSearch(rows[1] as never, "天ぷら")).toBe(true);
    expect(matchesItemSearch(rows[1] as never, "MN-003")).toBe(true);
    expect(matchesItemSearch(rows[1] as never, "philadelphia")).toBe(false);
    expect(matchesItemSearch(rows[1] as never, "  ")).toBe(true);
  });
});

describe("sorting", () => {
  it("moves an element and renumbers in steps of ten", () => {
    expect(reorder(["a", "b", "c"], 0, 2)).toEqual(["b", "c", "a"]);
    expect(reorder(["a", "b", "c"], 1, 1)).toEqual(["a", "b", "c"]);
    expect(sortValues(3)).toEqual([10, 20, 30]);
  });
});

describe("slugs and SKUs", () => {
  it("slugifies German names", () => {
    expect(slugify("Grüne Soße & Mehr")).toBe("gruene-sosse-mehr");
    expect(slugify("Mittagsangebot")).toBe("mittagsangebot");
  });

  it("does not collide", () => {
    expect(uniqueSlug("rolls", ["rolls", "rolls-2"])).toBe("rolls-3");
    expect(uniqueSlug("rolls", [])).toBe("rolls");
  });

  it("suggests the next SKU in the category's series", () => {
    expect(suggestSku("rolls", ["RO-001", "RO-014", "DS-002"])).toBe("RO-015");
    expect(suggestSku("rolls", [])).toBe("RO-001");
  });
});

describe("duplicate", () => {
  it("drops the identity columns, renames, hides and keeps no photos", () => {
    const copy = duplicateInsert(item(), "RL-015");
    expect(copy).not.toHaveProperty("id");
    expect(copy).not.toHaveProperty("created_at");
    expect(copy.sku).toBe("RL-015");
    expect(copy.name_de).toBe("Philadelphia Deluxe (2)");
    expect(copy.available).toBe(false);
    expect(copy.photos).toEqual([]);
    expect(copy.sort).toBe(11);
  });

  it("leaves an empty EN name empty rather than writing \"(2)\"", () => {
    expect(duplicateInsert(item({ name_en: "" }), "X-1").name_en).toBe("");
  });

  it("withoutIdentity does not mutate its input", () => {
    const row = item();
    withoutIdentity(row);
    expect(row.id).toBe("item-1");
  });
});

describe("focal crop window", () => {
  it("keeps the whole frame without an aspect", () => {
    expect(cropWindow(1000, 800, null, { x: 0.5, y: 0.5 })).toEqual({ sx: 0, sy: 0, sWidth: 1000, sHeight: 800 });
  });

  it("centres a 4:5 window on the focal point", () => {
    const w = cropWindow(1000, 1000, 4 / 5, { x: 0.5, y: 0.5 });
    expect(w).toEqual({ sx: 100, sy: 0, sWidth: 800, sHeight: 1000 });
  });

  it("clamps the window inside the image", () => {
    const left = cropWindow(1000, 1000, 4 / 5, { x: 0, y: 0 });
    expect(left.sx).toBe(0);
    const right = cropWindow(1000, 1000, 4 / 5, { x: 1, y: 1 });
    expect(right.sx).toBe(200);
    expect(right.sx + right.sWidth).toBe(1000);
  });

  it("uses the full width when the image is already narrower than the target", () => {
    const w = cropWindow(400, 1000, 4 / 5, { x: 0.5, y: 0.5 });
    expect(w.sWidth).toBe(400);
    expect(w.sHeight).toBe(500);
  });
});

describe("allergens", () => {
  it("is the German A–N scheme", () => {
    expect(ALLERGENS).toHaveLength(14);
    expect(ALLERGENS[0]).toBe("A");
    expect(ALLERGENS[13]).toBe("N");
  });
});
