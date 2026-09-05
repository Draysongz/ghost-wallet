import { resolveAndPriceToken, resolveAndPriceTokenByContract, type ResolvedToken } from "../base/pricing.js";

export type TradeAction = "buy" | "sell" | "swap";

export interface ParsedTradeInput {
  action: TradeAction;
  asset: string; // for buy/sell: the asset in question. for swap: the asset being SOLD.
  toAsset?: string; // only present for swap: the asset being bought
  amountUsd: number;
}

const BUY_SELL_PATTERN = /^(buy|sell)\s+(\S+)\s+\$?(\d+(?:\.\d+)?)$/i;
const SWAP_PATTERN = /^swap\s+(\S+)\s+for\s+(\S+)\s+\$?(\d+(?:\.\d+)?)$/i;

export function parseTradeInput(rawText: string): ParsedTradeInput {
  const text = rawText.trim();

  const swapMatch = text.match(SWAP_PATTERN);
  if (swapMatch) {
    const [, fromAsset, toAsset, amount] = swapMatch;
    return {
      action: "swap",
      asset: fromAsset as string,
      toAsset: toAsset as string,
      amountUsd: parseFloat(amount as string),
    };
  }

  const buySellMatch = text.match(BUY_SELL_PATTERN);
  if (buySellMatch) {
    const [, action, asset, amount] = buySellMatch;
    return {
      action: action!.toLowerCase() as "buy" | "sell",
      asset: asset as string,
      amountUsd: parseFloat(amount as string),
    };
  }

  throw new Error(
    `Couldn't understand that. Try something like:\n` +
      `"buy PEPE $1000"\n"sell ETH $500"\n"swap ETH for USDC $200"`
  );
}

const CONTRACT_ADDRESS_PATTERN = /^0x[a-fA-F0-9]{40}$/;

function isContractAddress(value: string): boolean {
  return CONTRACT_ADDRESS_PATTERN.test(value);
}

// Resolves a raw asset string (either a symbol like "PEPE" or a full
// contract address) to real market data -- routes to whichever pricing.ts
// function actually fits the input.
export async function resolveAsset(assetInput: string): Promise<ResolvedToken> {
  if (isContractAddress(assetInput)) {
    return resolveAndPriceTokenByContract(assetInput);
  }
  return resolveAndPriceToken(assetInput);
}