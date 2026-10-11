"use client";

// `settings.site` — SEO, the cookie banner, robots and maintenance mode (§1.1 seed shape).
//
// `site` is one of the keys `anon` may READ (settings_public_keys), which is exactly the row the
// column-level grant protects: the storefront reads `value` and has no grant on `draft`, so a
// maintenance switch staged here is invisible to the public until it is published. The
// draft-invisibility test asserts that against the live project rather than trusting it.
import { Row, Switch, TextArea, TextField } from "@/components/menu/Fields";
import { SettingSection } from "@/components/website/SettingSection";
import { useSettingDraft } from "@/components/website/useSettingDraft";
import { useI18n } from "@/lib/i18n";
import type { SiteValue } from "@/lib/site";
import type { Json } from "@/lib/types";

function parse(v: Json): SiteValue {
  if (!v || typeof v !== "object" || Array.isArray(v)) return {};
  const o = v as Record<string, Json>;
  const seo = o.seo && typeof o.seo === "object" && !Array.isArray(o.seo) ? (o.seo as Record<string, Json>) : {};
  return {
    seo: { title: typeof seo.title === "string" ? seo.title : undefined, description: typeof seo.description === "string" ? seo.description : undefined },
    cookie_banner: typeof o.cookie_banner === "boolean" ? o.cookie_banner : undefined,
    robots: typeof o.robots === "string" ? o.robots : undefined,
    maintenance: typeof o.maintenance === "boolean" ? o.maintenance : undefined,
    // Carried through untouched: it belongs to this key but is edited nowhere on this screen, and a
    // settings draft is a full replacement — dropping it here would silently delete it on publish.
    free_delivery_hint_cents: typeof o.free_delivery_hint_cents === "number" ? o.free_delivery_hint_cents : undefined,
  };
}

function toJson(v: SiteValue): Json {
  const seo: Record<string, Json> = {};
  if (v.seo?.title?.trim()) seo.title = v.seo.title.trim();
  if (v.seo?.description?.trim()) seo.description = v.seo.description.trim();
  const out: Record<string, Json> = { seo };
  out.cookie_banner = v.cookie_banner ?? true;
  out.robots = v.robots ?? "index,follow";
  out.maintenance = v.maintenance ?? false;
  if (v.free_delivery_hint_cents !== undefined) out.free_delivery_hint_cents = v.free_delivery_hint_cents;
  return out;
}

/** The two values `robots` takes in the seed; a switch is the design's control, not a text field. */
const ROBOTS_ON = "index,follow";
const ROBOTS_OFF = "noindex,nofollow";

export function SeoPanel() {
  const { t } = useI18n();
  const draft = useSettingDraft<SiteValue>("site", parse, toJson);
  const { form, setForm, canEdit } = draft;
  const ro = !canEdit;
  const title = form.seo?.title ?? "";
  const description = form.seo?.description ?? "";

  return (
    <SettingSection title={t("web.seo")} draft={draft}>
      <Row cols={1}>
        <TextField
          label={t("web.seoTitle")}
          value={title}
          disabled={ro}
          hint={t("web.seoTitleHint", { n: title.length })}
          onChange={(v) => setForm({ ...form, seo: { ...form.seo, title: v } })}
        />
      </Row>
      <Row cols={1}>
        <TextArea
          label={t("web.seoDescription")}
          value={description}
          rows={2}
          disabled={ro}
          onChange={(v) => setForm({ ...form, seo: { ...form.seo, description: v } })}
        />
      </Row>
      <span className="text-[11px] text-muted">{t("web.seoDescHint", { n: description.length })}</span>

      <div className="flex flex-col gap-3">
        <Switch
          checked={form.cookie_banner ?? true}
          disabled={ro}
          onChange={(v) => setForm({ ...form, cookie_banner: v })}
          label={t("web.cookieBanner")}
          hint={t("web.cookieHint")}
        />
        <Switch
          checked={(form.robots ?? ROBOTS_ON) === ROBOTS_ON}
          disabled={ro}
          onChange={(v) => setForm({ ...form, robots: v ? ROBOTS_ON : ROBOTS_OFF })}
          label={t("web.robots")}
          hint={t("web.robotsHint")}
        />
        <Switch
          checked={form.maintenance ?? false}
          disabled={ro}
          onChange={(v) => setForm({ ...form, maintenance: v })}
          label={t("web.maintenance")}
          hint={t("web.maintenanceHint")}
        />
        {form.maintenance && <span className="text-[11px] font-extrabold leading-[1.45] text-alert">{t("web.maintenanceWarn")}</span>}
      </div>
    </SettingSection>
  );
}
