import {ethers} from "hardhat";
import fs from "fs";
import path from "path";

// Keep existing interfaces
interface TokenInfo {
  address: string;
  name: string;
  symbol: string;
  decimals: number;
  reserve: string;
}

interface PoolData {
  index: number;
  address: string;
  token0: TokenInfo;
  token1: TokenInfo;
  prices: {[key: string]: number};
  liquidityUSD: string;
  totalSupply: string;
  updated: string;
}

// Add new arbitrage-specific interfaces
interface ArbitragePathStep {
  poolAddress: string;
  tokenIn: string;
  tokenOut: string;
  tokenInSymbol: string;
  tokenOutSymbol: string;
}

interface ArbitrageOpportunity {
  startToken: string;
  path: ArbitragePathStep[];
  expectedProfit: number;
  profitPercent: number;
  estimatedGasCost: number;
  netProfit: number;
  timestamp: string;
}

async function main() {
  console.log("Starting PancakeSwap V2 Arbitrage Scanner...");

  // Constants
  const PANCAKE_FACTORY = "0xcA143Ce32Fe78f1f7019d7d551a6402fC5350c73";
  const GAS_PRICE = 6; // Gwei

  // Timing parameters
  const SHORT_DELAY = 1000 * 5;
  const FULL_REFRESH_INTERVAL = 1000 * 60;
  const PRIORITY_REFRESH_INTERVAL = 1000 * 15;

  // Scan parameters
  const BATCH_SIZE = 10;
  const INITIAL_LOAD = 200;

  // Profit thresholds
  const MIN_PROFIT_THRESHOLD = 0.015;
  const MIN_LIQUIDITY_USD = 50000;

  // ABIs
  const FACTORY_ABI = [
    "function allPairsLength() external view returns (uint256)",
    "function allPairs(uint256) external view returns (address)",
    "function getPair(address, address) external view returns (address)",
  ];

  const PAIR_ABI = [
    "function token0() external view returns (address)",
    "function token1() external view returns (address)",
    "function getReserves() external view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)",
    "function totalSupply() external view returns (uint256)",
  ];

  const ERC20_ABI = [
    "function name() external view returns (string)",
    "function symbol() external view returns (string)",
    "function decimals() external view returns (uint8)",
  ];

  // Priority tokens to focus on
  const PRIORITY_TOKENS = {
    WBNB: "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c",
    BUSD: "0xe9e7CEA3DedcA5984780Bafc599bD69ADd087D56",
    USDT: "0x55d398326f99059fF775485246999027B3197955",
    CAKE: "0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82",
    ETH: "0x2170Ed0880ac9A755fd29B2688956BD959F933F8",
    BTCB: "0x7130d2A12B9BCbFAe4f2634d864A1Ee1Ce3Ead9c",
    LOVELY: "0x9E24415d1e549EBc626a13a482Bb117a2B43e9CF",
    Broccoli: "0x12B4356C65340Fb02cdff01293F95FEBb1512F3b",
  };

  // Stablecoins for liquidity calculation
  const STABLECOINS = [
    PRIORITY_TOKENS.BUSD.toLowerCase(),
    PRIORITY_TOKENS.USDT.toLowerCase(),
    "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d", // USDC
    "0x1AF3F329e8BE154074D8769D1FFa4eE058B1DBc3", // DAI
  ];

  const provider = ethers.provider;
  const factory = new ethers.Contract(PANCAKE_FACTORY, FACTORY_ABI, provider);

  // Token info cache
  const tokenCache: {
    [address: string]: {name: string; symbol: string; decimals: number};
  } = {};

  // In-memory pool data storage
  const poolsMap: Map<string, PoolData> = new Map();
  // Track which tokens are in which pools for quick lookup
  const tokenPools: Map<string, Set<string>> = new Map();

  // Helper function to get token info with caching
  async function getTokenInfo(address: string) {
    address = address.toLowerCase();
    if (tokenCache[address]) {
      return tokenCache[address];
    }

    try {
      const token = new ethers.Contract(address, ERC20_ABI, provider);

      const [name, symbol, decimals] = await Promise.all([
        token.name().catch(() => "Unknown"),
        token.symbol().catch(() => "UNKNOWN"),
        token.decimals().catch(() => 18),
      ]);

      tokenCache[address] = {name, symbol, decimals};
      return tokenCache[address];
    } catch (error) {
      console.log(`Error fetching token info for ${address}: ${error}`);
      return {name: "Unknown", symbol: "UNKNOWN", decimals: 18};
    }
  }

  // Load initial pool data for important pools
  async function loadInitialPoolData() {
    console.log("Loading initial pool data...");

    // Load pools for priority pairs first
    for (const [symbol1, address1] of Object.entries(PRIORITY_TOKENS)) {
      for (const [symbol2, address2] of Object.entries(PRIORITY_TOKENS)) {
        if (symbol1 === symbol2) continue;

        const pairAddress = await factory.getPair(address1, address2);
        if (pairAddress === "0x0000000000000000000000000000000000000000")
          continue;

        try {
          await loadPoolData(pairAddress, -1); // Use -1 for direct lookup pools
          console.log(`Loaded ${symbol1}-${symbol2} pool`);
        } catch (error) {
          console.log(`Error loading ${symbol1}-${symbol2} pool: ${error}`);
        }
      }
    }

    // Load a batch of other high liquidity pools
    const pairCount = await factory.allPairsLength();
    console.log(`Found ${pairCount} total pairs on PancakeSwap V2`);

    console.log(`Will focus on first ${INITIAL_LOAD} pools...`);

    for (let i = 0; i < INITIAL_LOAD; i += BATCH_SIZE) {
      const batch = [];
      const end = Math.min(i + BATCH_SIZE, INITIAL_LOAD);

      console.log(`Loading batch ${i} to ${end - 1}...`);

      for (let j = i; j < end; j++) {
        batch.push(loadPoolByIndex(j));
      }

      await Promise.all(batch);

      // Short delay between batches
      if (i + BATCH_SIZE < INITIAL_LOAD) {
        await new Promise((resolve) => setTimeout(resolve, SHORT_DELAY));
      }
    }

    console.log(`Loaded ${poolsMap.size} pools into memory`);
  }

  // Load pool by index
  async function loadPoolByIndex(index: number) {
    try {
      const pairAddress = await factory.allPairs(index);
      return await loadPoolData(pairAddress, index);
    } catch (error) {
      console.log(`Error loading pool at index ${index}: ${error}`);
      return null;
    }
  }

  // Load data for a specific pool
  async function loadPoolData(
    pairAddress: string,
    index: number
  ): Promise<PoolData | null> {
    try {
      pairAddress = pairAddress.toLowerCase();

      // Skip if already loaded recently
      if (poolsMap.has(pairAddress)) {
        const existing = poolsMap.get(pairAddress)!;
        const lastUpdate = new Date(existing.updated);
        const now = new Date();
        const secondsSinceUpdate =
          (now.getTime() - lastUpdate.getTime()) / 1000;

        // Only refresh if data is older than 60 seconds
        if (secondsSinceUpdate < FULL_REFRESH_INTERVAL / 1000) {
          return existing;
        }
      }

      // Get pool data
      const pair = new ethers.Contract(pairAddress, PAIR_ABI, provider);

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

      if (token0Info.symbol === "UNKNOWN" || token1Info.symbol === "UNKNOWN") {
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
      let liquidityUSD = "Unknown";
      const token0Lower = token0.toLowerCase();
      const token1Lower = token1.toLowerCase();

      if (STABLECOINS.includes(token0Lower)) {
        liquidityUSD = (Number(reserve0) * 2).toString();
      } else if (STABLECOINS.includes(token1Lower)) {
        liquidityUSD = (Number(reserve1) * 2).toString();
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
        liquidityUSD,
        totalSupply: ethers.formatEther(totalSupply),
        updated: new Date().toISOString(),
      };

      // Save to memory
      poolsMap.set(pairAddress, poolData);

      // Update token pools lookup
      updateTokenPoolsMap(token0.toLowerCase(), pairAddress);
      updateTokenPoolsMap(token1.toLowerCase(), pairAddress);

      return poolData;
    } catch (error) {
      console.log(`Error processing pair ${pairAddress}: ${error}`);
      // Wait a moment before returning to avoid rapid retries on persistent errors
      await new Promise((resolve) => setTimeout(resolve, 1000));
      return null;
    }
  }

  // Helper to update the token-to-pools lookup
  function updateTokenPoolsMap(tokenAddress: string, poolAddress: string) {
    if (!tokenPools.has(tokenAddress)) {
      tokenPools.set(tokenAddress, new Set());
    }
    tokenPools.get(tokenAddress)!.add(poolAddress);
  }

  // Find arbitrage opportunities using in-memory data
  function findArbitrageOpportunities() {
    // Start timing
    const startTime = Date.now();

    // We'll store found opportunities here
    const opportunities: ArbitrageOpportunity[] = [];

    // Focus on stablecoins as entry points
    for (const stablecoin of STABLECOINS) {
      // Get all pools with this stablecoin
      const stablePools = tokenPools.get(stablecoin) || new Set();

      if (stablePools.size === 0) continue;

      // For each pool with the stablecoin
      for (const stablePoolAddr of stablePools) {
        const stablePool = poolsMap.get(stablePoolAddr);
        if (!stablePool) continue;

        // Skip low liquidity pools
        if (
          stablePool.liquidityUSD !== "Unknown" &&
          Number(stablePool.liquidityUSD) < MIN_LIQUIDITY_USD
        ) {
          continue;
        }

        // Get the other token in the pool
        const midToken =
          stablePool.token0.address === stablecoin
            ? stablePool.token1.address
            : stablePool.token0.address;

        // Get all pools with this middle token
        const midTokenPools = tokenPools.get(midToken) || new Set();

        // For each pool with the middle token
        for (const midPoolAddr of midTokenPools) {
          // Skip the original stablecoin pool
          if (midPoolAddr === stablePoolAddr) continue;

          const midPool = poolsMap.get(midPoolAddr);
          if (!midPool) continue;

          // Skip low liquidity pools
          if (
            midPool.liquidityUSD !== "Unknown" &&
            Number(midPool.liquidityUSD) < MIN_LIQUIDITY_USD
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
          const destPools = tokenPools.get(destToken) || new Set();

          for (const destPoolAddr of destPools) {
            // Skip already used pools
            if (destPoolAddr === stablePoolAddr || destPoolAddr === midPoolAddr)
              continue;

            const destPool = poolsMap.get(destPoolAddr);
            if (!destPool) continue;

            // Skip low liquidity pools
            if (
              destPool.liquidityUSD !== "Unknown" &&
              Number(destPool.liquidityUSD) < MIN_LIQUIDITY_USD
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

              if (profit && profit.profitPercent > MIN_PROFIT_THRESHOLD) {
                opportunities.push(profit);
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
  function calculateTriangularArbitrage(
    startToken: string,
    midToken: string,
    destToken: string,
    pool1: PoolData,
    pool2: PoolData,
    pool3: PoolData
  ): ArbitrageOpportunity | null {
    // console.log(`================================================`);
    // console.log(
    //   `Found arbitrage path: ${startToken} → ${midToken} → ${destToken}`
    // );
    // console.log(`Pool 1: ${pool1.token0.symbol} ↔ ${pool1.token1.symbol}`);
    // console.log(`Pool 2: ${pool2.token0.symbol} ↔ ${pool2.token1.symbol}`);
    // console.log(`Pool 3: ${pool3.token0.symbol} ↔ ${pool3.token1.symbol}`);

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
      const gasCostBNB = estimatedGasUsed * GAS_PRICE * 1e-9; // Convert to BNB

      // Convert BNB cost to start token value (rough estimate)
      let gasCostInStartToken = 0;
      if (startToken.toLowerCase() === PRIORITY_TOKENS.WBNB.toLowerCase()) {
        gasCostInStartToken = gasCostBNB;
      } else {
        // Find a WBNB-startToken pool to estimate conversion
        const bnbPools =
          tokenPools.get(PRIORITY_TOKENS.WBNB.toLowerCase()) || new Set();
        for (const bnbPoolAddr of bnbPools) {
          const bnbPool = poolsMap.get(bnbPoolAddr);
          if (!bnbPool) continue;

          if (
            bnbPool.token0.address === startToken ||
            bnbPool.token1.address === startToken
          ) {
            // Found a relevant pool
            const bnbToStartRate =
              bnbPool.token0.address === PRIORITY_TOKENS.WBNB.toLowerCase()
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

  // Real-time monitoring loop
  async function startMonitoring() {
    console.log("Starting real-time arbitrage monitoring...");

    // Initial scan
    await loadInitialPoolData();

    // Periodic full scans
    setInterval(async () => {
      try {
        console.log("\nPerforming periodic refresh of pool data...");

        // Refresh all pools in memory (in batches)
        const pools = Array.from(poolsMap.keys());

        for (let i = 0; i < pools.length; i += BATCH_SIZE) {
          const batch = [];
          const end = Math.min(i + BATCH_SIZE, pools.length);

          for (let j = i; j < end; j++) {
            batch.push(loadPoolData(pools[j], -1));
          }

          await Promise.all(batch);

          // Find opportunities after each batch refresh
          const opportunities = findArbitrageOpportunities();

          // Log profitable opportunities
          if (opportunities.length > 0) {
            console.log(
              `\n🔍 Found ${opportunities.length} potential arbitrage opportunities:`
            );

            opportunities.slice(0, 5).forEach((opp, i) => {
              console.log(
                `\n#${i + 1}: ${opp.path[0].tokenInSymbol} → ${
                  opp.path[0].tokenOutSymbol
                } → ${opp.path[1].tokenOutSymbol} → ${
                  opp.path[2].tokenOutSymbol
                }`
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
            fs.writeFileSync(
              path.join(__dirname, "../data/arbitrage_opportunities.json"),
              JSON.stringify(
                {
                  timestamp: new Date().toISOString(),
                  opportunities: opportunities.slice(0, 20),
                },
                null,
                2
              )
            );
          } else {
            console.log(
              "No profitable arbitrage opportunities found in this scan."
            );
          }

          // Short delay between batches
          if (i + BATCH_SIZE < pools.length) {
            await new Promise((resolve) => setTimeout(resolve, SHORT_DELAY));
          }
        }
      } catch (error) {
        console.error("Error during periodic refresh:", error);
      }
    }, FULL_REFRESH_INTERVAL);

    // More frequent targeted refreshes for priority pools
    setInterval(async () => {
      try {
        // Refresh only high priority pools
        for (const [symbol1, address1] of Object.entries(PRIORITY_TOKENS)) {
          for (const [symbol2, address2] of Object.entries(PRIORITY_TOKENS)) {
            if (symbol1 === symbol2) continue;

            const pairAddress = await factory.getPair(address1, address2);
            if (pairAddress === "0x0000000000000000000000000000000000000000")
              continue;

            await loadPoolData(pairAddress, -1);
          }
        }

        // Check for opportunities after refreshing priority pools
        const opportunities = findArbitrageOpportunities();

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
        }
      } catch (error) {
        console.error("Error during priority refresh:", error);
      }
    }, PRIORITY_REFRESH_INTERVAL); // Refresh priority pools every XX seconds
  }

  // Start the monitoring
  await startMonitoring();
}

// Execute the script
main()
  .then(() => {
    // Keep running indefinitely
    console.log("Arbitrage scanner running. Press Ctrl+C to exit.");
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
