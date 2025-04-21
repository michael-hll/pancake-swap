import * as config from "./config";
import * as poolUtils from "./utils-pool";
import * as arbitrageUtils from "./calculate";
import * as fileUtils from "./utils-file";
import {ArbitrageOpportunity} from "./types";
import {deleteDebugLogFile} from "./utils-log";

let scanPaused = false;
let fullScanRunning = false;

// Load initial pool data for important pools
export async function loadInitialPoolData() {
  console.log("Loading initial pool data...");

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

      // Load pools for priority pairs first
      for (const [symbol1, address1] of Object.entries(
        config.PRIORITY_TOKENS_MUTABLE
      )) {
        if (config.DEBUG_DISABLE_PRIORITY) break;
        for (const [symbol2, address2] of Object.entries(
          config.PRIORITY_TOKENS_MUTABLE
        )) {
          if (symbol1 === symbol2) continue;

          const pairAddress = await config.factory.getPair(address1, address2);
          if (pairAddress === "0x0000000000000000000000000000000000000000")
            continue;

          try {
            await poolUtils.loadPoolData(pairAddress, -1); // Use -1 for direct lookup pools
            console.log(`Loaded ${symbol1}-${symbol2} pool`);
          } catch (error) {
            console.log(`Error loading ${symbol1}-${symbol2} pool: ${error}`);
          }
        }
      }

      // Load randomly selected pools in batches
      if (!config.DEBUG_DISABLE_RANDOM_POOLS) {
        console.log(
          `Loading ${config.state.currentPoolIndices.length} randomly selected pools...`
        );
      }

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

  console.log(`Loaded ${config.state.poolsMap.size} pools into memory`);
}

// Real-time monitoring loop
export async function startMonitoring() {
  console.log("Starting real-time arbitrage monitoring...");
  deleteDebugLogFile();

  // Initial scan
  await loadInitialPoolData();

  // Check if reset is needed
  setInterval(() => {
    if (scanPaused) return; // Skip if paused
    if (config.DEBUG) return; // Skip if debug mode
    const timeSinceLastProfit = Date.now() - config.state.lastProfitFound;
    if (timeSinceLastProfit > config.RESET_INTERVAL) {
      console.log(
        `No profitable opportunities found in ${
          config.RESET_INTERVAL / 1000 / 60
        } minutes. Resetting pool selection.`
      );
      poolUtils.resetPoolSelection();
      loadInitialPoolData();
      console.log("poolset was reset!");
    }
  }, 1000 * 60); // Check every minute

  // Periodic full scans
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
            "No profitable arbitrage opportunities found in this scan."
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

  // More frequent targeted refreshes for priority pools
  setInterval(async () => {
    if (scanPaused || fullScanRunning) return; // Skip if paused
    try {
      if (config.DEBUG_DISABLE_PRIORITY) return; // Skip if disabled in debug mode
      // Refresh only high priority pools
      for (const [symbol1, address1] of Object.entries(
        config.PRIORITY_TOKENS_MUTABLE
      )) {
        for (const [symbol2, address2] of Object.entries(
          config.PRIORITY_TOKENS_MUTABLE
        )) {
          if (symbol1 === symbol2) continue;

          const pairAddress = await config.factory.getPair(address1, address2);
          if (pairAddress === "0x0000000000000000000000000000000000000000")
            continue;

          await poolUtils.loadPoolData(pairAddress, -1, true);
        }
      }

      // Check for opportunities after refreshing priority pools
      const opportunities = await arbitrageUtils.findArbitrageOpportunities();

      if (opportunities.length > 0) {
        displayAndSaveOpportunity(opportunities, 5); // Show up to 5 opportunities
      } else {
        console.log(
          "No profitable arbitrage opportunities found in this scan."
        );
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
