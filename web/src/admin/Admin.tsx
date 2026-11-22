import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, ApiError, DropState, fmtDay, fmtOpens, fmtTime, Line, linesText, shekels } from "../lib/api";
import { BagelArt } from "../ui/BagelArt";
import { BagelSpinner } from "../ui/BagelSpinner";
import logo from "../assets/logo.jpg";

interface AdminDrop {
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
  paused: boolean;
  sold: number;
  orders: number;
  picked: number;
  paid: number;
  state: DropState;
}

interface AdminOrder {
  id: string;
  drop_id: string;
  code: string;
  name: string;
  phone: string;
  email: string | null;
  qty: number;
  status: "active" | "cancelled";
  paid: boolean;
  picked_up: boolean;
  source: "web" | "manual";
  created_at: number;
  lines: Line[];
}

interface AdminItem {
  id: string;
  name: string;
  description: string;
  extra: number;
  limit_per_drop: number | null;
  active: boolean;
  sort: number;
}

const TOKEN_KEY = "aab:admin";
const stateLabel: Record<DropState, string> = {
  scheduled: "Not open yet",
  open: "Taking orders",
  soldout: "Sold out, closed",
  closed: "Closed",
};

export function Admin() {
  const [token, setToken] = useState(() => {
    try {
      return localStorage.getItem(TOKEN_KEY) || "";
    } catch {
      return "";
    }
  });
  const out = useCallback(() => {
    try {
      localStorage.removeItem(TOKEN_KEY);
    } catch {
      /* ignore */
    }
    setToken("");
  }, []);
  if (!token) return <Login onIn={setToken} />;
  return <Dashboard token={token} onOut={out} />;
}

function Login({ onIn }: { onIn: (t: string) => void }) {
  const [code, setCode] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <div className="solo">
      <div className="solo-brand">
        <img src={logo} alt="" width={40} height={40} />
        <span>Abu Avi Bagels</span>
      </div>
      <form
        className="login"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setErr(null);
          try {
            await api("/api/admin/drops", { token: code });
            try {
              localStorage.setItem(TOKEN_KEY, code);
            } catch {
              /* ignore */
            }
            onIn(code);
          } catch (e) {
            setErr(
              e instanceof ApiError && e.code === "admin_not_configured"
                ? "No passcode is set up yet. Add ADMIN_TOKEN in Cloudflare first."
                : e instanceof ApiError && e.status === 401
                  ? "That passcode didn't work."
                  : "Can't reach the shop. Try again.",
            );
          } finally {
            setBusy(false);
          }
        }}
      >
        <h1 className="h-big">Drop control</h1>
        <label className="field" data-err={err ? "" : undefined}>
          <span className="field-label">Passcode</span>
          <input type="password" autoComplete="current-password" value={code} onChange={(e) => setCode(e.target.value)} />
          {err && <span className="field-err">{err}</span>}
        </label>
        <button className="btn cta" disabled={!code || busy}>
          {busy ? <BagelSpinner size={20} light /> : "Open dashboard"}
        </button>
      </form>
    </div>
  );
}

// ---------- data ----------

function useLiveRefresh(load: () => void) {
  // Any change anywhere (new order, cancel) nudges the dashboard to refetch.
  useEffect(() => {
    let ws: WebSocket | null = null;
    let timer: number | undefined;
    let debounce: number | undefined;
    let stopped = false;
    const poke = () => {
      window.clearTimeout(debounce);
      debounce = window.setTimeout(load, 300);
    };
    const connect = () => {
      if (stopped) return;
      ws = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/api/live`);
      ws.onmessage = (e) => e.data !== "pong" && poke();
      ws.onclose = () => !stopped && (timer = window.setTimeout(connect, 3000));
    };
    connect();
    const poll = window.setInterval(load, 15000);
    const vis = () => document.visibilityState === "visible" && load();
    document.addEventListener("visibilitychange", vis);
    return () => {
      stopped = true;
      ws?.close();
      window.clearTimeout(timer);
      window.clearTimeout(debounce);
      window.clearInterval(poll);
      document.removeEventListener("visibilitychange", vis);
    };
  }, [load]);
}

function useHashRoute(): [string, (h: string) => void] {
  const [hash, setHash] = useState(location.hash.slice(1));
  useEffect(() => {
    const on = () => setHash(location.hash.slice(1));
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return [hash, (h) => (location.hash = h)];
}

function Dashboard({ token, onOut }: { token: string; onOut: () => void }) {
  const [drops, setDrops] = useState<AdminDrop[] | null>(null);
  const [route, go] = useHashRoute();

  const load = useCallback(() => {
    api<{ drops: AdminDrop[] }>("/api/admin/drops", { token })
      .then((r) => setDrops(r.drops))
      .catch((e) => e instanceof ApiError && e.status === 401 && onOut());
  }, [token, onOut]);
  useEffect(load, [load]);
  useLiveRefresh(load);

  const [kind, id] = route.split("/");
  const drop = drops?.find((d) => d.id === id);

  return (
    <div className="admin">
      <header className="admin-head">
        <a href="#" className="admin-brand">
          <img src={logo} alt="" width={36} height={36} />
          <span>Drop control</span>
        </a>
        <nav className="admin-nav">
          <a href="#" aria-current={!kind || kind === "drop" || kind === "edit" || kind === "new" ? "page" : undefined}>
            Drops
          </a>
          <a href="#menu" aria-current={kind === "menu" ? "page" : undefined}>
            Menu
          </a>
          <button className="link" onClick={onOut}>
            Sign out
          </button>
        </nav>
      </header>
      <main className="admin-main">
        {!drops && (
          <div className="placeholder">
            <BagelSpinner size={40} />
          </div>
        )}
        {drops && kind === "new" && (
          <DropForm token={token} base={drops[0]} onDone={(d) => (load(), go(d ? `drop/${d.id}` : ""))} />
        )}
        {drops && kind === "edit" && drop && (
          <DropForm token={token} drop={drop} onDone={() => (load(), go(`drop/${drop.id}`))} />
        )}
        {drops && kind === "drop" && drop && <DropDetail token={token} drop={drop} reload={load} onGone={() => (load(), go(""))} />}
        {kind === "menu" && <MenuEditor token={token} />}
        {drops && (!kind || ((kind === "drop" || kind === "edit") && !drop)) && <DropList drops={drops} />}
      </main>
    </div>
  );
}

// ---------- list ----------

function DropList({ drops }: { drops: AdminDrop[] }) {
  return (
    <section>
      <div className="row-between">
        <h1 className="h-big">Drops</h1>
        <a className="btn cta" href="#new">
          New drop
        </a>
      </div>
      {drops.length === 0 && <p className="muted">No drops yet. Make the first one and share the link.</p>}
      <ul className="droplist">
        {drops.map((d) => (
          <li key={d.id}>
            <a href={`#drop/${d.id}`} className="dropcard" data-s={d.state}>
              <div className="dropcard-top">
                <span className="dropcard-date">{fmtDay(d.pickup_date, "long")}</span>
                <span className="tag" data-s={d.state}>
                  {stateLabel[d.state]}
                </span>
              </div>
              <Meter sold={d.sold} capacity={d.capacity} />
              <p className="dropcard-meta tabular">
                {d.sold} of {d.capacity} sold, {d.orders} {d.orders === 1 ? "order" : "orders"}
                {d.state === "scheduled" ? `. Opens ${fmtOpens(d.opens_at)}` : ""}
              </p>
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Meter({ sold, capacity }: { sold: number; capacity: number }) {
  const pct = Math.min(100, (sold / Math.max(1, capacity)) * 100);
  return (
    <div className="meter" role="img" aria-label={`${sold} of ${capacity} sold`}>
      <span style={{ transform: `scaleX(${pct / 100})` }} />
    </div>
  );
}

// ---------- drop form ----------

const toLocalInput = (ms: number | null | undefined) => {
  if (!ms) return "";
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};
const fromLocalInput = (v: string) => (v ? new Date(v).getTime() : null);

function DropForm({
  token,
  drop,
  base,
  onDone,
}: {
  token: string;
  drop?: AdminDrop;
  base?: AdminDrop;
  onDone: (d?: AdminDrop) => void;
}) {
  const src = drop ?? base;
  const [f, setF] = useState({
    pickup_date: drop?.pickup_date ?? "",
    pickup_window: src?.pickup_window ?? "",
    location: src?.location ?? "",
    opens_at: toLocalInput(drop?.opens_at),
    closes_at: toLocalInput(drop?.closes_at),
    capacity: String(src?.capacity ?? 100),
    max_per_order: String(src?.max_per_order ?? 12),
    price: src?.price != null ? String(src.price) : "",
    note: drop?.note ?? "",
  });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setF((x) => ({ ...x, [k]: e.target.value }));

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!f.pickup_date || !f.opens_at || !f.capacity) {
      setErr("Pickup day, opening time and how many bagels are needed.");
      return;
    }
    setBusy(true);
    setErr(null);
    const payload = {
      pickup_date: f.pickup_date,
      pickup_window: f.pickup_window,
      location: f.location,
      opens_at: fromLocalInput(f.opens_at),
      closes_at: fromLocalInput(f.closes_at),
      capacity: Number(f.capacity),
      max_per_order: Number(f.max_per_order || 12),
      price: f.price === "" ? null : Number(f.price),
      note: f.note,
    };
    try {
      const r = await api<{ drop: AdminDrop }>(drop ? `/api/admin/drops/${drop.id}` : "/api/admin/drops", {
        method: drop ? "PATCH" : "POST",
        token,
        json: payload,
      });
      onDone(r.drop);
    } catch (e) {
      setErr(e instanceof ApiError && e.code === "invalid" ? `Check the ${String(e.data.field).replace(/_/g, " ")} field.` : "Couldn't save. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="dropform" onSubmit={save}>
      <a className="link" href={drop ? `#drop/${drop.id}` : "#"}>
        Back
      </a>
      <h1 className="h-big">{drop ? "Edit drop" : "New drop"}</h1>
      <div className="grid2">
        <label className="field">
          <span className="field-label">Pickup day</span>
          <input type="date" required value={f.pickup_date} onChange={set("pickup_date")} />
        </label>
        <label className="field">
          <span className="field-label">Pickup time</span>
          <input placeholder="8:00 to 10:00" value={f.pickup_window} onChange={set("pickup_window")} maxLength={60} />
        </label>
      </div>
      <label className="field">
        <span className="field-label">Pickup spot</span>
        <input placeholder="Street and number, or a landmark" value={f.location} onChange={set("location")} maxLength={120} />
      </label>
      <div className="grid2">
        <label className="field">
          <span className="field-label">Orders open</span>
          <input type="datetime-local" required value={f.opens_at} onChange={set("opens_at")} />
          <span className="field-hint">The order button unlocks at this exact minute.</span>
        </label>
        <label className="field">
          <span className="field-label">Stop orders at</span>
          <input type="datetime-local" value={f.closes_at} onChange={set("closes_at")} />
          <span className="field-hint">Optional. It also closes on its own when sold out.</span>
        </label>
      </div>
      <div className="grid3">
        <label className="field">
          <span className="field-label">Bagels</span>
          <input type="number" inputMode="numeric" min={1} required value={f.capacity} onChange={set("capacity")} />
        </label>
        <label className="field">
          <span className="field-label">Max per order</span>
          <input type="number" inputMode="numeric" min={1} value={f.max_per_order} onChange={set("max_per_order")} />
        </label>
        <label className="field">
          <span className="field-label">Base price (₪)</span>
          <input type="number" inputMode="numeric" min={0} placeholder="Optional" value={f.price} onChange={set("price")} />
          <span className="field-hint">Per bagel. Flavour add-ons are set in Menu.</span>
        </label>
      </div>
      <label className="field">
        <span className="field-label">Note for buyers</span>
        <textarea rows={2} maxLength={400} placeholder="Optional. Flavours this week, parking, anything." value={f.note} onChange={set("note")} />
      </label>
      {drop && Number(f.capacity) < drop.sold && (
        <p className="banner">{drop.sold} are already sold. Lowering below that keeps those orders and just stops new ones.</p>
      )}
      {err && <p className="banner" role="alert">{err}</p>}
      <button className="btn cta" disabled={busy}>
        {busy ? <BagelSpinner size={20} light /> : drop ? "Save changes" : "Create drop"}
      </button>
    </form>
  );
}

// ---------- drop detail ----------

function DropDetail({ token, drop, reload, onGone }: { token: string; drop: AdminDrop; reload: () => void; onGone: () => void }) {
  const [orders, setOrders] = useState<AdminOrder[] | null>(null);
  const [bake, setBake] = useState<{ name: string; qty: number }[]>([]);
  const [q, setQ] = useState("");
  const [adding, setAdding] = useState(false);
  const [copied, setCopied] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const loadOrders = useCallback(() => {
    api<{ orders: AdminOrder[]; bake: { name: string; qty: number }[] }>(`/api/admin/drops/${drop.id}/orders`, { token })
      .then((r) => {
        setOrders(r.orders);
        setBake(r.bake);
      })
      .catch(() => {});
  }, [drop.id, token]);
  useEffect(loadOrders, [loadOrders, drop.sold, drop.orders, drop.picked, drop.paid]);

  const patchDrop = async (json: Record<string, unknown>) => {
    await api(`/api/admin/drops/${drop.id}`, { method: "PATCH", token, json });
    reload();
  };
  const patchOrder = async (o: AdminOrder, json: Partial<AdminOrder>) => {
    setOrders((list) => list?.map((x) => (x.id === o.id ? { ...x, ...json } : x)) ?? null); // optimistic
    try {
      await api(`/api/admin/orders/${o.id}`, { method: "PATCH", token, json });
    } finally {
      reload();
      loadOrders();
    }
  };

  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    const list = orders ?? [];
    if (!t) return list;
    return list.filter((o) => o.name.toLowerCase().includes(t) || o.code.toLowerCase().includes(t) || o.phone.includes(t.replace(/\D/g, "") || "~"));
  }, [orders, q]);

  const active = (orders ?? []).filter((o) => o.status === "active");
  const revenue = drop.price != null ? shekels(drop.price * drop.sold) : null;
  const canClose = drop.state === "open" || drop.state === "scheduled";

  function copyPost() {
    const day = new Date(`${drop.pickup_date}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).toUpperCase();
    const text =
      drop.state === "scheduled"
        ? `ORDERS OPEN ${fmtOpens(drop.opens_at).toUpperCase()}\nPICKUP ${day}\n${location.origin}`
        : `ORDERS NOW OPEN\n${day}\n${location.origin}`;
    navigator.clipboard?.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    });
  }

  function exportCsv() {
    const rows = [["code", "name", "phone", "email", "qty", "bagels", "status", "paid", "picked_up", "source", "ordered_at"]];
    for (const o of orders ?? [])
      rows.push([o.code, o.name, o.phone, o.email ?? "", String(o.qty), linesText(o.lines), o.status, o.paid ? "yes" : "", o.picked_up ? "yes" : "", o.source, new Date(o.created_at).toISOString()]);
    const csv = rows.map((r) => r.map((c) => `"${c.replace(/"/g, '""')}"`).join(",")).join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv" }));
    a.download = `bagels-${drop.pickup_date}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  return (
    <section className="detail">
      <a className="link" href="#">
        All drops
      </a>
      <div className="row-between">
        <h1 className="h-big">{fmtDay(drop.pickup_date, "long")}</h1>
        <span className="tag" data-s={drop.state}>
          {stateLabel[drop.state]}
        </span>
      </div>
      <p className="muted">
        {[drop.pickup_window, drop.location].filter(Boolean).join(", ") || "No pickup time or spot set"}
        {drop.state === "scheduled" ? `. Opens ${fmtOpens(drop.opens_at)}` : ""}
      </p>

      <div className="detail-meter">
        <Meter sold={drop.sold} capacity={drop.capacity} />
        <dl className="numbers tabular">
          <div>
            <dt>Sold</dt>
            <dd>
              {drop.sold}
              <small>/{drop.capacity}</small>
            </dd>
          </div>
          <div>
            <dt>Orders</dt>
            <dd>{drop.orders}</dd>
          </div>
          <div>
            <dt>Picked up</dt>
            <dd>{drop.picked}</dd>
          </div>
          <div>
            <dt>Paid</dt>
            <dd>
              {drop.paid}
              <small>/{drop.orders}</small>
            </dd>
          </div>
          {revenue && (
            <div>
              <dt>Expected</dt>
              <dd>{revenue}</dd>
            </div>
          )}
        </dl>
      </div>

      {bake.length > 0 && (
        <div className="bake">
          <h2 className="h-mid">To bake</h2>
          <ul>
            {bake.map((b) => (
              <li key={b.name}>
                <BagelArt name={b.name} size={36} />
                <span>{b.name}</span>
                <span className="tabular">{b.qty}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="actions">
        {canClose ? (
          <button className="btn btn-quiet" onClick={() => patchDrop({ paused: true })}>
            Close orders now
          </button>
        ) : drop.paused ? (
          <button className="btn btn-quiet" onClick={() => patchDrop({ paused: false })}>
            Reopen orders
          </button>
        ) : null}
        <a className="btn btn-quiet" href={`#edit/${drop.id}`}>
          Edit drop
        </a>
        <button className="btn btn-quiet" onClick={copyPost}>
          {copied ? "Copied" : "Copy post text"}
        </button>
        <button className="btn btn-quiet" onClick={exportCsv} disabled={!orders?.length}>
          Download CSV
        </button>
      </div>

      <div className="row-between orders-head">
        <h2 className="h-mid">Orders</h2>
        <button className="btn btn-small" onClick={() => setAdding((a) => !a)}>
          {adding ? "Close" : "Add order"}
        </button>
      </div>
      {adding && (
        <AddOrder
          token={token}
          dropId={drop.id}
          onAdded={() => {
            setAdding(false);
            reload();
            loadOrders();
          }}
        />
      )}
      <input className="search" type="search" placeholder="Search name, phone or code" value={q} onChange={(e) => setQ(e.target.value)} />

      {!orders && <BagelSpinner size={32} />}
      {orders && orders.length === 0 && <p className="muted">No orders yet. They show up here the moment they land.</p>}
      <ul className="orders">
        {shown.map((o) => (
          <OrderRow key={o.id} o={o} onPatch={(j) => patchOrder(o, j)} />
        ))}
      </ul>
      {orders && active.length > 0 && (
        <p className="muted tabular">
          {active.length} active orders, {active.reduce((s, o) => s + o.qty, 0)} bagels.
        </p>
      )}

      {drop.orders === 0 && (
        <button
          className="btn btn-quiet danger"
          onClick={async () => {
            if (!confirmDelete) return setConfirmDelete(true);
            await api(`/api/admin/drops/${drop.id}`, { method: "DELETE", token });
            onGone();
          }}
        >
          {confirmDelete ? "Tap again to delete this drop" : "Delete drop"}
        </button>
      )}
    </section>
  );
}

function OrderRow({ o, onPatch }: { o: AdminOrder; onPatch: (j: Partial<AdminOrder>) => void }) {
  const [confirm, setConfirm] = useState(false);
  const timer = useRef<number>();
  const cancelled = o.status === "cancelled";
  const wa = o.phone ? `https://wa.me/${o.phone.replace(/\D/g, "")}` : null;
  return (
    <li className="order-row" data-cancelled={cancelled || undefined} data-done={(o.picked_up && !cancelled) || undefined}>
      <div className="order-main">
        <span className="order-code tabular">{o.code}</span>
        <span className="order-name">{o.name}</span>
        <span className="order-qty tabular">{o.qty}</span>
      </div>
      <p className="order-lines">{linesText(o.lines)}</p>
      <div className="order-sub">
        {wa ? (
          <a href={wa} target="_blank" rel="noreferrer">
            {o.phone.replace("+972", "0")}
          </a>
        ) : (
          <span>No phone</span>
        )}
        <span>{fmtTime(o.created_at)}</span>
        {o.source === "manual" && <span>Added by hand</span>}
        {cancelled && <span>Cancelled</span>}
      </div>
      <div className="order-actions">
        {!cancelled && (
          <>
            <button className="toggle" aria-pressed={o.paid} onClick={() => onPatch({ paid: !o.paid })}>
              Paid
            </button>
            <button className="toggle" aria-pressed={o.picked_up} onClick={() => onPatch({ picked_up: !o.picked_up })}>
              Picked up
            </button>
          </>
        )}
        <button
          className="link"
          onClick={() => {
            if (cancelled) return onPatch({ status: "active" });
            if (!confirm) {
              setConfirm(true);
              window.clearTimeout(timer.current);
              timer.current = window.setTimeout(() => setConfirm(false), 3000);
              return;
            }
            setConfirm(false);
            onPatch({ status: "cancelled" });
          }}
        >
          {cancelled ? "Restore" : confirm ? "Tap to confirm" : "Cancel"}
        </button>
      </div>
    </li>
  );
}

function AddOrder({ token, dropId, onAdded }: { token: string; dropId: string; onAdded: () => void }) {
  const [f, setF] = useState({ name: "", phone: "" });
  const [items, setItems] = useState<AdminItem[]>([]);
  const [qty, setQty] = useState<Record<string, string>>({});
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api<{ items: AdminItem[] }>("/api/admin/items", { token }).then((r) => setItems(r.items)).catch(() => {});
  }, [token]);
  const lines = Object.entries(qty)
    .map(([id, v]) => ({ id, qty: Number(v) || 0 }))
    .filter((l) => l.qty > 0);

  return (
    <form
      className="addorder"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!lines.length) return setErr("Add at least one bagel.");
        setBusy(true);
        setErr(null);
        try {
          await api(`/api/admin/drops/${dropId}/orders`, { method: "POST", token, json: { ...f, items: lines } });
          onAdded();
        } catch (e) {
          setErr(e instanceof ApiError && e.code === "invalid" ? `Check the ${e.data.field}.` : "Couldn't add it. Try again.");
        } finally {
          setBusy(false);
        }
      }}
    >
      <p className="muted">For orders that came in by DM or phone. This goes over the cap if you need it to.</p>
      <div className="grid2">
        <label className="field">
          <span className="field-label">Name</span>
          <input required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
        </label>
        <label className="field">
          <span className="field-label">Phone</span>
          <input type="tel" inputMode="tel" placeholder="Optional" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} />
        </label>
      </div>
      <div className="qtygrid">
        {items.map((i) => (
          <label key={i.id} className="field">
            <span className="field-label">{i.name}</span>
            <input type="number" inputMode="numeric" min={0} placeholder="0" value={qty[i.id] ?? ""} onChange={(e) => setQty({ ...qty, [i.id]: e.target.value })} />
          </label>
        ))}
      </div>
      {err && <p className="field-err">{err}</p>}
      <button className="btn cta" disabled={busy}>
        {busy ? <BagelSpinner size={20} light /> : `Add order${lines.length ? ` (${lines.reduce((a, l) => a + l.qty, 0)})` : ""}`}
      </button>
    </form>
  );
}

// ---------- menu editor ----------

function MenuEditor({ token }: { token: string }) {
  const [items, setItems] = useState<AdminItem[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const load = useCallback(() => {
    api<{ items: AdminItem[] }>("/api/admin/items", { token }).then((r) => setItems(r.items)).catch(() => setErr("Couldn't load the menu."));
  }, [token]);
  useEffect(load, [load]);

  const call = async (path: string, method: string, json?: unknown) => {
    setErr(null);
    try {
      const r = await api<{ items: AdminItem[] }>(path, { method, token, json });
      setItems(r.items);
      return true;
    } catch (e) {
      setErr(e instanceof ApiError && e.code === "invalid" ? `Check the ${String(e.data.field).replace(/_/g, " ")}.` : "Couldn't save. Try again.");
      return false;
    }
  };
  const move = (i: number, dir: -1 | 1) => {
    if (!items) return;
    const next = [...items];
    const j = i + dir;
    if (j < 0 || j >= next.length) return;
    [next[i], next[j]] = [next[j], next[i]];
    setItems(next);
    call("/api/admin/items/order", "POST", { ids: next.map((x) => x.id) });
  };

  return (
    <section className="menuedit">
      <h1 className="h-big">Menu</h1>
      <p className="muted">
        Every drop sells from this menu. Add-on is extra on top of the drop's base price, like +3 for cheese. A limit caps
        that flavour per drop. Switch a flavour off to hide it without deleting it.
      </p>
      {err && <p className="banner" role="alert">{err}</p>}
      {!items && <BagelSpinner size={32} />}
      <ul className="menuedit-list">
        {items?.map((it, i) => (
          <ItemRowEdit
            key={it.id}
            item={it}
            first={i === 0}
            last={i === items.length - 1}
            onMove={(d) => move(i, d)}
            onSave={(patch) => call(`/api/admin/items/${it.id}`, "PATCH", patch)}
            onDelete={() => call(`/api/admin/items/${it.id}`, "DELETE")}
          />
        ))}
      </ul>
      <NewItem onAdd={(b) => call("/api/admin/items", "POST", b)} />
    </section>
  );
}

function ItemRowEdit({
  item,
  first,
  last,
  onMove,
  onSave,
  onDelete,
}: {
  item: AdminItem;
  first: boolean;
  last: boolean;
  onMove: (d: -1 | 1) => void;
  onSave: (patch: Record<string, unknown>) => Promise<boolean>;
  onDelete: () => void;
}) {
  const init = () => ({ name: item.name, extra: String(item.extra || ""), limit: item.limit_per_drop == null ? "" : String(item.limit_per_drop), description: item.description });
  const [f, setF] = useState(init);
  const [confirm, setConfirm] = useState(false);
  useEffect(() => setF(init()), [item.name, item.extra, item.limit_per_drop, item.description]); // eslint-disable-line react-hooks/exhaustive-deps
  const dirty = f.name !== item.name || f.extra !== String(item.extra || "") || f.limit !== (item.limit_per_drop == null ? "" : String(item.limit_per_drop)) || f.description !== item.description;

  return (
    <li className="itemedit" data-off={!item.active || undefined}>
      <div className="itemedit-top">
        <BagelArt name={f.name || item.name} size={44} />
        <input className="itemedit-name" aria-label="Flavour name" value={f.name} maxLength={40} onChange={(e) => setF({ ...f, name: e.target.value })} />
        <button type="button" className="toggle" aria-pressed={item.active} onClick={() => onSave({ active: !item.active })}>
          {item.active ? "On" : "Off"}
        </button>
      </div>
      <div className="grid3">
        <label className="field">
          <span className="field-label">Add-on ₪</span>
          <input type="number" inputMode="numeric" placeholder="0" value={f.extra} onChange={(e) => setF({ ...f, extra: e.target.value })} />
        </label>
        <label className="field">
          <span className="field-label">Limit per drop</span>
          <input type="number" inputMode="numeric" min={0} placeholder="No limit" value={f.limit} onChange={(e) => setF({ ...f, limit: e.target.value })} />
        </label>
        <label className="field">
          <span className="field-label">Short note</span>
          <input maxLength={140} placeholder="Optional" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
        </label>
      </div>
      <div className="itemedit-actions">
        {dirty && (
          <button
            type="button"
            className="btn btn-small"
            onClick={() => onSave({ name: f.name, extra: f.extra === "" ? 0 : Number(f.extra), limit_per_drop: f.limit === "" ? null : Number(f.limit), description: f.description })}
          >
            Save
          </button>
        )}
        <button type="button" className="link" disabled={first} onClick={() => onMove(-1)}>
          Move up
        </button>
        <button type="button" className="link" disabled={last} onClick={() => onMove(1)}>
          Move down
        </button>
        <button
          type="button"
          className="link danger"
          onClick={() => {
            if (!confirm) return setConfirm(true);
            onDelete();
          }}
          onBlur={() => setConfirm(false)}
        >
          {confirm ? "Tap again to delete" : "Delete"}
        </button>
      </div>
    </li>
  );
}

function NewItem({ onAdd }: { onAdd: (b: Record<string, unknown>) => Promise<boolean> }) {
  const [name, setName] = useState("");
  const [extra, setExtra] = useState("");
  return (
    <form
      className="addorder"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!name.trim()) return;
        if (await onAdd({ name, extra: extra === "" ? 0 : Number(extra) })) {
          setName("");
          setExtra("");
        }
      }}
    >
      <h2 className="h-mid">Add a flavour</h2>
      <div className="grid2">
        <label className="field">
          <span className="field-label">Name</span>
          <input value={name} maxLength={40} placeholder="Za'atar" onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="field">
          <span className="field-label">Add-on ₪</span>
          <input type="number" inputMode="numeric" placeholder="0" value={extra} onChange={(e) => setExtra(e.target.value)} />
        </label>
      </div>
      <button className="btn cta" disabled={!name.trim()}>
        Add flavour
      </button>
    </form>
  );
}
