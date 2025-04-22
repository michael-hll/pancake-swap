import {ethers} from "hardhat";
import {Contract} from "ethers";
import {ArbitrageOpportunity, PoolData} from "./types";
import * as config from "./config";
import {saveLocalEstimatesForAnalysis} from "./utils-file";
import {debugLog} from "./utils-log";
import {sendArbitrage} from "./send";

// Remove the factory import and use PancakeSwap ABI directly:
const ROUTER_ABI = [
  "function getAmountsOut(uint amountIn, address[] memory path) external view returns (uint[] memory amounts)",
];
let router: Contract | null = null;

async function initializeRouter(): Promise<Contract> {
  if (router) return router;

  try {
    // Use Hardhat's provider directly - works on any network Hardhat is configured for
    const provider = ethers.provider;
    const routerAddress = "0x10ED43C718714eb63d5aA57B78B54704E256024E"; // PancakeSwap router on BSC

    router = new Contract(routerAddress, ROUTER_ABI, provider);

    // Verify connection
    await provider.getBlockNumber();
    console.log("Connected to blockchain via Hardhat provider");

    return router;
  } catch (error) {
    console.error("Router initialization failed:", error);
    throw new Error("Failed to initialize router");
  }
}

async function getActualTradeOutput(
  amount: number,
  path: string[]
): Promise<number> {
  try {
    // Get a router instance
    const routerInstance = await initializeRouter();

    // Convert amount to wei (assuming 18 decimals)
    const amountIn = ethers.parseUnits(amount.toString(), 18);

    // Get amounts out from router
    const amountsOut = await routerInstance.getAmountsOut(amountIn, path);

    // Parse the result
    const result = Number(
      ethers.formatUnits(amountsOut[amountsOut.length - 1], 18)
    );

    return result;
  } catch (err: unknown) {
    const error = err as Error;
    console.error("Error simulating trade:", error);

    // Default fallback - assume 0.3% fee but no price impact
    return amount * 0.997;
  }
}

// Local Trade Calculation
function calculateLocalTradeOutput(
  amount: number,
  path: string[],
  reserves: {[poolAddress: string]: {reserve0: string; reserve1: string}},
  findPoolForPair: (tokenA: string, tokenB: string) => string,
  isToken0: (token: string, poolAddress: string) => boolean
): number {
  let currentAmount = amount;

  // For each hop in the path (except the last token)
  for (let i = 0; i < path.length - 1; i++) {
    const tokenIn = path[i];
    const tokenOut = path[i + 1];

    // Find the pool for this pair
    const poolAddress = findPoolForPair(tokenIn, tokenOut);
    if (!poolAddress) return 0;

    const poolReserves = reserves[poolAddress];
    if (!poolReserves) return 0;

    // Determine which token is token0 and which is token1
    const isToken0In = isToken0(tokenIn, poolAddress);

    if (isToken0In) {
      // Token0 in, Token1 out
      const reserveIn = Number(poolReserves.reserve0);
      const reserveOut = Number(poolReserves.reserve1);
      currentAmount =
        (reserveOut * currentAmount * 0.997) /
        (reserveIn + currentAmount * 0.997);
    } else {
      // Token1 in, Token0 out
      const reserveIn = Number(poolReserves.reserve1);
      const reserveOut = Number(poolReserves.reserve0);
      currentAmount =
        (reserveOut * currentAmount * 0.997) /
        (reserveIn + currentAmount * 0.997);
    }
  }

  debugLog(
    "\n==== \
    \nLocal trade output:\n",
    2,
    `Amount in: ${amount}, Amount out: ${currentAmount}, \npath: ${path.join(
      " -> "
    )}, \nreserves: ${JSON.stringify(reserves)}
    \nLocal trade calculation completed\n----\n`
  );
  return currentAmount;
}

// Find arbitrage opportunities using in-memory data
export async function findArbitrageOpportunities() {
  // Start timing
  const startTime = Date.now();

  // We'll store found opportunities here
  const opportunities: ArbitrageOpportunity[] = [];

  // Use all priority tokens as entry points instead of just stablecoins
  const priorityTokenAddresses = Object.values(
    config.PRIORITY_TOKENS_MUTABLE
  ).map((address) => address.toLowerCase());

  console.log(
    `Searching for arbitrage with ${priorityTokenAddresses.length} priority tokens as entry points`
  );

  // Loop through all priority tokens
  for (const startToken of priorityTokenAddresses) {
    // Get all pools with this token
    const startTokenPools =
      config.state.tokenPools.get(startToken) || new Set();

    if (startTokenPools.size === 0) {
      console.log(
        `No pools found for ${
          config.state.tokenCache[startToken]?.symbol || startToken
        }`
      );
      continue;
    }

    debugLog(
      `Checking ${startTokenPools.size} pools for ${
        config.state.tokenCache[startToken]?.symbol || startToken
      }`,
      2
    );

    // For each pool with the start token
    for (const startPoolAddr of startTokenPools) {
      const startPool = config.state.poolsMap.get(startPoolAddr);
      if (!startPool) continue;

      // Skip low liquidity pools
      if (
        startPool.liquidityUSD !== config.UNKNOW_LIQUIDITY_USD &&
        Number(startPool.liquidityUSD) < config.MIN_LIQUIDITY_USD
      ) {
        continue;
      }

      // Get the other token in the pool
      const midToken =
        startPool.token0.address.toLowerCase() === startToken.toLowerCase()
          ? startPool.token1.address.toLowerCase()
          : startPool.token0.address.toLowerCase();

      // Get all pools with this middle token
      const midTokenPools = config.state.tokenPools.get(midToken) || new Set();

      // For each pool with the middle token
      for (const midPoolAddr of midTokenPools) {
        // Skip the original start token pool
        if (midPoolAddr === startPoolAddr) continue;

        const midPool = config.state.poolsMap.get(midPoolAddr);
        if (!midPool) continue;

        // Skip low liquidity pools
        if (
          midPool.liquidityUSD !== config.UNKNOW_LIQUIDITY_USD &&
          Number(midPool.liquidityUSD) < config.MIN_LIQUIDITY_USD
        ) {
          continue;
        }

        // Get the other token in the middle pool
        const destToken =
          midPool.token0.address.toLowerCase() === midToken.toLowerCase()
            ? midPool.token1.address.toLowerCase()
            : midPool.token0.address.toLowerCase();

        // Skip if it's the original start token
        if (destToken === startToken) continue;

        // Check if there's a pool between dest token and start token
        const destPools = config.state.tokenPools.get(destToken) || new Set();

        for (const destPoolAddr of destPools) {
          // Skip already used pools
          if (destPoolAddr === startPoolAddr || destPoolAddr === midPoolAddr)
            continue;

          const destPool = config.state.poolsMap.get(destPoolAddr);
          if (!destPool) continue;

          // Skip low liquidity pools
          if (
            destPool.liquidityUSD !== config.UNKNOW_LIQUIDITY_USD &&
            Number(destPool.liquidityUSD) < config.MIN_LIQUIDITY_USD
          ) {
            continue;
          }

          // Check if this pool connects back to the start token
          const otherToken =
            destPool.token0.address.toLowerCase() === destToken.toLowerCase()
              ? destPool.token1.address.toLowerCase()
              : destPool.token0.address.toLowerCase();

          if (otherToken === startToken) {
            // We found a triangular path!
            // Calculate potential profit
            const opportunity = await calculateTriangularArbitrage(
              startToken,
              midToken,
              destToken,
              startPool,
              midPool,
              destPool
            );

            if (
              opportunity &&
              opportunity.profitPercent >
                (config.INPUT_ARGS.percent ?? config.MIN_PROFIT_THRESHOLD)
            ) {
              validateOpportunityAndSend(opportunity);
              opportunities.push(opportunity);
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
export async function calculateTriangularArbitrage(
  startToken: string,
  midToken: string,
  destToken: string,
  pool1: PoolData,
  pool2: PoolData,
  pool3: PoolData
): Promise<ArbitrageOpportunity | null> {
  try {
    debugLog(
      "\n========================================== \
      \nmethod calculateTriangularArbitrage enter:\n",
      2,
      `Start token: ${startToken}, Mid token: ${midToken}, Dest token: ${destToken}`
    );
    // Determine exact path and rates
    const isPool1Token0Start = pool1.token0.address === startToken;
    const isPool2Token0Mid = pool2.token0.address === midToken;
    const isPool3Token0Dest = pool3.token0.address === destToken;

    // Initialize test results array
    const testResults = [];
    let bestAmount = 0; // Initialize to 0 (no profitable amount)
    let bestProfitPercent = -Infinity; // Start with negative infinity to capture any profitable trade
    let bestProfit = 0;
    let bestNetProfit = 0;
    let hasAnyProfitableAmount = false; // Flag to track if any amount is profitable
    let bestGasCost = 0;
    let localEstimatedProfit = false;

    // Create reserves object for local calculation
    const reserves: {
      [poolAddress: string]: {reserve0: string; reserve1: string};
    } = {
      [pool1.address]: {
        reserve0: pool1.token0.reserve,
        reserve1: pool1.token1.reserve,
      },
      [pool2.address]: {
        reserve0: pool2.token0.reserve,
        reserve1: pool2.token1.reserve,
      },
      [pool3.address]: {
        reserve0: pool3.token0.reserve,
        reserve1: pool3.token1.reserve,
      },
    };

    // Helper function to find pool for a pair
    const findPoolForPair = (tokenA: string, tokenB: string): string => {
      if (
        (tokenA === startToken && tokenB === midToken) ||
        (tokenA === midToken && tokenB === startToken)
      ) {
        return pool1.address;
      } else if (
        (tokenA === midToken && tokenB === destToken) ||
        (tokenA === destToken && tokenB === midToken)
      ) {
        return pool2.address;
      } else if (
        (tokenA === destToken && tokenB === startToken) ||
        (tokenA === startToken && tokenB === destToken)
      ) {
        return pool3.address;
      }
      return "";
    };

    // Helper function to determine if a token is token0 in a pool
    const isToken0 = (token: string, poolAddress: string): boolean => {
      if (poolAddress === pool1.address) {
        return token === pool1.token0.address;
      } else if (poolAddress === pool2.address) {
        return token === pool2.token0.address;
      } else if (poolAddress === pool3.address) {
        return token === pool3.token0.address;
      }
      return false;
    };

    const tradePath = [startToken, midToken, destToken, startToken];

    // Test each amount
    for (const amount of config.TEST_AMOUNTS) {
      try {
        // HYBRID APPROACH: First check with local calculation if it's worth pursuing
        const localEstimate = calculateLocalTradeOutput(
          amount,
          tradePath,
          reserves,
          findPoolForPair,
          isToken0
        );

        const flashLoanFee = amount * 0.003;
        const amountToRepay = amount + flashLoanFee;
        const estimatedProfit = localEstimate - amountToRepay;
        const estimatedProfitPercent = estimatedProfit / amount;

        if (localEstimate > amount) {
          debugLog(
            `Test Amount (+): ${amount}, localEstimate: ${localEstimate}, estimatedProfitPercent: ${estimatedProfitPercent}, tradePath: ${tradePath
              .map((token) => config.state.tokenCache[token].symbol)
              .join(" -> ")}`
          );
        } else {
          debugLog(
            `Test Amount (+): ${amount}, localEstimate: ${localEstimate}, estimatedProfitPercent: ${estimatedProfitPercent}, tradePath: ${tradePath
              .map((token) => config.state.tokenCache[token].symbol)
              .join(" -> ")}`,
            2
          );
        }

        // Only do on-chain simulation if local calculation shows potentially significant profit
        // estimatedProfitPercent already the fees included:
        // - swap fees: 0.3% * 3 = 1.2%
        // - flash loan fee: 0.3%
        // - total: 1.5%
        // So we need the MIN_PROFIT_THRESHOLD can cover the fees:
        // - gas fees + slippage
        // 1. For computational efficiency only: 0.5-0.8% could be sufficient
        // 2. For slippage protection: 1.0-1.5% is reasonable
        // 3. For higher execution success rate: 1.5-2.0% provides more safety
        if (estimatedProfitPercent > config.MIN_PROFIT_THRESHOLD) {
          localEstimatedProfit = true;
          const endAmount = await getActualTradeOutput(amount, tradePath);

          // Calculate flash loan fee and profit
          const profit = endAmount - amountToRepay;
          const profitPercent = profit / amount;

          // Calculate gas cost
          // Calculate gas cost
          const estimatedGasUsed = 300000; // Flash loan arbitrage typically uses ~300k gas
          const gasCostBNB = estimatedGasUsed * config.GAS_PRICE * 1e-9; // Convert to BNB

          // Convert gas cost to startToken
          let gasCostInStartToken = 0;

          // If the starting token is BNB/WBNB, use the gas cost directly
          if (
            startToken.toLowerCase() ===
            config.PRIORITY_TOKENS_MUTABLE.WBNB.toLowerCase()
          ) {
            gasCostInStartToken = gasCostBNB;
          } else {
            // Find WBNB-startToken pool to get price conversion rate
            const bnbPools =
              config.state.tokenPools.get(
                config.PRIORITY_TOKENS_MUTABLE.WBNB.toLowerCase()
              ) || new Set();

            // Look for a pool that contains both WBNB and our starting token
            for (const bnbPoolAddr of bnbPools) {
              const bnbPool = config.state.poolsMap.get(bnbPoolAddr);
              if (!bnbPool) continue;

              // Check if this pool contains our starting token
              if (
                bnbPool.token0.address.toLowerCase() ===
                  startToken.toLowerCase() ||
                bnbPool.token1.address.toLowerCase() ===
                  startToken.toLowerCase()
              ) {
                // Determine BNB to startToken conversion rate
                if (
                  bnbPool.token0.address.toLowerCase() ===
                  config.PRIORITY_TOKENS_MUTABLE.WBNB.toLowerCase()
                ) {
                  // BNB is token0, startToken is token1
                  // Use reserve ratio: token1Reserve / token0Reserve gives us startToken per BNB
                  const conversionRate =
                    Number(bnbPool.token1.reserve) /
                    Number(bnbPool.token0.reserve);
                  gasCostInStartToken = gasCostBNB * conversionRate;
                } else {
                  // BNB is token1, startToken is token0
                  // Use reserve ratio: token0Reserve / token1Reserve gives us startToken per BNB
                  const conversionRate =
                    Number(bnbPool.token0.reserve) /
                    Number(bnbPool.token1.reserve);
                  gasCostInStartToken = gasCostBNB * conversionRate;
                }
                break; // Found a pool, we can stop searching
              }
            }

            // If we couldn't find a direct BNB-startToken pool, use a default estimate
            if (gasCostInStartToken === 0) {
              // Assume BNB is worth ~$300 and most tokens are roughly $1 each (for stablecoins)
              // This is a very rough fallback estimate when we can't find a direct rate
              gasCostInStartToken = gasCostBNB * 300;

              // Log that we're using an estimate
              console.log(
                `Warning: Could not find BNB-${startToken} pool for gas cost calculation. Using estimate.`
              );
            }
          }

          // Calculate net profit after gas costs
          const netProfit = profit - gasCostInStartToken;

          // Save results for this test amount
          testResults.push({
            amount,
            profit,
            profitPercent,
            netProfit,
            endAmount, // Direct value rather than nested
            localEstimate: {
              endAmount: localEstimate,
              profit: estimatedProfit,
              profitPercent: estimatedProfitPercent,
            },
          });

          // Update best amount ONLY if this profit is positive and better than previous best
          if (
            profitPercent > 0 &&
            profitPercent > bestProfitPercent &&
            netProfit > 0
          ) {
            bestProfitPercent = profitPercent;
            bestAmount = amount;
            bestProfit = profit;
            bestNetProfit = netProfit;
            bestGasCost = gasCostInStartToken;
            hasAnyProfitableAmount = true; // We found at least one profitable amount
          }
        } else {
          // Not worth checking on-chain - add the local calculation result
          testResults.push({
            amount,
            profit: estimatedProfit,
            profitPercent: estimatedProfitPercent,
            netProfit: estimatedProfit,
            endAmount: localEstimate, // Direct value rather than nested
            localEstimate: {
              endAmount: localEstimate,
              profit: estimatedProfit,
              profitPercent: estimatedProfitPercent,
            },
            skippedOnChain: true,
          });
        }
      } catch (err: unknown) {
        // [Error handling remains the same]
      }
    }

    debugLog(
      "After testing all amounts: \n",
      2,
      `$$$: Best amount: ${bestAmount}, Best profit percent: ${bestProfitPercent}, Best profit: ${bestProfit}, Best net profit: ${bestNetProfit}, Best gas cost: ${bestGasCost} \n
Test results: ${JSON.stringify(testResults, null, 2)}\n
--------------------------------------------------------`
    );

    if (hasAnyProfitableAmount) {
      // Create and return the opportunity object with test results
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
            tokenInDecimals: config.state.tokenCache[startToken].decimals,
            tokenOutDecimals: config.state.tokenCache[midToken].decimals,
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
            tokenInDecimals: config.state.tokenCache[midToken].decimals,
            tokenOutDecimals: config.state.tokenCache[destToken].decimals,
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
            tokenInDecimals: config.state.tokenCache[destToken].decimals,
            tokenOutDecimals: config.state.tokenCache[startToken].decimals,
          },
        ],
        expectedProfit: bestProfit,
        profitPercent: bestProfitPercent,
        estimatedGasCost: bestGasCost,
        netProfit: bestNetProfit,
        timestamp: new Date().toISOString(),
        testAmounts: config.TEST_AMOUNTS,
        testResults: testResults,
        bestAmount: bestAmount,
      };
    }

    // save localEstimatedProfit = true case
    // which means the actual trade was not profitable
    if (localEstimatedProfit && !hasAnyProfitableAmount) {
      // This case is interesting for analysis - local calculation showed promise
      // but on-chain verification didn't find profit
      saveLocalEstimatesForAnalysis(
        startToken,
        midToken,
        destToken,
        testResults,
        pool1,
        pool2,
        pool3
      );
      console.log(
        `Saved local estimate analysis: Local calc was profitable but router calc wasn't`
      );
    }

    return null;
  } catch (err: unknown) {
    const error = err as Error;
    console.log(`Error calculating arbitrage: ${error}`);
    return null;
  }
}

function validateOpportunityAndSend(opportunity: ArbitrageOpportunity): void {
  // Validate the opportunity object
  if (
    !opportunity ||
    !opportunity.startToken ||
    !opportunity.bestAmount ||
    !opportunity.path ||
    !opportunity.expectedProfit ||
    !opportunity.profitPercent ||
    !opportunity.netProfit ||
    !opportunity.testAmounts ||
    !opportunity.testResults ||
    opportunity.bestAmount < 100
  ) {
    console.error("Invalid opportunity object:", opportunity);
    return;
  }

  // The token path can't include the chain base token
  const isBaseTokenInPath = opportunity.path.some(
    (step) =>
      step.tokenIn === config.PRIORITY_TOKENS_MUTABLE.WBNB ||
      step.tokenOut === config.PRIORITY_TOKENS_MUTABLE.WBNB
  );
  if (isBaseTokenInPath) {
    console.error(
      "Opportunity path contains the base token (WBNB), skipping..."
    );
    return;
  }

  // Send the opportunity to the queue
  sendArbitrage(opportunity);
}
