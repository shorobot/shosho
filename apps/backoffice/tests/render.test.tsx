// Render smoke tests for BO · Website and BO · Marketing.
//
// WHY THESE EXIST. Typecheck and `next build` both pass on a component that throws the moment it
// renders — a null deref in a row, a `.map` over something that is not an array, a hook called in a
// branch. S4-03's lesson was that a back-office defect can typecheck, build and pass every test; the
// cheap guard is to actually render the screens. `react-dom/server` is already a dependency and runs
// in the node environment the suite uses, so this needs no browser and no database.
//
// It also pins the EMPTY STATES (boot task 11) to their copy: each one is rendered from the data
// shape that produces it, so a future refactor cannot quietly replace "no banners yet, here is why"
// with a blank panel.
//
// WHAT IT DOES NOT COVER, stated rather than implied: `useEffect` does not run under
// `renderToStaticMarkup`, so this is first-paint only — no data fetching, no post-mount state. The
// data-layer behaviour is covered against the live project in tests/anonDraft.live.test.ts and in the
// S4-04 staging walk-through recorded in /memory/log.md.
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";
import type { BannerRow, PublicationRow, SettingsRow, ZoneRow } from "@/lib/site";
import type { AutomationRow, CampaignRow, MarketingOrder, PromoRow } from "@/lib/marketing";
import type { Staff } from "@/lib/types";

/* ---------------------------------------------------------------- mocks */

const siteData = vi.hoisted(() => ({ current: null as unknown }));
const marketingData = vi.hoisted(() => ({ current: null as unknown }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
  usePathname: () => "/website",
  redirect: () => {
    throw new Error("unexpected redirect");
  },
}));

// The one browser dependency the screens have. Nothing here calls it during a first paint except
// the storage URL helper, so a minimal stub is honest rather than a shortcut.
vi.mock("@/components/providers/EnvProvider", () => ({
  useEnv: () => ({ supabaseUrl: "https://example.supabase.co", supabaseAnonKey: "anon", siteUrl: "https://shos.hellfiresol.com" }),
  useSupabase: () => ({
    storage: { from: () => ({ getPublicUrl: (k: string) => ({ data: { publicUrl: `https://example.supabase.co/storage/v1/object/public/site/${k}` } }) }) },
  }),
}));

vi.mock("@/lib/siteStore", async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  useSite: () => siteData.current,
}));

vi.mock("@/lib/marketingStore", async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  useMarketing: () => marketingData.current,
}));

/* ---------------------------------------------------------------- fixtures */

const NOW = new Date("2026-10-11T12:00:00Z");
const ME: Staff = { id: "u1", name: "K. Sato", role: "owner", active: true };

function banner(over: Partial<BannerRow> = {}): BannerRow {
  return {
    id: "b1", slot: "home_hero", image_path: null, title_de: "Signature Set −15 %", title_en: null,
    subtitle_de: null, subtitle_en: null, cta_label_de: null, cta_label_en: null, cta_href: null,
    valid_from: null, valid_to: null, sort: 0, active: true, draft: null,
    created_at: "2026-10-01T00:00:00Z", updated_at: "2026-10-01T00:00:00Z", ...over,
  } as BannerRow;
}

const SETTINGS: SettingsRow[] = [
  { key: "business", value: { name: "Shosho Sushi GmbH", address: { street: "Torstraße 000", postal_code: "10119", city: "Berlin", country: "DE" }, phone: "+49 30 0000000", email: "hello@shosho.berlin", impressum: "…", ust_id: "DE000000000" }, draft: null, created_at: "", updated_at: "" },
  { key: "opening_hours", value: { mon: [["11:00", "23:00"]], sun: [], holidays: [] }, draft: null, created_at: "", updated_at: "" },
  { key: "site", value: { seo: { title: "SHOSHO", description: "Sushi" }, cookie_banner: true, robots: "index,follow", maintenance: false, free_delivery_hint_cents: 3500 }, draft: null, created_at: "", updated_at: "" },
] as SettingsRow[];

const ZONE: ZoneRow = {
  id: "z1", code: "A", name: "Zone A", areas: "Mitte, Prenzlauer Berg", min_order_cents: 1500,
  fee_cents: 0, free_delivery_over_cents: 3500, promised_minutes: 45, active: true,
  postal_codes: ["10119", "10435"], created_at: "", updated_at: "",
} as ZoneRow;

const PUBLICATION: PublicationRow = {
  id: "p1", at: "2026-10-10T15:20:00Z", actor_id: "u1",
  summary: { settings_keys: ["site"], banner_ids: ["b1"] },
  snapshot: { settings: { site: { from: { seo: { title: "alt" } }, to: { seo: { title: "neu" } } } } },
} as PublicationRow;

function site(over: Record<string, unknown> = {}) {
  return {
    me: ME, canEditSettings: true, canEditContent: true, canPublish: true,
    settings: SETTINGS, banners: [] as BannerRow[], zones: [] as ZoneRow[], publications: [] as PublicationRow[],
    staff: [{ id: "u1", name: "K. Sato", role: "owner", active: true }],
    loading: false, error: null, now: NOW, pending: [],
    settingsByKey: new Map(SETTINGS.map((s) => [s.key, s])),
    reload: async () => {}, stageSetting: async () => true, publish: async () => null,
    ...over,
  };
}

const PROMO: PromoRow = {
  id: "pc1", code: "SHOSHO10", kind: "percent", value: 10, min_order_cents: 0,
  applies_to: { scope: "all" }, usage_limit: 1000, used_count: 312, valid_from: null,
  valid_to: "2026-12-31T00:00:00Z", active: true, created_at: "", updated_at: "",
} as PromoRow;

const CAMPAIGN: CampaignRow = {
  id: "c1", name: "Neue Bowls", channel: "push", segment: { min_days_silent: 60 },
  message_de: { title: "Wir vermissen dich", body: "−15 % auf Sets" }, message_en: {},
  status: "draft", scheduled_for: null, sent_at: null, stats: {},
  created_at: "2026-10-01T00:00:00Z", updated_at: "",
} as CampaignRow;

const AUTOMATIONS: AutomationRow[] = (["welcome", "win_back_45d", "birthday", "review_after_delivery"] as const).map(
  (kind, i) => ({ id: `a${i}`, kind, active: false, config: {}, last_run_at: null, created_at: "", updated_at: "" }) as AutomationRow,
);

const ORDERS: MarketingOrder[] = [
  { created_at: "2026-10-05T12:00:00Z", status: "delivered", total_cents: 3600, discount_cents: 400, promo_code: "SHOSHO10" },
  { created_at: "2026-10-06T12:00:00Z", status: "delivered", total_cents: 5000, discount_cents: 0, promo_code: null },
];

function marketing(over: Record<string, unknown> = {}) {
  return {
    me: ME, canWrite: true, promos: [] as PromoRow[], campaigns: [] as CampaignRow[],
    automations: AUTOMATIONS, runs: [], categories: [], orders: [] as MarketingOrder[],
    customerCount: 5, loading: false, error: null, now: NOW,
    from: new Date("2026-09-11T12:00:00Z"), to: NOW,
    reload: async () => {}, resolveSegment: async () => [],
    ...over,
  };
}

/** Render, and let any throw fail the test with its own message rather than a generic one. */
function html(el: ReactElement): string {
  return renderToStaticMarkup(el);
}

/* ================================================================ Website */

describe("BO · Website renders", () => {
  it("the whole screen with content", async () => {
    siteData.current = site({
      banners: [banner(), banner({ id: "b2", title_de: "Mittagsangebot", valid_from: "2026-12-01T00:00:00Z" })],
      zones: [ZONE],
      publications: [PUBLICATION],
    });
    const { WebsiteScreen } = await import("@/components/website/WebsiteScreen");
    const out = html(<WebsiteScreen />);
    expect(out).toContain("Website");
    expect(out).toContain("Signature Set");
    expect(out).toContain("Mitte, Prenzlauer Berg");
    expect(out).toContain("Shosho Sushi GmbH");
  });

  it("the publish bar with nothing pending — and says the site matches what is saved", async () => {
    siteData.current = site();
    const { PublishBar } = await import("@/components/website/PublishBar");
    const out = html(<PublishBar />);
    expect(out).toContain("Keine unveröffentlichten Änderungen");
    expect(out).toContain("Die Website zeigt genau den gespeicherten Stand");
  });

  it("the publish bar with two pending changes — counted AND named, with what publishing does", async () => {
    siteData.current = site({
      pending: [{ kind: "setting", key: "site" }, { kind: "banner", id: "b1", name: "Signature Set" }],
      banners: [banner({ draft: { title_de: "Signature Set" } })],
    });
    const { PublishBar } = await import("@/components/website/PublishBar");
    const out = html(<PublishBar />);
    expect(out).toContain("2 unveröffentlichte Änderungen");
    expect(out).toContain("Einstellungen: site");
    // The one sentence a non-technical owner learns the staging model from (boot task 4).
    expect(out).toContain("erst mit „Veröffentlichen“ live gestellt");
  });

  it("the publish bar for an OPERATOR — their edits are saved and they are told who publishes", async () => {
    siteData.current = site({ canPublish: false, canEditSettings: false, pending: [{ kind: "setting", key: "site" }] });
    const { PublishBar } = await import("@/components/website/PublishBar");
    const out = html(<PublishBar />);
    expect(out).toContain("Veröffentlichen kann nur der Inhaber");
  });

  it("EMPTY STATE — no banners, with the reason and the next action", async () => {
    siteData.current = site();
    const { BannerList } = await import("@/components/website/BannerList");
    const out = html(<BannerList />);
    expect(out).toContain("Noch kein Banner angelegt");
    expect(out).toContain("läuft nach der Aktion automatisch aus");
    expect(out).toContain("Die Website zeigt gerade keinen Banner");
  });

  it("every banner state is labelled with WHY, next to what banners_live actually returns", async () => {
    siteData.current = site({
      banners: [
        banner({ id: "live" }),
        banner({ id: "sched", title_de: "Neue Bowls", valid_from: "2026-12-01T00:00:00Z" }),
        banner({ id: "gone", title_de: "Sommer", valid_to: "2026-08-31T00:00:00Z" }),
        banner({ id: "off", title_de: "Entwurf", active: false }),
      ],
    });
    const { BannerList } = await import("@/components/website/BannerList");
    const out = html(<BannerList />);
    for (const label of ["LIVE", "GEPLANT", "ABGELAUFEN", "INAKTIV"]) expect(out).toContain(label);
    expect(out).toContain("Startet am");
    expect(out).toContain("Zeitraum endete am");
    expect(out).toContain("Nicht aktiviert");
    // The live panel lists only the one row the storefront is showing.
    expect(out).toContain("Was die Website jetzt zeigt");
  });

  it("a staged banner carries the ENTWURF badge", async () => {
    siteData.current = site({ banners: [banner({ draft: { title_de: "Neuer Titel" } })] });
    const { BannerList } = await import("@/components/website/BannerList");
    const out = html(<BannerList />);
    expect(out).toContain("ENTWURF");
    expect(out).toContain("Neuer Titel");
  });

  it("EMPTY STATE — no delivery zone, saying pickup still works", async () => {
    siteData.current = site();
    const { ZonesPanel } = await import("@/components/website/ZonesPanel");
    const out = html(<ZonesPanel />);
    expect(out).toContain("Noch kein Liefergebiet");
    expect(out).toContain("Abholung funktioniert weiterhin");
    // And the thing that would otherwise be a silent surprise.
    expect(out).toContain("nicht Teil des Entwurfs");
  });

  it("EMPTY STATE — no publish history", async () => {
    siteData.current = site();
    const { PublishHistory } = await import("@/components/website/PublishHistory");
    const out = html(<PublishHistory />);
    expect(out).toContain("Noch nichts veröffentlicht");
  });

  it("publish history with a row names the actor and the size of the publish", async () => {
    siteData.current = site({ publications: [PUBLICATION] });
    const { PublishHistory } = await import("@/components/website/PublishHistory");
    const out = html(<PublishHistory />);
    expect(out).toContain("K. Sato");
    expect(out).toContain("2 Änderungen");
  });

  it("the settings panels are read-only for an operator, with the reason", async () => {
    siteData.current = site({ canEditSettings: false });
    const { BusinessPanel } = await import("@/components/website/BusinessPanel");
    const { SeoPanel } = await import("@/components/website/SeoPanel");
    const { HoursPanel } = await import("@/components/website/HoursPanel");
    for (const out of [html(<BusinessPanel />), html(<SeoPanel />), html(<HoursPanel />)]) {
      expect(out).toContain("darf nur der Inhaber ändern");
      expect(out).toContain("disabled");
    }
  });

  it("maintenance mode warns about what publishing it would do", async () => {
    const staged = SETTINGS.map((s) => (s.key === "site" ? { ...s, draft: { ...(s.value as object), maintenance: true } } : s));
    siteData.current = site({ settings: staged, settingsByKey: new Map(staged.map((s) => [s.key, s])) });
    const { SeoPanel } = await import("@/components/website/SeoPanel");
    const out = html(<SeoPanel />);
    expect(out).toContain("stoppt jede Bestellung");
    expect(out).toContain("ENTWURF");
  });
});

/* ================================================================ Marketing */

describe("BO · Marketing renders", () => {
  it("the whole screen with content", async () => {
    marketingData.current = marketing({ promos: [PROMO], campaigns: [CAMPAIGN], orders: ORDERS });
    const { MarketingScreen } = await import("@/components/marketing/MarketingScreen");
    const out = html(<MarketingScreen />);
    expect(out).toContain("Marketing");
    expect(out).toContain("SHOSHO10");
    expect(out).toContain("Neue Bowls");
  });

  it("the push-open-rate KPI is UNAVAILABLE with its reason, not a zero", async () => {
    marketingData.current = marketing({ orders: ORDERS, campaigns: [CAMPAIGN] });
    const { Kpis } = await import("@/components/marketing/Kpis");
    const out = html(<Kpis />);
    expect(out).toContain("PUSH-ÖFFNUNGSRATE");
    expect(out).toContain("nicht messbar");
    expect(out).toContain("Es gibt noch keinen Versand");
    // The order-derived KPIs ARE real numbers from the same render.
    expect(out).toContain("UMSATZ AUS AKTIONEN");
  });

  it("with no completed orders, the order KPIs say why instead of reading 0", async () => {
    marketingData.current = marketing();
    const { Kpis } = await import("@/components/marketing/Kpis");
    const out = html(<Kpis />);
    expect(out).toContain("Im Zeitraum liegen keine abgeschlossenen Bestellungen");
  });

  it("EMPTY STATE — no promo codes", async () => {
    marketingData.current = marketing();
    const { PromoCodes } = await import("@/components/marketing/PromoCodes");
    const out = html(<PromoCodes />);
    expect(out).toContain("Noch kein Promocode");
  });

  it("an exhausted code stays visible, dimmed, with its counter in the alert colour", async () => {
    marketingData.current = marketing({ promos: [{ ...PROMO, code: "SOMMER20", usage_limit: 500, used_count: 500 }] });
    const { PromoCodes } = await import("@/components/marketing/PromoCodes");
    const out = html(<PromoCodes />);
    expect(out).toContain("SOMMER20");
    expect(out).toContain("AUSGESCHÖPFT");
    expect(out).toContain("text-alert");
  });

  it("EMPTY STATE — no campaigns, saying drafts save but nothing sends", async () => {
    marketingData.current = marketing();
    const { CampaignList } = await import("@/components/marketing/CampaignList");
    const out = html(<CampaignList />);
    expect(out).toContain("Noch keine Kampagne");
    expect(out).toContain("versendet wird noch nicht");
  });

  it("campaign stats render as — rather than 0 while there is no sender", async () => {
    marketingData.current = marketing({ campaigns: [CAMPAIGN] });
    const { CampaignList } = await import("@/components/marketing/CampaignList");
    const out = html(<CampaignList />);
    expect(out).toContain("GESENDET");
    expect(out).toContain("—");
    expect(out).not.toMatch(/UMSATZ<\/span><span[^>]*>0,00/);
  });

  it("the automations list the four kinds and say nothing runs them", async () => {
    marketingData.current = marketing();
    const { Automations } = await import("@/components/marketing/Automations");
    const out = html(<Automations />);
    for (const label of ["Willkommensrabatt", "Rückgewinnung nach 45 Tagen", "Geburtstagsgutschein", "Bewertung nach Lieferung"]) {
      expect(out).toContain(label);
    }
    expect(out).toContain("Der Schalter speichert die Absicht");
    // The weekly cap is attributed to the trigger, not to this screen.
    expect(out).toContain("diese Grenze sitzt als Trigger in der Datenbank");
    expect(out).toContain("Noch kein Protokolleintrag");
  });

  it("the discount chart says so when the window has no completed orders", async () => {
    marketingData.current = marketing();
    const { DiscountChart } = await import("@/components/marketing/DiscountChart");
    const out = html(<DiscountChart />);
    expect(out).toContain("Im Zeitraum liegen keine abgeschlossenen Bestellungen");
    expect(out).toContain("Noch keine Einlösung im Zeitraum");
  });
});

/* ================================================================ the wizard */

describe("the Kampagne wizard renders", () => {
  it("with the send button disabled and every missing piece named", async () => {
    marketingData.current = marketing();
    const { CampaignWizard } = await import("@/components/marketing/CampaignWizard");
    const out = html(<CampaignWizard campaign={null} />);
    expect(out).toContain("Nachricht senden");
    // The honest disabled send (boot task 7).
    expect(out).toContain("Senden ist nicht möglich");
    expect(out).toContain("es gibt keinen Versanddienst");
    expect(out).toContain("es gibt keinen Speicher für Push-Adressen");
    expect(out).toContain("disabled");
    expect(out).toContain("ein Knopf, der in eine leere Warteschlange schreibt, wäre schlimmer als ein deaktivierter");
    // Drafting and scheduling are real.
    expect(out).toContain("Als Entwurf speichern");
    expect(out).toContain("Termin speichern");
  });

  it("EMPTY STATE — a segment matching zero consented customers, with the reason", async () => {
    // `useEffect` does not run in SSR, so `reach` is still null on first paint: exactly the state a
    // zero-consent resolve produces, which is the real state on staging today (0 consented customers).
    marketingData.current = marketing();
    const { CampaignWizard } = await import("@/components/marketing/CampaignWizard");
    const out = html(<CampaignWizard campaign={null} />);
    expect(out).toContain("Kein Kunde mit Einwilligung in diesem Segment");
    expect(out).toContain("Einwilligungen stehen im Kundenprofil mit Datum und Quelle");
    expect(out).toContain("Zu den Kunden");
  });

  it("offers the design's segment tiles and the 'best time' option marked unavailable", async () => {
    marketingData.current = marketing();
    const { CampaignWizard } = await import("@/components/marketing/CampaignWizard");
    const out = html(<CampaignWizard campaign={null} />);
    for (const tile of ["Alle Kunden", "Stammkunden (3+)", "Neu diesen Monat", "Schlafend (60+ Tage)", "Firmen"]) {
      expect(out).toContain(tile);
    }
    expect(out).toContain("Bester Zeitpunkt");
    expect(out).toContain("braucht Öffnungsraten vergangener Kampagnen");
  });

  it("an existing campaign's name, channel and message come back into the form", async () => {
    marketingData.current = marketing({ campaigns: [CAMPAIGN] });
    const { CampaignWizard } = await import("@/components/marketing/CampaignWizard");
    const out = html(<CampaignWizard campaign={CAMPAIGN} />);
    expect(out).toContain("Neue Bowls");
    expect(out).toContain("Wir vermissen dich");
    expect(out).toContain("ENTWURF");
  });

  it("a wizard url that matches no campaign says so instead of rendering a blank form", async () => {
    marketingData.current = marketing({ campaigns: [CAMPAIGN] });
    const { CampaignGate } = await import("@/components/marketing/CampaignGate");
    const out = html(<CampaignGate id="00000000-0000-4000-8000-000000000000" />);
    expect(out).toContain("Noch keine Kampagne");
    expect(out).toContain("Zurück zu Marketing");
  });
});
