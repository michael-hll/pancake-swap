import {ethers} from "hardhat";
import {PoolData, PoolTokenInfo, TokenInfo} from "./types";
import * as config from "./config";

// Generate unique random pool indices
export function generateRandomPoolIndices(
  count: number,
  min: number,
  max: number
): number[] {
  console.log(
    `Generating ${count} random pool indices between ${min} and ${max}`
  );

  // Ensure max doesn't exceed total pools
  max = Math.min(max, config.state.totalPools - 1);

  // Create a set for uniqueness
  const poolIndicesSet = new Set<number>();

  // Generate random indices until we have enough
  while (poolIndicesSet.size < count && poolIndicesSet.size < max - min + 1) {
    const randomIndex = Math.floor(Math.random() * (max - min + 1)) + min;
    poolIndicesSet.add(randomIndex);
  }

  // include newly added pools
  for (let i = max; i > max - config.POOLS_NEWLY_ADDED; i--) {
    poolIndicesSet.add(i);
  }

  return Array.from(poolIndicesSet);
}

// Reset pool selection and clear memory
export function resetPoolSelection() {
  console.log(
    "Resetting pool selection - clearing memory and selecting new pools"
  );

  // Clear existing data
  config.state.poolsMap.clear();

  // Generate new random indices
  config.state.currentPoolIndices = generateRandomPoolIndices(
    config.POOLS_TO_SAMPLE,
    config.RANDOM_START,
    config.RANDOM_END
  );

  // Reset profit timer
  config.state.lastProfitFound = Date.now();
}

// Helper function to get token info with caching
export async function getTokenInfo(address: string) {
  address = address.toLowerCase();
  if (config.state.tokenCache[address]) {
    return config.state.tokenCache[address];
  }

  try {
    const token = new ethers.Contract(
      address,
      config.ERC20_ABI,
      config.provider
    );

    const [name, symbol, decimals] = await Promise.all([
      token.name().catch(() => config.UNKNOW_TOKEN_NAME),
      token.symbol().catch(() => config.UNKNOW_TOKEN_SYMBOL),
      token.decimals().catch(() => 18),
    ]);

    config.state.tokenCache[address] = {name, symbol, decimals};
    return config.state.tokenCache[address];
  } catch (error) {
    console.log(`Error fetching token info for ${address}: ${error}`);
    return {
      name: config.UNKNOW_TOKEN_NAME,
      symbol: config.UNKNOW_TOKEN_SYMBOL,
      decimals: 18,
    };
  }
}

// Helper to update the token-to-pools lookup
export function updateTokenPoolsMap(tokenAddress: string, poolAddress: string) {
  if (!config.state.tokenPools.has(tokenAddress)) {
    config.state.tokenPools.set(tokenAddress, new Set());
  }
  config.state.tokenPools.get(tokenAddress)!.add(poolAddress);
}

// Additional utility functions for pool loading, etc.
export async function loadPoolByIndex(index: number) {
  try {
    const pairAddress = await config.factory.allPairs(index);
    return await loadPoolData(pairAddress, index);
  } catch (error) {
    console.log(`Error loading pool at index ${index}: ${error}`);
    return null;
  }
}

// Load data for a specific pool
export async function loadPoolData(
  pairAddress: string,
  index: number,
  forceRefresh: boolean = false
): Promise<PoolData | null> {
  let localToken0Info: TokenInfo | null = null;
  let localToken1Info: TokenInfo | null = null;
  try {
    pairAddress = pairAddress.toLowerCase();

    if (config.state.poolsMap.has(pairAddress)) {
      localToken0Info = config.state.poolsMap.get(pairAddress)!
        .token0 as TokenInfo;
      localToken1Info = config.state.poolsMap.get(pairAddress)!
        .token1 as TokenInfo;
    }

    // Skip if already loaded recently
    if (!forceRefresh && config.state.poolsMap.has(pairAddress)) {
      const existing = config.state.poolsMap.get(pairAddress)!;
      const lastUpdate = new Date(existing.updated);
      const now = new Date();
      const secondsSinceUpdate = (now.getTime() - lastUpdate.getTime()) / 1000;

      const refreshInterval =
        index === -1 // -1 is used for priority pairs
          ? config.PRIORITY_REFRESH_INTERVAL / 1000 // Priority pairs refresh more frequently
          : config.FULL_REFRESH_INTERVAL / 1000; // Regular pairs refresh less frequently

      // Only refresh if data is older
      if (secondsSinceUpdate < refreshInterval) {
        return existing;
      }
    }

    // Get pool data
    const pair = new ethers.Contract(
      pairAddress,
      config.PAIR_ABI,
      config.provider
    );

    const [token0, token1, reserves, totalSupply] = await Promise.all([
      pair.token0(),
      pair.token1(),
      pair.getReserves(),
      pair.totalSupply(),
    ]);

    // Get token info in parallel
    const [token0Info, token1Info] = await Promise.all([
      getTokenInfo(token0),
      getTokenInfo(token1),
    ]);
    if (!localToken0Info) {
      localToken0Info = token0Info;
      localToken1Info = token1Info;
    }

    if (
      token0Info.symbol === config.UNKNOW_TOKEN_SYMBOL ||
      token1Info.symbol === config.UNKNOW_TOKEN_SYMBOL
    ) {
      console.log(`Skipping pool ${pairAddress} due to unknown token info`);
      return null;
    }

    // Format reserves
    const reserve0 = ethers.formatUnits(reserves[0], token0Info.decimals);
    const reserve1 = ethers.formatUnits(reserves[1], token1Info.decimals);

    // Calculate prices
    const token0Price = Number(reserve1) / Number(reserve0);
    const token1Price = Number(reserve0) / Number(reserve1);

    // Calculate liquidity
    let liquidityUSD = config.UNKNOW_LIQUIDITY_USD;
    const token0Lower = token0.toLowerCase();
    const token1Lower = token1.toLowerCase();

    const r0 = Number(reserve0);
    const r1 = Number(reserve1);
    if (config.STABLECOIN_SET.has(token0Lower) && config.STABLECOIN_SET.has(token1Lower)) {
      // both stable: sum them (already in USD)
      liquidityUSD = (r0 + r1).toString();
    } else if (config.STABLECOIN_SET.has(token0Lower)) {
      liquidityUSD = (r0 * 2).toString();
    } else if (config.STABLECOIN_SET.has(token1Lower)) {
      liquidityUSD = (r1 * 2).toString();
    } else {
      liquidityUSD = config.UNKNOW_LIQUIDITY_USD;
    }

    // Create pool data
    const poolData: PoolData = {
      index: index,
      address: pairAddress,
      token0: {
        address: token0.toLowerCase(),
        name: token0Info.name,
        symbol: token0Info.symbol,
        decimals: token0Info.decimals,
        reserve: reserve0,
      },
      token1: {
        address: token1.toLowerCase(),
        name: token1Info.name,
        symbol: token1Info.symbol,
        decimals: token1Info.decimals,
        reserve: reserve1,
      },
      prices: {
        [`${token0Info.symbol}_PER_${token1Info.symbol}`]: token1Price,
        [`${token1Info.symbol}_PER_${token0Info.symbol}`]: token0Price,
      },
      liquidityUSD, // Estimated total liquidity in USD
      totalSupply: ethers.formatEther(totalSupply), // total LP tokens (total liquidity pool contract tokens)
      updated: new Date().toISOString(),
    };
    // LP tokens 
    /*📈 What is totalSupply for LP-tokens — and when it changes
	•	totalSupply is the total number of LP tokens currently outstanding for that pool — i.e. all LP tokens minted minus those burned.  ￼
	•	Initially, when the pool is first created and someone supplies the first liquidity, totalSupply = 0. Then the first liquidity provider deposits token0 + token1; the contract mints a certain amount of LP tokens (minus a small “MINIMUM_LIQUIDITY” reserved amount) and sends them to the provider.  ￼
	•	On subsequent liquidity additions (by same or different providers), totalSupply increases: new LP tokens are minted in proportion to the amount of liquidity added (relative to existing reserves).  ￼
	•	On liquidity removal (“burn”), LP tokens are burned, and totalSupply decreases accordingly.  */

    // Save to memory
    config.state.poolsMap.set(pairAddress, poolData);

    // Update token pools lookup
    updateTokenPoolsMap(token0.toLowerCase(), pairAddress);
    updateTokenPoolsMap(token1.toLowerCase(), pairAddress);

    return poolData;
  } catch (error) {
    console.log(
      `Error processing pair ${pairAddress} (${
        localToken0Info ? localToken0Info.symbol : config.UNKNOW_TOKEN_SYMBOL
      } -> ${
        localToken1Info ? localToken1Info.symbol : config.UNKNOW_TOKEN_SYMBOL
      }): ${error}`
    );
    // Wait a moment before returning to avoid rapid retries on persistent errors
    await new Promise((resolve) => setTimeout(resolve, 1000));
    return null;
  }
}
