// Tiny response helpers shared by the Edge Functions (Deno + Node safe).
export const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS, ...headers },
  });
}

export function problem(code: string, status = 400, extra: Record<string, unknown> = {}): Response {
  return json({ error: code, ...extra }, status);
}
