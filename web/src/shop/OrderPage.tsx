import { useEffect, useState } from "react";
import { api, ApiError, OrderView } from "../lib/api";
import { Ticket } from "./Ticket";
import { BagelSpinner } from "../ui/BagelSpinner";
import logo from "../assets/logo.jpg";

// /o/:token, the link from the confirmation email.
export function OrderPage({ token }: { token: string }) {
  const [order, setOrder] = useState<OrderView | null>(null);
  const [missing, setMissing] = useState(false);
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    api<{ order: OrderView }>(`/api/orders/${encodeURIComponent(token)}`)
      .then((r) => setOrder(r.order))
      .catch((e) => (e instanceof ApiError && e.status === 404 ? setMissing(true) : setOffline(true)));
  }, [token]);

  return (
    <div className="solo">
      <a className="solo-brand" href="/">
        <img src={logo} alt="" width={40} height={40} />
        <span>Abu Avi Bagels</span>
      </a>
      {order && <Ticket order={order} onChange={setOrder} />}
      {!order && !missing && !offline && (
        <div className="placeholder">
          <BagelSpinner size={40} />
        </div>
      )}
      {missing && (
        <div className="placeholder">
          <h1 className="h-big">No order here</h1>
          <p>This link doesn't match an order. Check you copied the whole link, or message Avi.</p>
        </div>
      )}
      {offline && (
        <div className="placeholder">
          <p>Can't reach the shop right now. Refresh in a moment.</p>
        </div>
      )}
      <a className="link" href="/">
        Back to the drop
      </a>
    </div>
  );
}
