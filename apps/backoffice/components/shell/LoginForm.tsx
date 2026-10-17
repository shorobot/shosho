"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { useEnv, useSupabase } from "@/components/providers/EnvProvider";
import { LangToggle } from "@/components/shell/LangToggle";
import { Logo } from "@/components/shell/Logo";
import { Pill } from "@/components/ui/Pill";
import { useT } from "@/lib/i18n";
import { safeNextPath } from "@/lib/safeRedirect";

export function LoginForm({ configured }: { configured: boolean }) {
  const t = useT();
  return (
    <main className="screen-in flex min-h-dvh items-center justify-center p-6">
      <div className="w-full max-w-[400px]">
        <div className="mb-6 flex items-center justify-between">
          <Logo light={false} />
          <div className="w-[104px]">
            <LangToggle dark={false} />
          </div>
        </div>
        <div className="card rounded-[24px] p-6">
          <h1 className="mb-1">{t("login.title")}</h1>
          <p className="mb-5 text-[12px] font-medium text-muted">{t("login.sub")}</p>
          {configured ? <Form /> : <p className="rounded-xl bg-alert-tint p-3 text-[12px] font-medium text-alert">{t("login.unconfigured")}</p>}
        </div>
      </div>
    </main>
  );
}

function Form() {
  const t = useT();
  const router = useRouter();
  const env = useEnv();
  const supabase = useSupabase();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // S6-01 finding 3 (LOW): defence in depth, layered under the real fix (finding 0, lib/csp.ts's
  // dev-only 'unsafe-eval' carve-out — filed separately). `hydrated` starts false, which SSR bakes
  // into the submit control's `disabled` attribute in the markup the browser paints first — so a
  // click landing in the window before React attaches hits a button the browser itself refuses to
  // submit, with no JS required for that part. Once attached, the effect below flips it live.
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    if (error) {
      setError(t("login.error"));
      setBusy(false);
      return;
    }
    // `?next=` is attacker-controllable, so it is validated, not trusted (lib/safeRedirect.ts).
    const next = new URLSearchParams(window.location.search).get("next");
    router.replace(safeNextPath(next, window.location.origin));
    router.refresh();
  }

  return (
    // method="post" action="#": a pre-hydration native submission (if the disabled button above
    // somehow still fires — e.g. a very old browser ignoring the attribute) posts nowhere useful
    // instead of falling through to a GET that puts the password in the URL (S6-01 finding 3,
    // observed live in CI: /login?email=…&password=…).
    <form onSubmit={onSubmit} method="post" action="#" className="flex flex-col gap-3" data-env={env.supabaseUrl ? "ok" : "missing"}>
      <label className="flex flex-col gap-1.5">
        <span className="label-caps">{t("login.email")}</span>
        <input className="field" type="email" name="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
      </label>
      <label className="flex flex-col gap-1.5">
        <span className="label-caps">{t("login.password")}</span>
        <input className="field" type="password" name="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
      </label>
      {error && (
        <p role="alert" className="rounded-xl bg-alert-tint px-3 py-2 text-[12px] font-extrabold text-alert">
          {error}
        </p>
      )}
      <Pill type="submit" size="lg" className="mt-2 w-full" disabled={busy || !hydrated}>
        {busy ? t("action.working") : t("login.submit")}
      </Pill>
    </form>
  );
}
