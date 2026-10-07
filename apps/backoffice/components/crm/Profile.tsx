"use client";

// BO · Profil. Contacts, both addresses, the kitchen note, GDPR consents with date and source, the
// stats block, most-ordered items, and the merged timeline.
import Link from "next/link";
import { useMemo, useState } from "react";
import { CustomerTimeline } from "@/components/crm/CustomerTimeline";
import { EventDialog, type EventKind } from "@/components/crm/EventDialog";
import { GdprControls } from "@/components/crm/GdprControls";
import { KitchenNote } from "@/components/crm/KitchenNote";
import { Section } from "@/components/menu/Fields";
import { Badge } from "@/components/ui/Badge";
import { Pill, PillLink } from "@/components/ui/Pill";
import { EmptyState, ErrorState, Spinner } from "@/components/ui/States";
import {
  consentsOf, effectiveDaysSilent, isAnonymised, isErasureRequest, mergeTimeline, TAGS, topItems, withTag,
  type Tag,
} from "@/lib/crm";
import { run, useCrm, useCustomerDetail } from "@/lib/crmStore";
import { useI18n, type Key } from "@/lib/i18n";
import { euro } from "@/lib/money";
import { ddmm, ddmmHHmm } from "@/lib/time";
import { Toasts } from "@/lib/toast";
import { useSupabase } from "@/components/providers/EnvProvider";
import type { ConsentChannel, Customer, CustomerUpdate, Json } from "@/lib/types";

const CONSENT_LABEL = { email: "cp.consentEmail", push: "cp.consentPush", phone: "cp.consentPhone" } as const;

export function Profile({ customerId }: { customerId: string }) {
  const { t, lang } = useI18n();
  const { rows, staff, loading: listLoading, error: listError, now, canWrite } = useCrm();
  const { events, orders, loading, error, reload } = useCustomerDetail(customerId);
  const [dialog, setDialog] = useState<EventKind | null>(null);

  const row = rows.find((r) => r.customer.id === customerId);
  const entries = useMemo(() => mergeTimeline(events, orders), [events, orders]);
  const items = useMemo(() => topItems(orders), [orders]);

  if (listLoading || loading) return <Spinner label={t("crm.loading")} />;
  if (listError || error) return <ErrorState title={t("crm.loadError")} body={listError ?? error ?? ""} />;
  if (!row) {
    return (
      <EmptyState
        icon="☻"
        title={t("cp.notFound")}
        body={t("cp.notFoundBody")}
        action={<PillLink href="/customers" size="sm" variant="ghost">{t("cp.back")}</PillLink>}
      />
    );
  }

  const c = row.customer;
  const stats = row.stats;
  const anon = isAnonymised(c);
  const silent = effectiveDaysSilent(stats, now);
  const addresses = [...c.customer_addresses].sort((a, b) => Number(b.is_default) - Number(a.is_default));
  const primary = addresses[0];
  const pendingErasure = entries.find((e) => isErasureRequest(e));

  return (
    <div className="screen-in flex flex-col gap-4">
      <header className="flex flex-wrap items-center gap-3">
        <Link
          href="/customers"
          aria-label={t("cp.back")}
          className="flex h-9 w-9 flex-none items-center justify-center rounded-full bg-paper text-[14px] shadow-(--shadow-pill)"
        >
          ‹
        </Link>
        <h1 className="text-[22px] font-extrabold">{c.name}</h1>
        <span className="flex flex-wrap gap-1">
          {anon && <Badge tone="muted">{t("ct.anonymised")}</Badge>}
          {c.tags.map((tg) => (
            <Badge key={tg} tone={tg === "PROBLEM" ? "alert" : tg === "ALLERGIE" ? "amber" : tg === "VIP" ? "orange" : "sky"}>
              {tg}
            </Badge>
          ))}
        </span>
        <div className="ml-auto flex flex-wrap gap-1.5">
          <Pill variant="ghost" size="sm" onClick={() => (window.location.href = `tel:${c.phone}`)}>
            ☏ {t("cp.call")}
          </Pill>
          {/* No messaging channel and no voucher issuing exist yet (S5 / S2-06) — disabled, with the
              reason in the tooltip, rather than a button that silently does nothing. */}
          <Pill variant="ghost" size="sm" disabled title={t("cb.pushUnavailable")}>
            ✉ {t("cp.message")}
          </Pill>
          <Pill variant="ghost" size="sm" disabled title={t("cb.voucherUnavailable")}>
            % {t("cp.voucher")}
          </Pill>
          <PillLink href={`/orders?phone=${c.id}`} size="sm">
            {t("cp.createOrder")}
          </PillLink>
        </div>
      </header>

      {anon && (
        <EmptyState
          icon="–"
          title={t("ce.anonymisedTitle")}
          body={t("ce.anonymisedBody", { d: ddmm(c.anonymised_at) })}
        />
      )}

      {pendingErasure && (
        <ErrorState
          tone="warn"
          title={t("cd.erasureTitle")}
          body={t("cd.erasurePending", { d: ddmmHHmm(pendingErasure.at) })}
        />
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        <div className="flex flex-col gap-4">
          <Section title={t("ct.contact")} hint={t("cp.customerSince", { d: ddmm(c.created_at) })}>
            <div className="flex flex-col gap-1.5 text-[13px]">
              <a href={`tel:${c.phone}`} className="font-extrabold underline decoration-line-2 underline-offset-2">
                {c.phone}
              </a>
              {c.email ? (
                <a href={`mailto:${c.email}`} className="text-ink-2 underline decoration-line-2 underline-offset-2">
                  {c.email}
                </a>
              ) : null}
              {primary ? (
                <span className="text-ink-2">
                  {[primary.street, primary.floor_apt].filter(Boolean).join(", ")} · {primary.postal_code} {primary.city}
                </span>
              ) : (
                <span className="text-muted">{t("cp.noAddress")}</span>
              )}
              {addresses.slice(1).map((a) => (
                <span key={a.id} className="text-[12px] text-muted">
                  {t("cp.secondAddress", { a: `${a.street}${a.label ? ` (${a.label})` : ""}` })}
                </span>
              ))}
            </div>
          </Section>

          <KitchenNote customer={c} canWrite={canWrite} />

          <Section title={t("cp.consents")}>
            <Consents customer={c} canWrite={canWrite} />
            <GdprControls customer={c} stats={stats} events={events} orders={orders} canWrite={canWrite} onFiled={reload} />
          </Section>

          {canWrite && (
            <Section title={t("ct.actions")}>
              <div className="flex flex-wrap gap-1.5">
                <Pill variant="soft" size="sm" onClick={() => setDialog("note")}>
                  + {t("cp.addNote")}
                </Pill>
                <Pill variant="soft" size="sm" onClick={() => setDialog("complaint")}>
                  + {t("cp.addComplaint")}
                </Pill>
                <Pill variant="soft" size="sm" onClick={() => setDialog("compensation")}>
                  + {t("cp.addCompensation")}
                </Pill>
              </div>
              <Tags customer={c} />
            </Section>
          )}
        </div>

        <div className="flex flex-col gap-4">
          <Section title={t("cp.statsOrders")}>
            {stats.orders_count === 0 ? (
              <EmptyState icon="◷" title={t("ce.noOrdersTitle")} body={t("ce.noOrdersBody")} />
            ) : (
              <>
                <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
                  <Stat label={t("cp.statsOrders")} value={String(stats.orders_count)} />
                  <Stat label={t("cp.statsSpend")} value={euro(stats.spent_cents, lang)} />
                  <Stat label={t("cp.statsAvg")} value={euro(stats.avg_cents, lang)} />
                  <Stat label={t("cp.statsInterval")} value={silent == null ? "—" : t("ct.days", { n: silent })} />
                </div>
                {stats.cancelled_count > 0 && (
                  <span className="text-[11px] text-muted">{t("ct.cancelled", { n: stats.cancelled_count })}</span>
                )}
                {/* S2-04: a non-cash order with no provider reaches delivered/picked_up with
                    payment_status untouched. Until Stripe exists that is correct — said plainly
                    rather than hidden or coerced. */}
                {orders.some((o) => o.payment_status === "pending" && (o.status === "delivered" || o.status === "picked_up")) && (
                  <span className="rounded-xl bg-sky-tint p-2.5 text-[11px] leading-[1.5] text-ink-2">{t("cp.unpaidHint")}</span>
                )}
              </>
            )}
          </Section>

          <Section title={t("cp.topItems")}>
            {items.length === 0 ? (
              <span className="text-[12px] text-muted">{t("cp.topItemsNone")}</span>
            ) : (
              <ul className="flex flex-col gap-1.5 text-[13px]">
                {items.map((i) => (
                  <li key={i.name} className="flex justify-between gap-3">
                    <span className="truncate">{i.name}</span>
                    <span className="flex-none font-extrabold">{i.count}×</span>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section title={t("cp.activity")}>
            <CustomerTimeline entries={entries} staff={staff} />
          </Section>
        </div>
      </div>

      {dialog && (
        <EventDialog
          kind={dialog}
          customerId={customerId}
          orders={orders}
          onClose={() => setDialog(null)}
          onSaved={reload}
        />
      )}
      <Toasts />
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5 rounded-[14px] bg-field-2 px-3.5 py-3">
      <span className="label-caps">{label}</span>
      <span className="text-[17px] font-extrabold leading-[1.2]">{value}</span>
    </div>
  );
}

/**
 * Consents, read-only by default and written through so the `consent_changed` trigger fires. Nothing
 * is computed locally: the stored `{granted_at, source}` is what the screen shows, because a consent
 * record that disagrees with the database is worse than no record (§6.8).
 */
function Consents({ customer, canWrite }: { customer: Customer; canWrite: boolean }) {
  const { t, lang } = useI18n();
  const supabase = useSupabase();
  const { reload } = useCrm();
  const [busy, setBusy] = useState<string | null>(null);

  async function setConsent(channel: ConsentChannel, grant: boolean) {
    setBusy(channel);
    // Written through rather than patched locally, so `customers_consent_changed` writes the
    // consent_changed event with who, which channel and the source. The patch is spelled out per
    // column instead of built from a computed key, which would widen the value type to `never`.
    const value: Json = grant ? { granted_at: new Date().toISOString(), source: t("cp.consentSourceBackoffice") } : null;
    const patch: CustomerUpdate =
      channel === "email" ? { consent_email: value } : channel === "push" ? { consent_push: value } : { consent_phone: value };
    const ok = await run(lang, () => supabase.from("customers").update(patch).eq("id", customer.id).select("id"));
    setBusy(null);
    if (ok) await reload();
  }

  return (
    <ul className="flex flex-col gap-2">
      {consentsOf(customer).map((c) => (
        <li key={c.channel} className="flex flex-wrap items-center gap-2 text-[13px]">
          <span className="min-w-[140px] font-extrabold">{t(CONSENT_LABEL[c.channel] as Key)}</span>
          {c.granted ? (
            <span className="text-[12px] text-ink-2">
              {c.source
                ? t("cp.consentSource", { d: c.grantedAt ? ddmm(c.grantedAt) : "—", s: c.source })
                : t("cp.consentNoSource", { d: c.grantedAt ? ddmm(c.grantedAt) : "—" })}
            </span>
          ) : (
            <span className="text-[12px] text-muted">{t("cp.consentNotGiven")}</span>
          )}
          {canWrite && (
            <Pill
              variant="ghost"
              size="xs"
              className="ml-auto"
              disabled={busy === c.channel}
              onClick={() => setConsent(c.channel, !c.granted)}
            >
              {c.granted ? t("cp.consentRevoke") : t("cp.consentGrant")}
            </Pill>
          )}
        </li>
      ))}
    </ul>
  );
}

function Tags({ customer }: { customer: Customer }) {
  const { t, lang } = useI18n();
  const supabase = useSupabase();
  const { reload } = useCrm();
  const [busy, setBusy] = useState(false);

  async function toggle(tag: Tag) {
    setBusy(true);
    const ok = await run(lang, () =>
      supabase.from("customers").update({ tags: withTag(customer.tags, tag, !customer.tags.includes(tag)) }).eq("id", customer.id).select("id"),
    );
    setBusy(false);
    if (ok) await reload();
  }

  return (
    <div className="flex flex-wrap gap-1.5">
      {TAGS.map((tg) => {
        const on = customer.tags.includes(tg);
        return (
          <button
            key={tg}
            type="button"
            disabled={busy}
            aria-pressed={on}
            onClick={() => toggle(tg)}
            className={`rounded-full px-3 py-1.5 text-[11px] leading-[1.3] transition-micro ${on ? "bg-ink font-extrabold text-cream" : "bg-field font-medium text-ink-2 hover:text-ink"}`}
          >
            {tg}
          </button>
        );
      })}
      <span className="sr-only">{t("ct.tagFilter")}</span>
    </div>
  );
}
