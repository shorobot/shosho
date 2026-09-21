import type { Metadata } from "next";
import { Archivo, Zen_Kaku_Gothic_New } from "next/font/google";
import { CookieBanner } from "@/components/site/CookieBanner";
import { Footer } from "@/components/site/Footer";
import { Header } from "@/components/site/Header";
import { MobileBar } from "@/components/site/MobileBar";
import { PublicEnvScript } from "@/components/site/PublicEnvScript";
import { UiProvider } from "@/components/site/UiProvider";
import { CartProvider, CatalogProvider } from "@/lib/cart";
import { getCatalog } from "@/lib/catalog";
import { publicEnv } from "@/lib/env";
import { Maintenance } from "@/components/site/Maintenance";
import "./globals.css";

// Brand type (brandbook 05): Archivo 400/500/800 only — no weights between 500 and 800.
const archivo = Archivo({ subsets: ["latin", "latin-ext"], weight: ["400", "500", "800"], variable: "--font-archivo", display: "swap" });
// preload: false — the Japanese face ships ~100 unicode-range subsets; preloading them all produced a `link` header
// too large for the host nginx proxy buffer (502 on staging). Latin Archivo stays preloaded.
const zen = Zen_Kaku_Gothic_New({ subsets: ["latin"], weight: ["400", "500", "700"], variable: "--font-zen", display: "swap", preload: false });

export async function generateMetadata(): Promise<Metadata> {
  const { settings } = await getCatalog();
  const seo = settings.site?.seo;
  return {
    metadataBase: new URL(publicEnv().siteUrl),
    title: { default: seo?.title ?? "SHOSHO — Premium Sushi · Berlin", template: "%s · SHOSHO" },
    description: seo?.description ?? "Fresh sushi, ramen and bowls, delivered in 60 minutes across Berlin Mitte.",
    robots: settings.site?.robots ?? "index,follow",
    icons: { icon: "/icon.svg" },
  };
}

export const dynamic = "force-dynamic";

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const catalog = await getCatalog();
  const { settings } = catalog;
  const maintenance = Boolean(settings.site?.maintenance);
  return (
    <html lang="en" className={`${archivo.variable} ${zen.variable}`}>
      <body className="bg-page text-ink">
        <PublicEnvScript />
        {maintenance ? (
          <Maintenance business={settings.business} hours={settings.opening_hours} />
        ) : (
          <CatalogProvider catalog={catalog}>
            <CartProvider>
              <UiProvider>
                <Header />
                <main className="pb-[96px] md:pb-0">{children}</main>
                <Footer business={settings.business} hours={settings.opening_hours} payments={settings.payments_enabled} />
                <MobileBar />
                <CookieBanner enabled={Boolean(settings.site?.cookie_banner)} />
              </UiProvider>
            </CartProvider>
          </CatalogProvider>
        )}
      </body>
    </html>
  );
}
