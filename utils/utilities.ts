import {network, ethers} from "hardhat";
import {Contract, Signer} from "ethers";
import {IERC20} from "../typechain-types";

/**
 * Fund an ERC20 token from a sender to a recipient
 * @param contract The ERC20 token contract
 * @param sender The address of the token sender
 * @param recipient The address receiving the tokens
 * @param amount The amount to send as a string (will be converted to wei)
 */
const fundErc20 = async (
  contract: IERC20,
  sender: string,
  recipient: string,
  amount: string
): Promise<void> => {
  const FUND_AMOUNT = ethers.parseUnits(amount, 18);

  // Fund ERC20 token to the contract
  const whale: Signer = await ethers.getSigner(sender);
  // Cast contract to IERC20 to access the transfer method
  const contractSigner = contract.connect(whale);
  await contractSigner.transfer(recipient, FUND_AMOUNT);
};

/**
 * Impersonate an account, fund ERC20 tokens, then stop impersonating
 * @param contract The ERC20 token contract
 * @param sender The address to impersonate (must have tokens)
 * @param recipient The address receiving the tokens
 * @param amount The amount to send as a string (will be converted to wei)
 */
const impersonateFundErc20 = async (
  contract: IERC20,
  sender: string,
  recipient: string,
  amount: string
): Promise<void> => {
  await network.provider.request({
    method: "hardhat_impersonateAccount",
    params: [sender],
  });

  // Fund baseToken to the contract
  await fundErc20(contract, sender, recipient, amount);

  await network.provider.request({
    method: "hardhat_stopImpersonatingAccount",
    params: [sender],
  });
};

export {fundErc20, impersonateFundErc20};
