"use client";

import { Logo } from "@/components/shell/Logo";
import { EmptyState } from "@/components/ui/States";
import { Pill } from "@/components/ui/Pill";
import { useT } from "@/lib/i18n";

export function NoAccess({ email }: { email: string }) {
  const t = useT();
  return (
    <main className="screen-in flex min-h-dvh items-center justify-center p-6">
      <div className="w-full max-w-[420px]">
        <div className="mb-6 flex justify-center">
          <Logo light={false} />
        </div>
        <EmptyState
          icon="☻"
          title={t("noaccess.title")}
          body={t("noaccess.body", { email })}
          action={
            <form action="/auth/signout" method="post">
              <Pill type="submit">{t("noaccess.cta")}</Pill>
            </form>
          }
        />
      </div>
    </main>
  );
}
