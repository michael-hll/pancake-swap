import * as scannerOps from "./monitor";
import {INPUT_ARGS, MIN_PROFIT_THRESHOLD} from "./config";

async function main() {
  if (process.env.percent) {
    INPUT_ARGS.percent = Number.parseFloat(process.env.percent);
  }
  console.log("Starting PancakeSwap V2 Arbitrage Scanner...");
  console.log(
    `Using ${
      INPUT_ARGS.percent ?? MIN_PROFIT_THRESHOLD
    }% as the minimum profit threshold`
  );

  // Start the monitoring
  await scannerOps.startMonitoring();
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
