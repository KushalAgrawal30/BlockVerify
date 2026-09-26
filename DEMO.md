# Review walkthrough (~6 min)

**Before you start:** `npm run chain`, `npm run deploy`, `npm run seed`,
`npm run api`, `npm run web`. Check `mongod` is up.

1. **Contracts first.** `npm test` — 8 passing, including duplicate-serial revert
   and unauthorized-transfer revert. Point at the printed gas line:
   register ≈ 208k gas, transfer ≈ 121k.

2. **Manufacturer portal.** Sign in as `manufacturer@demo.io`. Register a product
   ("SN-DEMO-1", "Insulin Pen", "BATCH-D"). A QR appears with the tx hash and gas
   used — that's the on-chain write, not a database insert.

3. **Verify it.** Scroll to *Verify a product*, enter the new ID → **VERIFIED
   GENUINE**, 0 transfers, read latency in ms.

4. **Move it down the chain.** Still as manufacturer, transfer it to
   NorthDist Logistics. Sign out, sign in as `distributor@demo.io` — it's now in
   their stock. Transfer on to CityMart Retail. Sign in as `retailer@demo.io`,
   transfer to the customer.

5. **The payoff.** Verify the same ID again: three hops, each with addresses and
   timestamps, ending at the customer's wallet. Nobody had to trust our server —
   `frontend/src/chain.js` read that directly from the node.

6. **Counterfeit case.** Verify ID `999999` → **NOT REGISTERED**. That's a cloned
   or invented QR tag.

7. **Tamper case.** In the manufacturer portal, try registering the same serial
   twice → the contract reverts with `duplicate serial`. Sign in as the
   distributor and try to transfer a product they don't hold → `not current
   owner`. `npm run smoke` runs both of those plus the auth checks in one shot.

**If asked what's left:** the centralized-MongoDB baseline for the comparative
write-up, and the formal benchmark report. Everything in the objectives list
except objective 07's write-up is running.
