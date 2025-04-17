import {ethers, run} from "hardhat";
import fs from "fs";
import path from "path";

async function main() {
  const [deployer] = await ethers.getSigners();

  // Check deployer balance
  const balance = await deployer.provider.getBalance(deployer.address);
  const balanceInBNB = ethers.formatEther(balance);

  console.log("----------------------------------------------------");
  console.log("Deploying FlashSwap with the account:", deployer.address);
  console.log(`Account balance: ${balanceInBNB} BNB`);

  // Ensure deployer has enough balance
  if (parseFloat(balanceInBNB) < 0.01) {
    console.error(
      "WARNING: Deployer account has less than 0.01 BNB! This may not be enough for deployment."
    );
    console.error("Consider funding your account before proceeding.");
    return;
  }

  // Check which network we're on
  const {chainId, name} = await ethers.provider.getNetwork();
  console.log(`Network: ${name} (Chain ID: ${chainId})`);

  // Set addresses based on network
  let factoryAddress, routerAddress, wbnbAddress;
  let verifyContract = false;

  if (chainId === 56n) {
    // Fix: Compare with BigInt (56n)
    // BSC Mainnet
    factoryAddress = "0xcA143Ce32Fe78f1f7019d7d551a6402fC5350c73";
    routerAddress = "0x10ED43C718714eb63d5aA57B78B54704E256024E";
    wbnbAddress = "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c";
    //verifyContract = true;
    console.log("Using BSC Mainnet addresses");
  } else if (chainId === 97n) {
    // Fix: Compare with BigInt (97n)
    // BSC Testnet
    factoryAddress = "0x6725F303b657a9451d8BA641348b6761A6CC7a17";
    routerAddress = "0xD99D1c33F9fC3444f8101754aBC46c52416550D1";
    wbnbAddress = "0xae13d989daC2f0dEbFf460aC112a837C89BAa7cd";
    //verifyContract = true;
    console.log("Using BSC Testnet addresses");
  } else {
    console.log(
      `Network ${chainId} is not officially supported, but will attempt deployment.`
    );
    console.log("You'll need to manually set the correct addresses later.");
    factoryAddress = "0x0000000000000000000000000000000000000000";
    routerAddress = "0x0000000000000000000000000000000000000000";
    wbnbAddress = "0x0000000000000000000000000000000000000000";
  }

  console.log("----------------------------------------------------");
  console.log("Deployment Configuration:");
  console.log(`Factory Address: ${factoryAddress}`);
  console.log(`Router Address:  ${routerAddress}`);
  console.log(`WBNB Address:    ${wbnbAddress}`);
  console.log("----------------------------------------------------");

  try {
    // Deploy the flash swap contract
    const FlashSwap = await ethers.getContractFactory("FlashSwap");
    console.log("Deploying FlashSwap contract...");

    // Fix: Correct deployment syntax
    const flashSwapInstance = await FlashSwap.deploy(
      factoryAddress,
      routerAddress,
      wbnbAddress
    );

    console.log("Transaction sent! Waiting for confirmation...");
    // Add null check for deploymentTransaction()
    const tx = flashSwapInstance.deploymentTransaction();
    if (!tx) {
      throw new Error("Deployment transaction is null. This is unexpected.");
    }
    await tx.wait();

    console.log("----------------------------------------------------");
    // Fix: Get address from the deployed contract instance
    const contractAddress = await flashSwapInstance.getAddress();
    console.log(`🎉 FlashSwap deployed successfully to: ${contractAddress}`);
    console.log("----------------------------------------------------");

    // Save deployment info to a file
    const deploymentInfo = {
      network: name,
      chainId: Number(chainId), // Convert BigInt to Number for JSON
      contractAddress: contractAddress,
      deploymentTime: new Date().toISOString(),
      factoryAddress,
      routerAddress,
      wbnbAddress,
    };

    const deployDir = path.join(__dirname, "../deployments");
    if (!fs.existsSync(deployDir)) {
      fs.mkdirSync(deployDir);
    }

    // append the deployment info to a file
    // Read existing deployments if the file exists
    let existingDeployments = [];
    const deploymentFilePath = path.join(
      deployDir,
      `flashswap-${Number(chainId)}.json`
    );

    if (fs.existsSync(deploymentFilePath)) {
      try {
        const fileContent = fs.readFileSync(deploymentFilePath, "utf8");
        const parsedContent = JSON.parse(fileContent);
        // Check if the content is an array or a single deployment
        existingDeployments = Array.isArray(parsedContent)
          ? parsedContent
          : [parsedContent];
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        console.warn(
          `Warning: Could not parse existing deployment file: ${errorMessage}`
        );
        // Continue with an empty array if parsing fails
      }
    }

    // Add the new deployment to the list
    existingDeployments.push(deploymentInfo);

    // Write the updated array back to the file
    fs.writeFileSync(
      deploymentFilePath,
      JSON.stringify(existingDeployments, null, 2)
    );

    console.log(
      `Deployment info appended to deployments/flashswap-${Number(
        chainId
      )}.json`
    );

    // Verify contract on explorer if on a public network
    if (verifyContract) {
      console.log("Waiting for block confirmations before verification...");
      // Wait for 5 block confirmations to ensure the contract is indexed by the explorer
      // Add null check for deploymentTransaction()
      const verifyTx = flashSwapInstance.deploymentTransaction();
      if (!verifyTx) {
        console.warn(
          "Warning: Deployment transaction is null, may affect verification."
        );
        // Alternative approach without waiting
        console.log("Proceeding without waiting for confirmations...");
      } else {
        // Wait for 5 block confirmations to ensure the contract is indexed by the explorer
        await verifyTx.wait(5);
      }

      console.log("Verifying contract on BscScan...");
      try {
        await run("verify:verify", {
          address: contractAddress,
          constructorArguments: [factoryAddress, routerAddress, wbnbAddress],
        });
        console.log("Contract verified successfully! ✅");
      } catch (error) {
        console.error("Error verifying contract:", error);
        console.log("You may need to verify the contract manually.");
      }
    }

    console.log("----------------------------------------------------");
    console.log("Next steps:");
    console.log("1. Check your contract on the block explorer");
    console.log(
      `   https://${
        chainId === 97n ? "testnet." : ""
      }bscscan.com/address/${contractAddress}`
    );
    console.log("2. Start using your FlashSwap contract");
    console.log("----------------------------------------------------");
  } catch (error) {
    console.error("Error during deployment:", error);
    process.exit(1);
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Unhandled error:", error);
    process.exit(1);
  });
