import * as scannerOps from "./monitor";
import {
  INPUT_ARGS,
  MIN_PROFIT_THRESHOLD,
  POOLS_TO_SAMPLE,
  FULL_REFRESH_INTERVAL,
} from "./config";

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
  console.log(
    `Using ${
      INPUT_ARGS.full_refresh_interval ?? FULL_REFRESH_INTERVAL
    } ms as the full refresh interval`
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
  if (process.env.refresh_interval) {
    INPUT_ARGS.full_refresh_interval = Number.parseInt(
      process.env.refresh_interval
    );
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
