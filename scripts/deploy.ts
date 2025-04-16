import {ethers} from "hardhat";

async function main() {
  console.log("Deploying FlashLoan contract...");
  const [deployer] = await ethers.getSigners();

  console.log("Deploying contracts with the account:", deployer.address);

  // Fix for ethers.js v6:
  const balance = await ethers.provider.getBalance(deployer.address);
  console.log("Account balance:", balance.toString());
  console.log("Account balance (BNB):", ethers.formatEther(balance));

  const Token = await ethers.getContractFactory("FlashSwap");
  const token = await Token.deploy();

  console.log("Token address:", await token.getAddress());
}

// Execute the main function and handle errors
main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Deployment failed:", error);
    process.exit(1);
  });
