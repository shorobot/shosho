// Banners (api-contracts §8.6): BannerSlot (home_strip/product/checkout) and Hero's home_hero
// handling — filtering by slot, honouring `sort`, and the "empty looks deliberate" requirement.
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { BannerSlot } from "@/components/site/BannerSlot";
import { Hero } from "@/components/home/Hero";
import { CatalogProvider } from "@/lib/cart";
import { MOCK_SETTINGS } from "@/lib/mock-data";
import type { Banner, Catalog } from "@/lib/types";

const banner = (over: Partial<Banner>): Banner => ({
  id: over.id ?? "b1",
  slot: "home_strip",
  title_de: null,
  title_en: null,
  subtitle_de: null,
  subtitle_en: null,
  cta_label_de: null,
  cta_label_en: null,
  cta_href: null,
  sort: 0,
  image_path: null,
  ...over,
});

const catalogWith = (banners: Banner[]): Catalog => ({
  categories: [],
  items: [],
  itemOptionGroups: [],
  zones: [],
  settings: MOCK_SETTINGS,
  banners,
  online: true,
});

function withCatalog(banners: Banner[], children: React.ReactNode) {
  return <CatalogProvider catalog={catalogWith(banners)}>{children}</CatalogProvider>;
}

describe("BannerSlot", () => {
  it("renders nothing for an empty slot — the normal case, not an error", () => {
    const { container } = render(withCatalog([], <BannerSlot slot="checkout" />));
    expect(container.firstChild).toBeNull();
  });

  it("only renders rows for its own slot", () => {
    render(
      withCatalog(
        [banner({ id: "home", slot: "home_strip", title_en: "Home strip" }), banner({ id: "co", slot: "checkout", title_en: "Checkout banner" })],
        <BannerSlot slot="checkout" />,
      ),
    );
    expect(screen.queryByText("Home strip")).toBeNull();
    expect(screen.getByText("Checkout banner")).toBeInTheDocument();
  });

  it("honours `sort`", () => {
    render(
      withCatalog(
        [banner({ id: "b", slot: "product", title_en: "Second", sort: 20 }), banner({ id: "a", slot: "product", title_en: "First", sort: 10 })],
        <BannerSlot slot="product" />,
      ),
    );
    const titles = screen.getAllByText(/First|Second/).map((el) => el.textContent);
    expect(titles).toEqual(["First", "Second"]);
  });

  it("renders the EN fields — no language toggle yet (D-016/D-017 scope; title_de is still carried on the type)", () => {
    render(withCatalog([banner({ slot: "product", title_en: "English title", title_de: "Deutscher Titel" })], <BannerSlot slot="product" />));
    expect(screen.getByText("English title")).toBeInTheDocument();
    expect(screen.queryByText("Deutscher Titel")).toBeNull();
  });

  it("renders a CTA only when both the label and href are present", () => {
    render(withCatalog([banner({ slot: "product", cta_label_en: "Shop now", cta_href: null })], <BannerSlot slot="product" />));
    expect(screen.queryByText("Shop now")).toBeNull();
  });
});

describe("Hero (home_hero)", () => {
  it("keeps the static hero when there is no home_hero banner — empty must look deliberate, not broken", () => {
    render(withCatalog([], <Hero fromCents={1490} />));
    expect(screen.getByText(/Signature sets,/)).toBeInTheDocument();
  });

  it("ignores a banner for a different slot", () => {
    render(withCatalog([banner({ slot: "home_strip", title_en: "Strip only" })], <Hero fromCents={null} />));
    expect(screen.getByText(/Signature sets,/)).toBeInTheDocument();
    expect(screen.queryByText("Strip only")).toBeNull();
  });

  it("renders the CMS banner when one exists for home_hero", () => {
    render(withCatalog([banner({ slot: "home_hero", title_en: "Autumn set", subtitle_en: "Limited time" })], <Hero fromCents={null} />));
    expect(screen.getByText("Autumn set")).toBeInTheDocument();
    expect(screen.getByText("Limited time")).toBeInTheDocument();
    expect(screen.queryByText(/Signature sets,/)).toBeNull();
  });

  it("still shows the live \"from …\" price on top of a CMS banner", () => {
    render(withCatalog([banner({ slot: "home_hero", title_en: "Autumn set" })], <Hero fromCents={1490} />));
    expect(screen.getByText(/from/)).toBeInTheDocument();
  });
});
