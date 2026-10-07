"use client";

// The allergy note. It is red and near the top because the same note is copied onto every order card
// and onto the kitchen receipt, "so the allergy never gets lost" (canvas note on BO · Profil).
//
// The boot asks for that consequence to be visible in the UI "so nobody edits it casually", and this
// is the whole reason the component is not just a textarea:
//   - the consequence is stated next to the field, not buried in a tooltip;
//   - editing is behind an explicit "bearbeiten" step, so it cannot be changed by tabbing through;
//   - saving a change to a note that already had content confirms first, naming what will happen.
// Clearing an allergy note is a decision about a guest's safety, and the UI says so in those words.
import { useState } from "react";
import { useSupabase } from "@/components/providers/EnvProvider";
import { Section } from "@/components/menu/Fields";
import { Modal } from "@/components/ui/Modal";
import { Pill } from "@/components/ui/Pill";
import { run, useCrm } from "@/lib/crmStore";
import { useI18n } from "@/lib/i18n";
import { toast } from "@/lib/toast";
import type { Customer } from "@/lib/types";

export function KitchenNote({ customer, canWrite }: { customer: Customer; canWrite: boolean }) {
  const { t, lang } = useI18n();
  const supabase = useSupabase();
  const { reload } = useCrm();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(customer.kitchen_note ?? "");
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);

  const current = customer.kitchen_note ?? "";
  const changed = text.trim() !== current.trim();

  async function save() {
    setBusy(true);
    const value = text.trim() === "" ? null : text.trim();
    const ok = await run(lang, () => supabase.from("customers").update({ kitchen_note: value }).eq("id", customer.id).select("id"));
    setBusy(false);
    setConfirm(false);
    if (!ok) return;
    toast(t("cd.added"), "ok");
    setEditing(false);
    await reload();
  }

  function attemptSave() {
    // Overwriting or clearing an existing note is the dangerous direction — confirm that one.
    // Adding a note where there was none is not.
    if (current.trim() !== "") setConfirm(true);
    else void save();
  }

  return (
    <Section
      title={<span className="text-alert">{t("cp.kitchenNote")}</span>}
      right={
        canWrite && !editing ? (
          <Pill variant="ghost" size="xs" onClick={() => { setText(current); setEditing(true); }}>
            {t("cp.kitchenNoteEdit")}
          </Pill>
        ) : undefined
      }
    >
      {editing ? (
        <div className="flex flex-col gap-2.5">
          <textarea
            className="field resize-y"
            rows={3}
            value={text}
            placeholder={t("cp.kitchenNotePlaceholder")}
            onChange={(e) => setText(e.target.value)}
            aria-label={t("cp.kitchenNote")}
          />
          <span className="rounded-xl bg-alert-tint p-2.5 text-[11px] leading-[1.5] font-medium text-alert">
            {t("cp.kitchenNoteConsequence")}
          </span>
          <div className="flex justify-end gap-2">
            <Pill variant="ghost" size="sm" onClick={() => { setEditing(false); setText(current); }}>
              {t("cp.kitchenNoteCancel")}
            </Pill>
            <Pill size="sm" onClick={attemptSave} disabled={busy || !changed}>
              {busy ? t("cd.saving") : t("cp.kitchenNoteSave")}
            </Pill>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {current ? (
            <p className="rounded-[14px] bg-alert-tint p-3 text-[13px] font-extrabold leading-[1.5] text-alert">{current}</p>
          ) : (
            <span className="text-[12px] text-muted">{t("cp.kitchenNoteEmpty")}</span>
          )}
          <span className="text-[11px] leading-[1.4] text-muted">{t("cp.kitchenNoteConsequence")}</span>
        </div>
      )}

      <Modal open={confirm} onClose={() => setConfirm(false)} title={t("cp.kitchenNoteWarnTitle")}>
        <div className="flex flex-col gap-3.5">
          <span className="text-[13px] leading-[1.55] text-ink-3">{t("cp.kitchenNoteWarnBody")}</span>
          <div className="flex flex-col gap-1.5 rounded-[14px] bg-field-2 p-3 text-[12px] leading-[1.5]">
            <span className="label-caps">{t("cp.kitchenNote")}</span>
            <span className="text-muted line-through">{current || "—"}</span>
            <span className="font-extrabold text-alert">{text.trim() || "—"}</span>
          </div>
          <div className="flex justify-end gap-2">
            <Pill variant="ghost" size="sm" onClick={() => setConfirm(false)}>
              {t("cp.kitchenNoteCancel")}
            </Pill>
            <Pill variant="alert" size="sm" onClick={save} disabled={busy}>
              {busy ? t("cd.saving") : t("cp.kitchenNoteSave")}
            </Pill>
          </div>
        </div>
      </Modal>
    </Section>
  );
}
