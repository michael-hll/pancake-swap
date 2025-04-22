import * as config from "./config";
import {ArbitrageOpportunity} from "./types";
import {ethers} from "hardhat";
import {debugLog} from "./utils-log";

/**
 * Send an arbitrage opportunity by adding it to the BullMQ queue
 * @param opportunityData The arbitrage opportunity data
 * @returns The job ID if successful
 */
export async function sendArbitrage(
  opportunityData: ArbitrageOpportunity
): Promise<string | undefined> {
  try {
    // Validate opportunity data
    if (
      !opportunityData ||
      !opportunityData.startToken ||
      !opportunityData.bestAmount
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
    const jobPayload = {
      token0: borrowToken,
      borrowAmount: borrowAmountStr,
      token1: intermediateToken,
      token2: finalToken,
      deadLineMin: 1, // 1 minute deadline
      slippages: slippages,
      // Include additional pool addresses for router
      pools: opportunityData.path.map((step) => step.poolAddress),
    };

    debugLog(`Sending arbitrage execution job to queue:`, 1, {
      path: `${borrowTokenSymbol} -> ${intermediateTokenSymbol} -> ${finalTokenSymbol} -> ${borrowTokenSymbol}`,
      amount: opportunityData.bestAmount,
      expectedProfit: opportunityData.expectedProfit,
      profitPercent: `${(opportunityData.profitPercent * 100).toFixed(2)}%`,
    });

    // Add job to queue with priority based on profit
    const job = await config.arbitrageQueue.add("path-test", jobPayload, {
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
    return job.id || "";
  } catch (error: unknown) {
    console.error(`Failed to queue arbitrage job:`, error);
  }
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
