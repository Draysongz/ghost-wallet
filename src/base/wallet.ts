import { configDotenv } from "dotenv";
import { createThirdwebClient } from "thirdweb";
import { base } from "thirdweb/chains";
import {
  privateKeyToAccount,
  smartWallet,
} from "thirdweb/wallets";
import { generatePrivateKey } from "viem/accounts";

configDotenv();

const thirdwebClient = createThirdwebClient({
  secretKey: process.env.THIRDWEB_SECRET_KEY!,
});

export function createOwnerWallet() {
  const privateKey = generatePrivateKey();

  const account = privateKeyToAccount({
    client: thirdwebClient,
    privateKey,
  });

  return {
    privateKey,
    address: account.address,
    account,
  };
}

export async function createGhostSmartAccount(
  ownerAccount: ReturnType<typeof createOwnerWallet>["account"],
) {
  const wallet = smartWallet({
    chain: base,
    sponsorGas: true,
  });

  const smartAccount = await wallet.connect({
    client: thirdwebClient,
    personalAccount: ownerAccount,
  });

  return smartAccount;
}

export async function createGhostWallet() {
  const owner = createOwnerWallet();

  const smartAccount = await createGhostSmartAccount(
    owner.account,
  );

  return {
    ownerAddress: owner.address,
    ownerPrivateKey: owner.privateKey,
    smartAccountAddress: smartAccount.address,
  };
}

export function importOwnerWallet(privateKey: string) {
  const normalized = privateKey.startsWith("0x")
    ? privateKey
    : `0x${privateKey}`;

  const account = privateKeyToAccount({
    client: thirdwebClient,
    privateKey: normalized as `0x${string}`,
  });

  return {
    address: account.address,
    account,
  };
}