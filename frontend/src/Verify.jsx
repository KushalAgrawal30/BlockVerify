import { useState } from "react";
import { verifyOnChain } from "./chain";
import Scanner from "./Scanner";

const when = (ts) => new Date(ts * 1000).toLocaleString();
const short = (a) => a.slice(0, 6) + "…" + a.slice(-4);

export default function Verify({ contractAddress }) {
  const [productId, setProductId] = useState("");
  const [result, setResult] = useState(null);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState("");

  async function run(id, address = contractAddress) {
    setError(""); setResult(null);
    try {
      setResult(await verifyOnChain(address, Number(id)));
    } catch (e) {
      setError(e.message);
    }
  }

  // QR payload is {contractAddress, productId} — never product data itself,
  // so a scan always forces a fresh on-chain read.
  function onScan(text) {
    setScanning(false);
    try {
      const { contractAddress: addr, productId: id } = JSON.parse(text);
      setProductId(String(id));
      run(id, addr);
    } catch {
      setError("that QR code is not a BlockVerify tag");
    }
  }

  const tone = { "VERIFIED GENUINE": "ok", "NOT REGISTERED": "bad", "OWNERSHIP MISMATCH": "bad" };

  return (
    <section className="card">
      <h2>Verify a product</h2>
      <div className="row">
        <input value={productId} onChange={(e) => setProductId(e.target.value)} placeholder="Product ID" />
        <button onClick={() => run(productId)} disabled={!productId}>Verify</button>
        <button onClick={() => setScanning(true)}>Scan QR</button>
      </div>
      {scanning && <Scanner onScan={onScan} onClose={() => setScanning(false)} />}
      {error && <p className="bad">{error}</p>}

      {result && (
        <div className="result">
          <h3 className={tone[result.status]}>{result.status}</h3>
          <p className="muted">
            product #{result.productId} · read straight from chain in {result.latencyMs} ms
          </p>
          {result.product && (
            <>
              <table>
                <tbody>
                  <tr><td>Name</td><td>{result.product.name}</td></tr>
                  <tr><td>Batch</td><td>{result.product.batchNumber}</td></tr>
                  <tr><td>Manufactured</td><td>{when(result.product.mfgDate)}</td></tr>
                  <tr><td>Manufacturer</td><td>{short(result.product.manufacturer)}</td></tr>
                  <tr><td>Current owner</td><td>{short(result.product.currentOwner)}</td></tr>
                </tbody>
              </table>
              <h4>Chain of custody ({result.hops} transfer{result.hops === 1 ? "" : "s"})</h4>
              <ol className="timeline">
                <li>Registered by manufacturer {short(result.product.manufacturer)}</li>
                {result.history.map((h, i) => (
                  <li key={i}>{short(h.from)} → {short(h.to)} · {when(h.timestamp)}</li>
                ))}
              </ol>
            </>
          )}
        </div>
      )}
    </section>
  );
}
