import { DropGatekeeper } from "./shop";

export { DropGatekeeper };

export interface Env {
  SHOP: DurableObjectNamespace<DropGatekeeper>;
  ASSETS: Fetcher;
  TIMEZONE: string;
  PUBLIC_URL: string;
  ADMIN_TOKEN?: string;
  RESEND_API_KEY?: string;
  EMAIL_FROM?: string;
  DEMO_SEED?: string;
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (!url.pathname.startsWith("/api/")) return env.ASSETS.fetch(req);

    if (url.pathname.startsWith("/api/admin/")) {
      if (!env.ADMIN_TOKEN) return json({ error: "admin_not_configured" }, 503);
      const given = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
      if (!(await same(given, env.ADMIN_TOKEN))) return json({ error: "unauthorized" }, 401);
    }

    const headers = new Headers(req.headers);
    headers.set("x-client-ip", req.headers.get("cf-connecting-ip") ?? "");
    headers.delete("authorization");
    const stub = env.SHOP.get(env.SHOP.idFromName("shop"));
    return stub.fetch(new Request(req, { headers }));
  },
} satisfies ExportedHandler<Env>;

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
}

async function same(a: string, b: string): Promise<boolean> {
  const enc = new TextEncoder();
  const [x, y] = await Promise.all([
    crypto.subtle.digest("SHA-256", enc.encode(a)),
    crypto.subtle.digest("SHA-256", enc.encode(b)),
  ]);
  return crypto.subtle.timingSafeEqual(x, y);
}
