export interface InputsArgs {
  percent?: number;
  pools?: number;
  full_refresh_interval?: number;
}

export interface TokenInfo {
  address: string;
  name: string;
  symbol: string;
  decimals: number;
  reserve: string;
}

export interface PoolData {
  index: number;
  address: string;
  token0: TokenInfo;
  token1: TokenInfo;
  prices: {[key: string]: number};
  liquidityUSD: string;
  totalSupply: string;
  updated: string;
}

export interface ArbitragePathStep {
  poolAddress: string;
  tokenIn: string;
  tokenOut: string;
  tokenInSymbol: string;
  tokenOutSymbol: string;
}

export interface ArbitrageOpportunity {
  startToken: string;
  path: ArbitragePathStep[];
  expectedProfit: number; // Best profit from all test amounts
  profitPercent: number; // Profit percentage of best amount
  estimatedGasCost: number; // Direct gas cost value
  netProfit: number; // Profit after gas costs
  timestamp: string;
  testAmounts: number[]; // All amounts tested
  testResults: TestResult[]; // Results for each test amount
  bestAmount: number; // The amount that yielded the best profit
}

export interface TestResult {
  amount: number; // Test amount
  profit: number; // Raw profit (before gas)
  profitPercent: number; // Profit as percentage
  netProfit: number; // Profit after gas costs
  endAmount: number; // Final amount after all swaps
  localEstimate?: {
    // Optional local calculation results
    endAmount: number;
    profit: number;
    profitPercent: number;
  };
  skippedOnChain?: boolean; // Whether on-chain verification was skipped
  error?: string; // Optional error information
}
