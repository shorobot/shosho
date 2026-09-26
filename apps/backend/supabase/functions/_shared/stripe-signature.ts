// Stripe webhook signature verification (Stripe-Signature: t=<unix>,v1=<hex>[,v1=<hex>…]).
// Web Crypto only — runs unchanged in Deno (Edge Functions) and Node ≥ 20 (vitest).
// Spec: https://docs.stripe.com/webhooks#verify-manually

export const DEFAULT_TOLERANCE_SECONDS = 300;

export type SignatureCheck =
  | { ok: true; timestamp: number }
  | { ok: false; reason: "missing_header" | "malformed_header" | "no_v1" | "timestamp_out_of_tolerance" | "signature_mismatch" };

function parseHeader(header: string): { t: number | null; v1: string[] } {
  let t: number | null = null;
  const v1: string[] = [];
  for (const part of header.split(",")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    if (k === "t") t = Number(v);
    else if (k === "v1") v1.push(v);
  }
  return { t: t !== null && Number.isFinite(t) ? t : null, v1 };
}

function hex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, "0")).join("");
}

function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function hmacSha256Hex(secret: string, payload: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return hex(await crypto.subtle.sign("HMAC", key, enc.encode(payload)));
}

/** Build a header the way Stripe does — used by tests and the local `stripe listen` recipe docs. */
export async function signPayload(secret: string, body: string, timestamp = Math.floor(Date.now() / 1000)): Promise<string> {
  const sig = await hmacSha256Hex(secret, `${timestamp}.${body}`);
  return `t=${timestamp},v1=${sig}`;
}

export async function verifyStripeSignature(
  body: string,
  header: string | null | undefined,
  secret: string,
  opts: { toleranceSeconds?: number; now?: number } = {},
): Promise<SignatureCheck> {
  if (!header) return { ok: false, reason: "missing_header" };
  const { t, v1 } = parseHeader(header);
  if (t === null) return { ok: false, reason: "malformed_header" };
  if (v1.length === 0) return { ok: false, reason: "no_v1" };
  const now = opts.now ?? Math.floor(Date.now() / 1000);
  const tolerance = opts.toleranceSeconds ?? DEFAULT_TOLERANCE_SECONDS;
  if (tolerance > 0 && Math.abs(now - t) > tolerance) return { ok: false, reason: "timestamp_out_of_tolerance" };
  const expected = await hmacSha256Hex(secret, `${t}.${body}`);
  for (const sig of v1) if (timingSafeEqualHex(sig, expected)) return { ok: true, timestamp: t };
  return { ok: false, reason: "signature_mismatch" };
}
