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

async function ensureApproval(
  walletClient: ForkClients["walletClient"],
  publicClient: ForkClients["publicClient"],
  token: Address,
  owner: Address,
  spender: Address,
  amount: bigint,
) {
  // ...unchanged
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

    const hash = await walletClient.writeContract({
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
    });

    await publicClient.waitForTransactionReceipt({ hash });

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

    const hash = await walletClient.writeContract({
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
    });

    await publicClient.waitForTransactionReceipt({ hash });

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

// export async function executeSell(params: ExecuteSellParams): Promise<ExecuteSellResult> {
//   const { walletClient, publicClient, account } = createForkClients(params.privateKey);
//   const deadline = BigInt(Math.floor(Date.now() / 1000) + 60 * 10);

//   await ensureApproval(
//     walletClient,
//     publicClient,
//     params.tokenInAddress,
//     account.address,
//     AERODROME_ROUTER_ADDRESS,
//     params.tokenAmountRaw,
//   );

//   const ethBalanceBefore = await getEthBalance(publicClient, account.address);

// //   const hash = await walletClient.writeContract({
// //     address: AERODROME_ROUTER_ADDRESS,
// //     abi: AERODROME_ROUTER_ABI,
// //     functionName: "swapExactTokensForETH", // NOTE: not yet in the ABI below -- see caveat
// //     args: [
// //       params.tokenAmountRaw,
// //       0n, // TODO: same slippage caveat as the buy side
// //       [
// //         {
// //           from: params.tokenInAddress,
// //           to: WETH_ADDRESS,
// //           stable: false,
// //           factory: AERODROME_DEFAULT_FACTORY,
// //         },
// //       ],
// //       account.address,
// //       deadline,
// //     ],
// //   });

// //   await publicClient.waitForTransactionReceipt({ hash });

// //   const ethBalanceAfter = await getEthBalance(publicClient, account.address);

// //   return { txHash: hash, ethReceivedWei: ethBalanceAfter - ethBalanceBefore };
// }