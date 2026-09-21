import { publicEnv } from "@/lib/env";

// Hands the server's runtime env (rendered into the container by CI) to the browser bundle.
// Only public values: the anon key is public by design (RLS does the guarding).
export function PublicEnvScript() {
  const env = publicEnv();
  const json = JSON.stringify(env).replace(/</g, "\\u003c");
  return <script id="shosho-env" dangerouslySetInnerHTML={{ __html: `window.__SHOSHO_ENV__=${json};` }} />;
}
