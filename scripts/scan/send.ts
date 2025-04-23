import * as config from "./config";
import {
  ArbitrageOpportunity,
  ArbitragePathStep,
  StartArbitrageArgs,
  TestResult,
} from "./types";
import {ethers} from "hardhat";
import {debugLog} from "./utils-log";

const JOB_NAME = "flash"; // Job name for BullMQ queue

/**
 * Send an arbitrage opportunity by adding it to the BullMQ queue
 * @param opportunityData The arbitrage opportunity data
 * @returns The job ID if successful
 */
export async function sendArbitrage(
  opportunityData: ArbitrageOpportunity,
  isTesting = false
): Promise<string | undefined> {
  try {
    if (isTesting && JOB_NAME === "flash") {
      throw new Error("Testing mode is not allowed for flash jobs");
    }
    // Validate opportunity data
    if (
      !opportunityData ||
      !opportunityData.startToken ||
      !opportunityData.bestAmount ||
      opportunityData.bestAmount <= config.TX_MIN_BEST_AMOUNT
    ) {
      throw new Error("Invalid opportunity data");
    }

    // Get tokens from the path
    if (!opportunityData.path || opportunityData.path.length < 2) {
      throw new Error("Invalid path data");
    }

    // Extract tokens from path
    const borrowToken = opportunityData.startToken;
    const intermediateToken = opportunityData.path[0].tokenOut;
    const finalToken = opportunityData.path[1].tokenOut;

    // Get token decimals from path data or use default
    const borrowTokenDecimals = opportunityData.path[0].tokenInDecimals || 18;

    // Extract token symbols for logging
    const borrowTokenSymbol = opportunityData.path[0].tokenInSymbol;
    const intermediateTokenSymbol = opportunityData.path[0].tokenOutSymbol;
    const finalTokenSymbol = opportunityData.path[1].tokenOutSymbol;

    // Get liquidity data for slippage calculation
    const poolLiquidities = opportunityData.path.map((step) => {
      const pool = config.state.poolsMap.get(step.poolAddress);
      return pool ? Number(pool.liquidityUSD) : 0;
    });

    // Calculate adaptive slippage
    const slippages = calculateAdaptiveSlippageWithLiquidity(
      opportunityData.bestAmount,
      poolLiquidities
    );

    // Convert amount to appropriate string format for blockchain
    const borrowAmountStr = ethers
      .parseUnits(opportunityData.bestAmount.toString(), borrowTokenDecimals)
      .toString();

    // Create job payload
    const jobPayload: StartArbitrageArgs = {
      token0: borrowToken,
      borrowAmount: borrowAmountStr,
      token1: intermediateToken,
      token2: finalToken,
      deadLineMin: 2,
      slippages: slippages,
    };

    debugLog(`Sending arbitrage execution job to queue:`, 1, {
      path: `${borrowTokenSymbol} -> ${intermediateTokenSymbol} -> ${finalTokenSymbol} -> ${borrowTokenSymbol}`,
      amount: opportunityData.bestAmount,
      expectedProfit: opportunityData.expectedProfit,
      profitPercent: `${(opportunityData.profitPercent * 100).toFixed(2)}%`,
    });

    // Add job to queue with priority based on profit
    const job = await config.arbitrageQueue.add(JOB_NAME, jobPayload, {
      priority: Math.ceil(-opportunityData.profitPercent * 10000),
      attempts: 1,
    });

    console.log(
      `Arbitrage job queued with ID: ${job.id}, expected profit: ${
        opportunityData.expectedProfit
      } ${borrowTokenSymbol} (${(opportunityData.profitPercent * 100).toFixed(
        2
      )}%)`
    );

    // check if the test amounts profit is increasing
    // if so, send another job with a large amount
    // this is the key to make the big profit!!! bless me!!!
    await sendAnotherArbitrage(
      jobPayload,
      opportunityData.path,
      opportunityData.testResults,
      borrowTokenDecimals,
      isTesting
    );
    return job.id || "";
  } catch (error: unknown) {
    console.error(`Failed to queue arbitrage job:`, error);
  }
}

async function sendAnotherArbitrage(
  jobPayload: StartArbitrageArgs,
  path: ArbitragePathStep[],
  testResults: TestResult[],
  borrowTokenDecimals: number = 18,
  isTesting = false
) {
  try {
    if (isTesting && JOB_NAME === "flash") {
      throw new Error("Testing mode is not allowed for flash jobs");
    }
    if (testResults.length < 3) return;
    let isContinue = true;
    testResults.sort((a, b) => a.amount - b.amount);
    for (let i = 1; i < testResults.length; i++) {
      if (testResults[i].profitPercent < testResults[i - 1].profitPercent) {
        isContinue = false;
        break;
      }
    }
    if (isContinue) {
      console.log("\n🚀 Scaling opportunity found - submitting larger trade!");
      debugLog("Scaling opportunity found - submitting larger trade!", 1);
      const poolLiquidities = path.map((step) => {
        const pool = config.state.poolsMap.get(step.poolAddress);
        return pool
          ? Number(
              pool.liquidityUSD === config.UNKNOW_LIQUIDITY_USD
                ? "0"
                : pool.liquidityUSD
            )
          : 0;
      });

      // Calculate safe amount
      const borrowAmountStr = isTesting
        ? ethers.parseUnits("0.01", borrowTokenDecimals).toString()
        : calculateSafeTradeAmount(poolLiquidities, borrowTokenDecimals);

      // Set more conservative slippage for larger amounts
      jobPayload.borrowAmount = borrowAmountStr;
      jobPayload.slippages = isTesting ? [997, 997, 997] : [990, 990, 990]; // 1% slippage

      // Queue the job
      const job = await config.arbitrageQueue.add(JOB_NAME, jobPayload, {
        priority: Math.ceil(-100 * 10000),
        attempts: 1,
      });

      console.log(
        `Large arbitrage job queued with ID: ${
          job.id
        }, amount: ${ethers.formatUnits(borrowAmountStr, borrowTokenDecimals)}`
      );
    } else {
      debugLog(
        `Not scaling: isContinue=${isContinue}, testResults.length=${testResults.length}`,
        2
      );
    }
  } catch (error) {
    console.error(`Failed to queue arbitrage job:`, error);
  }
}

function calculateSafeTradeAmount(
  poolLiquidities: number[],
  tokenDecimals: number
): string {
  // Filter out invalid liquidities and convert to numbers
  const validLiquidities = poolLiquidities.filter((liq) => liq > 0);

  if (validLiquidities.length === 0) {
    return ethers.parseUnits("100000", tokenDecimals).toString();
  }

  // Find minimum liquidity across all pools in the path
  const minLiquidity = Math.min(...validLiquidities);

  // Calculate safe percentage based on pool size
  let safePercentage;
  if (minLiquidity > 1000000) {
    // >$1M liquidity
    safePercentage = 0.003; // 0.3%
  } else if (minLiquidity > 100000) {
    // >$100K liquidity
    safePercentage = 0.008; // 0.8%
  } else {
    safePercentage = 0.015; // 1.5%
  }

  // Calculate safe amount with an absolute cap
  const safeLiquidityAmount = minLiquidity * safePercentage;
  const maxAmount = Math.min(safeLiquidityAmount, 100000);

  // Round to a clean number for readability
  const roundedAmount = Math.floor(maxAmount / 100) * 100;

  // Return as string with proper decimals
  return ethers.parseUnits(roundedAmount.toString(), tokenDecimals).toString();
}

/**
 * Calculate adaptive slippage values based on pool liquidity and amount
 */
function calculateAdaptiveSlippageWithLiquidity(
  amount: number,
  poolLiquidities: number[]
): number[] {
  // Default slippage values (0.3% fees accounted for)
  const defaultSlippage = 997; // 0.3% fee (1000 - 3)

  // If we have liquidity information, adjust slippage based on trade size
  if (poolLiquidities && poolLiquidities.length > 0) {
    return poolLiquidities.map((liquidity) => {
      // If no liquidity info, use default
      if (!liquidity || liquidity <= 0) return defaultSlippage;

      // Calculate the percentage of liquidity being used
      const percentOfLiquidity = (amount / liquidity) * 100;

      // Adjust slippage: higher percentage = lower slippage value (more conservative)
      if (percentOfLiquidity > 5) return 990; // 1%
      if (percentOfLiquidity > 2) return 992; // 0.8%
      if (percentOfLiquidity > 1) return 995; // 0.5%
      return defaultSlippage; // 0.3%
    });
  }

  // If no liquidity info, use standard slippage values for each hop
  return [defaultSlippage, defaultSlippage, defaultSlippage];
}

async function test_main() {
  console.log("Starting test of arbitrage queue system...");

  // Create mock opportunities with realistic data that match your interface
  // the test data is on bsc_testnet
  const mockOpportunity: ArbitrageOpportunity = {
    startToken: "0x78867BbEeF44f2326bF8DDd1941a4439382EF2A7",
    path: [
      {
        poolAddress: "0x16b9a82891338f9bA80E2D6970FddA79D1eb0daE", // wrong pool address
        tokenIn: "0x78867BbEeF44f2326bF8DDd1941a4439382EF2A7",
        tokenOut: "0xFa60D973F7642B748046464e165A65B7323b0DEE",
        tokenInSymbol: "USDT",
        tokenOutSymbol: "WBNB",
        tokenInDecimals: 18,
        tokenOutDecimals: 18,
      },
      {
        poolAddress: "0x58F876857a02D6762E0101bb5C46A8c1ED44Dc16", // wrong pool address
        tokenIn: "0xFa60D973F7642B748046464e165A65B7323b0DEE",
        tokenOut: "0x7ef95a0FEE0Dd31b22626fA2e10Ee6A223F8a684",
        tokenInSymbol: "WBNB",
        tokenOutSymbol: "BUSD",
        tokenInDecimals: 18,
        tokenOutDecimals: 18,
      },
      {
        poolAddress: "0x7EFaEf62fDdCCa950418312c6C91Aef321375A00", // BUSD-USDT pool
        tokenIn: "0x7ef95a0FEE0Dd31b22626fA2e10Ee6A223F8a684",
        tokenOut: "0x78867BbEeF44f2326bF8DDd1941a4439382EF2A7",
        tokenInSymbol: "BUSD",
        tokenOutSymbol: "USDT",
        tokenInDecimals: 18,
        tokenOutDecimals: 18,
      },
    ],
    expectedProfit: 23, // 23 USDT profit
    profitPercent: 0.023, // 2.3% profit
    estimatedGasCost: 1.5, // Estimated gas cost in USDT
    netProfit: 21.5, // Profit after gas costs
    timestamp: new Date().toISOString(),
    testAmounts: [100, 500, 1000, 2000, 5000],
    testResults: [
      {
        amount: 500,
        profit: 10,
        profitPercent: 2,
        netProfit: 8,
        endAmount: 510,
        localEstimate: {
          endAmount: 510,
          profit: 10,
          profitPercent: 0.02,
        },
      },
      {
        amount: 1000,
        profit: 23,
        profitPercent: 3,
        netProfit: 21.5,
        endAmount: 1023,
        localEstimate: {
          endAmount: 1023.5,
          profit: 23.5,
          profitPercent: 0.0235,
        },
      },
      {
        amount: 1500,
        profit: 23,
        profitPercent: 4,
        netProfit: 21.5,
        endAmount: 1023,
        localEstimate: {
          endAmount: 1023.5,
          profit: 23.5,
          profitPercent: 0.0235,
        },
      },
    ],
    bestAmount: 0.01,
  };

  try {
    console.log("Sending mock opportunity to queue...");
    const jobId = await sendArbitrage(mockOpportunity, true);

    if (jobId) {
      console.log(`✅ Test successful! Job added to queue with ID: ${jobId}`);
    } else {
      console.error("❌ Test failed: No job ID returned");
    }

    // Test with different profit levels
    console.log("\nTesting with different profit levels to verify priority...");
  } catch (error) {
    console.error("Test failed with error:", error);
  }
}

// Execute test if run directly
if (require.main === module) {
  test_main()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}
