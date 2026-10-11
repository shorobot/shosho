// `next dev` compiles each route on-demand, lazily, the first time it's hit — not at server start.
// This run's own CI logs show the cost: the first test to reach a given route ate the compile inside
// its own 15-90s action timeout (home page / checkout / login all showed this, at different points
// across two real CI runs). Warm every route this suite actually drives, once, before any spec's own
// timing-sensitive assertions start — so a slow first compile is startup cost, not a flaky test.
const WEB_URL = process.env.WEB_URL ?? "http://127.0.0.1:3100";
const BO_URL = process.env.BO_URL ?? "http://127.0.0.1:3102";

const ROUTES = [
  `${WEB_URL}/`,
  `${WEB_URL}/checkout`,
  `${WEB_URL}/order/warm-up-not-a-real-token`,
  `${BO_URL}/login`,
  `${BO_URL}/orders`, // compiles while logged out too — the route itself, not its data, is the cost
];

async function warm(url: string): Promise<void> {
  try {
    await fetch(url, { signal: AbortSignal.timeout(60_000) });
  } catch {
    // best-effort — a route that fails to warm here will just pay its own compile cost in its test
  }
}

export default async function globalSetup(): Promise<void> {
  await Promise.all(ROUTES.map(warm));
}
