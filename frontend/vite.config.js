import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    // Hardhat's node only advertises OPTIONS/GET in its CORS preflight, so a
    // browser POST to it is blocked. Same-origin proxy sidesteps that; against
    // a public RPC (Sepolia, Polygon) the frontend would hit the node directly.
    proxy: { "/rpc": { target: "http://127.0.0.1:8545", changeOrigin: true, rewrite: () => "/" } },
  },
});
