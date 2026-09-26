import { useEffect, useRef } from "react";
import { Html5Qrcode } from "html5-qrcode";

// Camera QR scanner. onScan gets the decoded payload string.
export default function Scanner({ onScan, onClose }) {
  const ref = useRef(null);

  useEffect(() => {
    const scanner = new Html5Qrcode("qr-reader");
    ref.current = scanner;
    scanner
      .start({ facingMode: "environment" }, { fps: 10, qrbox: 250 }, (text) => {
        scanner.stop().catch(() => {});
        onScan(text);
      })
      .catch((e) => alert("camera unavailable: " + e));
    return () => { scanner.stop().catch(() => {}); };
  }, []);

  return (
    <div className="scanner">
      <div id="qr-reader" />
      <button onClick={onClose}>Cancel scan</button>
    </div>
  );
}
