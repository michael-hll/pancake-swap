import * as scannerOps from "./monitor";
import {INPUT_ARGS, MIN_PROFIT_THRESHOLD, POOLS_TO_SAMPLE} from "./config";

async function main() {
  parseArgs();

  console.log("Starting PancakeSwap V2 Arbitrage Scanner...");
  console.log(
    `Using ${
      (INPUT_ARGS.percent ?? MIN_PROFIT_THRESHOLD) * 100
    }% as the minimum profit threshold`
  );
  console.log(
    `Using ${
      INPUT_ARGS.pools ?? POOLS_TO_SAMPLE
    } as the number of pools to sample`
  );

  // Start the monitoring
  await scannerOps.startMonitoring();
}

function parseArgs() {
  if (process.env.percent) {
    INPUT_ARGS.percent = Number.parseFloat(process.env.percent);
  }
  if (process.env.pools) {
    INPUT_ARGS.pools = Number.parseInt(process.env.pools);
  }
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
