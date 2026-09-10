
const COINGECKO_API_KEY = process.env.COINGECKO_DEMO_API_KEY;

if (!COINGECKO_API_KEY) {
  throw new Error("COINGECKO_DEMO_API_KEY must be set in .env");
}

const BASE_URL = "https://api.coingecko.com/api/v3";


const LOW_LIQUIDITY_VOLUME_THRESHOLD_USD = 1_000_000;

async function cgFetch(path: string): Promise<any> {
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: { "x-cg-demo-api-key": COINGECKO_API_KEY! },
  });

  if (!res.ok) {
    throw new Error(`CoinGecko request failed: ${res.status} ${res.statusText}`);
  }

  return res.json();
}

export interface ResolvedToken {
  coingecko_id: string;
  symbol: string;
  name: string;
  price_usd: number;
  category_tags: string[];
  volume_24h_usd: number;
  contract_address: string; // NEW — Base contract address, needed to actually execute a swap
}


async function resolveCoinId(query: string) {
  const searchResults = await cgFetch(`/search?query=${encodeURIComponent(query)}`);
  const candidates = (searchResults?.coins ?? []).slice(0, 5);

  if (candidates.length === 0) {
    throw new Error(`No CoinGecko match found for "${query}"`);
  }

  for (const candidate of candidates) {
    const data = await cgFetch(
      `/coins/${candidate.id}?localization=false&tickers=false&community_data=false&developer_data=false`
    );

    const baseAddress = data?.platforms?.base;
    if (baseAddress) {
      return {
        id: candidate.id,
        symbol: candidate.symbol,
        name: candidate.name,
        contractAddress: baseAddress as string, // NEW
        marketData: parseMarketData(data),
      };
    }
  }

  throw new Error(
    `Found matches for "${query}", but none are confirmed deployed on Base. Try the contract address instead.`
  );
}

export async function resolveAndPriceToken(query: string): Promise<ResolvedToken> {
  const { id, symbol, name, contractAddress, marketData } = await resolveCoinId(query);

  return {
    coingecko_id: id,
    symbol,
    name,
    price_usd: marketData.price_usd,
    category_tags: toCategoryTags(marketData.categories, marketData.volume_24h_usd),
    volume_24h_usd: marketData.volume_24h_usd,
    contract_address: contractAddress, // NEW
  };
}

export async function resolveAndPriceTokenByContract(
  contractAddress: string,
  platformId: string = "base"
): Promise<ResolvedToken> {
  const data = await cgFetch(`/coins/${platformId}/contract/${contractAddress}`);
  const { price_usd, categories, volume_24h_usd } = parseMarketData(data);

  return {
    coingecko_id: data.id,
    symbol: data.symbol,
    name: data.name,
    price_usd,
    category_tags: toCategoryTags(categories, volume_24h_usd),
    volume_24h_usd,
    contract_address: contractAddress, // NEW — already have it, was just never being returned
  };
}


function parseMarketData(data: any): {
  price_usd: number;
  categories: string[];
  volume_24h_usd: number;
} {
  return {
    price_usd: data?.market_data?.current_price?.usd ?? 0,
    categories: Array.isArray(data?.categories) ? data.categories : [],
    volume_24h_usd: data?.market_data?.total_volume?.usd ?? 0,
  };
}

function toCategoryTags(categories: string[], volume_24h_usd: number): string[] {
  const tags = categories
    .filter((c): c is string => typeof c === "string" && c.length > 0)
    .map((c) => c.toLowerCase().replace(/\s+/g, "-"));

  if (volume_24h_usd < LOW_LIQUIDITY_VOLUME_THRESHOLD_USD) {
    tags.push("low-liquidity");
  }

  return tags;
}


// export async function resolveAndPriceToken(query: string): Promise<ResolvedToken> {
//   const { id, symbol, name, marketData } = await resolveCoinId(query);

//   return {
//     coingecko_id: id,
//     symbol,
//     name,
//     price_usd: marketData.price_usd,
//     category_tags: toCategoryTags(marketData.categories, marketData.volume_24h_usd),
//     volume_24h_usd: marketData.volume_24h_usd,
//   };
// }


// export async function resolveAndPriceTokenByContract(
//   contractAddress: string,
//   platformId: string = "base"
// ): Promise<ResolvedToken> {
//   const data = await cgFetch(`/coins/${platformId}/contract/${contractAddress}`);
//   const { price_usd, categories, volume_24h_usd } = parseMarketData(data);

//   return {
//     coingecko_id: data.id,
//     symbol: data.symbol,
//     name: data.name,
//     price_usd,
//     category_tags: toCategoryTags(categories, volume_24h_usd),
//     volume_24h_usd,
//   };
// }


export async function getCurrentPrice(coingeckoId: string): Promise<number> {
  const data = await cgFetch(`/simple/price?ids=${coingeckoId}&vs_currencies=usd`);
  const price = data?.[coingeckoId]?.usd;

  if (price === undefined) {
    throw new Error(`Could not fetch current price for "${coingeckoId}"`);
  }

  return price;
}


export interface MarketSnapshot {
  coingecko_id: string;
  price_usd: number;
  market_cap_usd: number;
  price_change_pct_1h: number | null;
  price_change_pct_24h: number | null;
}

// Batched lookup -- one API call for N tokens instead of N calls, which
// matters once this runs against every open position on every dashboard
// refresh. price_change_percentage needs both windows requested together.
export async function getMarketSnapshot(coingeckoIds: string[]): Promise<Map<string, MarketSnapshot>> {
  if (coingeckoIds.length === 0) return new Map();

  const idsParam = coingeckoIds.join(",");
  const data = await cgFetch(
    `/coins/markets?vs_currency=usd&ids=${idsParam}&price_change_percentage=1h,24h`
  );

  const result = new Map<string, MarketSnapshot>();

  for (const coin of data ?? []) {
    result.set(coin.id, {
      coingecko_id: coin.id,
      price_usd: coin.current_price ?? 0,
      market_cap_usd: coin.market_cap ?? 0,
      price_change_pct_1h: coin.price_change_percentage_1h_in_currency ?? null,
      price_change_pct_24h: coin.price_change_percentage_24h_in_currency ?? null,
    });
  }

  return result;
}