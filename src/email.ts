import type { Env } from "./index";
import type { Line } from "./shop";

// Optional order confirmation via Resend. Only runs when both
// RESEND_API_KEY and EMAIL_FROM are set, and the buyer left an email.

interface OrderLike {
  code: string;
  token: string;
  name: string;
  email: string | null;
  qty: number;
}
interface DropLike {
  pickup_date: string;
  pickup_window: string;
  location: string;
  price: number | null;
}

export async function sendConfirmation(env: Env, o: OrderLike, d: DropLike, lines: Line[]): Promise<void> {
  if (!o.email || !env.RESEND_API_KEY || !env.EMAIL_FROM) return;
  const base = (env.PUBLIC_URL || "").replace(/\/$/, "");
  const link = `${base}/o/${o.token}`;
  const day = new Date(`${d.pickup_date}T12:00:00Z`).toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  });
  const extras = lines.reduce((n, l) => n + l.extra * l.qty, 0);
  const total = d.price != null ? `₪${d.price * o.qty + extras}, paid at pickup` : "Paid at pickup";
  const list = lines.map((l) => `${l.qty} ${l.name}`).join(", ");
  const where = [d.pickup_window, d.location].filter(Boolean).join(", ");

  const text = [
    `${o.name}, you're in.`,
    ``,
    `Order ${o.code}: ${list}`,
    `Pickup: ${day}${where ? `, ${where}` : ""}`,
    total,
    ``,
    `View or cancel: ${link}`,
    ``,
    `Abu Avi Bagels`,
  ].join("\n");

  const html = `<!doctype html><html><body style="margin:0;background:#faf6ef;font-family:Arial,sans-serif;color:#1c1815">
<div style="max-width:440px;margin:0 auto;padding:32px 20px">
<p style="font-size:13px;margin:0 0 4px;color:#6b6255">Abu Avi Bagels</p>
<h1 style="font-family:'Arial Black',Arial,sans-serif;font-size:28px;line-height:1.1;margin:0 0 20px;text-transform:uppercase">You're in, ${escape(o.name)}</h1>
<table style="width:100%;border-collapse:collapse;font-size:15px">
<tr><td style="padding:8px 0;color:#6b6255">Order</td><td style="padding:8px 0;text-align:right;font-weight:bold;letter-spacing:2px">${o.code}</td></tr>
<tr><td style="padding:8px 0;color:#6b6255;border-top:1px solid #ece3d3;vertical-align:top">Bagels</td><td style="padding:8px 0;text-align:right;border-top:1px solid #ece3d3">${lines.map((l) => `${l.qty} ${escape(l.name)}`).join("<br>")}</td></tr>
<tr><td style="padding:8px 0;color:#6b6255;border-top:1px solid #ece3d3">Pickup</td><td style="padding:8px 0;text-align:right;border-top:1px solid #ece3d3">${escape(day)}${where ? `<br>${escape(where)}` : ""}</td></tr>
<tr><td style="padding:8px 0;color:#6b6255;border-top:1px solid #ece3d3">Payment</td><td style="padding:8px 0;text-align:right;border-top:1px solid #ece3d3">${escape(total)}</td></tr>
</table>
<p style="margin:28px 0 0"><a href="${link}" style="display:inline-block;background:#63311b;color:#fffdfa;text-decoration:none;padding:12px 18px;border-radius:10px;font-weight:bold">View my order</a></p>
<p style="font-size:13px;color:#6b6255;margin-top:16px">Plans changed? Cancel from that page so someone else gets your bagels.</p>
</div></body></html>`;

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({
      from: env.EMAIL_FROM,
      to: [o.email],
      subject: `Order ${o.code}: ${o.qty} bagel${o.qty === 1 ? "" : "s"}, ${day}`,
      text,
      html,
    }),
  });
  if (!res.ok) throw new Error(`resend ${res.status}: ${await res.text()}`);
}

function escape(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
