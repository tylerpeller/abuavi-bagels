import { useEffect, useMemo, useRef, useState } from "react";
import {
  api,
  ApiError,
  Drop,
  fmtCountdown,
  fmtDay,
  fmtOpens,
  liveState,
  loadMe,
  MenuItem,
  myOrders,
  newKey,
  OrderView,
  rememberOrder,
  saveMe,
  serverNow,
  shekels,
  useDrops,
  useTick,
} from "../lib/api";
import { Tray } from "./Tray";
import { Ticket } from "./Ticket";
import { BagelSpinner } from "../ui/BagelSpinner";
import { BagelArt } from "../ui/BagelArt";
import hero from "../assets/hero-bagels.jpg";
import logo from "../assets/logo.jpg";

type Cart = Record<string, number>;

export function Shop() {
  const { drops, menu, error, reload } = useDrops();
  const [picked, setPicked] = useState<string | null>(null);
  useTick(1000, !!drops?.some((d) => d.state === "scheduled"));

  const visible = drops ?? [];
  const current = useMemo(() => {
    if (!visible.length) return null;
    return (
      visible.find((d) => d.id === picked) ??
      visible.find((d) => liveState(d) === "open") ??
      visible.find((d) => liveState(d) === "scheduled") ??
      visible[0]
    );
  }, [visible, picked]);

  return (
    <div className="shop">
      <header className="shop-head">
        <div className="hero-img">
          <img src={hero} alt="A rack of fresh sesame and everything bagels" width={1200} height={800} />
        </div>
        <div className="brand">
          <img className="badge" src={logo} alt="" width={72} height={72} />
          <div>
            <p className="brand-name">Abu Avi Bagels</p>
            <p className="brand-line">Hand-rolled. Cold-proofed. Fresh in Tel Aviv.</p>
          </div>
        </div>
      </header>

      <main className="shop-main">
        {!drops && !error && (
          <div className="placeholder">
            <BagelSpinner size={44} />
            <p>Checking the tray</p>
          </div>
        )}
        {!drops && error && (
          <div className="placeholder">
            <p className="h-mid">Can't reach the shop right now.</p>
            <p>Your connection may be busy. This page keeps trying on its own.</p>
          </div>
        )}
        {drops && !current && (
          <div className="placeholder">
            <h1 className="h-big">No drop yet</h1>
            <p>
              The next one goes up on <a href="https://instagram.com/abuavibagels">Instagram</a> first. Turn on
              notifications and come back here when it opens.
            </p>
          </div>
        )}
        {drops && visible.length > 1 && current && <DayTabs drops={visible} current={current.id} onPick={setPicked} />}
        {current && <DropView key={current.id} drop={current} menu={menu} reload={reload} />}
      </main>

      <footer className="shop-foot">
        <p>
          Drops are announced on <a href="https://instagram.com/abuavibagels">Instagram</a>. Pay at pickup.
        </p>
      </footer>
    </div>
  );
}

function DayTabs({ drops, current, onPick }: { drops: Drop[]; current: string; onPick: (id: string) => void }) {
  return (
    <div className="days" role="tablist" aria-label="Pickup day">
      {drops.map((d) => {
        const s = liveState(d);
        const sub = s === "open" ? `${d.remaining} left` : s === "scheduled" ? `Opens ${fmtOpens(d.opens_at)}` : s === "soldout" ? "Sold out" : "Closed";
        return (
          <button key={d.id} role="tab" aria-selected={d.id === current} className="day" data-s={s} onClick={() => onPick(d.id)}>
            <span className="day-date">{fmtDay(d.pickup_date)}</span>
            <span className="day-sub">{sub}</span>
          </button>
        );
      })}
    </div>
  );
}

function DropView({ drop, menu, reload }: { drop: Drop; menu: MenuItem[]; reload: () => void }) {
  const [mine, setMine] = useState(() => myOrders()[drop.id] ?? null);
  const [cart, setCart] = useState<Cart>({});
  const state = liveState(drop);
  const count = Object.values(cart).reduce((a, b) => a + b, 0);
  const picking = !mine && (state === "open" || state === "scheduled");

  return (
    <section className="drop">
      <div className="drop-info">
        <Status drop={drop} />
        <Tray capacity={drop.capacity} remaining={drop.remaining} mine={picking ? count : 0} dim={state === "closed"} />
        <dl className="facts">
          <div>
            <dt>Pickup</dt>
            <dd>
              {fmtDay(drop.pickup_date, "long")}
              {drop.pickup_window ? `, ${drop.pickup_window}` : ""}
            </dd>
          </div>
          {drop.location && (
            <div>
              <dt>Where</dt>
              <dd>{drop.location}</dd>
            </div>
          )}
          <div>
            <dt>Price</dt>
            <dd>{drop.price != null ? `${shekels(drop.price)} a bagel, paid at pickup` : "Paid at pickup"}</dd>
          </div>
          <div>
            <dt>Limit</dt>
            <dd>Up to {drop.max_per_order} per order, one order per phone</dd>
          </div>
        </dl>
        {drop.note && <p className="drop-note">{drop.note}</p>}
      </div>

      <div className="drop-action">
        {mine ? (
          <MyTicket
            token={mine.token}
            onForget={() => {
              rememberOrder(drop.id, null);
              setMine(null);
            }}
          />
        ) : (
          <OrderForm
            drop={drop}
            menu={menu}
            cart={cart}
            setCart={setCart}
            reload={reload}
            onPlaced={(o) => {
              const m = { token: o.token, code: o.code, qty: o.qty };
              rememberOrder(drop.id, m);
              setMine(m);
              setCart({});
            }}
          />
        )}
      </div>
    </section>
  );
}

function Status({ drop }: { drop: Drop }) {
  const state = liveState(drop);
  if (state === "scheduled") {
    return (
      <div className="status">
        <h1 className="h-big">Opens {fmtOpens(drop.opens_at)}</h1>
        <p className="countdown tabular">{fmtCountdown(drop.opens_at - serverNow())}</p>
        <p className="status-sub">
          {drop.capacity} bagels on the tray. Pick your bagels and fill in your details now. The order button unlocks the
          second it opens.
        </p>
      </div>
    );
  }
  if (state === "open") {
    return (
      <div className="status">
        <h1 className="h-big" aria-live="polite">
          <Rolling value={drop.remaining} /> left
        </h1>
        <p className="status-sub">Of {drop.capacity}. This count is live, so it drops as people order.</p>
      </div>
    );
  }
  if (state === "soldout") {
    return (
      <div className="status">
        <h1 className="h-big">Sold out</h1>
        <p className="status-sub">If someone cancels, their bagels go back on the tray here, live.</p>
      </div>
    );
  }
  return (
    <div className="status">
      <h1 className="h-big">Orders closed</h1>
      <p className="status-sub">This drop isn't taking orders. Watch Instagram for the next one.</p>
    </div>
  );
}

function Rolling({ value }: { value: number }) {
  const prev = useRef(value);
  const dir = value < prev.current ? "down" : "up";
  useEffect(() => {
    prev.current = value;
  }, [value]);
  return (
    <span className="roll tabular" data-dir={dir} key={value}>
      {value}
    </span>
  );
}

// ---------------- menu + checkout ----------------

type Phase = "idle" | "sending" | "retrying";
type FieldErr = Partial<Record<"name" | "phone" | "email", string>>;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function OrderForm({
  drop,
  menu,
  cart,
  setCart,
  reload,
  onPlaced,
}: {
  drop: Drop;
  menu: MenuItem[];
  cart: Cart;
  setCart: React.Dispatch<React.SetStateAction<Cart>>;
  reload: () => void;
  onPlaced: (o: OrderView) => void;
}) {
  const [me, setMe] = useState(loadMe);
  const [phase, setPhase] = useState<Phase>("idle");
  const [fieldErr, setFieldErr] = useState<FieldErr>({});
  const [banner, setBanner] = useState<string | null>(null);
  const idem = useRef<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  const state = liveState(drop);
  const open = state === "open";
  const busy = phase !== "idle";
  const locked = busy || state === "soldout" || state === "closed";
  const count = Object.values(cart).reduce((a, b) => a + b, 0);
  const cap = open ? Math.min(drop.max_per_order, drop.remaining) : drop.max_per_order;
  const over = count > cap;
  const extras = menu.reduce((s, i) => s + (cart[i.id] ?? 0) * i.extra, 0);
  const total = drop.price != null && count ? shekels(drop.price * count + extras) : null;
  useTick(250, state === "scheduled" && drop.opens_at - serverNow() < 60_000);

  // Drop flavours that left the menu.
  useEffect(() => {
    const ids = new Set(menu.map((i) => i.id));
    if (Object.keys(cart).some((id) => !ids.has(id))) setCart((c) => Object.fromEntries(Object.entries(c).filter(([id]) => ids.has(id))));
  }, [menu, cart, setCart]);

  const setQty = (id: string, n: number) => {
    setCart((c) => {
      const next = { ...c };
      if (n <= 0) delete next[id];
      else next[id] = n;
      return next;
    });
    setBanner(null);
    if (!busy) idem.current = null;
  };

  const update = (patch: Partial<typeof me>) => {
    setMe((m) => ({ ...m, ...patch }));
    setFieldErr((e) => {
      const n = { ...e };
      for (const k of Object.keys(patch)) delete n[k as keyof FieldErr];
      return n;
    });
    if (!busy) idem.current = null;
  };

  function validate(): boolean {
    const e: FieldErr = {};
    if (me.name.trim().length < 2) e.name = "Add the name you'll give at pickup.";
    const digits = me.phone.replace(/\D/g, "");
    if (digits.length < 9 || digits.length > 15) e.phone = "Enter a mobile number, like 050-123-4567.";
    if (me.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(me.email.trim())) e.email = "Check the email, or leave it empty.";
    setFieldErr(e);
    const first = Object.keys(e)[0];
    if (first) {
      const el = formRef.current?.querySelector<HTMLInputElement>(`input[name=${first}]`);
      el?.focus({ preventScroll: true });
      el?.scrollIntoView({ block: "center", behavior: "smooth" });
    }
    return !first;
  }

  async function submit() {
    if (busy || !open || !count || over) return;
    if (!validate()) return;
    setBanner(null);
    saveMe(me);
    if (!idem.current) idem.current = newKey();
    setPhase("sending");
    const items = Object.entries(cart).map(([id, qty]) => ({ id, qty }));

    for (let attempt = 0; attempt < 6; attempt++) {
      try {
        const r = await api<{ order: OrderView }>("/api/orders", {
          method: "POST",
          json: { drop_id: drop.id, name: me.name, phone: me.phone, email: me.email, items, idem: idem.current, website: "" },
        });
        idem.current = null;
        setPhase("idle");
        onPlaced(r.order);
        return;
      } catch (err) {
        if (err instanceof ApiError) {
          const c = err.code;
          if (c === "not_open") {
            const wait = (err.data.opens_at ?? 0) - serverNow();
            if (wait < 20_000) {
              await sleep(Math.max(150, wait) + Math.random() * 300);
              continue;
            }
            setBanner("Orders aren't open yet. The button unlocks on time.");
          } else if (c === "only_left") {
            setBanner(`Only ${err.data.remaining} left in the whole drop. Take a few off and order again.`);
          } else if (c === "item_left") {
            const n = err.data.remaining as number;
            setQty(err.data.item_id, n);
            setBanner(n > 0 ? `Only ${n} ${err.data.name} left, so we set yours to ${n}. Tap order again.` : `${err.data.name} just sold out, so we took it off your order.`);
          } else if (c === "item_unavailable") {
            reload();
            setBanner("One of those flavours just came off the menu. Check your order and tap again.");
          } else if (c === "sold_out") {
            setBanner("Sold out. Every bagel just went. If someone cancels, they'll show up here.");
          } else if (c === "duplicate") {
            setBanner("That number already has an order for this drop. Check your email, or message Avi to change it.");
          } else if (c === "closed") {
            setBanner("This drop just closed.");
          } else if (c === "invalid") {
            const f = err.data.field as string;
            if (f === "phone") setFieldErr({ phone: "Use an Israeli mobile (05X) or a number starting with +." });
            else if (f === "name") setFieldErr({ name: "Name should be 2 to 60 characters." });
            else if (f === "email") setFieldErr({ email: "Check the email, or leave it empty." });
            else setBanner(`Orders are up to ${drop.max_per_order} bagels. Check your order and try again.`);
          } else if (c === "rate_limited") {
            setBanner("Lots of tries from this network. Wait a few seconds, then tap again.");
          } else if (err.status >= 500) {
            setPhase("retrying");
            await sleep(400 * 2 ** attempt + Math.random() * 400);
            continue;
          } else {
            setBanner("That didn't go through. Tap the button to try again.");
          }
          if (c !== "rate_limited") idem.current = null;
          setPhase("idle");
          return;
        }
        // Network hiccup: resend with the same key, so it can't double-order.
        setPhase("retrying");
        await sleep(400 * 2 ** attempt + Math.random() * 400);
      }
    }
    setPhase("idle");
    setBanner("Couldn't reach the shop. Your order wasn't placed yet. Tap the button to try again.");
  }

  let label: React.ReactNode;
  if (phase === "sending") label = <><BagelSpinner size={20} light /> Placing your order</>;
  else if (phase === "retrying") label = <><BagelSpinner size={20} light /> Busy, still trying</>;
  else if (state === "scheduled") label = <>Opens in <span className="tabular">{fmtCountdown(drop.opens_at - serverNow())}</span></>;
  else if (state === "soldout") label = "Sold out";
  else if (state === "closed") label = "Orders closed";
  else if (!count) label = "Pick your bagels";
  else if (over) label = `Only ${cap} left, take some off`;
  else label = "Place order";

  return (
    <form
      ref={formRef}
      className="order"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <div className="menu-head">
        <h2 className="h-mid">Pick your bagels</h2>
        <p className="tabular" data-full={count >= drop.max_per_order || undefined}>
          {count} of {drop.max_per_order}
        </p>
      </div>

      <ul className="menu">
        {menu.map((item) => {
          const qty = cart[item.id] ?? 0;
          const left = drop.item_left?.[item.id];
          const gone = left === 0;
          const maxHere = Math.min(left ?? Infinity, qty + Math.max(0, cap - count));
          const price = drop.price != null ? shekels(drop.price + item.extra) : item.extra ? `+${shekels(item.extra)}` : null;
          return (
            <li key={item.id} className="menu-item" data-on={qty > 0 || undefined} data-gone={gone || undefined}>
              <BagelArt name={item.name} />
              <div className="menu-text">
                <p className="menu-name">{item.name}</p>
                <p className="menu-meta">
                  {price && <span>{price}</span>}
                  {drop.price != null && item.extra > 0 && <span className="menu-extra">+{shekels(item.extra)}</span>}
                  {left != null && <span className="menu-left">{gone ? "Sold out" : `${left} left`}</span>}
                </p>
                {item.description && <p className="menu-desc">{item.description}</p>}
              </div>
              {qty === 0 ? (
                <button type="button" className="add" aria-label={`Add ${item.name}`} disabled={locked || gone || maxHere < 1} onClick={() => setQty(item.id, 1)}>
                  <Plus />
                </button>
              ) : (
                <div className="mini-stepper">
                  <button type="button" aria-label={`One less ${item.name}`} disabled={locked} onClick={() => setQty(item.id, qty - 1)}>
                    {qty === 1 ? <Trash /> : <Minus />}
                  </button>
                  <output className="tabular" aria-live="polite">
                    {qty}
                  </output>
                  <button type="button" aria-label={`One more ${item.name}`} disabled={locked || qty >= maxHere} onClick={() => setQty(item.id, qty + 1)}>
                    <Plus />
                  </button>
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {menu.length === 0 && <p className="muted">The menu is being set up. Check back in a minute.</p>}

      <h2 className="h-mid details-head">Your details</h2>
      <Field label="Name" error={fieldErr.name}>
        <input name="name" autoComplete="name" value={me.name} maxLength={60} onChange={(e) => update({ name: e.target.value })} disabled={busy} aria-invalid={!!fieldErr.name} />
      </Field>
      <Field label="Phone" hint="For pickup and WhatsApp updates." error={fieldErr.phone}>
        <input name="phone" type="tel" inputMode="tel" autoComplete="tel" placeholder="050-123-4567" value={me.phone} onChange={(e) => update({ phone: e.target.value })} disabled={busy} aria-invalid={!!fieldErr.phone} />
      </Field>
      <Field label="Email" hint="Optional. We'll send your confirmation here." error={fieldErr.email}>
        <input name="email" type="email" inputMode="email" autoComplete="email" value={me.email} onChange={(e) => update({ email: e.target.value })} disabled={busy} aria-invalid={!!fieldErr.email} />
      </Field>
      <input className="hp" tabIndex={-1} autoComplete="off" name="website" aria-hidden="true" />

      {banner && (
        <p className="banner" role="alert">
          {banner}
        </p>
      )}

      <div className="orderbar" data-s={state}>
        <div className="orderbar-row">
          <div className="bar-sum" data-empty={!count || undefined}>
            <span className="bar-count tabular">
              {count} {count === 1 ? "bagel" : "bagels"}
            </span>
            <span className="bar-total tabular">{total ?? (count ? "Pay at pickup" : "Nothing yet")}</span>
          </div>
          <button type="submit" className="btn cta" data-phase={phase} data-s={state} disabled={!open || busy || !count || over} aria-busy={busy}>
            {label}
          </button>
        </div>
      </div>
    </form>
  );
}

function Field({ label, hint, error, children }: { label: string; hint?: string; error?: string; children: React.ReactElement }) {
  return (
    <label className="field" data-err={error ? "" : undefined}>
      <span className="field-label">{label}</span>
      {children}
      {error ? <span className="field-err">{error}</span> : hint ? <span className="field-hint">{hint}</span> : null}
    </label>
  );
}

function MyTicket({ token, onForget }: { token: string; onForget: () => void }) {
  const [order, setOrder] = useState<OrderView | null>(null);
  const [gone, setGone] = useState(false);
  useEffect(() => {
    api<{ order: OrderView }>(`/api/orders/${token}`)
      .then((r) => setOrder(r.order))
      .catch((e) => e instanceof ApiError && e.status === 404 && setGone(true));
  }, [token]);
  useEffect(() => {
    if (gone) onForget();
  }, [gone, onForget]);
  if (gone) return null;
  if (!order)
    return (
      <div className="placeholder">
        <BagelSpinner size={36} />
      </div>
    );
  return (
    <div className="mine">
      <Ticket order={order} onChange={setOrder} fresh={Date.now() - order.created_at < 15000} />
      <button type="button" className="link" onClick={onForget}>
        {order.status === "cancelled" ? "Place a new order" : "Order for a different phone number"}
      </button>
    </div>
  );
}

const Minus = () => (
  <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
    <path d="M4 9h10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
  </svg>
);
const Plus = () => (
  <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
    <path d="M4 9h10M9 4v10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
  </svg>
);
const Trash = () => (
  <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
    <path d="M3.5 5h11M7 5V3.5h4V5M5 5l.8 9.5h6.4L13 5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
