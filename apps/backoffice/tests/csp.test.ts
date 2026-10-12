// S6-01 finding 0 (HIGH, filed to S4): `next dev`'s HMR runtime evaluates chunks via `eval()`, which
// a CSP with no `'unsafe-eval'` blocks outright — total, not partial: the page paints, but no client
// JS runs at all, anywhere. The carve-out is non-production only; production must stay byte-for-byte
// what it already was (confirmed working, live, on shosho-staging).
import { afterEach, describe, expect, it, vi } from "vitest";
import { contentSecurityPolicy } from "@/lib/csp";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("contentSecurityPolicy — script-src 'unsafe-eval' carve-out (S6-01 finding 0)", () => {
  it("production carries no 'unsafe-eval' — unchanged from before this fix", () => {
    vi.stubEnv("NODE_ENV", "production");
    const csp = contentSecurityPolicy("abc123", { http: "https://x.supabase.co", ws: "wss://x.supabase.co" }, { upgradeInsecure: true });
    const scriptSrc = csp.split("; ").find((d) => d.startsWith("script-src"));
    expect(scriptSrc).toBe("script-src 'self' 'nonce-abc123' 'strict-dynamic'");
  });

  it("development/test gets 'unsafe-eval' so next dev's HMR eval() is not blocked", () => {
    vi.stubEnv("NODE_ENV", "development");
    const csp = contentSecurityPolicy("abc123", { http: "https://x.supabase.co", ws: "wss://x.supabase.co" }, { upgradeInsecure: false });
    const scriptSrc = csp.split("; ").find((d) => d.startsWith("script-src"));
    expect(scriptSrc).toBe("script-src 'self' 'nonce-abc123' 'strict-dynamic' 'unsafe-eval'");
  });

  it("every other directive is untouched by the NODE_ENV branch", () => {
    vi.stubEnv("NODE_ENV", "production");
    const prod = contentSecurityPolicy("n1", { http: "https://x.supabase.co", ws: "wss://x.supabase.co" }, { upgradeInsecure: true });
    vi.stubEnv("NODE_ENV", "development");
    const dev = contentSecurityPolicy("n1", { http: "https://x.supabase.co", ws: "wss://x.supabase.co" }, { upgradeInsecure: true });
    const strip = (csp: string) => csp.split("; ").filter((d) => !d.startsWith("script-src"));
    expect(strip(prod)).toEqual(strip(dev));
  });
});
