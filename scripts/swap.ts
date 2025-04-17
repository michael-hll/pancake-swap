import {ethers} from "hardhat";

async function main() {
  // PancakeSwap Router address on BSC Testnet
  const ROUTER = "0xD99D1c33F9fC3444f8101754aBC46c52416550D1";
  // BUSD address on BSC Testnet
  const BUSD = "0x78867BbEeF44f2326bF8DDd1941a4439382EF2A7";

  // Get signer
  const [signer] = await ethers.getSigners();
  console.log(`Using account: ${signer.address}`);

  const amountIn = ethers.parseEther("0.05");

  // Router ABI (just the functions we need)
  const routerAbi = [
    "function swapExactETHForTokens(uint amountOutMin, address[] calldata path, address to, uint deadline) external payable returns (uint[] memory amounts)",
  ];

  // Create router contract instance
  const router = new ethers.Contract(ROUTER, routerAbi, signer);

  // Create path for swap (BNB → BUSD)
  const WBNB = "0xae13d989daC2f0dEbFf460aC112a837C89BAa7cd";
  const path = [WBNB, BUSD];

  // Execute swap
  console.log(`Swapping ${ethers.formatEther(amountIn)} BNB for BUSD...`);
  const deadline = Math.floor(Date.now() / 1000) + 60 * 20; // 20 minutes

  const tx = await router.swapExactETHForTokens(
    0, // We accept any amount of tokens (no min amount)
    path,
    signer.address,
    deadline,
    {value: amountIn}
  );

  console.log(`Transaction hash: ${tx.hash}`);
  const receipt = await tx.wait();
  console.log(`Swap completed in block ${receipt.blockNumber}`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
