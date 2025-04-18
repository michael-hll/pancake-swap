// scripts/start-arbitrage.ts
import {ethers} from "hardhat";
import fs from "fs";
import path from "path";
import {FlashSwap} from "../typechain-types";
import readline from "readline";

// Token reference for BSC Testnet
const TESTNET_TOKENS = {
  BUSD: "0x78867BbEeF44f2326bF8DDd1941a4439382EF2A7", // BUSD on testnet
  CAKE: "0xFa60D973F7642B748046464e165A65B7323b0DEE", // CAKE on testnet
  USDT: "0x7ef95a0FEE0Dd31b22626fA2e10Ee6A223F8a684", // USDT on testnet
  WBNB: "0xae13d989daC2f0dEbFf460aC112a837C89BAa7cd", // WBNB on testnet
};

interface BaseEvent {
  type: string;
  order: number;
}

interface FlashLoanReceivedEvent extends BaseEvent {
  type: "FlashLoanReceived";
  token: string;
  amount: bigint;
}

interface PoolLiquidityEvent extends BaseEvent {
  type: "PoolLiquidity";
  pair: string;
  token0: string;
  token1: string;
  reserve0: bigint;
  reserve1: bigint;
}

interface TradeExecutedEvent extends BaseEvent {
  type: "TradeExecuted";
  tradeNumber: number;
  fromToken: string;
  toToken: string;
  amountIn: bigint;
  amountOut: bigint;
}

interface ArbitrageExecutedEvent extends BaseEvent {
  type: "ArbitrageExecuted";
  tokenBorrowed: string;
  amountBorrowed: bigint;
  amountReturned: bigint;
  profit: bigint;
  success: boolean;
}

type ArbitrageEvent =
  | FlashLoanReceivedEvent
  | PoolLiquidityEvent
  | TradeExecutedEvent
  | ArbitrageExecutedEvent;

/**
 * Creates a readline interface for user input
 */
function createReadlineInterface() {
  return readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
}

/**
 * Asks the user a question and returns their answer
 */
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

/**
 * Gets network information and displays it
 */
async function getNetworkInfo() {
  const {chainId, name} = await ethers.provider.getNetwork();
  console.log(`Connected to network: ${name} (Chain ID: ${chainId})`);
  return {chainId, name};
}

/**
 * Gets account information and checks balance
 */
async function getAccountInfo() {
  const [signer] = await ethers.getSigners();
  console.log(`Using account: ${signer.address}`);

  const balance = await signer.provider.getBalance(signer.address);
  console.log(`Account balance: ${ethers.formatEther(balance)} BNB`);

  return {signer, balance};
}

/**
 * Gets the most recent deployment from the deployments file
 */
async function getLatestDeployment(chainId: bigint) {
  const deploymentFilePath = path.join(
    __dirname,
    "../deployments",
    `flashswap-${Number(chainId)}.json`
  );

  if (!fs.existsSync(deploymentFilePath)) {
    throw new Error(
      `No deployment found for network with Chain ID: ${chainId}`
    );
  }

  const deploymentData = JSON.parse(
    fs.readFileSync(deploymentFilePath, "utf8")
  );

  // Get the most recent deployment
  return Array.isArray(deploymentData)
    ? deploymentData[deploymentData.length - 1]
    : deploymentData;
}

/**
 * Attaches to the FlashSwap contract
 */
async function attachToContract(contractAddress: string) {
  const FlashSwapFactory = await ethers.getContractFactory("FlashSwap");
  return FlashSwapFactory.attach(contractAddress) as FlashSwap;
}

/**
 * Displays token information for reference
 */
function displayTokenReference() {
  console.log("----------------------------------------------------");
  console.log("Popular BSC Testnet Tokens:");
  console.log(`BUSD: ${TESTNET_TOKENS.BUSD}`);
  console.log(`CAKE: ${TESTNET_TOKENS.CAKE}`);
  console.log(`USDT: ${TESTNET_TOKENS.USDT}`);
  console.log(`WBNB: ${TESTNET_TOKENS.WBNB}`);
  console.log("----------------------------------------------------");
}

/**
 * Executes the arbitrage transaction
 */
async function executeArbitrage(
  flashSwap: FlashSwap,
  token0: string,
  borrowAmount: bigint,
  token1: string,
  token2: string,
  chainId: bigint
) {
  console.log("Sending transaction...");

  // Call the start function
  const tx = await flashSwap.start(token0, borrowAmount, token1, token2, 0);

  console.log(`Transaction sent! Hash: ${tx.hash}`);
  console.log(
    `View on explorer: https://${
      chainId === 97n ? "testnet." : ""
    }bscscan.com/tx/${tx.hash}`
  );

  console.log("Waiting for transaction confirmation...");
  const receipt = await tx.wait();

  if (!receipt) {
    throw new Error("Failed to get transaction receipt");
  }

  return receipt;
}

/**
 * Processes the transaction receipt and extracts all relevant events
 */
function processArbitrageEvents(receipt: any, flashSwap: FlashSwap) {
  console.log("----------------------------------------------------");
  console.log(`Transaction confirmed in block ${receipt.blockNumber}`);
  console.log(`Gas used: ${receipt.gasUsed}`);

  console.log("\n📋 EXECUTION FLOW:");

  // Parse all events in chronological order
  const allEvents = receipt.logs
    .map((log: any) => {
      try {
        const parsedLog = flashSwap.interface.parseLog(log);
        if (!parsedLog) return null;

        // Return different structures based on event type
        switch (parsedLog.name) {
          case "DebugFlashLoanReceived":
            return {
              type: "FlashLoanReceived",
              order: 1,
              token: parsedLog.args.token,
              amount: parsedLog.args.amount,
            };

          case "DebugPoolLiquidity":
            return {
              type: "PoolLiquidity",
              order: 2,
              pair: parsedLog.args.pair,
              token0: parsedLog.args.token0,
              token1: parsedLog.args.token1,
              reserve0: parsedLog.args.reserve0,
              reserve1: parsedLog.args.reserve1,
            };

          case "DebugTradeExecuted":
            return {
              type: "TradeExecuted",
              order: 3 + Number(parsedLog.args.tradeNumber),
              tradeNumber: Number(parsedLog.args.tradeNumber),
              fromToken: parsedLog.args.fromToken,
              toToken: parsedLog.args.toToken,
              amountIn: parsedLog.args.amountIn,
              amountOut: parsedLog.args.amountOut,
            };

          case "ArbitrageExecuted":
            return {
              type: "ArbitrageExecuted",
              order: 10, // Always display last
              tokenBorrowed: parsedLog.args.tokenBorrowed,
              amountBorrowed: parsedLog.args.amountBorrowed,
              amountReturned: parsedLog.args.amountReturned,
              profit: parsedLog.args.profit,
              success: parsedLog.args.success,
            };

          default:
            return null;
        }
      } catch {
        return null;
      }
    })
    .filter((event: ArbitrageEvent) => event !== null)
    .sort((a: ArbitrageEvent, b: ArbitrageEvent) => a.order - b.order || 0); // Sort by order

  // Display all events
  if (allEvents.length > 0) {
    // Extract arbitrage results for return value
    const arbitrageEvents = allEvents.filter(
      (event: ArbitrageEvent) => event.type === "ArbitrageExecuted"
    );

    // Process each event type
    allEvents.forEach((event: ArbitrageEvent) => {
      switch (event.type) {
        case "FlashLoanReceived":
          console.log("\n🔄 FLASH LOAN RECEIVED:");
          console.log(`Token: ${event.token}`);
          console.log(`Amount: ${ethers.formatUnits(event.amount, 18)}`);
          break;

        case "PoolLiquidity":
          console.log("\n💧 POOL LIQUIDITY:");
          console.log(`Pair: ${event.pair}`);
          console.log(`Token0: ${event.token0}`);
          console.log(`Token1: ${event.token1}`);
          console.log(`Reserve0: ${ethers.formatUnits(event.reserve0, 18)}`);
          console.log(`Reserve1: ${ethers.formatUnits(event.reserve1, 18)}`);
          break;

        case "TradeExecuted":
          console.log(`\n🔄 TRADE ${event.tradeNumber}:`);
          console.log(`From: ${event.fromToken}`);
          console.log(`To: ${event.toToken}`);
          console.log(`Amount In: ${ethers.formatUnits(event.amountIn, 18)}`);
          console.log(`Amount Out: ${ethers.formatUnits(event.amountOut, 18)}`);
          // Calculate and display price impact
          const priceImpact = calculatePriceImpact(
            event.amountIn,
            event.amountOut
          );
          console.log(`Rate: 1 token = ${priceImpact.rate} tokens`);
          break;

        case "ArbitrageExecuted":
          console.log("\n✅ ARBITRAGE RESULTS:");
          console.log(`Token Borrowed: ${event.tokenBorrowed}`);
          console.log(
            `Amount Borrowed: ${ethers.formatUnits(event.amountBorrowed, 18)}`
          );
          console.log(
            `Amount Returned: ${ethers.formatUnits(event.amountReturned, 18)}`
          );
          console.log(`Profit: ${ethers.formatUnits(event.profit, 18)}`);
          console.log(`Success: ${event.success}`);

          // Calculate ROI
          const roi = calculateROI(event.amountBorrowed, event.profit);
          console.log(`ROI: ${roi}%`);
          break;
      }
    });

    return arbitrageEvents;
  } else {
    console.log("No events found in transaction");
    return [];
  }
}

/**
 * Calculates price impact from a trade
 */
function calculatePriceImpact(
  amountIn: bigint,
  amountOut: bigint
): {rate: string} {
  if (amountIn === 0n) return {rate: "0"};

  // Calculate tokens received per token spent
  const rawRate = Number(amountOut) / Number(amountIn);
  return {
    rate: rawRate.toFixed(6),
  };
}

/**
 * Calculates return on investment
 */
function calculateROI(amountBorrowed: bigint, profit: bigint): string {
  if (amountBorrowed === 0n) return "0";

  const roi = (Number(profit) / Number(amountBorrowed)) * 100;
  return roi.toFixed(2);
}

/**
 * Displays the arbitrage results
 */
function displayArbitrageResults(events: any[]) {
  if (events.length > 0) {
    const event = events[0];
    console.log("Arbitrage Results:");
    console.log(`Token Borrowed: ${event.tokenBorrowed}`);
    console.log(
      `Amount Borrowed: ${ethers.formatUnits(event.amountBorrowed, 18)}`
    );
    console.log(
      `Amount Returned: ${ethers.formatUnits(event.amountReturned, 18)}`
    );
    console.log(`Profit: ${ethers.formatUnits(event.profit, 18)}`);
    console.log(`Success: ${event.success}`);
  } else {
    console.log("No arbitrage events found in transaction");
  }
  console.log("----------------------------------------------------");
}

/**
 * Gets contract address from user or deployment file
 */
async function getContractAddress(
  rl: readline.Interface,
  chainId: bigint
): Promise<string> {
  console.log("----------------------------------------------------");
  const useExisting = await askQuestion(rl, "Use existing deployment? (y/N): ");

  if (useExisting.toLowerCase() === "y") {
    try {
      const latestDeployment = await getLatestDeployment(chainId);
      const contractAddress = latestDeployment.contractAddress;
      console.log(`Using FlashSwap contract at: ${contractAddress}`);
      return contractAddress;
    } catch (error) {
      console.log(error instanceof Error ? error.message : String(error));
      console.log("Falling back to manual address input...");
    }
  }

  // Manual input
  while (true) {
    const address = await askQuestion(rl, "Enter contract address: ");
    if (ethers.isAddress(address)) {
      return address;
    }
    console.log("Invalid address format. Please try again.");
  }
}

/**
 * Gets token address from user
 */
async function getTokenAddress(
  rl: readline.Interface,
  prompt: string
): Promise<string> {
  while (true) {
    const address = await askQuestion(rl, prompt);
    if (ethers.isAddress(address)) {
      return address;
    }
    console.log("Invalid address format. Please try again.");
  }
}

/**
 * Gets amount from user
 */
async function getAmount(
  rl: readline.Interface,
  prompt: string
): Promise<bigint> {
  while (true) {
    try {
      const amountStr = await askQuestion(rl, prompt);
      return ethers.parseUnits(amountStr, 18);
    } catch {
      console.log("Invalid amount format. Please enter a valid number.");
    }
  }
}

/**
 * Main function orchestrating the arbitrage process
 */
async function main() {
  const rl = createReadlineInterface();

  try {
    // Get network and account info
    const {chainId} = await getNetworkInfo();
    await getAccountInfo();

    // Get contract address from user
    const contractAddress = await getContractAddress(rl, chainId);

    // Attach to the contract
    const flashSwap = await attachToContract(contractAddress);

    // Display token reference for user convenience
    displayTokenReference();

    // Get token0 (to borrow) from user
    console.log("----------------------------------------------------");
    console.log(
      "Enter the first token in the arbitrage path (token to borrow):"
    );
    const token0 = await getTokenAddress(rl, "Token0 address: ");

    // Get borrow amount
    console.log("----------------------------------------------------");
    console.log("Enter the amount to borrow:");
    const borrowAmount = await getAmount(rl, "Amount (e.g. 10): ");

    // Get token1
    console.log("----------------------------------------------------");
    console.log("Enter the second token in the arbitrage path:");
    const token1 = await getTokenAddress(rl, "Token1 address: ");

    // Get token2
    console.log("----------------------------------------------------");
    console.log("Enter the third token in the arbitrage path:");
    const token2 = await getTokenAddress(rl, "Token2 address: ");

    // Display transaction parameters
    console.log("----------------------------------------------------");
    console.log("Review arbitrage parameters:");
    console.log(`Contract: ${contractAddress}`);
    console.log(`Token0: ${token0}`);
    console.log(`Amount to borrow: ${ethers.formatUnits(borrowAmount, 18)}`);
    console.log(`Token1: ${token1}`);
    console.log(`Token2: ${token2}`);
    console.log("----------------------------------------------------");

    // Get user confirmation
    const confirm = await askQuestion(
      rl,
      "Proceed with this transaction? (y/N): "
    );
    rl.close();

    if (confirm.toLowerCase() !== "y") {
      console.log("Transaction cancelled by user");
      return;
    }

    // Execute the arbitrage transaction
    const receipt = await executeArbitrage(
      flashSwap,
      token0,
      borrowAmount,
      token1,
      token2,
      chainId
    );

    // Process and display results
    const events = processArbitrageEvents(receipt, flashSwap);
    displayArbitrageResults(events);
  } catch (error: unknown) {
    // Make sure readline is closed if open
    try {
      rl.close();
    } catch {}

    console.error(
      "Error executing arbitrage:",
      error instanceof Error ? error.message : String(error)
    );
    console.error(
      "Stack trace:",
      error instanceof Error ? error.stack : "No stack trace available"
    );
    process.exit(1);
  }
}

// Execute the main function
main()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    console.error(
      "Unhandled error:",
      error instanceof Error ? error.message : String(error)
    );
    process.exit(1);
  });
