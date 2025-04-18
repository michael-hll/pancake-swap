import {ArbitrageOpportunity, PoolData} from "./types";
import * as config from "./config";

// Find arbitrage opportunities using in-memory data
export function findArbitrageOpportunities() {
  // Start timing
  const startTime = Date.now();

  // We'll store found opportunities here
  const opportunities: ArbitrageOpportunity[] = [];

  // Focus on stablecoins as entry points
  for (const stablecoin of config.STABLECOINS) {
    // Get all pools with this stablecoin
    const stablePools = config.state.tokenPools.get(stablecoin) || new Set();

    if (stablePools.size === 0) continue;

    // For each pool with the stablecoin
    for (const stablePoolAddr of stablePools) {
      const stablePool = config.state.poolsMap.get(stablePoolAddr);
      if (!stablePool) continue;

      // Skip low liquidity pools
      if (
        stablePool.liquidityUSD !== "Unknown" &&
        Number(stablePool.liquidityUSD) < config.MIN_LIQUIDITY_USD
      ) {
        continue;
      }

      // Get the other token in the pool
      const midToken =
        stablePool.token0.address === stablecoin
          ? stablePool.token1.address
          : stablePool.token0.address;

      // Get all pools with this middle token
      const midTokenPools = config.state.tokenPools.get(midToken) || new Set();

      // For each pool with the middle token
      for (const midPoolAddr of midTokenPools) {
        // Skip the original stablecoin pool
        if (midPoolAddr === stablePoolAddr) continue;

        const midPool = config.state.poolsMap.get(midPoolAddr);
        if (!midPool) continue;

        // Skip low liquidity pools
        if (
          midPool.liquidityUSD !== "Unknown" &&
          Number(midPool.liquidityUSD) < config.MIN_LIQUIDITY_USD
        ) {
          continue;
        }

        // Get the other token in the middle pool
        const destToken =
          midPool.token0.address === midToken
            ? midPool.token1.address
            : midPool.token0.address;

        // Skip if it's the original stablecoin
        if (destToken === stablecoin) continue;

        // Check if there's a pool between dest token and stablecoin
        const destPools = config.state.tokenPools.get(destToken) || new Set();

        for (const destPoolAddr of destPools) {
          // Skip already used pools
          if (destPoolAddr === stablePoolAddr || destPoolAddr === midPoolAddr)
            continue;

          const destPool = config.state.poolsMap.get(destPoolAddr);
          if (!destPool) continue;

          // Skip low liquidity pools
          if (
            destPool.liquidityUSD !== "Unknown" &&
            Number(destPool.liquidityUSD) < config.MIN_LIQUIDITY_USD
          ) {
            continue;
          }

          // Check if this pool connects back to the stablecoin
          const otherToken =
            destPool.token0.address === destToken
              ? destPool.token1.address
              : destPool.token0.address;

          if (otherToken === stablecoin) {
            // We found a triangular path!
            // Calculate potential profit
            const profit = calculateTriangularArbitrage(
              stablecoin,
              midToken,
              destToken,
              stablePool,
              midPool,
              destPool
            );

            if (
              profit &&
              profit.profitPercent >
                (config.INPUT_ARGS.percent ?? config.MIN_PROFIT_THRESHOLD)
            ) {
              opportunities.push(profit);
              // Update last profit found time
              config.state.lastProfitFound = Date.now();
            }
          }
        }
      }
    }
  }

  // Sort opportunities by profit
  opportunities.sort((a, b) => b.netProfit - a.netProfit);

  // Log timing
  const endTime = Date.now();
  console.log(`Scan completed in ${(endTime - startTime) / 1000} seconds`);

  return opportunities;
}

// Calculate arbitrage profit for a triangular path
export function calculateTriangularArbitrage(
  startToken: string,
  midToken: string,
  destToken: string,
  pool1: PoolData,
  pool2: PoolData,
  pool3: PoolData
): ArbitrageOpportunity | null {
  try {
    // Determine exact path and rates
    // First trade: startToken -> midToken
    const isPool1Token0Start = pool1.token0.address === startToken;
    const rate1 = isPool1Token0Start
      ? Number(
          pool1.prices[`${pool1.token0.symbol}_PER_${pool1.token1.symbol}`]
        )
      : Number(
          pool1.prices[`${pool1.token1.symbol}_PER_${pool1.token0.symbol}`]
        );

    // Second trade: midToken -> destToken
    const isPool2Token0Mid = pool2.token0.address === midToken;
    const rate2 = isPool2Token0Mid
      ? Number(
          pool2.prices[`${pool2.token0.symbol}_PER_${pool2.token1.symbol}`]
        )
      : Number(
          pool2.prices[`${pool2.token1.symbol}_PER_${pool2.token0.symbol}`]
        );

    // Third trade: destToken -> startToken
    const isPool3Token0Dest = pool3.token0.address === destToken;
    const rate3 = isPool3Token0Dest
      ? Number(
          pool3.prices[`${pool3.token0.symbol}_PER_${pool3.token1.symbol}`]
        )
      : Number(
          pool3.prices[`${pool3.token1.symbol}_PER_${pool3.token0.symbol}`]
        );

    // Calculate expected profit for 1 unit of startToken
    const startAmount = 1;
    const midAmount = startAmount * rate1;
    const destAmount = midAmount * rate2;
    const endAmount = destAmount * rate3;

    const profit = endAmount - startAmount;
    const profitPercent = profit / startAmount;

    // Estimate gas cost (in the start token)
    // Assuming approximately 300,000 gas for a complete arbitrage transaction
    const estimatedGasUsed = 300000;
    const gasCostBNB = estimatedGasUsed * config.GAS_PRICE * 1e-9; // Convert to BNB

    // Convert BNB cost to start token value (rough estimate)
    let gasCostInStartToken = 0;
    if (
      startToken.toLowerCase() === config.PRIORITY_TOKENS.WBNB.toLowerCase()
    ) {
      gasCostInStartToken = gasCostBNB;
    } else {
      // Find a WBNB-startToken pool to estimate conversion
      const bnbPools =
        config.state.tokenPools.get(
          config.PRIORITY_TOKENS.WBNB.toLowerCase()
        ) || new Set();
      for (const bnbPoolAddr of bnbPools) {
        const bnbPool = config.state.poolsMap.get(bnbPoolAddr);
        if (!bnbPool) continue;

        if (
          bnbPool.token0.address === startToken ||
          bnbPool.token1.address === startToken
        ) {
          // Found a relevant pool
          const bnbToStartRate =
            bnbPool.token0.address === config.PRIORITY_TOKENS.WBNB.toLowerCase()
              ? Number(
                  bnbPool.prices[
                    `${bnbPool.token0.symbol}_PER_${bnbPool.token1.symbol}`
                  ]
                )
              : Number(
                  bnbPool.prices[
                    `${bnbPool.token1.symbol}_PER_${bnbPool.token0.symbol}`
                  ]
                );

          gasCostInStartToken = gasCostBNB * bnbToStartRate;
          break;
        }
      }
    }

    const netProfit = profit - gasCostInStartToken;

    return {
      startToken,
      path: [
        {
          poolAddress: pool1.address,
          tokenIn: startToken,
          tokenOut: midToken,
          tokenInSymbol: isPool1Token0Start
            ? pool1.token0.symbol
            : pool1.token1.symbol,
          tokenOutSymbol: isPool1Token0Start
            ? pool1.token1.symbol
            : pool1.token0.symbol,
        },
        {
          poolAddress: pool2.address,
          tokenIn: midToken,
          tokenOut: destToken,
          tokenInSymbol: isPool2Token0Mid
            ? pool2.token0.symbol
            : pool2.token1.symbol,
          tokenOutSymbol: isPool2Token0Mid
            ? pool2.token1.symbol
            : pool2.token0.symbol,
        },
        {
          poolAddress: pool3.address,
          tokenIn: destToken,
          tokenOut: startToken,
          tokenInSymbol: isPool3Token0Dest
            ? pool3.token0.symbol
            : pool3.token1.symbol,
          tokenOutSymbol: isPool3Token0Dest
            ? pool3.token1.symbol
            : pool3.token0.symbol,
        },
      ],
      expectedProfit: profit,
      profitPercent: profitPercent,
      estimatedGasCost: gasCostInStartToken,
      netProfit: netProfit,
      timestamp: new Date().toISOString(),
    };
  } catch (error) {
    console.log(`Error calculating arbitrage: ${error}`);
    return null;
  }
}
