"use client";

// BO · Speisekarte — categories panel, item table and the shared option groups, in the layout the
// canvas shows. Everything below reads through <MenuProvider> (one load per visit to /menu*).
import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useEnv } from "@/components/providers/EnvProvider";
import { Pill } from "@/components/ui/Pill";
import { ErrorState, Spinner } from "@/components/ui/States";
import { Categories } from "@/components/menu/Categories";
import { ItemsTable } from "@/components/menu/ItemsTable";
import { OptionGroupsPanel } from "@/components/menu/OptionGroups";
import { useI18n } from "@/lib/i18n";
import { useMenu } from "@/lib/menuStore";

export function MenuScreen() {
  const { t, lang } = useI18n();
  const router = useRouter();
  const { siteUrl } = useEnv();
  const { categories, items, countByCategory, loading, error, reload, canWrite } = useMenu();
  const [selected, setSelected] = useState<string | null>(null);

  const category = categories.find((c) => c.id === selected);
  const count = selected ? countByCategory.get(selected) ?? 0 : items.length;
  const createHref = selected ? `/menu/item/new?category=${selected}` : "/menu/item/new";

  return (
    <div className="screen-in flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1>{t("menu.title")}</h1>
        <span className="text-[13px] font-medium text-muted">
          {category ? t("menu.sub", { c: lang === "de" ? category.name_de : category.name_en, n: count }) : t("menu.subAll", { n: count })}
        </span>
        <div className="ml-auto flex flex-wrap gap-2">
          <Link href="/menu/options" className="rounded-full bg-paper px-3.5 py-2 text-[12px] font-medium text-ink-2 shadow-(--shadow-pill) transition-micro hover:text-ink">
            {t("menu.options")}
          </Link>
          {siteUrl && (
            <a href={siteUrl} target="_blank" rel="noreferrer" className="rounded-full bg-paper px-3.5 py-2 text-[12px] font-medium text-ink-2 shadow-(--shadow-pill) transition-micro hover:text-ink">
              {t("menu.preview")}
            </a>
          )}
          {canWrite && (
            <Pill size="sm" onClick={() => router.push(createHref)}>
              {t("menu.newItem")}
            </Pill>
          )}
        </div>
      </div>

      {!canWrite && <div className="rounded-[14px] bg-sky-tint px-3.5 py-2.5 text-[12px] text-ink-2">{t("menu.readOnly")}</div>}
      {error && <ErrorState title={t("menu.loadError")} body={error} actions={<Pill size="sm" variant="ghost" onClick={() => reload()}>{t("menu.retry")}</Pill>} />}
      {loading && <Spinner label={t("misc.loading")} />}

      <div className="flex flex-col gap-4 lg:flex-row">
        <Categories selected={selected} onSelect={setSelected} onCreateItem={() => router.push(createHref)} />
        <ItemsTable categoryId={selected} onCreateItem={() => router.push(createHref)} />
        <div className="w-full lg:w-[260px] lg:flex-none">
          <OptionGroupsPanel compact />
        </div>
      </div>
    </div>
  );
}
