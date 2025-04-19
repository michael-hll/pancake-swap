// scripts/simulate-arbitrage-offchain.ts
import {ethers} from "hardhat";
import {Contract} from "ethers";
import * as readline from "readline";
import {PRIORITY_TOKENS} from "./scan/config";

// Interfaces we need to interact with
const IUniswapV2Factory = [
  "function getPair(address tokenA, address tokenB) external view returns (address pair)",
];

const IUniswapV2Pair = [
  "function getReserves() external view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)",
  "function token0() external view returns (address)",
  "function token1() external view returns (address)",
];

const IUniswapV2Router = [
  "function getAmountsOut(uint amountIn, address[] memory path) external view returns (uint[] memory amounts)",
];

const TESTNET_TOKENS = {
  BUSD: "0x78867BbEeF44f2326bF8DDd1941a4439382EF2A7",
  CAKE: "0xFa60D973F7642B748046464e165A65B7323b0DEE",
  USDT: "0x7ef95a0FEE0Dd31b22626fA2e10Ee6A223F8a684",
  WBNB: "0xae13d989daC2f0dEbFf460aC112a837C89BAa7cd",
};

// Simulation result structure (matches the contract's structure)
interface SimulationResult {
  success: boolean;
  errorMessage: string;
  failedTradeNumber: number;
  amountIn: bigint;
  expectedTrade1: bigint;
  expectedTrade2: bigint;
  expectedTrade3: bigint;
  isProfitable: boolean;
  profitAmount: bigint;
  repayAmount: bigint;
  contractCheck?: ContractBalanceCheck;
}

// Add near the top of your file with other interfaces
interface ContractBalanceCheck {
  address: string;
  hasBalance: boolean;
  balance: bigint;
  sufficientForRepayment: boolean;
  missingAmount: bigint;
}

// Add this function right after your simulateArbitrage function
async function checkContractBalance(
  contractAddress: string,
  tokenAddress: string,
  requiredAmount: bigint
): Promise<ContractBalanceCheck> {
  // ABI for token balance check
  const tokenAbi = [
    "function balanceOf(address account) external view returns (uint256)",
  ];

  // Create contract instance
  const tokenContract = new ethers.Contract(
    tokenAddress,
    tokenAbi,
    ethers.provider
  );

  // Get current balance
  const balance = await tokenContract.balanceOf(contractAddress);

  return {
    address: contractAddress,
    hasBalance: balance > 0n,
    balance: balance,
    sufficientForRepayment: balance >= requiredAmount,
    missingAmount: balance >= requiredAmount ? 0n : requiredAmount - balance,
  };
}

async function main() {
  // Create readline interface
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  try {
    // Network setup
    const network = await ethers.provider.getNetwork();
    const chainId = network.chainId;
    console.log(`Connected to network with chain ID: ${chainId}`);

    // Set up contract addresses based on network
    let factoryAddress: string, routerAddress: string, baseTokenAddress: string;

    if (chainId === 97n) {
      // BSC Testnet
      factoryAddress = "0x6725F303b657a9451d8BA641348b6761A6CC7a17";
      routerAddress = "0xD99D1c33F9fC3444f8101754aBC46c52416550D1";
      baseTokenAddress = "0xae13d989daC2f0dEbFf460aC112a837C89BAa7cd"; // WBNB
    } else if (chainId === 56n) {
      // BSC Mainnet
      factoryAddress = "0xcA143Ce32Fe78f1f7019d7d551a6402fC5350c73";
      routerAddress = "0x10ED43C718714eb63d5aA57B78B54704E256024E";
      baseTokenAddress = "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c"; // WBNB
    } else {
      throw new Error(`Unsupported network: ${chainId}`);
    }

    // Create contract instances
    const factory = new ethers.Contract(
      factoryAddress,
      IUniswapV2Factory,
      ethers.provider
    );
    const router = new ethers.Contract(
      routerAddress,
      IUniswapV2Router,
      ethers.provider
    );

    // Display token reference
    displayTokenReference(chainId);

    // Get tokens and amount from user input
    const token0 = await askQuestion(rl, "Enter token to borrow: ");
    const amount = ethers.parseUnits(
      await askQuestion(rl, "Enter amount to borrow: "),
      18
    );
    const token1 = await askQuestion(rl, "Enter first swap token: ");
    const token2 = await askQuestion(rl, "Enter second swap token: ");
    // Ask for contract address
    const contractAddress = await askQuestion(
      rl,
      "Enter contract address to check: "
    );

    console.log("\nRunning simulation...");

    // Execute the simulation
    const result = await simulateArbitrage(
      token0,
      amount,
      token1,
      token2,
      factory,
      router,
      baseTokenAddress
    );

    // check token0 balance
    const updatedResult = await checkAndDisplayContractBalance(
      result,
      contractAddress,
      token0,
      rl
    );

    // Display simulation results
    displayResults(updatedResult, token0, token1, token2);
  } catch (error) {
    console.error("Error:", error);
  } finally {
    rl.close();
  }
}

// Add this function to handle contract balance checking
async function checkAndDisplayContractBalance(
  result: SimulationResult,
  contractAddress: string,
  token0: string,
  rl: readline.Interface
): Promise<SimulationResult> {
  if (!contractAddress || contractAddress.trim() === "") {
    console.log("No valid contract address provided. Skipping balance check.");
    return result;
  }

  const shortfall = result.repayAmount - result.expectedTrade3;
  console.log(`\nChecking contract balance of ${token0}`);

  try {
    result.contractCheck = await checkContractBalance(
      contractAddress,
      token0,
      shortfall > 0n ? shortfall : 0n
    );

    console.log(
      `Contract balance: ${ethers.formatUnits(
        result.contractCheck.balance,
        18
      )} ${token0}`
    );

    if (shortfall > 0n) {
      if (result.contractCheck.sufficientForRepayment) {
        console.log(
          `✅ Contract has sufficient funds to cover the shortfall of ${ethers.formatUnits(
            shortfall,
            18
          )} ${token0}`
        );
        console.log(`Transaction would succeed with pre-funded balance`);
      } else {
        console.log(
          `❌ Contract needs additional ${ethers.formatUnits(
            result.contractCheck.missingAmount,
            18
          )} ${token0} to execute this transaction`
        );
        console.log(
          `Transaction would fail with "transfer amount exceeds balance" error`
        );
      }
    } else {
      console.log(`✅ No additional funds needed - trade is profitable`);
    }

    return result;
  } catch (error) {
    console.error(
      `Error checking contract balance: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
    return result;
  }
}

// Main simulation function
async function simulateArbitrage(
  token0: string,
  amount: bigint,
  token1: string,
  token2: string,
  factory: Contract,
  router: Contract,
  baseToken: string
): Promise<SimulationResult> {
  // Initialize the result object
  const result: SimulationResult = {
    success: true,
    errorMessage: "",
    failedTradeNumber: 0,
    amountIn: amount,
    expectedTrade1: 0n,
    expectedTrade2: 0n,
    expectedTrade3: 0n,
    isProfitable: false,
    profitAmount: 0n,
    repayAmount: 0n,
  };

  // Step 1: Check if borrow pool exists and has sufficient liquidity
  try {
    console.log(`Checking borrow pool for ${token0}...`);
    const pairBorrowAddress = await factory.getPair(token0, baseToken);

    if (pairBorrowAddress === ethers.ZeroAddress) {
      result.success = false;
      result.errorMessage = `No pool exists for ${token0}-WBNB`;
      return result;
    }

    const pairBorrow = new ethers.Contract(
      pairBorrowAddress,
      IUniswapV2Pair,
      ethers.provider
    );
    const [reserve0, reserve1] = await pairBorrow.getReserves();
    const token0Address = await pairBorrow.token0();

    // Determine which reserve corresponds to our token
    const borrowReserve =
      token0Address.toLowerCase() === token0.toLowerCase()
        ? reserve0
        : reserve1;

    console.log(
      `Borrow pool reserves: ${ethers.formatUnits(borrowReserve, 18)} tokens`
    );

    if (borrowReserve < amount) {
      result.success = false;
      result.errorMessage = `Insufficient liquidity in borrow pool. Available: ${ethers.formatUnits(
        borrowReserve,
        18
      )}`;
      return result;
    }
  } catch (error) {
    result.success = false;
    result.errorMessage = `Error checking borrow pool: ${
      error instanceof Error ? error.message : String(error)
    }`;
    return result;
  }

  // Step 2: Simulate Trade 1 (token0 -> token1)
  try {
    console.log(`Simulating trade 1: ${token0} -> ${token1}...`);
    const path = [token0, token1];
    const amounts = await router.getAmountsOut(amount, path);
    result.expectedTrade1 = amounts[1];

    console.log(
      `Trade 1 would yield: ${ethers.formatUnits(
        result.expectedTrade1,
        18
      )} ${token1}`
    );

    if (result.expectedTrade1 === 0n) {
      result.success = false;
      result.failedTradeNumber = 1;
      result.errorMessage = "Trade 1 would return zero tokens";
      return result;
    }
  } catch (error) {
    result.success = false;
    result.failedTradeNumber = 1;
    result.errorMessage = `Trade 1 error: ${
      error instanceof Error ? error.message : String(error)
    }`;
    return result;
  }

  // Step 3: Simulate Trade 2 (token1 -> token2)
  try {
    console.log(`Simulating trade 2: ${token1} -> ${token2}...`);
    const path = [token1, token2];
    const amounts = await router.getAmountsOut(result.expectedTrade1, path);
    result.expectedTrade2 = amounts[1];

    console.log(
      `Trade 2 would yield: ${ethers.formatUnits(
        result.expectedTrade2,
        18
      )} ${token2}`
    );

    if (result.expectedTrade2 === 0n) {
      result.success = false;
      result.failedTradeNumber = 2;
      result.errorMessage = "Trade 2 would return zero tokens";
      return result;
    }
  } catch (error) {
    result.success = false;
    result.failedTradeNumber = 2;
    result.errorMessage = `Trade 2 error: ${
      error instanceof Error ? error.message : String(error)
    }`;
    return result;
  }

  // Step 4: Simulate Trade 3 (token2 -> token0)
  try {
    console.log(`Simulating trade 3: ${token2} -> ${token0}...`);
    const path = [token2, token0];
    const amounts = await router.getAmountsOut(result.expectedTrade2, path);
    result.expectedTrade3 = amounts[1];

    console.log(
      `Trade 3 would yield: ${ethers.formatUnits(
        result.expectedTrade3,
        18
      )} ${token0}`
    );

    if (result.expectedTrade3 === 0n) {
      result.success = false;
      result.failedTradeNumber = 3;
      result.errorMessage = "Trade 3 would return zero tokens";
      return result;
    }
  } catch (error) {
    result.success = false;
    result.failedTradeNumber = 3;
    result.errorMessage = `Trade 3 error: ${
      error instanceof Error ? error.message : String(error)
    }`;
    return result;
  }

  // Step 5: Calculate profitability
  const fee = (amount * 3n) / 997n + 1n; // 0.3% fee calculation
  result.repayAmount = amount + fee;

  console.log(`Flash loan fee: ${ethers.formatUnits(fee, 18)} ${token0}`);
  console.log(
    `Total to repay: ${ethers.formatUnits(result.repayAmount, 18)} ${token0}`
  );

  if (result.expectedTrade3 > result.repayAmount) {
    result.isProfitable = true;
    result.profitAmount = result.expectedTrade3 - result.repayAmount;
  }

  return result;
}

// Display results in a user-friendly format
function displayResults(
  result: SimulationResult,
  token0: string,
  token1: string,
  token2: string
) {
  console.log("\n====== ARBITRAGE SIMULATION RESULTS ======");

  if (result.success) {
    console.log("✅ SIMULATION SUCCESSFUL");
    console.log("\nExpected Trades:");
    console.log(
      `1. ${ethers.formatUnits(
        result.amountIn,
        18
      )} ${token0} → ${ethers.formatUnits(result.expectedTrade1, 18)} ${token1}`
    );
    console.log(
      `2. ${ethers.formatUnits(
        result.expectedTrade1,
        18
      )} ${token1} → ${ethers.formatUnits(result.expectedTrade2, 18)} ${token2}`
    );
    console.log(
      `3. ${ethers.formatUnits(
        result.expectedTrade2,
        18
      )} ${token2} → ${ethers.formatUnits(result.expectedTrade3, 18)} ${token0}`
    );

    console.log("\nFlash Loan Details:");
    console.log(
      `Borrow Amount: ${ethers.formatUnits(result.amountIn, 18)} ${token0}`
    );
    console.log(
      `Repay Amount: ${ethers.formatUnits(result.repayAmount, 18)} ${token0}`
    );

    console.log("\nProfitability:");
    if (result.isProfitable) {
      console.log(
        `✅ PROFITABLE: ${ethers.formatUnits(
          result.profitAmount,
          18
        )} ${token0} profit`
      );
      const roi = (Number(result.profitAmount) * 100) / Number(result.amountIn);
      console.log(`ROI: ${roi.toFixed(2)}%`);
    } else {
      console.log(
        `❌ NOT PROFITABLE: Would lose ${ethers.formatUnits(
          result.repayAmount - result.expectedTrade3,
          18
        )} ${token0}`
      );
    }
  } else {
    console.log("❌ SIMULATION FAILED");
    console.log(`Error: ${result.errorMessage}`);

    if (result.failedTradeNumber === 0) {
      console.log("\nBorrow Pool Issue:");
      console.log(
        `- Could not borrow ${ethers.formatUnits(
          result.amountIn,
          18
        )} ${token0}`
      );
      console.log("- Check liquidity in the pool or reduce borrow amount");
    } else {
      console.log(`\nFailed at Trade ${result.failedTradeNumber}:`);
      switch (result.failedTradeNumber) {
        case 1:
          console.log(
            `- Failed swapping ${ethers.formatUnits(
              result.amountIn,
              18
            )} ${token0} → ${token1}`
          );
          break;
        case 2:
          console.log(
            `- Failed swapping ${ethers.formatUnits(
              result.expectedTrade1,
              18
            )} ${token1} → ${token2}`
          );
          break;
        case 3:
          console.log(
            `- Failed swapping ${ethers.formatUnits(
              result.expectedTrade2,
              18
            )} ${token2} → ${token0}`
          );
          break;
      }
    }

    console.log("\nRecommendations:");
    console.log("1. Try a smaller amount");
    console.log("2. Check pool liquidity");
    console.log("3. Try a different token path");
  }
}

// Helper function for user input
async function askQuestion(
  rl: readline.Interface,
  question: string
): Promise<string> {
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      resolve(answer);
    });
  });
}

// Display token references
function displayTokenReference(chainId: bigint) {
  console.log("----------------------------------------------------");

  // Check which network we're on
  if (chainId === 97n) {
    // BSC Testnet
    console.log("Popular BSC Testnet Tokens:");
    console.log(`BUSD: ${TESTNET_TOKENS.BUSD}`);
    console.log(`CAKE: ${TESTNET_TOKENS.CAKE}`);
    console.log(`USDT: ${TESTNET_TOKENS.USDT}`);
    console.log(`WBNB: ${TESTNET_TOKENS.WBNB}`);
  } else if (chainId === 56n) {
    // BSC Mainnet
    console.log("Popular BSC Mainnet Tokens:");
    console.log(`WBNB:  ${PRIORITY_TOKENS.WBNB}`);
    console.log(`BUSD:  ${PRIORITY_TOKENS.BUSD}`);
    console.log(`USDT:  ${PRIORITY_TOKENS.USDT}`);
    console.log(`CAKE:  ${PRIORITY_TOKENS.CAKE}`);
    console.log(`ETH:   ${PRIORITY_TOKENS.ETH}`);
    console.log(`BTCB:  ${PRIORITY_TOKENS.BTCB}`);
    console.log(`USDC:  ${PRIORITY_TOKENS.USDC}`);

    console.log("\nAdditional High-Liquidity Tokens:");
    console.log(`DOT:   ${PRIORITY_TOKENS.DOT}`);
    console.log(`ADA:   ${PRIORITY_TOKENS.ADA}`);
    console.log(`DOGE:  ${PRIORITY_TOKENS.DOGE}`);
    console.log(`XRP:   ${PRIORITY_TOKENS.XRP}`);
    console.log(`MATIC: ${PRIORITY_TOKENS.MATIC}`);
    console.log(`LINK:  ${PRIORITY_TOKENS.LINK}`);
  }
  console.log("----------------------------------------------------");
}

main().catch(console.error);
