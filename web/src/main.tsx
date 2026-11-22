import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Shop } from "./shop/Shop";
import { OrderPage } from "./shop/OrderPage";
import { Admin } from "./admin/Admin";
import "./styles.css";

function App() {
  const path = location.pathname.replace(/\/+$/, "");
  if (path === "/admin") return <Admin />;
  const m = path.match(/^\/o\/([A-Za-z0-9]+)$/);
  if (m) return <OrderPage token={m[1]} />;
  return <Shop />;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
