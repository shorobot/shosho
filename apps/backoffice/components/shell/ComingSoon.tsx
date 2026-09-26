"use client";

import { EmptyState } from "@/components/ui/States";
import { PillLink } from "@/components/ui/Pill";
import { useT, type Key } from "@/lib/i18n";

export function ComingSoon({ section }: { section: Key }) {
  const t = useT();
  return (
    <div className="screen-in mx-auto flex max-w-[640px] flex-col gap-4">
      <h1>{t(section)}</h1>
      <EmptyState icon="◷" title={t("soon.title")} body={t("soon.body", { s: t(section) })} action={<PillLink href="/orders">{t("soon.cta")}</PillLink>} />
    </div>
  );
}
