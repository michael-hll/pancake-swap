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
  expectedProfit: number;
  profitPercent: number;
  estimatedGasCost: number;
  netProfit: number;
  timestamp: string;
}
