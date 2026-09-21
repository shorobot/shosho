import type { ItemOptionGroups, MenuItem, OptionGroup } from "./types";

export function groupsFor(itemOptionGroups: ItemOptionGroups[], itemId: string): OptionGroup[] {
  return itemOptionGroups.find((g) => g.item_id === itemId)?.groups ?? [];
}

/** Group rule as the UI renders it: segmented (required, exactly one) · radio (max 1) · checkbox (any / 0–n). */
export function groupKind(g: OptionGroup): "segmented" | "radio" | "checkbox" {
  if (g.required && g.max_select === 1) return "segmented";
  if (g.max_select === 1) return "radio";
  return "checkbox";
}

/** Quick-add defaults: the first option of every group that needs a selection. */
export function defaultOptionIds(groups: OptionGroup[]): string[] {
  const out: string[] = [];
  for (const g of groups) {
    const need = Math.max(g.min_select, g.required ? 1 : 0);
    for (const o of g.options.slice(0, need)) out.push(o.id);
  }
  return out;
}

/** Client-side mirror of the min/max rules — for disabling the Add button; the server re-checks. */
export function optionsValid(groups: OptionGroup[], selected: string[]): boolean {
  return groups.every((g) => {
    const n = g.options.filter((o) => selected.includes(o.id)).length;
    if (g.required && n < Math.max(g.min_select, 1)) return false;
    if (n < g.min_select) return false;
    if (g.max_select != null && n > g.max_select) return false;
    return true;
  });
}

/** "8 pcs · 320 g · Classic · Extra wasabi" — the cart line's descriptor. */
export function optionsLabel(groups: OptionGroup[], selected: string[]): string {
  const names: string[] = [];
  for (const g of groups) for (const o of g.options) if (selected.includes(o.id)) names.push(o.name_en);
  return names.join(" · ");
}

export function badgeFor(item: Pick<MenuItem, "tags">): "BESTSELLER" | "NEW" | null {
  if (item.tags.includes("hit")) return "BESTSELLER";
  if (item.tags.includes("new")) return "NEW";
  return null;
}

/** Short descriptor under the name: first clause of the description ("8 pcs · salmon, cream cheese"). */
export function shortDescription(item: Pick<MenuItem, "description_en" | "weight_g">): string {
  const d = item.description_en ?? "";
  const first = d.split(/[.;]/)[0]?.trim() ?? "";
  if (first.length <= 48) return first;
  return `${first.slice(0, 46).trimEnd()}…`;
}
