import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { STATIC_SECURITY_HEADERS, contentSecurityPolicy, referrerPolicyFor, supabaseOrigin, supabaseSources } from "@/lib/csp";
import { Photo, photoUrl } from "@/components/ui/Photo";

const SB = "https://bvmitglwwqsvufetlkff.supabase.co";

describe("supabaseSources", () => {
  it("prefers the runtime SUPABASE_URL — NEXT_PUBLIC_* is inlined at build time and the image is built without it", () => {
    expect(supabaseSources({ SUPABASE_URL: SB, NEXT_PUBLIC_SUPABASE_URL: "https://other.supabase.co" })).toEqual({
      http: SB,
      ws: "wss://bvmitglwwqsvufetlkff.supabase.co",
    });
  });

  it("falls back to NEXT_PUBLIC_SUPABASE_URL", () => {
    expect(supabaseSources({ NEXT_PUBLIC_SUPABASE_URL: SB }).http).toBe(SB);
  });

  it("degrades to the *.supabase.co wildcard rather than to a blank menu", () => {
    expect(supabaseSources({})).toEqual({ http: "https://*.supabase.co", ws: "wss://*.supabase.co" });
    expect(supabaseSources({ SUPABASE_URL: "not a url" }).http).toBe("https://*.supabase.co");
  });

  it("reads only the origin, never a path", () => {
    expect(supabaseOrigin(`${SB}/rest/v1/whatever`)).toBe(SB);
  });
});

describe("content security policy", () => {
  const csp = contentSecurityPolicy("n0nce", supabaseSources({ SUPABASE_URL: SB }));
  const directive = (name: string) => csp.split("; ").find((d) => d.startsWith(`${name} `)) ?? "";

  it("carries the nonce in the shape Next parses out of the header", () => {
    expect(directive("script-src")).toContain("'nonce-n0nce'");
    expect(/^'nonce-([A-Za-z0-9+/_-]+={0,2})'$/.test("'nonce-n0nce'")).toBe(true);
  });

  it("lets Next's nonced bootstrap load its own chunks", () => {
    expect(directive("script-src")).toContain("'strict-dynamic'");
  });

  it("never allows eval or inline script", () => {
    expect(directive("script-src")).not.toContain("'unsafe-eval'");
    expect(directive("script-src")).not.toContain("'unsafe-inline'");
  });

  it("allows the Supabase REST/RPC origin and the realtime websocket — a too-strict connect-src kills tracking", () => {
    expect(directive("connect-src")).toContain(SB);
    expect(directive("connect-src")).toContain("wss://bvmitglwwqsvufetlkff.supabase.co");
  });

  it("allows menu photos from the storage host", () => {
    expect(directive("img-src")).toContain(SB);
    expect(directive("img-src")).toContain("data:");
  });

  it("keeps inline styles, which React style attributes need", () => {
    expect(directive("style-src")).toContain("'unsafe-inline'");
  });

  it("self-hosts fonts (next/font), so no Google host is allowed", () => {
    expect(directive("font-src")).toBe("font-src 'self'");
    expect(csp).not.toContain("fonts.googleapis.com");
  });

  it("blocks framing, objects and base-tag hijacking", () => {
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'self'");
    expect(csp).toContain("form-action 'self'");
  });
});

describe("static headers", () => {
  const byKey = Object.fromEntries(STATIC_SECURITY_HEADERS);

  it("sets a durable HSTS max-age, not Cloudflare's one day", () => {
    expect(byKey["Strict-Transport-Security"]).toBe("max-age=31536000; includeSubDomains");
  });

  it("covers the rest of S7 finding 5", () => {
    expect(byKey["X-Content-Type-Options"]).toBe("nosniff");
    expect(byKey["X-Frame-Options"]).toBe("DENY");
    expect(byKey["Permissions-Policy"]).toContain("camera=()");
    expect(byKey["Permissions-Policy"]).toContain("geolocation=()");
    expect(byKey["Permissions-Policy"]).toContain("microphone=()");
  });
});

describe("referrerPolicyFor — the tracking token must not ride along in a Referer", () => {
  it("is no-referrer on the tracking routes", () => {
    expect(referrerPolicyFor("/order/6f1a2b3c4d")).toBe("no-referrer");
    expect(referrerPolicyFor("/order")).toBe("no-referrer");
  });

  it("stays at the normal policy everywhere else", () => {
    for (const p of ["/", "/checkout", "/menu/philadelphia-deluxe-rl-014", "/impressum", "/orders-of-magnitude"]) {
      expect(referrerPolicyFor(p)).toBe("strict-origin-when-cross-origin");
    }
  });
});

describe("Photo", () => {
  const item = { name_en: "Philadelphia Deluxe", name_ja: "フィラデルフィア" };
  const url = `${SB}/storage/v1/object/public/menu/item-1/1.jpg`;

  // vitest does not read next.config.ts, so `images.unoptimized` is off here and next/image routes the
  // src through /_next/image. Production serves the URL directly (verified on staging); either way the
  // browser is asked for this photo, which is what this asserts.
  it("renders the resolved photo", () => {
    render(<Photo item={{ ...item, photos: [url] }} />);
    const src = screen.getByAltText("Philadelphia Deluxe").getAttribute("src") ?? "";
    expect(decodeURIComponent(src)).toContain(url);
  });

  it("keeps the brand placeholder when there is no photo", () => {
    const { container } = render(<Photo item={{ ...item, photos: [] }} />);
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector(".stone")).not.toBeNull();
  });

  it("never renders an unresolved bucket path as a src — that was the bug", () => {
    const { container } = render(<Photo item={{ ...item, photos: ["menu/item-1/1.jpg"] }} />);
    expect(container.querySelector("img")).toBeNull();
    expect(photoUrl({ photos: ["menu/item-1/1.jpg"] })).toBeNull();
  });

  it("marks an above-the-fold photo high priority", () => {
    render(<Photo item={{ ...item, photos: [url] }} priority />);
    expect(screen.getByAltText("Philadelphia Deluxe")).toHaveAttribute("fetchPriority", "high");
  });
});
