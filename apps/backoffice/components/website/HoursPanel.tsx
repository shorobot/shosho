"use client";

// `settings.opening_hours` — `{mon: [["11:00","23:00"]], …, holidays: []}` (§1.1). The storefront
// decides "open now" from this key, and outside these hours it accepts pre-orders only, so a typo
// here closes the shop: the form refuses to stage a range it cannot parse or whose end is not after
// its start, instead of letting `shop_open_at` interpret nonsense.
import { Switch, TextArea } from "@/components/menu/Fields";
import { SettingSection } from "@/components/website/SettingSection";
import { useSettingDraft } from "@/components/website/useSettingDraft";
import { useI18n, type Key } from "@/lib/i18n";
import { validateHours, WEEKDAYS, type HoursValue, type Weekday } from "@/lib/site";
import type { Json } from "@/lib/types";

function parse(v: Json): HoursValue {
  if (!v || typeof v !== "object" || Array.isArray(v)) return {};
  const o = v as Record<string, Json>;
  const out: HoursValue = {};
  for (const d of WEEKDAYS) {
    const raw = o[d];
    if (!Array.isArray(raw)) continue;
    out[d] = raw
      .filter((r): r is Json[] => Array.isArray(r))
      .map((r) => [typeof r[0] === "string" ? r[0] : "", typeof r[1] === "string" ? r[1] : ""] as [string, string]);
  }
  out.holidays = Array.isArray(o.holidays) ? o.holidays.filter((h): h is string => typeof h === "string") : [];
  return out;
}

function toJson(v: HoursValue): Json {
  const out: Record<string, Json> = {};
  for (const d of WEEKDAYS) out[d] = (v[d] ?? []).map(([a, b]) => [a, b]);
  out.holidays = v.holidays ?? [];
  return out;
}

export function HoursPanel() {
  const { t } = useI18n();
  const draft = useSettingDraft<HoursValue>("opening_hours", parse, toJson);
  const { form, setForm, canEdit } = draft;
  const ro = !canEdit;
  const problems = validateHours(form);

  const setRange = (day: Weekday, i: 0 | 1, value: string) => {
    const ranges = form[day] ?? [];
    const first = ranges[0] ?? (["", ""] as [string, string]);
    const next: [string, string] = i === 0 ? [value, first[1]] : [first[0], value];
    setForm({ ...form, [day]: [next, ...ranges.slice(1)] });
  };

  const setOpen = (day: Weekday, open: boolean) =>
    setForm({ ...form, [day]: open ? [["11:00", "23:00"] as [string, string]] : [] });

  return (
    <SettingSection
      title={t("web.hours")}
      hint={t("web.hoursHint")}
      draft={draft}
      blocked={problems.length > 0 ? (problems[0]?.reason === "order" ? t("web.hoursBadOrder") : t("web.hoursBadFormat")) : undefined}
    >
      <div className="flex flex-col gap-2">
        {WEEKDAYS.map((day) => {
          const ranges = form[day] ?? [];
          const open = ranges.length > 0;
          const first = ranges[0] ?? (["", ""] as [string, string]);
          const problem = problems.find((p) => p.day === day);
          return (
            <div key={day} className="flex flex-wrap items-center gap-2.5 rounded-[12px] bg-field-2 px-3 py-2">
              <span className="w-[92px] flex-none text-[12px] font-extrabold">{t(`web.day.${day}` as Key)}</span>
              {open ? (
                <>
                  <input
                    className="field w-[92px]"
                    value={first[0]}
                    placeholder="11:00"
                    disabled={ro}
                    aria-label={`${t(`web.day.${day}` as Key)} ${t("web.hoursFrom")}`}
                    onChange={(e) => setRange(day, 0, e.target.value)}
                  />
                  <span className="text-[12px] text-muted">—</span>
                  <input
                    className="field w-[92px]"
                    value={first[1]}
                    placeholder="23:00"
                    disabled={ro}
                    aria-label={`${t(`web.day.${day}` as Key)} ${t("web.hoursTo")}`}
                    onChange={(e) => setRange(day, 1, e.target.value)}
                  />
                </>
              ) : (
                <span className="text-[12px] text-muted">{t("web.hoursClosed")}</span>
              )}
              {problem && (
                <span className="text-[11px] font-extrabold text-alert">
                  {problem.reason === "format" ? t("web.hoursBadFormat") : t("web.hoursBadOrder")}
                </span>
              )}
              <span className="ml-auto">
                <Switch checked={open} disabled={ro} onChange={(v) => setOpen(day, v)} label={open ? t("web.hoursOpen") : t("web.hoursClosed")} />
              </span>
            </div>
          );
        })}
      </div>
      <TextArea
        label={t("web.hoursHolidays")}
        rows={2}
        disabled={ro}
        value={(form.holidays ?? []).join("\n")}
        onChange={(v) => setForm({ ...form, holidays: v.split(/\n+/).map((s) => s.trim()).filter(Boolean) })}
      />
    </SettingSection>
  );
}
