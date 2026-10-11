"use client";

// The staging behaviour every `settings` panel on BO · Website shares (§8.7).
//
// The form edits `draft ?? value` and saves into `draft`. Two details that keep the counter honest:
//   · saving a value identical to the live one writes `draft = null`, so an edit-and-undo does not
//     leave a "pending change" that publishing would record as a change;
//   · a reload only overwrites the form while it is clean, so a colleague's publish landing mid-edit
//     does not silently discard what is being typed.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "@/lib/i18n";
import { effectiveValue, hasPendingDraft, jsonEqual, settingsDraftFor, type SiteSettingKey } from "@/lib/site";
import { useSite } from "@/lib/siteStore";
import { toast } from "@/lib/toast";
import type { Json } from "@/lib/types";

export type SettingDraft<T> = {
  /** The working value: the pending draft if there is one, else what the storefront reads. */
  form: T;
  setForm: (next: T) => void;
  /** This key has an unpublished edit. */
  pending: boolean;
  /** The form differs from the stored draft/value — i.e. there is something to save. */
  dirty: boolean;
  /** `settings` is owner-write; everyone else gets the panel read-only. */
  canEdit: boolean;
  busy: boolean;
  save: () => Promise<void>;
  /** Throw the pending edit away; the storefront is untouched either way. */
  discard: () => Promise<void>;
  /** What is live right now, for a before/after comparison. */
  live: T;
};

export function useSettingDraft<T>(key: SiteSettingKey, parse: (v: Json) => T, toJson: (v: T) => Json): SettingDraft<T> {
  const { lang } = useI18n();
  const { t } = useI18n();
  const { settingsByKey, stageSetting, canEditSettings } = useSite();
  const row = settingsByKey.get(key);

  const stored = useMemo(() => effectiveValue(row), [row]);
  const live = useMemo(() => parse(row?.value ?? {}), [row, parse]);
  const [form, setFormState] = useState<T>(() => parse(stored));
  const [busy, setBusy] = useState(false);
  const dirtyRef = useRef(false);
  const [dirty, setDirty] = useState(false);

  const setForm = useCallback((next: T) => {
    dirtyRef.current = true;
    setDirty(true);
    setFormState(next);
  }, []);

  // Re-sync from the store only while the form is clean, so a reload cannot eat an in-flight edit.
  const signature = JSON.stringify(stored ?? null);
  useEffect(() => {
    if (dirtyRef.current) return;
    setFormState(parse(JSON.parse(signature) as Json));
    // `parse` is stable in every caller (a module-level function), so it is not a dependency here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);

  const save = useCallback(async () => {
    setBusy(true);
    const next = toJson(form);
    const draft = settingsDraftFor((row?.value ?? {}) as Json, next);
    const ok = await stageSetting(lang, key, draft);
    setBusy(false);
    if (!ok) return;
    dirtyRef.current = false;
    setDirty(false);
    toast(draft === null ? t("web.discarded") : t("web.staged"), "ok");
  }, [form, toJson, row, stageSetting, lang, key, t]);

  const discard = useCallback(async () => {
    setBusy(true);
    const ok = await stageSetting(lang, key, null);
    setBusy(false);
    if (!ok) return;
    dirtyRef.current = false;
    setDirty(false);
    setFormState(parse((row?.value ?? {}) as Json));
    toast(t("web.discarded"), "ok");
  }, [stageSetting, lang, key, row, parse, t]);

  return {
    form,
    setForm,
    pending: hasPendingDraft(row),
    dirty: dirty && !jsonEqual(toJson(form), stored as Json),
    canEdit: canEditSettings,
    busy,
    save,
    discard,
    live,
  };
}
