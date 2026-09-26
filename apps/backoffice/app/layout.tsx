import type { Metadata, Viewport } from "next";
import { Archivo, Zen_Kaku_Gothic_New } from "next/font/google";
import { EnvProvider } from "@/components/providers/EnvProvider";
import { I18nProvider } from "@/lib/i18n";
import { publicEnv } from "@/lib/env";
import "./globals.css";

// Brand type (brandbook 05): Archivo 400/500/800 only — no weights between 500 and 800.
const archivo = Archivo({ subsets: ["latin", "latin-ext"], weight: ["400", "500", "800"], variable: "--font-archivo", display: "swap" });
// preload: false — the Japanese face ships ~100 unicode-range subsets (see S3-01 log: nginx header limit).
const zen = Zen_Kaku_Gothic_New({ subsets: ["latin"], weight: ["400", "700"], variable: "--font-zen", display: "swap", preload: false });

export const metadata: Metadata = {
  title: { default: "SHOSHO Back-Office", template: "%s · SHOSHO BO" },
  description: "SHOSHO back-office: orders, kitchen, drivers.",
  robots: "noindex,nofollow",
  icons: { icon: "/icon.svg" },
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#16192b" };

// Runtime env is read per request (Docker image is built without Supabase values).
export const dynamic = "force-dynamic";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const env = publicEnv();
  return (
    <html lang="de" className={`${archivo.variable} ${zen.variable}`}>
      <body className="bg-page text-ink">
        <EnvProvider env={env}>
          <I18nProvider>{children}</I18nProvider>
        </EnvProvider>
      </body>
    </html>
  );
}
