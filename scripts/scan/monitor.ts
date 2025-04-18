import * as config from "./config";
import * as poolUtils from "./pool-utils";
import * as arbitrageUtils from "./calculate";
import * as fileUtils from "./file-utils";

// Load initial pool data for important pools
export async function loadInitialPoolData() {
  console.log("Loading initial pool data...");

  // Get total pool count first
  const totalPoolsBigInt = await config.factory.allPairsLength();
  const totalPoolsNumber = Number(totalPoolsBigInt);
  config.updateTotalPools(totalPoolsNumber);
  config.updateRandomEnd(totalPoolsNumber - 1);
  console.log(`Found ${config.state.totalPools} total pairs on PancakeSwap V2`);

  // Generate initial random pool indices
  config.state.currentPoolIndices = poolUtils.generateRandomPoolIndices(
    config.POOLS_TO_SAMPLE,
    config.RANDOM_START,
    config.RANDOM_END
  );

  // Load pools for priority pairs first
  for (const [symbol1, address1] of Object.entries(config.PRIORITY_TOKENS)) {
    for (const [symbol2, address2] of Object.entries(config.PRIORITY_TOKENS)) {
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
      batch.push(poolUtils.loadPoolByIndex(config.state.currentPoolIndices[j]));
    }

    await Promise.all(batch);

    // Short delay between batches
    if (i + config.BATCH_SIZE < config.state.currentPoolIndices.length) {
      await new Promise((resolve) => setTimeout(resolve, config.SHORT_DELAY));
    }
  }

  console.log(`Loaded ${config.state.poolsMap.size} pools into memory`);
}

// Real-time monitoring loop
export async function startMonitoring() {
  console.log("Starting real-time arbitrage monitoring...");

  // Initial scan
  await loadInitialPoolData();

  // Check if reset is needed
  setInterval(() => {
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
        const opportunities = arbitrageUtils.findArbitrageOpportunities();

        // Log profitable opportunities
        if (opportunities.length > 0) {
          console.log(
            `\n🔍 Found ${opportunities.length} potential arbitrage opportunities:`
          );

          opportunities.slice(0, 5).forEach((opp, i) => {
            console.log(
              `\n#${i + 1}: ${opp.path[0].tokenInSymbol} → ${
                opp.path[0].tokenOutSymbol
              } → ${opp.path[1].tokenOutSymbol} → ${opp.path[2].tokenOutSymbol}`
            );
            console.log(
              `   Profit: ${(opp.profitPercent * 100).toFixed(
                4
              )}% (${opp.expectedProfit.toFixed(6)} ${
                opp.path[0].tokenInSymbol
              })`
            );
            console.log(
              `   Gas Cost: ~${opp.estimatedGasCost.toFixed(6)} ${
                opp.path[0].tokenInSymbol
              }`
            );
            console.log(
              `   Net Profit: ${opp.netProfit.toFixed(6)} ${
                opp.path[0].tokenInSymbol
              }`
            );
            console.log(
              `   Pool Addresses: ${opp.path
                .map((p) => p.poolAddress)
                .join(" → ")}`
            );
          });

          // Optional: Save to file for reference
          fileUtils.saveArbitrageOpportunities(opportunities);
        } else {
          console.log(
            "No profitable arbitrage opportunities found in this scan."
          );
        }

        // Short delay between batches
        if (i + config.BATCH_SIZE < pools.length) {
          await new Promise((resolve) =>
            setTimeout(resolve, config.SHORT_DELAY)
          );
        }
      }
    } catch (error) {
      console.error("Error during periodic refresh:", error);
    }
  }, config.FULL_REFRESH_INTERVAL);

  // More frequent targeted refreshes for priority pools
  setInterval(async () => {
    try {
      // Refresh only high priority pools
      for (const [symbol1, address1] of Object.entries(
        config.PRIORITY_TOKENS
      )) {
        for (const [symbol2, address2] of Object.entries(
          config.PRIORITY_TOKENS
        )) {
          if (symbol1 === symbol2) continue;

          const pairAddress = await config.factory.getPair(address1, address2);
          if (pairAddress === "0x0000000000000000000000000000000000000000")
            continue;

          await poolUtils.loadPoolData(pairAddress, -1);
        }
      }

      // Check for opportunities after refreshing priority pools
      const opportunities = arbitrageUtils.findArbitrageOpportunities();

      if (opportunities.length > 0) {
        console.log(
          `\n⚡ Found ${opportunities.length} potential arbitrage opportunities in priority scan:`
        );
        opportunities.slice(0, 3).forEach((opp, i) => {
          console.log(
            `   #${i + 1}: ${opp.path[0].tokenInSymbol} → ${
              opp.path[1].tokenOutSymbol
            } → ${opp.path[2].tokenOutSymbol}: ${(
              opp.profitPercent * 100
            ).toFixed(4)}%`
          );
        });
        fileUtils.saveArbitrageOpportunities(opportunities);
      }
    } catch (error) {
      console.error("Error during priority refresh:", error);
    }
  }, config.PRIORITY_REFRESH_INTERVAL);
}
