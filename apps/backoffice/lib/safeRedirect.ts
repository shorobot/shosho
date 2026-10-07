// Post-login `?next=` validation (S7-01 "back-office open redirect", /docs/security.md §5).
//
// The old check was `next.startsWith("/")`, which a protocol-relative URL also satisfies:
// `"//evil.example".startsWith("/")` is true, and a browser resolves `//evil.example` against the
// current scheme, i.e. straight off our origin. A crafted
// `…/login?next=//attacker.example/phish` therefore bounced a staff member off-domain in the one
// moment they have just proven they trust the page.
//
// This is deliberately an allow-list of *same-origin relative paths*, not a deny-list of known bad
// shapes. A fully-qualified URL is rejected even when its origin matches, because the back-office
// never needs one and accepting them re-opens the parsing surface the bug came from.
//
// Three things are easy to get wrong and are handled explicitly:
//   1. Browsers strip ASCII tab/LF/CR out of a URL *before* parsing it, so a `next` of
//      "/<tab>/evil.example" becomes "//evil.example" after the strip — validating the unstripped
//      string is not enough. Any control character (and any space, which a real path encodes as
//      %20) is refused outright rather than normalised, so there is no "strip then re-check" step
//      left to get wrong.
//   2. A backslash is treated as a path separator by the URL spec's authority parser, so `/\evil`
//      is another protocol-relative form. Refused anywhere in the string; a real path uses %5C.
//   3. `new URL(next, origin)` is the final arbiter: anything that resolves off-origin is refused
//      even if it passed the cheap prefix checks.

/** ASCII control characters plus space — a legitimate path percent-encodes all of these. */
const CONTROL_OR_SPACE = /[\u0000-\u0020\u007f]/;

/**
 * The path to send a freshly signed-in staff member to, or `fallback` when `next` is absent or is
 * not a same-origin relative path. The default `fallback` is `/`, which routes by role
 * (app/page.tsx → homeFor()), so a rejected `next` lands the operator on their own home screen
 * rather than somewhere generic.
 */
export function safeNextPath(next: string | null | undefined, origin: string, fallback = "/"): string {
  if (!next) return fallback;
  if (CONTROL_OR_SPACE.test(next)) return fallback;
  if (next.includes("\\")) return fallback;
  // Rejects absolute URLs and every scheme form (`https:`, `javascript:`, `data:`) in one check:
  // none of them start with a slash.
  if (!next.startsWith("/")) return fallback;
  // Protocol-relative: the exact bypass S7 found.
  if (next.startsWith("//")) return fallback;

  let url: URL;
  try {
    url = new URL(next, origin);
  } catch {
    return fallback;
  }
  if (!origin || url.origin !== origin) return fallback;
  // Defence in depth: a path that still reads as an authority after normalisation.
  if (url.pathname.startsWith("//")) return fallback;

  return `${url.pathname}${url.search}${url.hash}`;
}
