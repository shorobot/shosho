"use client";

// `settings.business` — the details that end up in the Impressum and the site footer (§1.1).
// Staged into `draft`, owner-write; the panel is the same form read-only for an operator.
import { Row, TextArea, TextField } from "@/components/menu/Fields";
import { SettingSection } from "@/components/website/SettingSection";
import { useSettingDraft } from "@/components/website/useSettingDraft";
import { useI18n } from "@/lib/i18n";
import type { BusinessValue } from "@/lib/site";
import type { Json } from "@/lib/types";

function parse(v: Json): BusinessValue {
  if (!v || typeof v !== "object" || Array.isArray(v)) return {};
  const o = v as Record<string, Json>;
  const addr = o.address && typeof o.address === "object" && !Array.isArray(o.address) ? (o.address as Record<string, Json>) : {};
  const s = (x: Json | undefined) => (typeof x === "string" ? x : undefined);
  return {
    name: s(o.name),
    address: { street: s(addr.street), postal_code: s(addr.postal_code), city: s(addr.city), country: s(addr.country) },
    phone: s(o.phone),
    email: s(o.email),
    impressum: s(o.impressum),
    ust_id: s(o.ust_id),
  };
}

/**
 * A settings draft is a FULL replacement for `value` (§8.7), so this must emit the complete value
 * the key should have — not a patch of the changed fields. Empty strings are dropped rather than
 * stored, so clearing a field really removes it instead of leaving `""` in the storefront's footer.
 */
function toJson(v: BusinessValue): Json {
  const out: Record<string, Json> = {};
  const put = (k: string, x: string | undefined) => {
    if (x?.trim()) out[k] = x.trim();
  };
  put("name", v.name);
  const addr: Record<string, Json> = {};
  const putA = (k: string, x: string | undefined) => {
    if (x?.trim()) addr[k] = x.trim();
  };
  putA("street", v.address?.street);
  putA("postal_code", v.address?.postal_code);
  putA("city", v.address?.city);
  putA("country", v.address?.country);
  if (Object.keys(addr).length) out.address = addr;
  put("phone", v.phone);
  put("email", v.email);
  put("impressum", v.impressum);
  put("ust_id", v.ust_id);
  return out;
}

export function BusinessPanel() {
  const { t } = useI18n();
  const draft = useSettingDraft<BusinessValue>("business", parse, toJson);
  const { form, setForm, canEdit } = draft;
  const ro = !canEdit;
  const setAddr = (k: keyof NonNullable<BusinessValue["address"]>, value: string) =>
    setForm({ ...form, address: { ...form.address, [k]: value } });

  return (
    <SettingSection title={t("web.business")} hint={t("web.bizHint")} draft={draft}>
      <Row cols={1}>
        <TextField label={t("web.bizName")} value={form.name ?? ""} disabled={ro} onChange={(v) => setForm({ ...form, name: v })} />
      </Row>
      <Row cols={4}>
        <TextField label={t("web.bizStreet")} value={form.address?.street ?? ""} disabled={ro} onChange={(v) => setAddr("street", v)} />
        <TextField label={t("web.bizPostal")} value={form.address?.postal_code ?? ""} disabled={ro} onChange={(v) => setAddr("postal_code", v)} />
        <TextField label={t("web.bizCity")} value={form.address?.city ?? ""} disabled={ro} onChange={(v) => setAddr("city", v)} />
        <TextField label={t("web.bizCountry")} value={form.address?.country ?? ""} disabled={ro} maxLength={2} onChange={(v) => setAddr("country", v.toUpperCase())} />
      </Row>
      <Row cols={3}>
        <TextField label={t("web.bizPhone")} value={form.phone ?? ""} disabled={ro} onChange={(v) => setForm({ ...form, phone: v })} />
        <TextField label={t("web.bizEmail")} value={form.email ?? ""} disabled={ro} onChange={(v) => setForm({ ...form, email: v })} />
        <TextField label={t("web.bizUstId")} value={form.ust_id ?? ""} disabled={ro} onChange={(v) => setForm({ ...form, ust_id: v })} />
      </Row>
      <Row cols={1}>
        <TextArea label={t("web.bizImpressum")} value={form.impressum ?? ""} rows={3} disabled={ro} onChange={(v) => setForm({ ...form, impressum: v })} />
      </Row>
    </SettingSection>
  );
}
