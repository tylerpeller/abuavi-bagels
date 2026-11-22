import { DurableObject } from "cloudflare:workers";
import type { Env } from "./index";
import { sendConfirmation } from "./email";

// One instance (named "shop") owns every drop and order. A Durable Object
// handles requests one at a time, and every capacity check below runs
// synchronously right before its INSERT, so two buyers can never take the
// same last bagel no matter how many hit "Order" in the same millisecond.

export type DropState = "scheduled" | "open" | "soldout" | "closed";

interface DropRow {
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
  paused: number;
  archived: number;
  created_at: number;
}

interface ItemRow {
  id: string;
  name: string;
  description: string;
  extra: number;
  limit_per_drop: number | null;
  active: number;
  sort: number;
  created_at: number;
}

export interface Line {
  item_id: string;
  name: string;
  qty: number;
  extra: number;
}

interface OrderRow {
  id: string;
  drop_id: string;
  code: string;
  token: string;
  name: string;
  phone: string;
  email: string | null;
  qty: number;
  status: "active" | "cancelled";
  paid: number;
  picked_up: number;
  source: "web" | "manual";
  idem: string | null;
  created_at: number;
  cancelled_at: number | null;
}

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS drops (
    id TEXT PRIMARY KEY,
    pickup_date TEXT NOT NULL,
    pickup_window TEXT NOT NULL DEFAULT '',
    location TEXT NOT NULL DEFAULT '',
    opens_at INTEGER NOT NULL,
    closes_at INTEGER,
    capacity INTEGER NOT NULL,
    max_per_order INTEGER NOT NULL DEFAULT 12,
    price INTEGER,
    note TEXT NOT NULL DEFAULT '',
    paused INTEGER NOT NULL DEFAULT 0,
    archived INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS orders (
    id TEXT PRIMARY KEY,
    drop_id TEXT NOT NULL,
    code TEXT NOT NULL,
    token TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    phone TEXT NOT NULL DEFAULT '',
    email TEXT,
    qty INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    paid INTEGER NOT NULL DEFAULT 0,
    picked_up INTEGER NOT NULL DEFAULT 0,
    source TEXT NOT NULL DEFAULT 'web',
    idem TEXT UNIQUE,
    created_at INTEGER NOT NULL,
    cancelled_at INTEGER
  )`,
  `CREATE INDEX IF NOT EXISTS orders_drop ON orders(drop_id, status)`,
  `CREATE INDEX IF NOT EXISTS orders_phone ON orders(drop_id, phone)`,
  `CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT)`,
  `CREATE TABLE IF NOT EXISTS items (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    extra INTEGER NOT NULL DEFAULT 0,
    limit_per_drop INTEGER,
    active INTEGER NOT NULL DEFAULT 1,
    sort INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS order_items (
    order_id TEXT NOT NULL,
    item_id TEXT NOT NULL,
    name TEXT NOT NULL,
    qty INTEGER NOT NULL,
    extra INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (order_id, item_id)
  )`,
];

// Starting menu. Avi edits names, add-on prices and limits in /admin.
const STARTER_MENU: [string, number, string][] = [
  ["Plain", 0, ""],
  ["Everything", 0, ""],
  ["Sesame", 0, ""],
  ["Poppy", 0, ""],
  ["Jalapeño Cheddar", 3, ""],
  ["Onion", 0, ""],
  ["Za'atar", 0, ""],
  ["Mediterranean", 0, ""],
  ["Cinnamon Raisin", 2, ""],
];

const RATE_WINDOW_MS = 60_000;
const RATE_MAX = 20; // order attempts per IP per minute; generous because of mobile CGNAT

export class DropGatekeeper extends DurableObject<Env> {
  private sql: SqlStorage;
  private hits = new Map<string, number[]>();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    for (const stmt of SCHEMA) this.sql.exec(stmt);
    this.seedMenu();
    if (env.DEMO_SEED === "1") this.seedDemo();
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
  }

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const path = url.pathname;
    const m = req.method;
    try {
      if (path === "/api/live") return this.live(req);
      if (path === "/api/drops" && m === "GET") return json(this.snapshot());
      if (path === "/api/orders" && m === "POST") return await this.placeOrder(req);

      let p: string[] | null;
      if ((p = match(path, "/api/orders/:token")) && m === "GET") return this.lookup(p[0]);
      if ((p = match(path, "/api/orders/:token/cancel")) && m === "POST") return this.cancelByCustomer(p[0]);

      if (path === "/api/admin/drops" && m === "GET") return json({ now: Date.now(), drops: this.adminDrops() });
      if (path === "/api/admin/drops" && m === "POST") return this.createDrop(await body(req));
      if ((p = match(path, "/api/admin/drops/:id")) && m === "PATCH") return this.updateDrop(p[0], await body(req));
      if ((p = match(path, "/api/admin/drops/:id")) && m === "DELETE") return this.deleteDrop(p[0]);
      if ((p = match(path, "/api/admin/drops/:id/orders")) && m === "GET") return this.dropOrders(p[0]);
      if ((p = match(path, "/api/admin/drops/:id/orders")) && m === "POST") return this.manualOrder(p[0], await body(req));
      if ((p = match(path, "/api/admin/orders/:id")) && m === "PATCH") return this.updateOrder(p[0], await body(req));
      if (path === "/api/admin/items" && m === "GET") return json({ items: this.adminItems() });
      if (path === "/api/admin/items" && m === "POST") return this.saveItem(null, await body(req));
      if ((p = match(path, "/api/admin/items/:id")) && m === "PATCH") return this.saveItem(p[0], await body(req));
      if ((p = match(path, "/api/admin/items/:id")) && m === "DELETE") return this.deleteItem(p[0]);
      if (path === "/api/admin/items/order" && m === "POST") return this.reorderItems(await body(req));

      return json({ error: "not_found" }, 404);
    } catch (err) {
      if (err instanceof HttpError) return json({ error: err.code, ...err.extra }, err.status);
      console.error(err);
      return json({ error: "server_error" }, 500);
    }
  }

  private seedMenu() {
    if (this.sql.exec(`SELECT 1 FROM meta WHERE k='menu_seeded'`).toArray().length) return;
    this.sql.exec(`INSERT INTO meta (k, v) VALUES ('menu_seeded', ?)`, String(Date.now()));
    if (this.sql.exec(`SELECT 1 FROM items LIMIT 1`).toArray().length) return;
    STARTER_MENU.forEach(([name, extra, description], i) =>
      this.sql.exec(
        `INSERT INTO items (id,name,description,extra,active,sort,created_at) VALUES (?,?,?,?,1,?,?)`,
        randomId(8), name, description, extra, i, Date.now(),
      ),
    );
  }

  // One-time example data so the page and admin have something to show.
  // Runs once per database; deleting the drops afterwards won't bring them back.
  private seedDemo() {
    if (this.sql.exec(`SELECT 1 FROM meta WHERE k='demo_seeded'`).toArray().length) return;
    this.sql.exec(`INSERT INTO meta (k, v) VALUES ('demo_seeded', ?)`, String(Date.now()));
    if (this.sql.exec(`SELECT 1 FROM drops LIMIT 1`).toArray().length) return;

    const now = Date.now();
    const day = (offset: number) =>
      new Intl.DateTimeFormat("en-CA", { timeZone: this.env.TIMEZONE || "Asia/Jerusalem" }).format(new Date(now + offset * 86400e3));
    const add = (pickup: string, opens: number, note: string) => {
      const id = randomId(10);
      this.sql.exec(
        `INSERT INTO drops (id,pickup_date,pickup_window,location,opens_at,capacity,max_per_order,price,note,created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?)`,
        id, pickup, "8:00 to 10:00", "Example pickup spot, Tel Aviv", opens, 100, 12, 9, note, now,
      );
      return id;
    };
    const open = add(day(3), now - 3600e3, "Example drop. Sesame, everything and plain.");
    add(day(7), now + 4 * 86400e3, "Example of a drop that hasn't opened yet.");
    const menu = this.menu();
    const pick = (spec: [number, number][]): Line[] =>
      spec.filter(([i]) => menu[i]).map(([i, qty]) => ({ item_id: menu[i].id, name: menu[i].name, qty, extra: menu[i].extra }));
    const sample: [string, [number, number][], boolean, boolean][] = [
      ["Demo Customer A", [[1, 4], [2, 2]], true, false],
      ["Demo Customer B", [[4, 2], [0, 2]], false, false],
      ["Demo Customer C", [[1, 6], [3, 3], [8, 3]], true, true],
      ["Demo Customer D", [[5, 2], [6, 2]], false, false],
      ["Demo Customer E", [[2, 3]], false, false],
    ];
    sample.forEach(([name, spec, paid, picked], i) => {
      const o = this.insertOrder(open, { name, phone: `+97250000000${i}`, email: null, lines: pick(spec), source: "web", idem: null });
      this.sql.exec(`UPDATE orders SET paid=?, picked_up=? WHERE id=?`, paid ? 1 : 0, picked ? 1 : 0, o.id);
    });
  }

  // ---------- reads ----------

  private today(): string {
    return new Intl.DateTimeFormat("en-CA", { timeZone: this.env.TIMEZONE || "Asia/Jerusalem" }).format(new Date());
  }

  private sold(dropId: string): number {
    const r = this.sql
      .exec<{ n: number }>(`SELECT COALESCE(SUM(qty),0) AS n FROM orders WHERE drop_id=? AND status='active'`, dropId)
      .one();
    return r.n;
  }

  private menu(all = false): ItemRow[] {
    return this.sql
      .exec<ItemRow>(`SELECT * FROM items ${all ? "" : "WHERE active=1"} ORDER BY sort, created_at`)
      .toArray();
  }

  private itemSold(dropId: string): Map<string, number> {
    const rows = this.sql
      .exec<{ item_id: string; n: number }>(
        `SELECT oi.item_id, SUM(oi.qty) AS n FROM order_items oi JOIN orders o ON o.id=oi.order_id
          WHERE o.drop_id=? AND o.status='active' GROUP BY oi.item_id`,
        dropId,
      )
      .toArray();
    return new Map(rows.map((r) => [r.item_id, r.n]));
  }

  private lines(orderId: string): Line[] {
    return this.sql
      .exec<Line>(`SELECT item_id, name, qty, extra FROM order_items WHERE order_id=? ORDER BY rowid`, orderId)
      .toArray()
      .map((l) => ({ ...l }));
  }

  private state(d: DropRow, sold: number, now = Date.now(), today = this.today()): DropState {
    if (d.paused || d.archived) return "closed";
    if (d.closes_at && now >= d.closes_at) return "closed";
    if (d.pickup_date < today) return "closed";
    if (now < d.opens_at) return "scheduled";
    if (sold >= d.capacity) return "soldout";
    return "open";
  }

  private getDrop(id: string): DropRow {
    const d = this.sql.exec<DropRow>(`SELECT * FROM drops WHERE id=?`, id).toArray()[0];
    if (!d) throw new HttpError(404, "drop_not_found");
    return d;
  }

  private publicDrop(d: DropRow, now: number, today: string) {
    const sold = this.sold(d.id);
    return {
      id: d.id,
      pickup_date: d.pickup_date,
      pickup_window: d.pickup_window,
      location: d.location,
      opens_at: d.opens_at,
      closes_at: d.closes_at,
      capacity: d.capacity,
      max_per_order: d.max_per_order,
      price: d.price,
      note: d.note,
      remaining: Math.max(0, d.capacity - sold),
      state: this.state(d, sold, now, today),
      item_left: this.itemLeft(d.id),
    };
  }

  // Remaining count for menu items that have a per-drop limit.
  private itemLeft(dropId: string): Record<string, number> {
    const limited = this.menu().filter((i) => i.limit_per_drop != null);
    if (!limited.length) return {};
    const sold = this.itemSold(dropId);
    return Object.fromEntries(limited.map((i) => [i.id, Math.max(0, i.limit_per_drop! - (sold.get(i.id) ?? 0))]));
  }

  private publicMenu() {
    return this.menu().map((i) => ({ id: i.id, name: i.name, description: i.description, extra: i.extra, limited: i.limit_per_drop != null }));
  }

  private snapshot() {
    const now = Date.now();
    const today = this.today();
    const rows = this.sql
      .exec<DropRow>(`SELECT * FROM drops WHERE archived=0 AND pickup_date>=? ORDER BY pickup_date, opens_at`, today)
      .toArray();
    return { now, menu: this.publicMenu(), drops: rows.map((d) => this.publicDrop(d, now, today)) };
  }

  private adminDrops() {
    const now = Date.now();
    const today = this.today();
    const rows = this.sql.exec<DropRow>(`SELECT * FROM drops WHERE archived=0 ORDER BY pickup_date DESC, opens_at DESC`).toArray();
    return rows.map((d) => {
      const s = this.sql
        .exec<{ orders: number; picked: number; paid: number }>(
          `SELECT COUNT(*) AS orders,
                  COALESCE(SUM(CASE WHEN picked_up=1 THEN qty END),0) AS picked,
                  COALESCE(SUM(CASE WHEN paid=1 THEN 1 END),0) AS paid
             FROM orders WHERE drop_id=? AND status='active'`,
          d.id,
        )
        .one();
      const sold = this.sold(d.id);
      return { ...d, paused: !!d.paused, sold, state: this.state(d, sold, now, today), ...s };
    });
  }

  // ---------- live updates ----------

  private live(req: Request): Response {
    if (req.headers.get("upgrade") !== "websocket") return json({ error: "expected_websocket" }, 426);
    const pair = new WebSocketPair();
    this.ctx.acceptWebSocket(pair[1]);
    pair[1].send(JSON.stringify({ type: "drops", ...this.snapshot() }));
    return new Response(null, { status: 101, webSocket: pair[0] });
  }

  private broadcast() {
    const sockets = this.ctx.getWebSockets();
    if (!sockets.length) return;
    const msg = JSON.stringify({ type: "drops", ...this.snapshot() });
    for (const ws of sockets) {
      try {
        ws.send(msg);
      } catch {
        /* closed mid-send */
      }
    }
  }

  async webSocketMessage() {}
  async webSocketClose(ws: WebSocket, code: number) {
    try {
      ws.close(code === 1005 ? 1000 : code);
    } catch {
      /* already closed */
    }
  }

  // ---------- customer ----------

  private rateLimited(ip: string): boolean {
    if (!ip) return false;
    const now = Date.now();
    const list = (this.hits.get(ip) ?? []).filter((t) => now - t < RATE_WINDOW_MS);
    list.push(now);
    this.hits.set(ip, list);
    if (this.hits.size > 5000) this.hits.clear();
    return list.length > RATE_MAX;
  }

  private async placeOrder(req: Request): Promise<Response> {
    const b = await body(req);
    // Everything below is synchronous: no awaits between the checks and the insert.
    if (typeof b.website === "string" && b.website) return json({ error: "invalid" }, 400); // honeypot
    if (this.rateLimited(req.headers.get("x-client-ip") ?? "")) throw new HttpError(429, "rate_limited");

    const idem = typeof b.idem === "string" && b.idem.length >= 8 && b.idem.length <= 64 ? b.idem : null;
    if (idem) {
      const prior = this.sql.exec<OrderRow>(`SELECT * FROM orders WHERE idem=?`, idem).toArray()[0];
      if (prior) return json({ order: this.orderView(prior), replay: true });
    }

    const d = this.getDrop(str(b.drop_id, "drop_id", 1, 40));
    const name = cleanName(b.name);
    const phone = normalizePhone(b.phone);
    const email = cleanEmail(b.email);
    const lines = this.readLines(b.items);
    const qty = lines.reduce((n, l) => n + l.qty, 0);
    if (qty < 1 || qty > d.max_per_order) throw new HttpError(400, "invalid", { field: "qty", max: d.max_per_order });

    const sold = this.sold(d.id);
    const state = this.state(d, sold);
    if (state === "scheduled") throw new HttpError(425, "not_open", { opens_at: d.opens_at, now: Date.now() });
    if (state === "closed") throw new HttpError(410, "closed");
    if (state === "soldout") throw new HttpError(409, "sold_out");

    const dup = this.sql
      .exec<OrderRow>(`SELECT * FROM orders WHERE drop_id=? AND phone=? AND status='active'`, d.id, phone)
      .toArray()[0];
    if (dup) throw new HttpError(409, "duplicate"); // never leak the existing order's cancel token

    const remaining = d.capacity - sold;
    if (qty > remaining) throw new HttpError(409, "only_left", { remaining });

    const left = this.itemLeft(d.id);
    for (const l of lines) {
      if (l.item_id in left && l.qty > left[l.item_id]) {
        throw new HttpError(409, "item_left", { item_id: l.item_id, name: l.name, remaining: left[l.item_id] });
      }
    }

    const order = this.insertOrder(d.id, { name, phone, email, lines, source: "web", idem });
    this.broadcast();
    this.emailConfirmation(order, d);
    return json({ order: this.orderView(order) }, 201);
  }

  // items: [{ id, qty }] -> validated lines with name and add-on price snapshotted.
  private readLines(raw: unknown, allowInactive = false): Line[] {
    if (!Array.isArray(raw) || raw.length === 0 || raw.length > 50) throw new HttpError(400, "invalid", { field: "items" });
    const menu = new Map(this.menu(allowInactive).map((i) => [i.id, i]));
    const merged = new Map<string, Line>();
    for (const r of raw) {
      const id = r && typeof r === "object" ? (r as Record<string, unknown>).id : null;
      const item = typeof id === "string" ? menu.get(id) : undefined;
      if (!item) throw new HttpError(409, "item_unavailable", { item_id: id ?? null });
      const q = int((r as Record<string, unknown>).qty, "items", 0, 500);
      if (q === 0) continue;
      const prev = merged.get(item.id);
      merged.set(item.id, { item_id: item.id, name: item.name, qty: (prev?.qty ?? 0) + q, extra: item.extra });
    }
    const lines = [...merged.values()];
    if (!lines.length) throw new HttpError(400, "invalid", { field: "items" });
    return lines;
  }

  private insertOrder(
    dropId: string,
    o: { name: string; phone: string; email: string | null; lines: Line[]; source: "web" | "manual"; idem: string | null },
  ): OrderRow {
    const qty = o.lines.reduce((n, l) => n + l.qty, 0);
    let code = shortCode();
    while (this.sql.exec(`SELECT 1 FROM orders WHERE drop_id=? AND code=?`, dropId, code).toArray().length) code = shortCode();
    const row: OrderRow = {
      id: randomId(12),
      drop_id: dropId,
      code,
      token: randomId(24),
      name: o.name,
      phone: o.phone,
      email: o.email,
      qty,
      status: "active",
      paid: 0,
      picked_up: 0,
      source: o.source,
      idem: o.idem,
      created_at: Date.now(),
      cancelled_at: null,
    };
    this.sql.exec(
      `INSERT INTO orders (id,drop_id,code,token,name,phone,email,qty,status,paid,picked_up,source,idem,created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      row.id, row.drop_id, row.code, row.token, row.name, row.phone, row.email, row.qty,
      row.status, row.paid, row.picked_up, row.source, row.idem, row.created_at,
    );
    for (const l of o.lines) {
      this.sql.exec(`INSERT INTO order_items (order_id,item_id,name,qty,extra) VALUES (?,?,?,?,?)`, row.id, l.item_id, l.name, l.qty, l.extra);
    }
    return row;
  }

  private orderView(o: OrderRow) {
    const d = this.sql.exec<DropRow>(`SELECT * FROM drops WHERE id=?`, o.drop_id).toArray()[0];
    return {
      code: o.code,
      token: o.token,
      name: o.name,
      qty: o.qty,
      lines: this.lines(o.id),
      status: o.status,
      picked_up: !!o.picked_up,
      created_at: o.created_at,
      drop: d
        ? { id: d.id, pickup_date: d.pickup_date, pickup_window: d.pickup_window, location: d.location, price: d.price, note: d.note }
        : null,
      cancellable: !!d && o.status === "active" && !o.picked_up && d.pickup_date >= this.today(),
    };
  }

  private emailConfirmation(o: OrderRow, d: DropRow) {
    if (!o.email || !this.env.RESEND_API_KEY || !this.env.EMAIL_FROM) return;
    this.ctx.waitUntil(sendConfirmation(this.env, o, d, this.lines(o.id)).catch((e) => console.error("email failed", e)));
  }

  private lookup(token: string): Response {
    const o = this.sql.exec<OrderRow>(`SELECT * FROM orders WHERE token=?`, token).toArray()[0];
    if (!o) throw new HttpError(404, "order_not_found");
    return json({ order: this.orderView(o) });
  }

  private cancelByCustomer(token: string): Response {
    const o = this.sql.exec<OrderRow>(`SELECT * FROM orders WHERE token=?`, token).toArray()[0];
    if (!o) throw new HttpError(404, "order_not_found");
    if (o.status === "cancelled") return json({ order: this.orderView(o) });
    if (!this.orderView(o).cancellable) throw new HttpError(409, "not_cancellable");
    this.sql.exec(`UPDATE orders SET status='cancelled', cancelled_at=? WHERE id=?`, Date.now(), o.id);
    this.broadcast(); // freed bagels show up live for everyone still on the page
    return json({ order: this.orderView({ ...o, status: "cancelled" }) });
  }

  // ---------- admin ----------

  private readDropFields(b: Record<string, unknown>, partial: boolean) {
    const f: Partial<DropRow> = {};
    const has = (k: string) => k in b && b[k] !== undefined;
    if (!partial || has("pickup_date")) {
      const v = str(b.pickup_date, "pickup_date", 10, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new HttpError(400, "invalid", { field: "pickup_date" });
      f.pickup_date = v;
    }
    if (!partial || has("opens_at")) f.opens_at = int(b.opens_at, "opens_at", 0, 9e15);
    if (!partial || has("capacity")) f.capacity = int(b.capacity, "capacity", 1, 5000);
    if (has("pickup_window")) f.pickup_window = str(b.pickup_window, "pickup_window", 0, 60);
    if (has("location")) f.location = str(b.location, "location", 0, 120);
    if (has("note")) f.note = str(b.note, "note", 0, 400);
    if (has("max_per_order")) f.max_per_order = int(b.max_per_order, "max_per_order", 1, 500);
    if (has("closes_at")) f.closes_at = b.closes_at === null ? null : int(b.closes_at, "closes_at", 0, 9e15);
    if (has("price")) f.price = b.price === null || b.price === "" ? null : int(b.price, "price", 0, 10000);
    if (has("paused")) f.paused = b.paused ? 1 : 0;
    return f;
  }

  private createDrop(b: Record<string, unknown>): Response {
    const f = this.readDropFields(b, false);
    const id = randomId(10);
    this.sql.exec(
      `INSERT INTO drops (id,pickup_date,pickup_window,location,opens_at,closes_at,capacity,max_per_order,price,note,paused,created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      id, f.pickup_date!, f.pickup_window ?? "", f.location ?? "", f.opens_at!, f.closes_at ?? null,
      f.capacity!, f.max_per_order ?? 12, f.price ?? null, f.note ?? "", f.paused ?? 0, Date.now(),
    );
    this.broadcast();
    return json({ drop: this.adminDrops().find((d) => d.id === id) }, 201);
  }

  private updateDrop(id: string, b: Record<string, unknown>): Response {
    this.getDrop(id);
    const f = this.readDropFields(b, true);
    const keys = Object.keys(f) as (keyof DropRow)[];
    if (keys.length) {
      this.sql.exec(`UPDATE drops SET ${keys.map((k) => `${k}=?`).join(",")} WHERE id=?`, ...keys.map((k) => f[k] as SqlStorageValue), id);
      this.broadcast();
    }
    return json({ drop: this.adminDrops().find((d) => d.id === id) });
  }

  private deleteDrop(id: string): Response {
    this.getDrop(id);
    const n = this.sql.exec<{ n: number }>(`SELECT COUNT(*) AS n FROM orders WHERE drop_id=?`, id).one().n;
    if (n === 0) this.sql.exec(`DELETE FROM drops WHERE id=?`, id);
    else this.sql.exec(`UPDATE drops SET archived=1 WHERE id=?`, id);
    this.broadcast();
    return json({ ok: true, archived: n > 0 });
  }

  private dropOrders(id: string): Response {
    this.getDrop(id);
    const orders = this.sql
      .exec<OrderRow>(`SELECT * FROM orders WHERE drop_id=? ORDER BY created_at`, id)
      .toArray()
      .map(({ idem: _i, token: _t, ...o }) => ({ ...o, paid: !!o.paid, picked_up: !!o.picked_up, lines: this.lines(o.id) }));
    const bake = this.sql
      .exec<{ name: string; qty: number }>(
        `SELECT oi.name, SUM(oi.qty) AS qty FROM order_items oi JOIN orders o ON o.id=oi.order_id
          WHERE o.drop_id=? AND o.status='active' GROUP BY oi.item_id ORDER BY qty DESC`,
        id,
      )
      .toArray()
      .map((r) => ({ ...r }));
    return json({ now: Date.now(), orders, bake });
  }

  private manualOrder(id: string, b: Record<string, unknown>): Response {
    const d = this.getDrop(id);
    const name = cleanName(b.name);
    const phone = b.phone ? normalizePhone(b.phone) : "";
    const email = cleanEmail(b.email);
    const lines = this.readLines(b.items, true);
    // Avi can add phone/DM orders even when the web drop is closed or full.
    const o = this.insertOrder(d.id, { name, phone, email, lines, source: "manual", idem: null });
    this.broadcast();
    return json({ order: o }, 201);
  }

  private updateOrder(id: string, b: Record<string, unknown>): Response {
    const o = this.sql.exec<OrderRow>(`SELECT * FROM orders WHERE id=?`, id).toArray()[0];
    if (!o) throw new HttpError(404, "order_not_found");
    const sets: string[] = [];
    const vals: SqlStorageValue[] = [];
    if ("paid" in b) sets.push("paid=?"), vals.push(b.paid ? 1 : 0);
    if ("picked_up" in b) sets.push("picked_up=?"), vals.push(b.picked_up ? 1 : 0);
    if ("name" in b) sets.push("name=?"), vals.push(cleanName(b.name));
    if ("status" in b) {
      const s = b.status === "cancelled" ? "cancelled" : "active";
      sets.push("status=?", "cancelled_at=?");
      vals.push(s, s === "cancelled" ? Date.now() : null);
    }
    if (sets.length) {
      this.sql.exec(`UPDATE orders SET ${sets.join(",")} WHERE id=?`, ...vals, id);
      this.broadcast();
    }
    const fresh = this.sql.exec<OrderRow>(`SELECT * FROM orders WHERE id=?`, id).one();
    const { idem: _i, token: _t, ...rest } = fresh;
    return json({ order: { ...rest, paid: !!rest.paid, picked_up: !!rest.picked_up, lines: this.lines(id) } });
  }

  // ---------- menu admin ----------

  private adminItems() {
    return this.menu(true).map((i) => ({ ...i, active: !!i.active }));
  }

  private saveItem(id: string | null, b: Record<string, unknown>): Response {
    const has = (k: string) => k in b && b[k] !== undefined;
    const f: Partial<ItemRow> = {};
    if (!id || has("name")) f.name = str(b.name, "name", 1, 40);
    if (has("description")) f.description = str(b.description, "description", 0, 140);
    if (has("extra")) f.extra = b.extra === "" || b.extra == null ? 0 : int(b.extra, "extra", -100, 1000);
    if (has("limit_per_drop")) f.limit_per_drop = b.limit_per_drop === "" || b.limit_per_drop == null ? null : int(b.limit_per_drop, "limit_per_drop", 0, 5000);
    if (has("active")) f.active = b.active ? 1 : 0;
    if (!id) {
      const newId = randomId(8);
      const sort = this.sql.exec<{ n: number }>(`SELECT COALESCE(MAX(sort),0)+1 AS n FROM items`).one().n;
      this.sql.exec(
        `INSERT INTO items (id,name,description,extra,limit_per_drop,active,sort,created_at) VALUES (?,?,?,?,?,?,?,?)`,
        newId, f.name!, f.description ?? "", f.extra ?? 0, f.limit_per_drop ?? null, f.active ?? 1, sort, Date.now(),
      );
      id = newId;
    } else {
      if (!this.sql.exec(`SELECT 1 FROM items WHERE id=?`, id).toArray().length) throw new HttpError(404, "item_not_found");
      const keys = Object.keys(f) as (keyof ItemRow)[];
      if (keys.length) this.sql.exec(`UPDATE items SET ${keys.map((k) => `${k}=?`).join(",")} WHERE id=?`, ...keys.map((k) => f[k] as SqlStorageValue), id);
    }
    this.broadcast();
    return json({ items: this.adminItems() }, 200);
  }

  private deleteItem(id: string): Response {
    // Past orders keep their own copy of the name, so deleting is safe.
    this.sql.exec(`DELETE FROM items WHERE id=?`, id);
    this.broadcast();
    return json({ items: this.adminItems() });
  }

  private reorderItems(b: Record<string, unknown>): Response {
    if (!Array.isArray(b.ids)) throw new HttpError(400, "invalid", { field: "ids" });
    b.ids.forEach((id, i) => typeof id === "string" && this.sql.exec(`UPDATE items SET sort=? WHERE id=?`, i, id));
    this.broadcast();
    return json({ items: this.adminItems() });
  }
}

// ---------- helpers ----------

class HttpError extends Error {
  constructor(public status: number, public code: string, public extra: Record<string, unknown> = {}) {
    super(code);
  }
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

async function body(req: Request): Promise<Record<string, unknown>> {
  try {
    const b = await req.json();
    return b && typeof b === "object" ? (b as Record<string, unknown>) : {};
  } catch {
    throw new HttpError(400, "bad_json");
  }
}

function match(path: string, pattern: string): string[] | null {
  const a = path.split("/");
  const b = pattern.split("/");
  if (a.length !== b.length) return null;
  const out: string[] = [];
  for (let i = 0; i < b.length; i++) {
    if (b[i].startsWith(":")) {
      if (!a[i]) return null;
      out.push(decodeURIComponent(a[i]));
    } else if (a[i] !== b[i]) return null;
  }
  return out;
}

function str(v: unknown, field: string, min: number, max: number): string {
  const s = typeof v === "string" ? v.trim() : "";
  if (s.length < min || s.length > max) throw new HttpError(400, "invalid", { field });
  return s;
}

function int(v: unknown, field: string, min: number, max: number): number {
  const n = typeof v === "string" && v.trim() !== "" ? Number(v) : v;
  if (typeof n !== "number" || !Number.isInteger(n) || n < min || n > max) throw new HttpError(400, "invalid", { field });
  return n;
}

export function cleanName(v: unknown): string {
  const s = (typeof v === "string" ? v : "").replace(/\s+/g, " ").trim();
  if (s.length < 2 || s.length > 60) throw new HttpError(400, "invalid", { field: "name" });
  return s;
}

export function cleanEmail(v: unknown): string | null {
  const s = typeof v === "string" ? v.trim().toLowerCase() : "";
  if (!s) return null;
  if (s.length > 120 || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s)) throw new HttpError(400, "invalid", { field: "email" });
  return s;
}

// Israeli mobiles (050-1234567, 972501234567, +972 50 123 4567) become +9725XXXXXXXX.
// Foreign numbers must start with + and are kept as digits.
export function normalizePhone(v: unknown): string {
  const raw = typeof v === "string" ? v.trim() : "";
  const digits = raw.replace(/\D/g, "");
  let local = digits;
  if (local.startsWith("972")) local = local.slice(3);
  if (local.startsWith("0")) local = local.slice(1);
  if (/^5\d{8}$/.test(local) && (digits.startsWith("972") || digits.startsWith("05") || digits.startsWith("5"))) return `+972${local}`;
  if (raw.startsWith("+") && digits.length >= 8 && digits.length <= 15 && !digits.startsWith("972")) return `+${digits}`;
  throw new HttpError(400, "invalid", { field: "phone" });
}

const CODE_ALPHABET = "ACDEFGHJKMNPQRTUVWXY34679";
function shortCode(): string {
  const b = crypto.getRandomValues(new Uint8Array(4));
  return Array.from(b, (x) => CODE_ALPHABET[x % CODE_ALPHABET.length]).join("");
}

function randomId(len: number): string {
  const alphabet = "abcdefghijkmnopqrstuvwxyz23456789";
  const b = crypto.getRandomValues(new Uint8Array(len));
  return Array.from(b, (x) => alphabet[x % alphabet.length]).join("");
}
