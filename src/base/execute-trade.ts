import {
  createWalletClient,
  createPublicClient,
  http,
  parseEther,
  parseUnits,
  type Hex,
  type Address,
  type WalletClient,
  type PublicClient,
  type Account,
  type Chain,
  type Transport,
} from "viem";
import { base } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";

const ANVIL_RPC_URL = "http://127.0.0.1:8545";

const WETH_ADDRESS: Address = "0x4200000000000000000000000000000000000006";
const USDC_ADDRESS: Address = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";


const AERODROME_ROUTER_ADDRESS = process.env.AERODROME_ROUTER_ADDRESS as Address;

const AERODROME_DEFAULT_FACTORY = process.env.AERODROME_FACTORY_ADDRESS as Address;

if (!AERODROME_ROUTER_ADDRESS) {
  throw new Error("AERODROME_ROUTER_ADDRESS must be set in .env before executing trades");
}




// Minimal ABI slice -- only what execute-trade actually calls.
// Route struct fields per Aerodrome's Router.sol (Velodrome V2-style):
// swapExactETHForTokens(amountOutMin, routes[], to, deadline)
// swapExactTokensForTokens(amountIn, amountOutMin, routes[], to, deadline)
const AERODROME_ROUTER_ABI = [
  {
    name: "swapExactETHForTokens",
    type: "function",
    stateMutability: "payable",
    inputs: [
      { name: "amountOutMin", type: "uint256" },
      {
        name: "routes",
        type: "tuple[]",
        components: [
          { name: "from", type: "address" },
          { name: "to", type: "address" },
          { name: "stable", type: "bool" },
          { name: "factory", type: "address" },
        ],
      },
      { name: "to", type: "address" },
      { name: "deadline", type: "uint256" },
    ],
    outputs: [{ name: "amounts", type: "uint256[]" }],
  },
  {
    name: "swapExactTokensForTokens",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "amountIn", type: "uint256" },
      { name: "amountOutMin", type: "uint256" },
      {
        name: "routes",
        type: "tuple[]",
        components: [
          { name: "from", type: "address" },
          { name: "to", type: "address" },
          { name: "stable", type: "bool" },
          { name: "factory", type: "address" },
        ],
      },
      { name: "to", type: "address" },
      { name: "deadline", type: "uint256" },
    ],
    outputs: [{ name: "amounts", type: "uint256[]" }],
  },
  {
    name: "swapExactTokensForETH",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "amountIn", type: "uint256" },
      { name: "amountOutMin", type: "uint256" },
      {
        name: "routes",
        type: "tuple[]",
        components: [
          { name: "from", type: "address" },
          { name: "to", type: "address" },
          { name: "stable", type: "bool" },
          { name: "factory", type: "address" },
        ],
      },
      { name: "to", type: "address" },
      { name: "deadline", type: "uint256" },
    ],
    outputs: [{ name: "amounts", type: "uint256[]" }],
  },
] as const;

const ERC20_ABI = [
  {
    name: "balanceOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "approve",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    name: "allowance",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "decimals",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint8" }],
  },
] as const;


type BaseChain = typeof base;

interface ForkClients {
  account: Account;
  walletClient: WalletClient<Transport, BaseChain, Account>;
  publicClient: PublicClient<Transport, BaseChain>;
}

function buildForkClients(privateKeyHex: Hex): ForkClients {
  const account = privateKeyToAccount(privateKeyHex);

  const walletClient = createWalletClient({
    account,
    chain: base,
    transport: http(ANVIL_RPC_URL),
  });

  const publicClient = createPublicClient({
    chain: base,
    transport: http(ANVIL_RPC_URL),
  });

  return { account, walletClient, publicClient };
}

export function createForkClients(privateKeyHex: Hex): ForkClients {
  return buildForkClients(privateKeyHex);
}

export interface ExecuteSwapParams {
  privateKey: Hex;
  tokenOutAddress: Address; // contract address of the asset being bought
  amountUsd: number;
  ethPriceUsd: number; // needed to convert amountUsd -> ETH amount if paying in ETH
  usdcPriceUsd?: number; // defaults to 1 if omitted -- USDC should always be ~$1
}

export interface ExecuteSwapResult {
  txHash: Hex;
  paidWith: "ETH" | "USDC";
  amountIn: bigint;
}

async function getEthBalance(publicClient: ForkClients["publicClient"], address: Address) {
  return publicClient.getBalance({ address });
}

async function getErc20Balance(
  publicClient: ForkClients["publicClient"],
  token: Address,
  owner: Address,
) {
  return publicClient.readContract({
    address: token,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: [owner],
  }) as Promise<bigint>;
}

// eth_estimateGas can under-quote an AMM swap: Aerodrome pools append a new
// TWAP Observation slot once per 30-minute window, and an SSTORE-from-zero
// costs ~20k more than the warm update the estimate saw. When the estimate and
// the real execution land on opposite sides of that boundary the swap dies
// out-of-gas mid-call. A flat headroom multiplier is cheap insurance -- unused
// gas is refunded, so over-quoting costs nothing.
const GAS_BUFFER_NUMERATOR = 130n;
const GAS_BUFFER_DENOMINATOR = 100n;

function withGasBuffer(estimate: bigint): bigint {
  return (estimate * GAS_BUFFER_NUMERATOR) / GAS_BUFFER_DENOMINATOR;
}

/**
 * Wait for a receipt and treat a revert as a thrown error.
 *
 * waitForTransactionReceipt resolves as soon as the transaction is *mined*,
 * which is not the same as it having succeeded -- a reverted swap still gets a
 * hash and a receipt. Without this check a failed buy returns a plausible
 * txHash, the caller writes an "open" position into Sibyl for a trade that
 * never happened, and the user is shown a dead hash as proof.
 */
async function confirmOrThrow(
  publicClient: ForkClients["publicClient"],
  hash: Hex,
  label: string,
) {
  const receipt = await publicClient.waitForTransactionReceipt({ hash });

  if (receipt.status !== "success") {
    throw new Error(
      `${label} reverted on-chain (tx ${hash}). No funds moved and no position was opened.`,
    );
  }

  return receipt;
}

async function ensureApproval(
  walletClient: ForkClients["walletClient"],
  publicClient: ForkClients["publicClient"],
  token: Address,
  owner: Address,
  spender: Address,
  amount: bigint,
) {
  const currentAllowance = (await publicClient.readContract({
    address: token,
    abi: ERC20_ABI,
    functionName: "allowance",
    args: [owner, spender],
  })) as bigint;

  if (currentAllowance >= amount) return;

  const hash = await walletClient.writeContract({
    address: token,
    abi: ERC20_ABI,
    functionName: "approve",
    args: [spender, amount],
  });

  const receipt = await publicClient.waitForTransactionReceipt({ hash });

  if (receipt.status !== "success") {
    throw new Error(`ERC-20 approve reverted for ${token} -> ${spender} (tx ${hash})`);
  }
}

/** Estimate, add headroom, send, and confirm the transaction actually succeeded. */
async function writeConfirmed(
  walletClient: ForkClients["walletClient"],
  publicClient: ForkClients["publicClient"],
  account: Account,
  label: string,
  call: {
    address: Address;
    abi: typeof AERODROME_ROUTER_ABI;
    functionName: "swapExactETHForTokens" | "swapExactTokensForTokens" | "swapExactTokensForETH";
    args: any;
    value?: bigint;
  },
) {
  const estimate = await publicClient.estimateContractGas({
    ...call,
    account,
  } as any);

  const hash = await walletClient.writeContract({
    ...call,
    gas: withGasBuffer(estimate),
  } as any);

  const receipt = await confirmOrThrow(publicClient, hash, label);

  return { hash, receipt };
}

export async function executeSwap(params: ExecuteSwapParams): Promise<ExecuteSwapResult> {
  const { walletClient, publicClient, account } = createForkClients(params.privateKey);
  const usdcPrice = params.usdcPriceUsd ?? 1;

  const ethBalanceWei = await getEthBalance(publicClient, account.address);
  const ethBalanceUsd = Number(ethBalanceWei) / 1e18 * params.ethPriceUsd;

  const deadline = BigInt(Math.floor(Date.now() / 1000) + 60 * 10); // 10 min

  // --- Path 1: pay with ETH, if there's enough ---
  if (ethBalanceUsd >= params.amountUsd) {
    const amountInWei = parseEther((params.amountUsd / params.ethPriceUsd).toFixed(18));

    const { hash } = await writeConfirmed(
      walletClient,
      publicClient,
      account,
      `ETH -> ${params.tokenOutAddress} buy`,
      {
        address: AERODROME_ROUTER_ADDRESS,
        abi: AERODROME_ROUTER_ABI,
        functionName: "swapExactETHForTokens",
        args: [
          0n, // amountOutMin -- TODO: replace 0 with a real slippage-protected minimum before using real funds
          [
            {
              from: WETH_ADDRESS,
              to: params.tokenOutAddress,
              stable: false,
              factory: AERODROME_DEFAULT_FACTORY,
            },
          ],
          account.address,
          deadline,
        ],
        value: amountInWei,
      },
    );

    return { txHash: hash, paidWith: "ETH", amountIn: amountInWei };
  }

  // --- Path 2: fall back to USDC ---
  const usdcBalance = await getErc20Balance(publicClient, USDC_ADDRESS, account.address);
  const usdcBalanceUsd = Number(usdcBalance) / 1e6 * usdcPrice; // USDC has 6 decimals

  if (usdcBalanceUsd >= params.amountUsd) {
    const amountInUsdc = parseUnits((params.amountUsd / usdcPrice).toFixed(6), 6);

    await ensureApproval(
      walletClient,
      publicClient,
      USDC_ADDRESS,
      account.address,
      AERODROME_ROUTER_ADDRESS,
      amountInUsdc,
    );

    const { hash } = await writeConfirmed(
      walletClient,
      publicClient,
      account,
      `USDC -> ${params.tokenOutAddress} buy`,
      {
        address: AERODROME_ROUTER_ADDRESS,
        abi: AERODROME_ROUTER_ABI,
        functionName: "swapExactTokensForTokens",
        args: [
          amountInUsdc,
          0n, // TODO: same slippage caveat as above
          [
            {
              from: USDC_ADDRESS,
              to: params.tokenOutAddress,
              stable: false,
              factory: AERODROME_DEFAULT_FACTORY,
            },
          ],
          account.address,
          deadline,
        ],
      },
    );

    return { txHash: hash, paidWith: "USDC", amountIn: amountInUsdc };
  }

  // --- Neither covers it ---
  throw new Error(
    `Insufficient funds: need $${params.amountUsd}, have ~$${ethBalanceUsd.toFixed(2)} ETH and ~$${usdcBalanceUsd.toFixed(2)} USDC on the fork.`,
  );
}

export interface ExecuteSellParams {
  privateKey: Hex;
  tokenInAddress: Address; // contract address of the asset being sold
  tokenAmountRaw: bigint;  // exact on-chain balance/amount to sell, in the token's own decimals
}

export interface ExecuteSellResult {
  txHash: Hex;
  ethReceivedWei: bigint;
}

/**
 * Read an ERC-20 balance plus its decimals, so callers can size a sell
 * against what the wallet actually holds on-chain rather than against the
 * USD figure recorded in memory when the position was opened.
 */
export async function getTokenPosition(
  privateKey: Hex,
  token: Address,
): Promise<{ raw: bigint; decimals: number }> {
  const { publicClient, account } = createForkClients(privateKey);

  const [raw, decimals] = await Promise.all([
    getErc20Balance(publicClient, token, account.address),
    publicClient.readContract({
      address: token,
      abi: ERC20_ABI,
      functionName: "decimals",
    }) as Promise<number>,
  ]);

  return { raw, decimals };
}

export async function executeSell(params: ExecuteSellParams): Promise<ExecuteSellResult> {
  const { walletClient, publicClient, account } = createForkClients(params.privateKey);
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 60 * 10);

  if (params.tokenAmountRaw <= 0n) {
    throw new Error("Nothing to sell: the wallet holds none of this token on the fork.");
  }

  await ensureApproval(
    walletClient,
    publicClient,
    params.tokenInAddress,
    account.address,
    AERODROME_ROUTER_ADDRESS,
    params.tokenAmountRaw,
  );

  const ethBalanceBefore = await getEthBalance(publicClient, account.address);

  const { hash, receipt } = await writeConfirmed(
    walletClient,
    publicClient,
    account,
    `${params.tokenInAddress} sell`,
    {
      address: AERODROME_ROUTER_ADDRESS,
      abi: AERODROME_ROUTER_ABI,
      functionName: "swapExactTokensForETH",
      args: [
        params.tokenAmountRaw,
        0n, // TODO: same slippage caveat as the buy side
        [
          {
            from: params.tokenInAddress,
            to: WETH_ADDRESS,
            stable: false,
            factory: AERODROME_DEFAULT_FACTORY,
          },
        ],
        account.address,
        deadline,
      ],
    },
  );

  const ethBalanceAfter = await getEthBalance(publicClient, account.address);

  // The raw balance delta is net of gas, which would understate proceeds and
  // skew the realized PnL written back to memory. Add the gas back so
  // ethReceivedWei means what its name says: swap output only.
  const gasCostWei = receipt.gasUsed * receipt.effectiveGasPrice;
  const ethReceivedWei = ethBalanceAfter - ethBalanceBefore + gasCostWei;

  // A successful swap always pays out something, so a zero-or-negative result
  // means the ETH left the wallet again in the same transaction. On a Base
  // fork that is almost always an inherited EIP-7702 delegation: anvil's
  // default accounts have published private keys, so sweeper bots have
  // delegated them on mainnet to forward any incoming ETH away. Run
  // scripts/prepare-fork.mjs to clear it. Failing loudly here matters more
  // than the swap itself -- the caller would otherwise write a fabricated
  // -100% outcome into Sibyl Memory, permanently, for a trade that was fine.
  if (ethReceivedWei <= 0n) {
    throw new Error(
      `Sell settled but no ETH reached the wallet (tx ${hash}). The wallet is likely EIP-7702 ` +
        `delegated to a sweeper on this fork -- run 'node scripts/prepare-fork.mjs'. ` +
        `Refusing to record a realized outcome from a swept sale.`,
    );
  }

  return { txHash: hash, ethReceivedWei };
}