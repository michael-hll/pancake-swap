import * as config from "./config";
import * as poolUtils from "./utils-pool";
import * as arbitrageUtils from "./calculate";
import * as fileUtils from "./utils-file";
import {ArbitrageOpportunity} from "./types";
import {deleteDebugLogFile} from "./utils-log";

let scanPaused = false;
let fullScanRunning = false;

interface PriorityPair {
  symbol1: string;
  symbol2: string;
  address1: string;
  address2: string;
}

interface BatchPair extends PriorityPair {
  pairAddress: string;
}

// Load initial pool data for important pools
export async function loadInitialPoolData() {
  console.log("Loading initial pool data...");
  const startTime = Date.now();

  let success = false;
  scanPaused = true;

  while (!success) {
    try {
      // Get total pool count first
      const totalPoolsBigInt = await config.factory.allPairsLength();
      const totalPoolsNumber = Number(totalPoolsBigInt);
      config.updateTotalPools(totalPoolsNumber);
      config.updateRandomEnd(totalPoolsNumber - 1);
      console.log(
        `Found ${config.state.totalPools} total pairs on PancakeSwap V2`
      );

      // Generate initial random pool indices
      if (!config.DEBUG_DISABLE_RANDOM_POOLS) {
        config.state.currentPoolIndices = poolUtils.generateRandomPoolIndices(
          config.INPUT_ARGS.pools ?? config.POOLS_TO_SAMPLE,
          config.RANDOM_START,
          config.RANDOM_END
        );
      }
      // ---------------- PRIORITY POOLS LOADING -----------------
      // Load pools for priority pairs in batches
      if (!config.DEBUG_DISABLE_PRIORITY) {
        console.log("Loading priority token pairs in batches...");

        // First collect all valid pairs
        const priorityPairs: PriorityPair[] = [];
        for (const [symbol1, address1] of Object.entries(
          config.PRIORITY_TOKENS_MUTABLE
        )) {
          for (const [symbol2, address2] of Object.entries(
            config.PRIORITY_TOKENS_MUTABLE
          )) {
            if (symbol1 === symbol2) continue;
            priorityPairs.push({
              symbol1,
              symbol2,
              address1,
              address2,
            });
          }
        }

        // Process pairs in batches
        for (
          let i = 0;
          i < priorityPairs.length;
          i += config.PRIORITY_BATCH_SIZE
        ) {
          const pairPromises = [];
          const batchPairs: BatchPair[] = [];
          const end = Math.min(
            i + config.PRIORITY_BATCH_SIZE,
            priorityPairs.length
          );

          // First get all pair addresses in parallel
          for (let j = i; j < end; j++) {
            const pair = priorityPairs[j];
            pairPromises.push(
              config.factory
                .getPair(pair.address1, pair.address2)
                .then((pairAddress) => {
                  if (
                    pairAddress !== "0x0000000000000000000000000000000000000000"
                  ) {
                    batchPairs.push({
                      ...pair,
                      pairAddress,
                    });
                  }
                  return null;
                })
                .catch((error) => {
                  console.log(
                    `Error getting pair address for ${pair.symbol1}-${pair.symbol2}: ${error}`
                  );
                  return null;
                })
            );
          }

          // Wait for all pair lookups to complete
          await Promise.all(pairPromises);

          // Then load pool data for valid pairs in parallel
          const loadPromises = batchPairs.map((pair) => {
            return poolUtils
              .loadPoolData(pair.pairAddress, -1)
              .then(() => {
                console.log(`Loaded ${pair.symbol1}-${pair.symbol2} pool`);
                return null;
              })
              .catch((error) => {
                console.log(
                  `Error loading ${pair.symbol1}-${pair.symbol2} pool: ${error}`
                );
                return null;
              });
          });

          // Wait for all pool loads to complete
          await Promise.all(loadPromises);

          // Add a small delay between batches to avoid rate limiting
          if (i + config.PRIORITY_BATCH_SIZE < priorityPairs.length) {
            await new Promise((resolve) => setTimeout(resolve, 500));
          }
        }

        console.log("Finished loading priority token pairs");
      }

      // ---------------- RANDOM POOLS LOADING -------------------
      // Load randomly selected pools in batches
      if (!config.DEBUG_DISABLE_RANDOM_POOLS) {
        console.log(
          `Loading ${config.state.currentPoolIndices.length} randomly selected pools...`
        );
        for (
          let i = 0;
          i < config.state.currentPoolIndices.length;
          i += config.BATCH_SIZE
        ) {
          const batch = [];
          const end = Math.min(
            i + config.BATCH_SIZE,
            config.state.currentPoolIndices.length
          );

          console.log(`Loading batch ${i} to ${end - 1}...`);

          for (let j = i; j < end; j++) {
            batch.push(
              poolUtils.loadPoolByIndex(config.state.currentPoolIndices[j])
            );
          }

          await Promise.all(batch);

          // Short delay between batches
          if (i + config.BATCH_SIZE < config.state.currentPoolIndices.length) {
            await new Promise((resolve) =>
              setTimeout(resolve, config.BATCH_SHORT_DELAY)
            );
          }
        }
      }

      // log stable token in pairs count
      for (const stableCoinAddress of config.STABLECOINS) {
        const stablePools =
          config.state.tokenPools.get(stableCoinAddress) || new Set();
        console.log(
          `Stable token ${config.state.tokenCache[stableCoinAddress].symbol} has ${stablePools.size} pools`
        );

        // Show top pairs by liquidity if in debug mode
        if (config.DEBUG_LEVEL > 0 && stablePools.size > 0) {
          // Get pools with this stable token
          const poolsWithLiquidity = Array.from(stablePools)
            .map((poolAddress) => config.state.poolsMap.get(poolAddress))
            .filter((pool) => pool && pool.liquidityUSD)
            .sort((a, b) => b.liquidityUSD - a.liquidityUSD);

          // Show top 3 pairs by liquidity
          const topPairs = poolsWithLiquidity.slice(0, 3);
          if (topPairs.length > 0) {
            console.log(`  Top pairs by liquidity:`);
            topPairs.forEach((pool) => {
              const otherToken =
                pool.token0.address.toLowerCase() ===
                stableCoinAddress.toLowerCase()
                  ? pool.token1.symbol
                  : pool.token0.symbol;
              console.log(
                `    ${
                  config.state.tokenCache[stableCoinAddress].symbol
                }-${otherToken}: $${pool.liquidityUSD.toLocaleString()}`
              );
            });
          }
        }
      }

      success = true;
      scanPaused = false;
    } catch (error) {
      // pause 5 seconds and retry
      console.error(
        `Error loading initial pool data: ${error}. Retrying in 5 seconds...`
      );
      // Reset the pool selection
      poolUtils.resetPoolSelection();

      await new Promise((resolve) => setTimeout(resolve, 5000));
    } finally {
      scanPaused = false;
    }
  }

  const elapsedMinutes = ((Date.now() - startTime) / 1000 / 60).toFixed(1);
  console.log(
    `Loaded ${config.state.poolsMap.size} pools into memory (${elapsedMinutes} minutes)`
  );
}

// Real-time monitoring loop
export async function startMonitoring() {
  console.log("Starting real-time arbitrage monitoring...");
  deleteDebugLogFile();

  // Initial scan
  await loadInitialPoolData();

  // -------------- CHECK IF RESET --------
  setInterval(async () => {
    if (scanPaused || config.DEBUG) return; // Skip if paused or DEBUG mode is on
    const timeSinceLastProfit = Date.now() - config.state.lastProfitFound;
    if (timeSinceLastProfit > config.RESET_INTERVAL) {
      console.log(
        `No profitable opportunities found in ${
          config.RESET_INTERVAL / 1000 / 60
        } minutes. Resetting pool selection.`
      );
      poolUtils.resetPoolSelection();
      await loadInitialPoolData();
      console.log("poolset was reset!");
    }
  }, 1000 * 60); // Check every minute

  // -------------- FULL SCAN -------------
  setInterval(async () => {
    if (scanPaused) return; // Skip if paused
    fullScanRunning = true;
    try {
      console.log("\nPerforming periodic refresh of pool data...");

      // Refresh all pools in memory (in batches)
      const pools = Array.from(config.state.poolsMap.keys());

      for (let i = 0; i < pools.length; i += config.BATCH_SIZE) {
        const batch = [];
        const end = Math.min(i + config.BATCH_SIZE, pools.length);

        for (let j = i; j < end; j++) {
          batch.push(poolUtils.loadPoolData(pools[j], -1));
        }

        await Promise.all(batch);

        // Find opportunities after each batch refresh
        const opportunities = await arbitrageUtils.findArbitrageOpportunities();

        // Log profitable opportunities
        if (opportunities.length > 0) {
          displayAndSaveOpportunity(opportunities, 5); // Show up to 5 opportunities
        } else {
          console.log(
            "No profitable arbitrage opportunities found in this scan. (Full)"
          );
        }

        // Short delay between batches
        if (i + config.BATCH_SIZE < pools.length) {
          await new Promise((resolve) =>
            setTimeout(resolve, config.BATCH_SHORT_DELAY)
          );
        }
      }
    } catch (error) {
      console.error("Error during periodic refresh:", error);
    } finally {
      fullScanRunning = false;
    }
  }, config.INPUT_ARGS.full_refresh_interval ?? config.FULL_REFRESH_INTERVAL);

  // -------------- PRIORITY SCAN ---------
  setInterval(async () => {
    if (scanPaused || fullScanRunning) return;
    try {
      if (config.DEBUG_DISABLE_PRIORITY) return;

      console.log("\nRefreshing priority pools...");

      // Get only priority pools (those with index -1)
      const priorityPools = Array.from(config.state.poolsMap.entries())
        .filter(([_, pool]) => pool.index === -1)
        .map(([address, _]) => address);

      console.log(`Found ${priorityPools.length} priority pools to refresh`);

      // FORCE REFRESH ALL PRIORITY POOLS
      // Process in batches to avoid rate limiting
      for (
        let i = 0;
        i < priorityPools.length;
        i += config.PRIORITY_BATCH_SIZE
      ) {
        const batch = [];
        const end = Math.min(
          i + config.PRIORITY_BATCH_SIZE,
          priorityPools.length
        );

        for (let j = i; j < end; j++) {
          batch.push(poolUtils.loadPoolData(priorityPools[j], -1, true)); // force refresh
        }

        await Promise.all(batch);

        // Check for opportunities after each batch refreshing
        const opportunities = await arbitrageUtils.findArbitrageOpportunities();

        if (opportunities.length > 0) {
          displayAndSaveOpportunity(opportunities, 5);
        } else {
          console.log(
            "No profitable arbitrage opportunities found in this scan. (Priority)"
          );
        }

        // Small delay between batches if needed
        if (i + config.PRIORITY_BATCH_SIZE < priorityPools.length) {
          await new Promise((resolve) =>
            setTimeout(resolve, config.BATCH_SHORT_DELAY)
          );
        }
      }
    } catch (error) {
      console.error("Error during priority refresh:", error);
    }
  }, config.PRIORITY_REFRESH_INTERVAL);
}

/**
 * Displays arbitrage opportunities in a formatted way
 * @param opportunities List of arbitrage opportunities to display
 * @param limit Maximum number of opportunities to display
 */
export function displayAndSaveOpportunity(
  opportunities: ArbitrageOpportunity[],
  limit: number = 3
) {
  if (!opportunities || opportunities.length === 0) {
    console.log("No profitable arbitrage opportunities found.");
    return;
  }

  console.log(
    `\n⚡ Found ${opportunities.length} potential arbitrage opportunities:`
  );

  opportunities.slice(0, limit).forEach((opp, i) => {
    console.log(
      `   #${i + 1}: ${opp.path[0].tokenInSymbol} → ${
        opp.path[0].tokenOutSymbol
      } → ${opp.path[1].tokenOutSymbol} → ${opp.path[2].tokenOutSymbol}: ${(
        opp.profitPercent * 100
      ).toFixed(4)}%`
    );

    // Check if enhanced test data is available
    if (opp.testResults) {
      if (opp.bestAmount && opp.bestAmount > 0) {
        // We have a profitable test amount
        const bestTestResult = opp.testResults.find(
          (t) => t.amount === opp.bestAmount
        );
        if (bestTestResult) {
          console.log(
            `   Best Amount: ${opp.bestAmount} ${opp.path[0].tokenInSymbol} (${(
              bestTestResult.profitPercent * 100
            ).toFixed(4)}%)`
          );
        }
      } else {
        // No profitable test amount found
        console.log(
          `   Warning: No profitable test amount found at current prices`
        );
      }

      // Always show test results
      console.log(`   Test Results:`);
      opp.testResults.forEach((result) => {
        // Show error information if available
        const errorInfo = result.error ? ` (${result.error})` : "";
        console.log(
          `     ${result.amount} ${opp.path[0].tokenInSymbol}: ${(
            result.profitPercent * 100
          ).toFixed(4)}% (${result.profit.toFixed(6)} profit)${errorInfo}`
        );
      });
    } else {
      // Display basic profit information for legacy opportunities
      console.log(
        `   Profit: ${(opp.profitPercent * 100).toFixed(
          4
        )}% (${opp.expectedProfit.toFixed(6)} ${opp.path[0].tokenInSymbol})`
      );
    }

    console.log(
      `   Gas Cost: ~${opp.estimatedGasCost.toFixed(6)} ${
        opp.path[0].tokenInSymbol
      }`
    );
    console.log(
      `   Net Profit: ${opp.netProfit.toFixed(6)} ${opp.path[0].tokenInSymbol}`
    );
    console.log(
      `   Pool Addresses: ${opp.path.map((p) => p.poolAddress).join(" → ")}`
    );

    // Add a blank line between opportunities for better readability
    if (i < Math.min(limit, opportunities.length) - 1) {
      console.log("");
    }
  });

  fileUtils.saveArbitrageOpportunities(opportunities);
}
