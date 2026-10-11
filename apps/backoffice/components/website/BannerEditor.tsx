"use client";

// Banner editor (api-contracts §8.6 / §8.7). Everything it saves lands in `banners.draft` — never
// on the live columns — so no edit can reach the storefront before someone publishes it.
//
// THREE THINGS HERE ARE NOT OBVIOUS AND ARE DELIBERATE:
//
// 1. A NEW banner is inserted with `active = false` and all of its content in `draft`. The row
//    exists (so an image can be uploaded under its id) but `banners_live` filters it out, and
//    `publish_site()` merges the content in and flips `active` when the owner publishes. Inserting
//    the content on the live columns instead would put an unapproved banner one `active` toggle away
//    from the storefront.
//
// 2. REPLACING an image uploads a NEW object key and leaves the old one in the bucket. The menu's
//    photo editor deletes the replaced object immediately, which is right there because the row is
//    written at once — here the live site still serves the old path until publish, so deleting it
//    would break the storefront with a staged, unpublished edit. The orphan is stated in the UI and
//    in the README instead of being silently created.
//
// 3. A date cannot be CLEARED through a draft, and the editor refuses rather than trying. See
//    UNSTAGEABLE_CLEARS in lib/site.ts: `publish_site()` casts `(draft->>'valid_to')::timestamptz`,
//    so an empty string there would raise at publish time and take every other pending change down
//    with it. The operator gets the reason and an explicit immediate write.
import { useRef, useState } from "react";
import { useSupabase } from "@/components/providers/EnvProvider";
import { Label, NumberField, Row, Select, Switch, TextArea, TextField } from "@/components/menu/Fields";
import { Modal } from "@/components/ui/Modal";
import { Pill } from "@/components/ui/Pill";
import { ErrorState, Spinner } from "@/components/ui/States";
import { BannerThumb } from "@/components/website/BannerThumb";
import { DateTimeField } from "@/components/ui/DateTimeField";
import { useI18n, type Key } from "@/lib/i18n";
import { preparePhoto } from "@/lib/image";
import { extForMime, rejectPhoto } from "@/lib/menu";
import { isDenied } from "@/lib/menuStore";
import {
  BANNER_SLOTS, bannerDraftPatch, bannerStoredPath, mergeBannerDraft, nextImageIndex, nextSortInSlot,
  SITE_BUCKET, siteObjectKeyOf, type BannerDraftShape, type BannerRow, type BannerSlot, type UnstageableClear,
} from "@/lib/site";
import { run, useSite } from "@/lib/siteStore";
import { wrote } from "@/lib/write";
import { toast } from "@/lib/toast";
import type { Json } from "@/lib/types";

/** The hero slot is 16:9 on the storefront; the crop is baked in like the menu's photos (§6.8). */
const BANNER_ASPECT = 16 / 9;

function blankShape(slot: BannerSlot, sort: number): BannerDraftShape {
  return {
    slot, image_path: null, title_de: null, title_en: null, subtitle_de: null, subtitle_en: null,
    cta_label_de: null, cta_label_en: null, cta_href: null, valid_from: null, valid_to: null, sort, active: false,
  };
}

/** A row that does not exist yet, so `bannerDraftPatch` can diff a new banner the same way. */
function syntheticRow(id: string, slot: BannerSlot, sort: number): BannerRow {
  const nowIso = new Date().toISOString();
  return { ...blankShape(slot, sort), id, draft: null, created_at: nowIso, updated_at: nowIso } as BannerRow;
}

export function BannerEditor({ row, onClose }: { row: BannerRow | null; onClose: () => void }) {
  const { t, lang } = useI18n();
  const supabase = useSupabase();
  const { banners, canEditContent, reload } = useSite();
  const fileInput = useRef<HTMLInputElement | null>(null);

  const [id] = useState(() => row?.id ?? crypto.randomUUID());
  const [form, setForm] = useState<BannerDraftShape>(() =>
    row ? mergeBannerDraft(row) : blankShape("home_hero", nextSortInSlot(banners, "home_hero")),
  );
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [clears, setClears] = useState<UnstageableClear[]>([]);
  /** Objects uploaded in this dialog — removed again if a NEW banner is abandoned. */
  const [uploaded, setUploaded] = useState<string[]>([]);
  const [titleError, setTitleError] = useState(false);

  const set = <K extends keyof BannerDraftShape>(k: K, v: BannerDraftShape[K]) => setForm((f) => ({ ...f, [k]: v }));
  const ro = !canEditContent;

  async function pickImage(files: FileList | null) {
    const file = files?.[0];
    if (!file) return;
    const bad = rejectPhoto(file);
    if (bad) return toast(bad.reason === "type" ? t("web.imgErrType", { t: bad.detail }) : t("web.imgErrSize", { t: bad.detail }));
    setUploading(true);
    let prepared;
    try {
      prepared = await preparePhoto(file, { aspect: BANNER_ASPECT });
    } catch {
      setUploading(false);
      return toast(t("web.imgErrProcess"));
    }
    const ext = extForMime(prepared.type);
    const n = nextImageIndex(form.image_path);
    const key = `${id}/${n}.${ext}`;
    const { error } = await supabase.storage.from(SITE_BUCKET).upload(key, prepared.blob, { contentType: prepared.type, upsert: true });
    setUploading(false);
    if (error) {
      return toast(isDenied(error as { message?: string }) ? t("web.imgDenied") : t("web.imgErrUpload", { e: error.message }));
    }
    setUploaded((u) => [...u, key]);
    set("image_path", bannerStoredPath(id, n, ext));
  }

  /** Cancel: an abandoned NEW banner's uploads are removed so the bucket does not collect them. */
  async function cancel() {
    if (!row && uploaded.length) await supabase.storage.from(SITE_BUCKET).remove(uploaded);
    onClose();
  }

  async function save() {
    if (!form.title_de?.trim()) {
      setTitleError(true);
      return toast(t("web.bannerTitleRequired"));
    }
    setTitleError(false);
    setBusy(true);
    const base = row ?? syntheticRow(id, form.slot, form.sort);
    const { patch, clears: unstageable } = bannerDraftPatch(base, form);

    if (row) {
      if (!patch && unstageable.length === 0) {
        setBusy(false);
        return toast(t("web.bannerNoChange"));
      }
      const res = await run(lang, () => supabase.from("banners").update({ draft: patch }).eq("id", row.id).select("id"));
      setBusy(false);
      if (res == null) return;
      // `[]` with no error means RLS matched no row — a silent no-op, not a save (lib/write.ts).
      if (!wrote(res)) return toast(t("web.writeNoop"));
    } else {
      const res = await run(lang, () =>
        supabase.from("banners").insert({ id, slot: form.slot, sort: form.sort, active: false, draft: patch as Json }).select("id"),
      );
      setBusy(false);
      if (res == null) return;
      if (!wrote(res)) return toast(t("web.writeNoop"));
    }

    await reload();
    if (unstageable.length) {
      // Stay open: the operator has one explicit decision left to make about the dates.
      setClears(unstageable);
      toast(t("web.staged"), "ok");
      return;
    }
    toast(t("web.staged"), "ok");
    onClose();
  }

  /** The escape hatch for a date clear: a direct write to the live column, said out loud. */
  async function applyClears() {
    setBusy(true);
    const patch: { valid_from?: null; valid_to?: null } = {};
    for (const f of clears) patch[f] = null;
    const res = await run(lang, () => supabase.from("banners").update(patch).eq("id", id).select("id"));
    setBusy(false);
    if (res == null) return;
    if (!wrote(res)) return toast(t("web.writeNoop"));
    await reload();
    setClears([]);
    toast(t("web.clearsApplied"), "ok");
    onClose();
  }

  return (
    <Modal open onClose={cancel} title={row ? t("web.bannerEdit") : t("web.bannerNew")} wide>
      <div className="flex flex-col gap-4">
        {clears.length > 0 && (
          <ErrorState
            tone="warn"
            title={t("web.clearsTitle")}
            body={
              <>
                {t("web.clearsBody")}
                <br />
                {t("web.clearsFields", { f: clears.map((c) => t(`web.banner${c === "valid_from" ? "From" : "To"}` as Key)).join(", ") })}
              </>
            }
            actions={
              <>
                <Pill size="xs" variant="alert" onClick={applyClears} disabled={busy}>
                  {t("web.clearsApply")}
                </Pill>
                <Pill size="xs" variant="ghost" onClick={onClose}>
                  {t("web.cancel")}
                </Pill>
              </>
            }
          />
        )}

        <Row cols={2}>
          <Select<BannerSlot>
            label={t("web.bannerSlot")}
            value={form.slot}
            disabled={ro}
            onChange={(v) => setForm((f) => ({ ...f, slot: v, sort: row ? f.sort : nextSortInSlot(banners, v) }))}
            options={BANNER_SLOTS.map((s) => ({ value: s, label: t(`web.slot.${s}` as Key) }))}
          />
          <NumberField label={t("web.bannerSort")} value={form.sort} disabled={ro} onChange={(v) => set("sort", v ?? 0)} />
        </Row>

        <div className="flex flex-col gap-2">
          <Label>{t("web.bannerImage")}</Label>
          <div className="flex flex-wrap items-center gap-3">
            <BannerThumb path={form.image_path} size={70} />
            {!ro && (
              <>
                <Pill variant="soft" size="xs" onClick={() => fileInput.current?.click()} disabled={uploading}>
                  {uploading ? t("web.uploading") : form.image_path ? t("web.bannerImageReplace") : t("web.bannerImageAdd")}
                </Pill>
                {form.image_path && (
                  <Pill variant="ghost" size="xs" onClick={() => set("image_path", null)}>
                    {t("web.bannerImageRemove")}
                  </Pill>
                )}
                {uploading && <Spinner />}
              </>
            )}
          </div>
          <span className="text-[11px] leading-[1.45] text-muted">{t("web.bannerImageHint")}</span>
          {row && form.image_path !== row.image_path && row.image_path && (
            <span className="text-[11px] leading-[1.45] text-orange-ink">{t("web.bannerOrphanNote")}</span>
          )}
          <input
            ref={fileInput}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/avif"
            hidden
            onChange={(e) => {
              void pickImage(e.target.files);
              e.target.value = "";
            }}
          />
        </div>

        <Row cols={2}>
          <TextField label={t("web.bannerTitleDe")} value={form.title_de ?? ""} disabled={ro} onChange={(v) => set("title_de", v)} error={titleError ? t("web.bannerTitleRequired") : undefined} />
          <TextField label={t("web.bannerTitleEn")} value={form.title_en ?? ""} disabled={ro} onChange={(v) => set("title_en", v)} />
        </Row>
        <Row cols={2}>
          <TextArea label={t("web.bannerSubtitleDe")} value={form.subtitle_de ?? ""} rows={2} disabled={ro} onChange={(v) => set("subtitle_de", v)} />
          <TextArea label={t("web.bannerSubtitleEn")} value={form.subtitle_en ?? ""} rows={2} disabled={ro} onChange={(v) => set("subtitle_en", v)} />
        </Row>
        <Row cols={3}>
          <TextField label={t("web.bannerCtaDe")} value={form.cta_label_de ?? ""} disabled={ro} onChange={(v) => set("cta_label_de", v)} />
          <TextField label={t("web.bannerCtaEn")} value={form.cta_label_en ?? ""} disabled={ro} onChange={(v) => set("cta_label_en", v)} />
          <TextField label={t("web.bannerCtaHref")} value={form.cta_href ?? ""} disabled={ro} hint={t("web.bannerCtaHrefHint")} onChange={(v) => set("cta_href", v)} />
        </Row>
        <Row cols={2}>
          <DateTimeField label={t("web.bannerFrom")} value={form.valid_from} disabled={ro} onChange={(v) => set("valid_from", v)} />
          <DateTimeField label={t("web.bannerTo")} value={form.valid_to} disabled={ro} min={form.valid_from} onChange={(v) => set("valid_to", v)} />
        </Row>
        <Switch checked={form.active} disabled={ro} onChange={(v) => set("active", v)} label={t("web.bannerActive")} hint={t("web.bannerActiveHint")} />

        <div className="flex flex-wrap items-center justify-between gap-2">
          {row && canEditContent ? <DeleteBanner row={row} onDone={onClose} /> : <span />}
          <div className="flex gap-2">
            <Pill variant="ghost" size="sm" onClick={cancel}>
              {t("web.cancel")}
            </Pill>
            {canEditContent && (
              <Pill size="sm" onClick={save} disabled={busy || uploading}>
                {busy ? t("web.bannerSaving") : t("web.bannerSave")}
              </Pill>
            )}
          </div>
        </div>
      </div>
    </Modal>
  );
}

/** Deleting is the one banner action that is NOT staged — it is a row delete, so it says so. */
function DeleteBanner({ row, onDone }: { row: BannerRow; onDone: () => void }) {
  const { t, lang } = useI18n();
  const supabase = useSupabase();
  const { reload } = useSite();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  async function remove() {
    setBusy(true);
    const res = await run(lang, () => supabase.from("banners").delete().eq("id", row.id).select("id"));
    if (res != null && !wrote(res)) toast(t("web.writeNoop"));
    if (res != null && wrote(res)) {
      const key = siteObjectKeyOf(row.image_path);
      if (key) await supabase.storage.from(SITE_BUCKET).remove([key]);
      await reload();
      toast(t("web.bannerDeleted"), "ok");
      onDone();
    }
    setBusy(false);
  }

  if (!confirming) {
    return (
      <Pill variant="ghost" size="sm" onClick={() => setConfirming(true)}>
        {t("web.bannerDelete")}
      </Pill>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="max-w-[320px] text-[11px] leading-[1.45] text-alert">{t("web.bannerDeleteConfirm")}</span>
      <Pill variant="alert" size="xs" onClick={remove} disabled={busy}>
        {t("web.bannerDelete")}
      </Pill>
      <Pill variant="ghost" size="xs" onClick={() => setConfirming(false)}>
        {t("web.cancel")}
      </Pill>
    </div>
  );
}
