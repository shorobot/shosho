// [S2-04] Constant-time string comparison for secrets (S7-01 findings 4 and 7).
// Web Crypto / plain JS only — runs unchanged in Deno (Edge Functions) and Node ≥ 20 (vitest).
//
// `stripe-signature.ts` has always compared signatures in constant time; every other secret
// comparison in this codebase should look the same, so there is one helper and no judgement call
// at each call site about whether a given secret is "worth" it.
//
// The length check leaks the length of the expected value, which is not a secret (a tracking token
// is always 32 hex chars, a service-role JWT's length is public). What it must not leak is *where*
// two values first differ, and it does not.

export function timingSafeEqual(a: string | null | undefined, b: string | null | undefined): boolean {
  if (typeof a !== "string" || typeof b !== "string") return false;
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** `Authorization: Bearer <token>` → `<token>`, or null. */
export function bearerToken(req: Request): string | null {
  const auth = req.headers.get("Authorization") ?? "";
  if (!auth.startsWith("Bearer ")) return null;
  const token = auth.slice("Bearer ".length).trim();
  return token.length > 0 ? token : null;
}
