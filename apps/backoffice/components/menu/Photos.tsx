"use client";

// Fotos section of BO · Artikel (boot S4-02 task 3, contract §6.8).
//
// Pipeline: pick → validate type/size → decode and re-encode in the browser (≤ 1600 px long edge,
// ≤ ~1 MB) → `storage.from('menu').upload('<item_id>/<n>.<ext>')` → write the bucket-qualified path
// into `menu_items.photos`. Photos are written the moment they change, not on the form's Save: the
// object already exists in the bucket at that point, so deferring the row update only creates
// orphans. Removing a photo deletes the object as well as the reference.
//
// Crops: a real two-crop asset pipeline would need a second stored path (or a `{path, focal}` shape)
// per photo, which `photos: string[]` cannot express — so this ships a **focal-point picker** whose
// choice is baked into the uploaded pixels, with live card (4:3) and detail (4:5) previews. Noted in
// the README and in the contract request.
import { useRef, useState } from "react";
import { useSupabase } from "@/components/providers/EnvProvider";
import { Modal } from "@/components/ui/Modal";
import { Pill } from "@/components/ui/Pill";
import { Spinner } from "@/components/ui/States";
import { usePhotoUrl } from "@/components/menu/Thumb";
import { useI18n } from "@/lib/i18n";
import { CENTRE, preparePhoto, type Focal } from "@/lib/image";
import { PHOTO_BUCKET, extForMime, movePhoto, nextPhotoIndex, objectKeyOf, photoStoredPath, rejectPhoto } from "@/lib/menu";
import { isDenied } from "@/lib/menuStore";
import { toast } from "@/lib/toast";

/** Aspect of the crop that survives both frames the storefront uses. */
const CROP_ASPECT = 4 / 5;

export function Photos({
  itemId, photos, onChange, canWrite,
}: {
  itemId: string | null;
  photos: string[];
  onChange: (next: string[]) => Promise<void> | void;
  canWrite: boolean;
}) {
  const { t } = useI18n();
  const supabase = useSupabase();
  const url = usePhotoUrl();
  const fileInput = useRef<HTMLInputElement | null>(null);
  const replaceInput = useRef<HTMLInputElement | null>(null);
  const [replaceAt, setReplaceAt] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState<number | null>(null);
  const [pending, setPending] = useState<{ file: File; at: number | null } | null>(null);
  const [focal, setFocal] = useState<Focal>(CENTRE);
  const [cropOn, setCropOn] = useState(false);

  if (!canWrite) {
    // Storage policy is owner/operator only (§6.8) — kitchen and driver never see the control.
    return <span className="text-[12px] text-muted">{photos.length ? t("ph.cropHint") : t("ph.none")}</span>;
  }

  function pick(files: FileList | null, at: number | null) {
    const file = files?.[0];
    if (!file) return;
    const bad = rejectPhoto(file);
    if (bad) return toast(bad.reason === "type" ? t("ph.errType", { t: bad.detail }) : t("ph.errSize", { t: bad.detail }));
    setFocal(CENTRE);
    setCropOn(false);
    setPending({ file, at });
  }

  async function upload() {
    if (!pending || !itemId) return;
    setBusy(true);
    let prepared;
    try {
      prepared = await preparePhoto(pending.file, { aspect: cropOn ? CROP_ASPECT : null, focal });
    } catch {
      setBusy(false);
      setPending(null);
      return toast(t("ph.errProcess"));
    }
    const ext = extForMime(prepared.type);
    const n = nextPhotoIndex(photos);
    const key = `${itemId}/${n}.${ext}`;
    const { error } = await supabase.storage.from(PHOTO_BUCKET).upload(key, prepared.blob, { contentType: prepared.type, upsert: true });
    if (error) {
      setBusy(false);
      setPending(null);
      return toast(isDenied(error as { message?: string }) ? t("ph.errDenied") : t("ph.errUpload", { e: error.message }));
    }
    const stored = photoStoredPath(itemId, n, ext);
    const next = pending.at == null ? [...photos, stored] : photos.map((p, i) => (i === pending.at ? stored : p));
    // A replaced photo's old object is no longer referenced — remove it so the bucket does not grow.
    if (pending.at != null) {
      const old = objectKeyOf(photos[pending.at] as string);
      if (old) await supabase.storage.from(PHOTO_BUCKET).remove([old]);
    }
    await onChange(next);
    setBusy(false);
    setPending(null);
    toast(t("ph.uploaded", { s: `${Math.round(prepared.blob.size / 1024)} KB · ${prepared.width}×${prepared.height}` }), "ok");
  }

  async function remove(i: number) {
    const key = objectKeyOf(photos[i] as string);
    const next = photos.filter((_, k) => k !== i);
    await onChange(next);
    if (key) {
      const { error } = await supabase.storage.from(PHOTO_BUCKET).remove([key]);
      if (error) return toast(t("ph.orphanWarn", { e: error.message }));
    }
    toast(t("ph.removed"), "ok");
  }

  if (!itemId) return <span className="text-[12px] text-muted">{t("ph.saveFirst")}</span>;

  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex flex-wrap gap-2.5">
        {photos.map((p, i) => (
          <figure
            key={p}
            draggable
            onDragStart={() => setDragging(i)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => {
              if (dragging != null && dragging !== i) void onChange(movePhoto(photos, dragging, i));
              setDragging(null);
            }}
            onDragEnd={() => setDragging(null)}
            className={`group relative h-[104px] w-[104px] overflow-hidden rounded-[14px] bg-sand ${dragging === i ? "opacity-45" : ""}`}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={url(p)} alt="" className="h-full w-full object-cover" />
            {i === 0 && <figcaption className="absolute left-1 top-1 rounded bg-ink/80 px-1.5 py-px text-[9px] font-extrabold tracking-[0.06em] text-cream">{t("ph.card")}</figcaption>}
            <span className="absolute inset-x-0 bottom-0 flex justify-center gap-1 bg-ink/70 py-1 opacity-0 transition-micro group-hover:opacity-100 focus-within:opacity-100">
              {i > 0 && (
                <button type="button" title={t("ph.makeFirst")} aria-label={t("ph.makeFirst")} onClick={() => onChange(movePhoto(photos, i, 0))} className="px-1 text-[11px] text-cream">
                  ★
                </button>
              )}
              <button type="button" title={t("ph.replace")} aria-label={t("ph.replace")} onClick={() => { setReplaceAt(i); replaceInput.current?.click(); }} className="px-1 text-[11px] text-cream">
                ⟳
              </button>
              <button type="button" title={t("ph.remove")} aria-label={t("ph.remove")} onClick={() => remove(i)} className="px-1 text-[11px] text-cream">
                ✕
              </button>
            </span>
          </figure>
        ))}
        <button
          type="button"
          onClick={() => fileInput.current?.click()}
          disabled={busy}
          className="flex h-[104px] w-[104px] flex-col items-center justify-center gap-1 rounded-[14px] border border-dashed border-line-3 bg-field-2 text-[11px] font-extrabold text-orange transition-micro hover:border-orange-line"
        >
          {busy ? <Spinner /> : <span className="text-[16px]">+</span>}
          {busy ? t("ph.uploading") : t("ph.add")}
        </button>
      </div>
      <span className="text-[11px] leading-[1.45] text-muted">{t("ph.cropHint")}</span>

      <input ref={fileInput} type="file" accept="image/jpeg,image/png,image/webp,image/avif" hidden onChange={(e) => { pick(e.target.files, null); e.target.value = ""; }} />
      <input ref={replaceInput} type="file" accept="image/jpeg,image/png,image/webp,image/avif" hidden onChange={(e) => { pick(e.target.files, replaceAt); setReplaceAt(null); e.target.value = ""; }} />

      {pending && <CropDialog file={pending.file} focal={focal} setFocal={setFocal} cropOn={cropOn} setCropOn={setCropOn} busy={busy} onCancel={() => setPending(null)} onConfirm={upload} />}
    </div>
  );
}

function CropDialog({
  file, focal, setFocal, cropOn, setCropOn, busy, onCancel, onConfirm,
}: {
  file: File; focal: Focal; setFocal: (f: Focal) => void; cropOn: boolean; setCropOn: (v: boolean) => void; busy: boolean; onCancel: () => void; onConfirm: () => void;
}) {
  const { t } = useI18n();
  const [src] = useState(() => URL.createObjectURL(file));
  const pos = `${(focal.x * 100).toFixed(0)}% ${(focal.y * 100).toFixed(0)}%`;

  return (
    <Modal open onClose={onCancel} title={t("ph.cropTitle")} wide>
      <div className="flex flex-col gap-3.5">
        <span className="text-[12px] leading-[1.55] text-ink-3">{t("ph.cropBody")}</span>
        <div className="flex flex-wrap gap-4">
          <div
            role="presentation"
            onClick={(e) => {
              const r = e.currentTarget.getBoundingClientRect();
              setFocal({ x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)) });
            }}
            className="relative max-h-[280px] min-w-[220px] flex-1 cursor-crosshair overflow-hidden rounded-[14px] bg-field-2"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={src} alt="" className="max-h-[280px] w-full object-contain" />
            <span className="pointer-events-none absolute h-5 w-5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-orange/70 shadow-(--shadow-cta)" style={{ left: `${focal.x * 100}%`, top: `${focal.y * 100}%` }} />
          </div>
          <div className="flex gap-3">
            <Preview label={t("ph.card")} src={src} pos={pos} w={132} h={99} />
            <Preview label={t("ph.detail")} src={src} pos={pos} w={110} h={138} />
          </div>
        </div>
        <label className="flex items-center gap-2 text-[12px]">
          <input type="checkbox" checked={cropOn} onChange={(e) => setCropOn(e.target.checked)} />
          <span>{cropOn ? t("ph.crop") : t("ph.cropOff")}</span>
        </label>
        <span className="text-[11px] leading-[1.45] text-muted">{t("ph.focalHint")}</span>
        <div className="flex justify-end gap-2">
          <Pill variant="ghost" size="sm" onClick={onCancel}>
            {t("bulk.cancel")}
          </Pill>
          <Pill size="sm" onClick={onConfirm} disabled={busy}>
            {busy ? t("ph.uploading") : t("ph.cropApply")}
          </Pill>
        </div>
      </div>
    </Modal>
  );
}

function Preview({ label, src, pos, w, h }: { label: string; src: string; pos: string; w: number; h: number }) {
  return (
    <figure className="flex flex-col items-center gap-1">
      <span className="overflow-hidden rounded-[12px] bg-sand" style={{ width: w, height: h }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt="" className="h-full w-full object-cover" style={{ objectPosition: pos }} />
      </span>
      <figcaption className="label-caps">{label}</figcaption>
    </figure>
  );
}
