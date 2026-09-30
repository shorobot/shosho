import { headers } from "next/headers";
import { publicEnv } from "@/lib/env";

// Hands the server's runtime env (rendered into the container by CI) to the browser bundle.
// Only public values: the anon key is public by design (RLS does the guarding).
//
// This is the one inline script the app writes itself, so it carries the request's CSP nonce
// (middleware.ts sets `x-nonce`; Next nonces its own bootstrap scripts from the same header).
// Without the nonce it is blocked by `script-src` and the browser falls back to the build-time
// NEXT_PUBLIC_* values — which the CI image does not have. Keep the two in step.
export async function PublicEnvScript() {
  const env = publicEnv();
  const json = JSON.stringify(env).replace(/</g, "\\u003c");
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  return <script id="shosho-env" nonce={nonce} dangerouslySetInnerHTML={{ __html: `window.__SHOSHO_ENV__=${json};` }} />;
}
