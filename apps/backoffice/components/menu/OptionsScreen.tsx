"use client";

// /menu/options — the shared option groups on their own page: usage count per group, create and
// edit, and the warning before a shared group is saved (the design says it in so many words).
import Link from "next/link";
import { OptionGroupsPanel } from "@/components/menu/OptionGroups";
import { Spinner } from "@/components/ui/States";
import { useI18n } from "@/lib/i18n";
import { useMenu } from "@/lib/menuStore";

export function OptionsScreen() {
  const { t } = useI18n();
  const { loading } = useMenu();
  return (
    <div className="screen-in mx-auto flex w-full max-w-[720px] flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <Link href="/menu" className="flex h-8 w-8 items-center justify-center rounded-full bg-paper text-[14px] text-ink-2 shadow-(--shadow-pill)" aria-label={t("ie.back")}>
          ‹
        </Link>
        <h1>{t("og.title")}</h1>
        <span className="text-[13px] font-medium text-muted">{t("og.sub")}</span>
      </div>
      {loading ? <Spinner label={t("misc.loading")} /> : <OptionGroupsPanel />}
    </div>
  );
}
