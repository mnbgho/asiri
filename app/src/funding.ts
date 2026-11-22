// Where tari comes from, per network, in plain words. A new
// wallet holds nothing, and nothing else in the product works
// until it holds something, so this guidance sits where an
// empty wallet meets the user: the wallet card at a zero
// balance, and the create screen where the costs land.
//
// Esmeralda's route is the pilot one: the public faucet has
// been unreliable (it refused the project's own funding
// attempts, which arrived by a base layer burn instead), so
// funding is on request against the invitation. Mainnet has
// no faucet and no other source to point at: tari is made
// only by burning
// xtm one for one, and the copy promises nothing about where
// a user gets xtm.
import type { NetworkName } from "./indexer";

export function fundingGuidance(network: NetworkName): string {
  if (network === "esmeralda") {
    return "where testnet tari comes from: the public esmeralda faucet has been unreliable, so pilot circles are funded on request. if you were invited to a pilot circle, reply to the invitation and your wallet will be funded. testnet tari has no value outside this network.";
  }
  return "where mainnet tari comes from: tari is created only by burning xtm, the tari base layer coin, one for one. the xtm is destroyed on the base layer and the same amount of tari appears on this network. there is no faucet and no other source: you need xtm of your own first, and a base layer wallet to burn it in.";
}

/** The guidance is for empty wallets; a funded one has no use for it. */
export function fundingApplies(balance: bigint | null): boolean {
  return balance === 0n;
}
