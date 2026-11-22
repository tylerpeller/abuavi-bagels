import { useEffect, useRef, useState } from "react";

export type DropState = "scheduled" | "open" | "soldout" | "closed";

export interface Drop {
  id: string;
  pickup_date: string;
  pickup_window: string;
  location: string;
  opens_at: number;
  closes_at: number | null;
  capacity: number;
  max_per_order: number;
  price: number | null;
  note: string;
  remaining: number;
  state: DropState;
  item_left: Record<string, number>;
}

export interface MenuItem {
  id: string;
  name: string;
  description: string;
  extra: number;
  limited: boolean;
}

export interface Line {
  item_id: string;
  name: string;
  qty: number;
  extra: number;
}

export interface OrderView {
  code: string;
  token: string;
  name: string;
  qty: number;
  lines: Line[];
  status: "active" | "cancelled";
  picked_up: boolean;
  created_at: number;
  cancellable: boolean;
  drop: Pick<Drop, "id" | "pickup_date" | "pickup_window" | "location" | "price" | "note"> | null;
}

export class ApiError extends Error {
  constructor(public status: number, public code: string, public data: Record<string, any> = {}) {
    super(code);
  }
}

// ---------- server clock ----------
// Countdowns and the "unlock" moment use the server's clock, not the phone's.
let offset = 0;
export const serverNow = () => Date.now() + offset;
function syncClock(serverMs: unknown, sentAt: number) {
  if (typeof serverMs !== "number") return;
  const rtt = Date.now() - sentAt;
  if (rtt > 4000) return; // too noisy to trust
  offset = serverMs + rtt / 2 - Date.now();
}

export async function api<T = any>(path: string, init: RequestInit & { json?: unknown; token?: string } = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.json !== undefined) headers.set("content-type", "application/json");
  if (init.token) headers.set("authorization", `Bearer ${init.token}`);
  const sentAt = Date.now();
  const res = await fetch(path, {
    ...init,
    headers,
    body: init.json !== undefined ? JSON.stringify(init.json) : init.body,
  });
  let data: any = {};
  try {
    data = await res.json();
  } catch {
    /* empty or html error page */
  }
  if (data && typeof data.now === "number") syncClock(data.now, sentAt);
  if (!res.ok) throw new ApiError(res.status, data?.error ?? "server_error", data ?? {});
  return data as T;
}

export const newKey = () =>
  Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(16).padStart(2, "0")).join("");

// Client-side view of a drop's state at this instant (flips scheduled -> open on time).
export function liveState(d: Drop, now = serverNow()): DropState {
  if (d.state === "scheduled" && now >= d.opens_at) return d.remaining > 0 ? "open" : "soldout";
  if (d.state === "open" && d.closes_at && now >= d.closes_at) return "closed";
  return d.state;
}

// ---------- live drops ----------
// WebSocket push for the "left" count, with polling as a fallback.
export function useDrops() {
  const [drops, setDrops] = useState<Drop[] | null>(null);
  const [menu, setMenu] = useState<MenuItem[]>([]);
  const [error, setError] = useState(false);
  const [connected, setConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    let stopped = false;
    let retry = 0;
    let pollTimer: number | undefined;
    let pingTimer: number | undefined;
    let reconnectTimer: number | undefined;

    const load = () =>
      api<{ drops: Drop[]; menu: MenuItem[] }>("/api/drops")
        .then((d) => {
          if (!stopped) {
            setDrops(d.drops);
            setMenu(d.menu ?? []);
            setError(false);
          }
        })
        .catch(() => !stopped && setError(true));

    const startPolling = () => {
      if (pollTimer) return;
      pollTimer = window.setInterval(load, 5000);
    };
    const stopPolling = () => {
      window.clearInterval(pollTimer);
      pollTimer = undefined;
    };

    const connect = () => {
      if (stopped) return;
      const proto = location.protocol === "https:" ? "wss" : "ws";
      let ws: WebSocket;
      try {
        ws = new WebSocket(`${proto}://${location.host}/api/live`);
      } catch {
        startPolling();
        return;
      }
      wsRef.current = ws;
      const sentAt = Date.now();
      ws.onopen = () => {
        retry = 0;
        setConnected(true);
        stopPolling();
        pingTimer = window.setInterval(() => ws.readyState === 1 && ws.send("ping"), 25000);
      };
      ws.onmessage = (e) => {
        if (e.data === "pong") return;
        try {
          const msg = JSON.parse(e.data);
          if (msg.type === "drops") {
            syncClock(msg.now, retry === 0 ? sentAt : Date.now());
            setDrops(msg.drops);
            setMenu(msg.menu ?? []);
            setError(false);
          }
        } catch {
          /* ignore */
        }
      };
      ws.onclose = () => {
        setConnected(false);
        window.clearInterval(pingTimer);
        if (stopped) return;
        startPolling();
        // Jittered backoff so a thousand phones don't reconnect in lockstep.
        const delay = Math.min(30000, 1000 * 2 ** retry++) * (0.5 + Math.random());
        reconnectTimer = window.setTimeout(connect, delay);
      };
    };

    load();
    connect();
    const onVisible = () => document.visibilityState === "visible" && load();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      stopped = true;
      stopPolling();
      window.clearInterval(pingTimer);
      window.clearTimeout(reconnectTimer);
      wsRef.current?.close();
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  return { drops, menu, error, connected, reload: () => api<{ drops: Drop[]; menu: MenuItem[] }>("/api/drops").then((d) => (setDrops(d.drops), setMenu(d.menu ?? []))) };
}

// Re-render on an interval (for countdowns).
export function useTick(ms: number, active = true) {
  const [, set] = useState(0);
  useEffect(() => {
    if (!active) return;
    const t = window.setInterval(() => set((n) => n + 1), ms);
    return () => window.clearInterval(t);
  }, [ms, active]);
}

// ---------- formatting ----------
const TZ = "Asia/Jerusalem";

export function fmtDay(date: string, style: "short" | "long" = "short") {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString("en-GB", {
    weekday: style === "long" ? "long" : "short",
    day: "numeric",
    month: style === "long" ? "long" : "short",
    timeZone: "UTC",
  });
}

export function fmtTime(ms: number) {
  return new Date(ms).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: TZ });
}

export function fmtOpens(ms: number) {
  const d = new Date(ms);
  const day = d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: TZ });
  return `${day}, ${fmtTime(ms)}`;
}

export function fmtCountdown(ms: number) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  if (d > 0) return `${d}d ${pad(h)}h ${pad(m)}m`;
  if (h > 0) return `${h}:${pad(m)}:${pad(sec)}`;
  return `${m}:${pad(sec)}`;
}

export const shekels = (n: number) => `₪${n.toLocaleString("en-US")}`;

export function orderTotal(base: number | null, lines: { qty: number; extra: number }[]): number | null {
  if (base == null) return null;
  return lines.reduce((sum, l) => sum + l.qty * (base + l.extra), 0);
}

export const linesText = (lines: { qty: number; name: string }[]) => lines.map((l) => `${l.qty} ${l.name}`).join(", ");

// ---------- local memory ----------
const ME = "aab:me";
const MINE = "aab:orders";

export function loadMe(): { name: string; phone: string; email: string } {
  try {
    return { name: "", phone: "", email: "", ...JSON.parse(localStorage.getItem(ME) || "{}") };
  } catch {
    return { name: "", phone: "", email: "" };
  }
}
export function saveMe(me: { name: string; phone: string; email: string }) {
  try {
    localStorage.setItem(ME, JSON.stringify(me));
  } catch {
    /* private mode */
  }
}
export function myOrders(): Record<string, { token: string; code: string; qty: number }> {
  try {
    return JSON.parse(localStorage.getItem(MINE) || "{}");
  } catch {
    return {};
  }
}
export function rememberOrder(dropId: string, o: { token: string; code: string; qty: number } | null) {
  try {
    const all = myOrders();
    if (o) all[dropId] = o;
    else delete all[dropId];
    localStorage.setItem(MINE, JSON.stringify(all));
  } catch {
    /* private mode */
  }
}
