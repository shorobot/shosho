"use client";

// Team & roles (§6.9 row 2) — read through `staff_directory` (id, name, role, active), not the base
// `staff` table, which holds phone/PII and stays owner/operator (§6.9 row 2's own narrowing).
//
// The invite flow is NOT built, by design (S4-04-settings-cms.md's "depends on" note, restated in
// the S4-05 boot): it needs a service-role Edge Function, which cannot run in this anon-key app.
// Rendered as unavailable with the reason and the only manual path that actually exists given the
// schema today, rather than a disabled "Send" button that implies the feature almost works.
import { ReadOnlySection } from "@/components/settings/SettingsSection";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/States";
import { useI18n, type Key } from "@/lib/i18n";
import { sortTeam } from "@/lib/settings";
import { useSettings } from "@/lib/settingsStore";

const ROLE_KEY: Record<string, Key> = { owner: "set.role.owner", operator: "set.role.operator", kitchen: "set.role.kitchen", driver: "set.role.driver" };

export function TeamPanel() {
  const { t } = useI18n();
  const { team } = useSettings();
  const rows = sortTeam(team);

  return (
    <ReadOnlySection title={t("set.team")} hint={t("set.teamHint")}>
      {rows.length === 0 ? (
        <EmptyState icon="☺" title={t("state.noData.title")} body={t("set.teamHint")} />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[360px] border-collapse text-[12px]">
            <thead>
              <tr className="border-b border-line-2 text-left">
                {(["set.th.name", "set.th.role", "set.th.active"] as Key[]).map((k) => (
                  <th key={k} className="label-caps px-3 py-2.5 font-medium">
                    {t(k)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id ?? r.name} className="border-b border-line last:border-0">
                  <td className="px-3 py-2.5 font-medium">{r.name ?? "—"}</td>
                  <td className="px-3 py-2.5 text-ink-3">{r.role ? t(ROLE_KEY[r.role] ?? "set.role.operator") : "—"}</td>
                  <td className="px-3 py-2.5">
                    <Badge tone={r.active ? "ok" : "muted"}>{r.active ? t("set.activeYes") : t("set.activeNo")}</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="mt-3 flex flex-col gap-1.5 rounded-[14px] bg-field p-3.5">
        <span className="text-[12px] font-extrabold">{t("set.inviteTitle")}</span>
        <span className="text-[11px] leading-[1.5] text-muted">{t("set.inviteUnavailable")}</span>
        <span className="text-[11px] leading-[1.5] text-ink-3">{t("set.inviteManual")}</span>
      </div>
    </ReadOnlySection>
  );
}
