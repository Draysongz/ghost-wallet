import "dotenv/config";
import { createTestClient, createPublicClient, http, formatEther, parseEther } from "viem";
import { base } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";

// Anvil's default accounts have publicly published private keys, so on real
// chains sweeper bots have EIP-7702-delegated every one of them to a contract
// that instantly forwards any incoming ETH to an address they control.
// Forking Base mainnet inherits that delegation, which silently steals the
// proceeds of every sell and makes Ghost record a fabricated -100% outcome.
//
// Run this once after starting anvil:
//   anvil --fork-url https://mainnet.base.org --chain-id 8453
//   node scripts/prepare-fork.mjs

const ANVIL_RPC_URL = "http://127.0.0.1:8545";
const DELEGATION_PREFIX = "0xef0100";

const pk = process.env.ANVIL_TEST_PRIVATE_KEY;
if (!pk) throw new Error("ANVIL_TEST_PRIVATE_KEY must be set in .env");

const account = privateKeyToAccount(pk);
const testClient = createTestClient({ chain: base, mode: "anvil", transport: http(ANVIL_RPC_URL) });
const publicClient = createPublicClient({ chain: base, transport: http(ANVIL_RPC_URL) });

console.log("fork account:", account.address);

const code = await publicClient.getCode({ address: account.address });

if (code && code.toLowerCase().startsWith(DELEGATION_PREFIX)) {
  console.log(`  EIP-7702 delegation found -> 0x${code.slice(8)} (sweeper)`);
  await testClient.setCode({ address: account.address, bytecode: "0x" });
  const after = await publicClient.getCode({ address: account.address });
  if (after && after !== "0x") throw new Error(`Failed to clear delegation, code is still ${after}`);
  console.log("  delegation cleared — account is a plain EOA on this fork");
} else if (code && code !== "0x") {
  console.log(`  warning: account has non-delegation code (${code.slice(0, 20)}…), leaving it alone`);
} else {
  console.log("  no delegation present, nothing to clear");
}

const balance = await publicClient.getBalance({ address: account.address });
if (balance < parseEther("1")) {
  await testClient.setBalance({ address: account.address, value: parseEther("10000") });
  console.log("  funded with 10000 ETH");
}

console.log("  balance:", formatEther(await publicClient.getBalance({ address: account.address })), "ETH");

// Prove the fix: send 1 wei in and confirm it stays put.
await testClient.setBalance({ address: "0x000000000000000000000000000000000000dEaD", value: parseEther("1") });
const before = await publicClient.getBalance({ address: account.address });
await testClient.impersonateAccount({ address: "0x000000000000000000000000000000000000dEaD" });
const { createWalletClient } = await import("viem");
const wc = createWalletClient({ chain: base, transport: http(ANVIL_RPC_URL) });
const hash = await wc.sendTransaction({
  account: "0x000000000000000000000000000000000000dEaD",
  to: account.address,
  value: parseEther("0.5"),
});
await publicClient.waitForTransactionReceipt({ hash });
await testClient.stopImpersonatingAccount({ address: "0x000000000000000000000000000000000000dEaD" });
const after = await publicClient.getBalance({ address: account.address });

console.log(
  after - before === parseEther("0.5")
    ? "\n✅ incoming ETH now stays in the wallet — fork is ready"
    : `\n❌ incoming ETH is still being swept (kept ${formatEther(after - before)} of 0.5 ETH)`,
);
