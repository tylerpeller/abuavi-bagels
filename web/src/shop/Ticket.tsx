import { useEffect, useRef, useState } from "react";
import { api, ApiError, fmtDay, OrderView, orderTotal, shekels } from "../lib/api";
import { BagelSpinner } from "../ui/BagelSpinner";

// The order confirmation, shaped like a bakery pickup ticket.
export function Ticket({
  order,
  onChange,
  fresh,
}: {
  order: OrderView;
  onChange: (o: OrderView) => void;
  fresh?: boolean;
}) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    if (fresh) ref.current?.scrollIntoView({ block: "center", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  }, [fresh]);
  const d = order.drop;
  const cancelled = order.status === "cancelled";

  async function cancel() {
    if (!confirming) {
      setConfirming(true);
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const r = await api<{ order: OrderView }>(`/api/orders/${order.token}/cancel`, { method: "POST" });
      onChange(r.order);
    } catch (e) {
      setErr(
        e instanceof ApiError && e.code === "not_cancellable"
          ? "This order can't be cancelled online anymore. Message Avi."
          : "Couldn't cancel. Check your connection and try again.",
      );
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  }

  return (
    <article ref={ref} className="ticket" data-fresh={fresh || undefined} data-cancelled={cancelled || undefined}>
      <div className="ticket-top">
        {fresh && !cancelled && <Check />}
        <h2 className="h-mid">
          {cancelled ? "Order cancelled" : order.picked_up ? "Picked up. Enjoy." : `You're in, ${order.name.split(" ")[0]}`}
        </h2>
        <p className="ticket-code tabular" aria-label={`Order code ${order.code.split("").join(" ")}`}>
          {order.code}
        </p>
        <p className="ticket-codelabel">Say this code at pickup</p>
      </div>
      <dl className="ticket-rows">
        <div className="ticket-lines">
          <dt>{order.qty} bagels</dt>
          <dd>
            {order.lines.map((l) => (
              <span key={l.item_id} className="tabular">
                {l.qty} {l.name}
              </span>
            ))}
          </dd>
        </div>
        {d && (
          <div>
            <dt>Pickup</dt>
            <dd>
              {fmtDay(d.pickup_date, "long")}
              {d.pickup_window ? <><br />{d.pickup_window}</> : null}
            </dd>
          </div>
        )}
        {d?.location && (
          <div>
            <dt>Where</dt>
            <dd>{d.location}</dd>
          </div>
        )}
        <div>
          <dt>Pay at pickup</dt>
          <dd className="tabular">{d?.price != null ? shekels(orderTotal(d.price, order.lines)!) : "Price on the day"}</dd>
        </div>
      </dl>
      {!cancelled && (
        <div className="ticket-foot">
          <p>Screenshot this, or bookmark it. The link works on any phone.</p>
          {order.cancellable && (
            <button type="button" className="btn btn-quiet" data-confirm={confirming || undefined} onClick={cancel} disabled={busy}>
              {busy ? <BagelSpinner size={18} /> : confirming ? "Tap again to cancel" : "Cancel order"}
            </button>
          )}
          {confirming && !busy && (
            <button type="button" className="link" onClick={() => setConfirming(false)}>
              Keep my order
            </button>
          )}
          {err && <p className="field-err">{err}</p>}
        </div>
      )}
    </article>
  );
}

function Check() {
  return (
    <svg className="check" width="44" height="44" viewBox="0 0 44 44" aria-hidden="true">
      <circle cx="22" cy="22" r="20" fill="none" stroke="currentColor" strokeWidth="2.5" />
      <path d="M13 22.5l6 6 12-13" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
