import { useEffect, useState } from "react";
import { api, token } from "./api";
import Verify from "./Verify";
import "./index.css";

const short = (a) => a.slice(0, 6) + "…" + a.slice(-4);

// Each role's dashboard is the same three capabilities, gated: register is
// manufacturer-only, transfer needs stock in hand, verify is open to all.
const ROLE_COPY = {
  Manufacturer: { title: "Manufacturer portal", stock: "Products you registered and still hold" },
  Distributor: { title: "Distributor portal", stock: "Stock received from manufacturers" },
  Retailer: { title: "Retailer portal", stock: "Stock on your shelves" },
  Customer: { title: "Customer portal", stock: "Products you own" },
};

function Login({ onLogin }) {
  const [email, setEmail] = useState("manufacturer@demo.io");
  const [password, setPassword] = useState("demo1234");
  const [error, setError] = useState("");

  async function submit(e) {
    e.preventDefault();
    try {
      const { token: t, user } = await api("/api/auth/login", { method: "POST", body: { email, password } });
      token.set(t);
      onLogin(user);
    } catch (err) { setError(err.message); }
  }

  return (
    <form className="card login" onSubmit={submit}>
      <h2>Sign in</h2>
      <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="email" />
      <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="password" />
      <button>Sign in</button>
      {error && <p className="bad">{error}</p>}
      <p className="muted">
        Demo accounts (password <code>demo1234</code>): manufacturer@ · distributor@ · retailer@ · customer@demo.io
      </p>
    </form>
  );
}

function RegisterProduct({ onRegistered }) {
  const [form, setForm] = useState({ serial: "", name: "", batchNumber: "" });
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  async function submit(e) {
    e.preventDefault();
    setError(""); setResult(null);
    try {
      const r = await api("/api/products/register", { method: "POST", body: form });
      setResult(r);
      setForm({ serial: "", name: "", batchNumber: "" });
      onRegistered();
    } catch (err) { setError(err.message); }
  }

  return (
    <section className="card">
      <h2>Register a genuine product</h2>
      <form className="row" onSubmit={submit}>
        <input required value={form.serial} onChange={set("serial")} placeholder="Serial (unique)" />
        <input required value={form.name} onChange={set("name")} placeholder="Product name" />
        <input value={form.batchNumber} onChange={set("batchNumber")} placeholder="Batch no." />
        <button>Register on-chain</button>
      </form>
      {error && <p className="bad">{error}</p>}
      {result && (
        <div className="result">
          <p className="ok">Product #{result.productId} written on-chain</p>
          <p className="muted">tx {short(result.txHash)} · {result.gasUsed} gas</p>
          <img className="qr" src={result.qr} alt={`QR for product ${result.productId}`} />
          <p className="muted">Affix this QR to the physical product.</p>
        </div>
      )}
    </section>
  );
}

function Stock({ user, refreshKey, onTransferred }) {
  const [items, setItems] = useState([]);
  const [wallets, setWallets] = useState([]);
  const [choice, setChoice] = useState({}); // productId -> recipient address
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api("/api/products/mine").then(setItems).catch((e) => setError(e.message));
    api("/api/wallets").then(setWallets).catch(() => {});
  }, [refreshKey]);

  // Picking a recipient only stages it; the transfer fires on the button, so a
  // stray click on the dropdown can't put a product on the chain by accident.
  async function transfer(id) {
    const to = choice[id];
    if (!to) return;
    setBusy(id); setError("");
    try {
      await api(`/api/products/${id}/transfer`, { method: "POST", body: { to } });
      setChoice(({ [id]: _, ...rest }) => rest);
      onTransferred();
    } catch (e) { setError(e.message); }
    setBusy(null);
  }

  // Only offer the next hop down the chain, matching the real workflow.
  const nextRole = { Manufacturer: "Distributor", Distributor: "Retailer", Retailer: "Customer", Customer: null }[user.role];
  // Only wallets with a registered user behind them — an unclaimed demo wallet
  // is a valid address but nobody can sign in to it, so stock sent there is lost.
  const recipients = wallets.filter((w) => w.role === nextRole && w.name);

  return (
    <section className="card">
      <h2>{ROLE_COPY[user.role].stock} ({items.length})</h2>
      {error && <p className="bad">{error}</p>}
      <table className="stock">
        <thead>
          <tr><th>ID</th><th>Name</th><th>Batch</th>{nextRole && <th>Transfer to {nextRole}</th>}</tr>
        </thead>
        <tbody>
          {items.map((p) => (
            <tr key={p.productId}>
              <td>#{p.productId}</td>
              <td>{p.name}</td>
              <td>{p.batchNumber}</td>
              {nextRole && (
                <td className="row">
                  <select
                    value={choice[p.productId] || ""}
                    disabled={busy === p.productId}
                    onChange={(e) => setChoice({ ...choice, [p.productId]: e.target.value })}
                  >
                    <option value="" disabled>choose {nextRole.toLowerCase()}…</option>
                    {recipients.map((w) => (
                      <option key={w.address} value={w.address}>{w.name}</option>
                    ))}
                  </select>
                  <button
                    onClick={() => transfer(p.productId)}
                    disabled={!choice[p.productId] || busy === p.productId}
                  >
                    {busy === p.productId ? "Transferring…" : "Transfer"}
                  </button>
                </td>
              )}
            </tr>
          ))}
          {!items.length && <tr><td colSpan={4} className="muted">nothing in custody</td></tr>}
        </tbody>
      </table>
    </section>
  );
}

export default function App() {
  const [user, setUser] = useState(null);
  const [config, setConfig] = useState({ contractAddress: "" });
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    api("/api/config").then(setConfig).catch(() => {});
    if (token.get()) api("/api/auth/me").then(setUser).catch(() => token.clear());
  }, []);

  const refresh = () => setRefreshKey((k) => k + 1);

  return (
    <div className="app">
      <header>
        <h1>BlockVerify</h1>
        <span className="muted">contract {config.contractAddress && short(config.contractAddress)}</span>
        {user && (
          <span className="who">
            {user.name} · {user.role} · {short(user.walletAddress)}
            <button onClick={() => { token.clear(); setUser(null); }}>Sign out</button>
          </span>
        )}
      </header>

      {!user && <Login onLogin={setUser} />}
      {user && (
        <>
          <h2 className="portal">{ROLE_COPY[user.role].title}</h2>
          {user.role === "Manufacturer" && <RegisterProduct onRegistered={refresh} />}
          <Stock user={user} refreshKey={refreshKey} onTransferred={refresh} />
        </>
      )}
      <Verify contractAddress={config.contractAddress} />
    </div>
  );
}
