import { createPublicClient, http, formatEther } from "viem";
import { base } from "viem/chains";
import { listLessons } from "../memory/client.js";
import { getCurrentPrice } from "./pricing.js";

// Configurable so this can point at a local Anvil fork during development
// and real Base mainnet later, without any code changes.
const RPC_URL = process.env.BASE_RPC_URL || "https://mainnet.base.org";
const ETH_COINGECKO_ID = "ethereum"; // stable, well-known id -- Base's native token is ETH

const publicClient = createPublicClient({
  chain: base,
  transport: http(RPC_URL),
});

async function getNativeBalanceUsd(walletAddress: `0x${string}`): Promise<number> {
  const balanceWei = await publicClient.getBalance({ address: walletAddress });
  const balanceEth = parseFloat(formatEther(balanceWei));
  const ethPriceUsd = await getCurrentPrice(ETH_COINGECKO_ID);
  return balanceEth * ethPriceUsd;
}

export interface PortfolioSnapshot {
  portfolioValueUsd: number;
  categoryExposureUsd: number;
}

// tenantId: the user's wallet address, used to scope the Sibyl lookup
// walletAddress: same value, typed as a real address for the viem call
// category: the category being evaluated for THIS proposed trade (e.g.
//   the primary tag of the asset the user wants to buy/swap into)
export async function getPortfolioSnapshot(
  tenantId: string,
  walletAddress: `0x${string}`,
  category: string
): Promise<PortfolioSnapshot> {
  const [nativeUsd, lessonsResponse] = await Promise.all([
    getNativeBalanceUsd(walletAddress),
    listLessons(tenantId),
  ]);

  const openLessons =
    lessonsResponse.ok && lessonsResponse.entities
      ? lessonsResponse.entities
          .map((e) => e.body)
          .filter((lesson) => lesson.status === "open")
      : [];

  const totalOpenPositionsUsd = openLessons.reduce(
    (sum, lesson) => sum + lesson.position_size_usd,
    0
  );

  const categoryExposureUsd = openLessons
    .filter((lesson) => lesson.category_tags.includes(category))
    .reduce((sum, lesson) => sum + lesson.position_size_usd, 0);

  return {
    portfolioValueUsd: nativeUsd + totalOpenPositionsUsd,
    categoryExposureUsd,
  };
}