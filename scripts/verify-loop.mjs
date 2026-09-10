import "dotenv/config";
import { formatEther, formatUnits } from "viem";
import { executeSwap, executeSell, getTokenPosition } from "../dist/base/execute-trade.js";
import { getMarketSnapshot } from "../dist/base/pricing.js";
import { storeRule, storeLesson, resolveLesson, listLessons, deleteRule } from "../dist/memory/client.js";
import { evaluate } from "../dist/engine/evaluate.js";

const PK = process.env.ANVIL_TEST_PRIVATE_KEY;
const AERO = "0x940181a94A35A4569E4529A3CDfB74e38FD98631";
const T = "0xLOOP_" + Date.now();

const line = (s) => console.log("\n" + "=".repeat(72) + "\n" + s + "\n" + "=".repeat(72));
const cited = (r) => r.triggered_by.some((t) => "lesson" in t);

const TRADE = {
  asset: "AERO",
  category_tags: ["meme-tokens"],
  position_size_usd: 2500,
  portfolio_value_usd: 10000,
  current_category_exposure_usd: 0,
};

const ethPrice = (await getMarketSnapshot(["ethereum"])).get("ethereum")?.price_usd ?? 0;
console.log("ETH price (live):", ethPrice);

line("STEP 0: clear any stray AERO from earlier tests (warm-up sell)");
const stray = await getTokenPosition(PK, AERO);
if (stray.raw > 0n) {
  const s = await executeSell({ privateKey: PK, tokenInAddress: AERO, tokenAmountRaw: stray.raw });
  console.log("  sold", formatUnits(stray.raw, stray.decimals), "AERO | tx:", s.txHash);
} else {
  console.log("  none held, nothing to clear");
}

line("STEP 1: store a risk rule (max_exposure_pct meme-tokens 20%)");
console.log("  ok:", (await storeRule(T, { rule_type: "max_exposure_pct", applies_to: "meme-tokens", threshold: 20, unit: "percent", notes: "Burned before." })).ok);

line("STEP 2: BUY $200 of AERO on the fork");
const buy = await executeSwap({ privateKey: PK, tokenOutAddress: AERO, amountUsd: 200, ethPriceUsd: ethPrice });
console.log("  tx:", buy.txHash, "| paidWith:", buy.paidWith);
const held = await getTokenPosition(PK, AERO);
console.log("  now holding:", formatUnits(held.raw, held.decimals), "AERO");

line("STEP 3: store the OPEN lesson (what trade.ts writes, now incl. token_address)");
const open = await storeLesson(T, {
  asset: "AERO", category_tags: ["meme-tokens"], position_size_usd: 200,
  outcome_pct: null, lesson: "Pending outcome", status: "open",
  coingecko_id: "aerodrome-finance", entry_price_usd: 1, token_address: AERO,
  was_override: true, override_reason: "Momentum looked strong",
});
const name = open.entity.name;
console.log("  stored:", name);
console.log("  token_address persisted:", open.entity.body.token_address);

line("STEP 4: evaluate -- open lesson must NOT be cited");
const r4 = await evaluate(T, TRADE);
console.log("  triggered_by:", r4.triggered_by.length, "| lesson cited?", cited(r4) ? "YES (BUG)" : "NO (correct)");

line("STEP 5: CLOSE the position -- real on-chain sell");
const pos = await getTokenPosition(PK, AERO);
const sell = await executeSell({ privateKey: PK, tokenInAddress: AERO, tokenAmountRaw: pos.raw });
const proceedsUsd = Number(formatEther(sell.ethReceivedWei)) * ethPrice;
const pnlUsd = proceedsUsd - 200;
const pnlPct = (pnlUsd / 200) * 100;
console.log("  tx:", sell.txHash);
console.log("  ETH received:", formatEther(sell.ethReceivedWei));
console.log(`  proceeds: $${proceedsUsd.toFixed(2)} vs entry $200 => ${pnlPct.toFixed(2)}%`);

line("STEP 6: resolve the lesson with the REAL realized outcome");
const res = await resolveLesson(T, { name, outcome_pct: Number(pnlPct.toFixed(2)), status: "resolved", lesson: `Closed down ${Math.abs(pnlPct).toFixed(1)}% after overriding Ghost's block` });
console.log("  ok:", res.ok, "| status:", res.entity.body.status, "| outcome_pct:", res.entity.body.outcome_pct);

line("STEP 7: no duplicate row created?");
const after = await listLessons(T);
console.log("  lesson count:", after.entities.length, after.entities.length === 1 ? "(correct -- updated in place)" : "(BUG -- duplicated)");

line("STEP 8: evaluate -- a ~0% round-trip is BELOW the -30% bar, so still not cited");
const r8 = await evaluate(T, TRADE);
console.log("  lesson cited?", cited(r8) ? "YES" : "NO (correct -- loss too small to warn about)");

line("STEP 9: seed + resolve a genuinely bad trade (-45%), then evaluate");
const bad = await storeLesson(T, { asset: "WIF", category_tags: ["meme-tokens"], position_size_usd: 800, outcome_pct: null, lesson: "Pending outcome", status: "open", token_address: AERO });
await resolveLesson(T, { name: bad.entity.name, outcome_pct: -45, status: "resolved", lesson: "Held a meme coin through a rug" });
const r9 = await evaluate(T, TRADE);
console.log("  decision:", r9.decision, "| triggered_by:", r9.triggered_by.length);
console.log("  lesson cited?", cited(r9) ? "YES (correct)" : "NO (BUG)");
console.log("  reason:", r9.reason);

line("CLEANUP");
console.log("  rule deleted:", (await deleteRule(T, { rule_type: "max_exposure_pct", applies_to: "meme-tokens" })).ok);
console.log("  tenant:", T);
