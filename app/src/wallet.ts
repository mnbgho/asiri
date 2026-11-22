// The window.tari provider: an EIP-1193 style request interface
// injected by the user's wallet (Sapient, or the Tari web wallet).
// The app holds no keys. Every write is a transaction request the
// wallet shows to the user, who approves or rejects it there.
import type { Arg } from "./args";

export type Instruction =
  | {
      CallMethod: {
        call: { Address: string };
        method: string;
        args: Arg[];
      };
    }
  | {
      CallFunction: { address: string; function: string; args: Arg[] };
    }
  | { PutLastInstructionOutputOnWorkspace: { key: number } };

export interface TariProvider {
  request(args: { method: string; params?: unknown }): Promise<unknown>;
}

declare global {
  interface Window {
    tari?: TariProvider;
  }
}

export function hasProvider(): boolean {
  return typeof window !== "undefined" && !!window.tari?.request;
}

/** Wait briefly for the wallet to inject its provider. */
export async function waitForProvider(ms = 1500): Promise<boolean> {
  if (hasProvider()) return true;
  return new Promise((resolve) => {
    const done = () => resolve(hasProvider());
    window.addEventListener("tari#initialized", done, { once: true });
    setTimeout(done, ms);
  });
}

export type NetworkMatch = "match" | "mismatch" | "unknown";

/**
 * Compare the wallet's network with the network the app is
 * showing. The provider reports network names in the app's own
 * vocabulary ("mainnet", "esmeralda"), the same comparison the
 * connect flow has always made. A wallet whose network was
 * never read gives "unknown": no answer, not a match.
 */
export function networkMatch(
  walletNetwork: string | null,
  expected: string,
): NetworkMatch {
  if (!walletNetwork) return "unknown";
  return walletNetwork === expected ? "match" : "mismatch";
}

/**
 * Did the user decline this in the wallet? The EIP-1193 user
 * rejection code, 4001, settles it when the error carries one.
 * Otherwise the words wallets use for a refusal are reject,
 * denied, decline, cancel, and refuse, unless the message
 * negates them ("connection was not declined" is not a
 * refusal). Anything else is a failure of another kind and is
 * reported as one.
 */
export function looksDeclined(err: unknown): boolean {
  const code = (err as { code?: unknown } | null | undefined)?.code;
  if (code === 4001) return true;
  const msg = err instanceof Error ? err.message : String(err);
  // A negation just before the refusal word ("was not denied",
  // "did not reject", "wasn't cancelled") means the message is
  // reporting something else that went wrong, not a refusal.
  if (
    /\b(?:not|never|no)\b[^.]{0,20}\b(?:reject|denied|declin|cancel|refus)/i.test(msg) ||
    /n['’]t\b[^.]{0,20}\b(?:reject|denied|declin|cancel|refus)/i.test(msg)
  ) {
    return false;
  }
  return /reject|denied|declin|cancel|refus/i.test(msg);
}

export class Wallet {
  account: string | null = null;
  network: string | null = null;
  /** Delay between transaction-request status polls while the
   * wallet makes up its mind. A field rather than a constant so
   * tests can poll at full speed instead of riding real waits. */
  pollMs = 700;

  private get provider(): TariProvider {
    if (!window.tari?.request) throw new Error("no wallet found on this page");
    return window.tari;
  }

  /**
   * Re-read the wallet's current network from the provider.
   * The network recorded at connect time can go stale when the
   * user switches inside the wallet afterwards, so a submit
   * checks against a fresh read. Returns the freshly read
   * network, or null when the wallet's network could not be
   * read at all. The recorded network keeps its last known
   * value either way, but a null return means unverified, and
   * a caller that needs certainty (the submit guard) treats
   * it that way rather than trusting the stale record.
   */
  async refreshNetwork(): Promise<string | null> {
    try {
      const n = (await this.provider.request({
        method: "tari_getNetwork",
      })) as unknown;
      const v = typeof n === "string" ? n.trim() : "";
      if (v) {
        this.network = v;
        return v;
      }
    } catch {
      /* the network could not be read */
    }
    return null;
  }

  /**
   * Forget the connection locally. The provider interface this
   * app integrates exposes no disconnect call, so this clears
   * what the app holds; the wallet itself may still list the
   * site as connected, and its own settings are where that
   * permission is revoked.
   */
  disconnect(): void {
    this.account = null;
    this.network = null;
  }

  async connect(): Promise<string> {
    const accounts = (await this.provider.request({
      method: "tari_requestAccounts",
    })) as string[];
    if (!accounts?.length) throw new Error("the wallet returned no account");
    this.account = accounts[0];
    this.network = (await this.provider.request({
      method: "tari_getNetwork",
    })) as string;
    return this.account;
  }

  async switchNetwork(network: string): Promise<void> {
    await this.provider.request({
      method: "tari_switchNetwork",
      params: { network },
    });
    this.network = network;
  }

  /**
   * Submit one transaction built from instructions. The wallet
   * shows its own cost estimate and approval prompt; this resolves
   * with the wallet's result once the transaction is submitted, and
   * throws with the wallet's message when the user rejects it or
   * the transaction fails.
   */
  async submit(
    instructions: Instruction[],
    maxFeeMicroTari = 2_000_000,
  ): Promise<{ result: unknown }> {
    const created = (await this.provider.request({
      method: "tari_createTransactionRequest",
      params: {
        kind: "instructions",
        instructions,
        maxFee: String(maxFeeMicroTari),
      },
    })) as { requestId: string };
    const requestId = created.requestId;
    let submitted = false;
    for (;;) {
      const status = (await this.provider.request({
        method: "tari_getTransactionRequest",
        params: { requestId },
      })) as { status: string; result?: unknown; error?: string };
      if (status.status === "approved" && !submitted) {
        // Submit exactly once; a slow wallet may report "approved"
        // for several polls before it reports "submitted".
        submitted = true;
        await this.provider.request({
          method: "tari_submitTransactionRequest",
          params: { requestId },
        });
      } else if (status.status === "submitted") {
        return { result: status.result };
      } else if (status.status === "rejected" || status.status === "failed") {
        throw new Error(status.error ?? `transaction ${status.status}`);
      }
      await new Promise((r) => setTimeout(r, this.pollMs));
    }
  }
}

/** All component addresses in a transaction result that are not known. */
export function findNewComponents(result: unknown, known: string[]): string[] {
  const text = JSON.stringify(result) ?? "";
  const matches = text.match(/component_[0-9a-f]{64}/g) ?? [];
  return [...new Set(matches.filter((m) => !known.includes(m)))];
}
