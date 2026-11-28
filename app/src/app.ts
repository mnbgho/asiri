// Shared app state: the selected network, the wallet, the
// visitor's own public key (used only to light up the actions
// they can sign; the templates check the real signature), and
// the addresses this browser watches.
import { TARI_TOKEN } from "./args";
import {
  calledMethods,
  confirmAction,
  UNCONFIRMED,
  type ActionOutcome,
  type ConfirmOptions,
} from "./finalize";
import { Indexer, NETWORKS, defaultNetwork, type NetworkName } from "./indexer";
import {
  decodeAccountOwnerKey,
  decodeVaultBalance,
  decodeVaultResourceAddress,
  findAccountVault,
} from "./state";
import {
  Wallet,
  networkMatch,
  type Instruction,
  type SubstateRequirement,
} from "./wallet";

/**
 * The stages of one transaction, as the app reports them to
 * the screen: waiting for the wallet, submitted and waiting
 * for the chain, then the ending the chain gave. The modal
 * listens for these and narrates the wait, so no action ever
 * leaves the visitor staring at a still page wondering
 * whether anything happened.
 */
export type TxStage =
  | { stage: "wallet" }
  | { stage: "confirming" }
  | { stage: "submitted" }
  | { stage: "confirmed"; txId: string | null }
  | { stage: "failed"; txId: string | null; reason: string | null }
  | { stage: "unconfirmed"; txId: string | null }
  | { stage: "error"; message: string };

export function dispatchTxStage(detail: TxStage): void {
  if (
    typeof window !== "undefined" &&
    typeof window.dispatchEvent === "function"
  ) {
    const event = new Event("asiri:tx-stage") as Event & { detail?: TxStage };
    event.detail = detail;
    window.dispatchEvent(event);
  }
}

const store = {
  get(k: string): string | null {
    try {
      return localStorage.getItem(`asiri:${k}`);
    } catch {
      return null;
    }
  },
  set(k: string, v: string): void {
    try {
      localStorage.setItem(`asiri:${k}`, v);
    } catch {
      /* private mode: state simply does not persist */
    }
  },
  remove(k: string): void {
    try {
      localStorage.removeItem(`asiri:${k}`);
    } catch {
      /* private mode: nothing was persisted */
    }
  },
};

export class App {
  network: NetworkName;
  indexer: Indexer;
  wallet = new Wallet();
  myKey: string | null;
  balance: bigint | null = null;
  // A one-shot note the next rendered screen shows above its
  // content: how a just-submitted transaction actually stands.
  flash: { text: string; txId: string | null } | null = null;
  private identityAccount: string | null = null;

  constructor() {
    // A saved preference always wins. A first visit lands on the
    // first network with templates configured, so it never opens
    // on a network with nothing live to show.
    const saved = store.get("network");
    this.network =
      saved === "esmeralda" || saved === "mainnet" ? saved : defaultNetwork();
    this.indexer = new Indexer(NETWORKS[this.network]);
    this.myKey = store.get("mykey");
  }

  setNetwork(n: NetworkName): void {
    this.network = n;
    this.indexer = new Indexer(NETWORKS[n]);
    store.set("network", n);
    // The derived balance belongs to the old network's account
    // state; never present it as the new network's balance.
    this.balance = null;
    this.identityAccount = null;
  }

  setMyKey(k: string | null): void {
    this.myKey = k;
    if (k) store.set("mykey", k);
  }

  /**
   * The account the wallet was connected as, remembered across
   * a page refresh so the app can reconnect it without asking
   * the user to connect again. The wallet itself still holds
   * the permission; this is only the reminder to ask it.
   */
  rememberedAccount(): string | null {
    return store.get("wallet");
  }

  rememberWallet(account: string): void {
    store.set("wallet", account);
  }

  forgetWallet(): void {
    store.remove("wallet");
  }

  /**
   * Stop a submit before it starts when the wallet is on a
   * different network from the one the app is showing. Without
   * this, the transaction is built for the app's network and
   * the wallet's network rejects or strands it, and the user
   * learns nothing. The wallet's network is re-read fresh: the
   * value from connect time goes stale when the user switches
   * inside the wallet. A wallet whose network cannot be read
   * at all is unverified, and the submit stops too: trusting
   * the stale connect-time record in that case would let a
   * write through on a network nobody checked.
   */
  async guardWalletNetwork(): Promise<void> {
    if (!this.wallet.account) return;
    const net = await this.wallet.refreshNetwork();
    if (net === null) {
      throw new Error(
        "Your wallet's network could not be checked, so nothing was submitted. Reconnect your wallet and try again.",
      );
    }
    if (networkMatch(net, this.network) === "mismatch") {
      throw new Error(
        `Your wallet is on ${net}, but the app is set to ${NETWORKS[this.network].label}. Switch the network in your wallet, or switch the app's network, then try again.`,
      );
    }
  }

  private async resolveFeeInputs(): Promise<SubstateRequirement[]> {
    const account = this.wallet.account;
    if (!account)
      throw new Error("Connect a wallet before preparing fee-payer inputs.");
    const accountState = await this.indexer.substate(account);
    if (!accountState)
      throw new Error(
        "The connected fee-payer account is not live on the selected network; nothing was requested.",
      );
    const ownerKey = decodeAccountOwnerKey(accountState.value);
    if (this.myKey && this.myKey.toLowerCase() !== ownerKey)
      throw new Error(
        "The connected account owner does not match the app identity; nothing was requested.",
      );
    const vault = findAccountVault(accountState.value, TARI_TOKEN);
    if (!vault)
      throw new Error(
        "The connected account has no native-TARI fee vault; nothing was requested.",
      );
    const vaultState = await this.indexer.substate(vault);
    if (!vaultState)
      throw new Error(
        "The connected account's native-TARI fee vault is not live; nothing was requested.",
      );
    if (decodeVaultResourceAddress(vaultState.value) !== TARI_TOKEN)
      throw new Error(
        "The connected account's fee vault is not the native-TARI vault; nothing was requested.",
      );
    return [
      { substate_id: account, version: null },
      { substate_id: vault, version: null },
    ];
  }

  private async submitWithFeeInputs(
    instructions: Instruction[],
    maxFeeMicroTari: number,
  ): Promise<{ result: unknown }> {
    const inputs = await this.resolveFeeInputs();
    return this.wallet.submit(instructions, inputs, maxFeeMicroTari);
  }

  async submitWalletInstructions(
    instructions: Instruction[],
    maxFeeMicroTari = 2_000_000,
  ): Promise<{ result: unknown }> {
    await this.guardWalletNetwork();
    dispatchTxStage({ stage: "wallet" });
    try {
      const out = await this.submitWithFeeInputs(instructions, maxFeeMicroTari);
      dispatchTxStage({ stage: "submitted" });
      return out;
    } catch (e) {
      dispatchTxStage({
        stage: "error",
        message: e instanceof Error ? e.message : String(e),
      });
      throw e;
    }
  }

  /**
   * Disconnect the wallet and clear every piece of state the
   * app derived from that account: the balance, the derived
   * public key (in memory and in storage), the record of
   * which account the identity belongs to, and the reminder
   * that reconnects it after a refresh. Watched addresses
   * and saved bids stay: they name chain records and this
   * browser's own bids, not the account's identity.
   */
  disconnect(): void {
    this.wallet.disconnect();
    this.balance = null;
    this.myKey = null;
    this.identityAccount = null;
    store.remove("mykey");
    this.forgetWallet();
  }

  /**
   * Derive the connected visitor's public key and TARI balance
   * from their account state on the indexer, so no flow ever has
   * to ask them to paste a key. The derived key belongs to the
   * connected account only: when the account context changes, the
   * previous account's key and balance are cleared first, and the
   * derived key always replaces whatever key was stored before.
   * Best effort: a failed read leaves the cleared state rather
   * than another account's identity, and never blocks the
   * connection.
   */
  async deriveIdentity(): Promise<void> {
    const account = this.wallet.account;
    if (!account) return;
    if (this.identityAccount !== account) {
      this.myKey = null;
      this.balance = null;
      this.identityAccount = account;
    }
    try {
      const sub = await this.indexer.substate(account);
      if (!sub) return;
      this.setMyKey(decodeAccountOwnerKey(sub.value));
      const vault = findAccountVault(sub.value, TARI_TOKEN);
      if (vault) {
        const vsub = await this.indexer.substate(vault);
        if (vsub) this.balance = decodeVaultBalance(vsub.value);
      }
    } catch {
      /* identity derivation is best effort */
    }
  }

  /**
   * The transaction ids a component's event feed already
   * holds, read with a short leash: this snapshot is what lets
   * the confirmation tell the action's own transaction apart
   * from everything before it, so a snapshot that cannot be
   * read in time means no confirmation is attempted at all.
   */
  private async snapshotTxIds(component: string): Promise<Set<string> | null> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const events = await Promise.race([
        this.indexer.events(component),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error("snapshot timed out")), 5000);
        }),
      ]);
      return new Set(events.map((e) => e.txId).filter(Boolean));
    } catch {
      return null;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  /**
   * The watched component's version before the action, read
   * with the same short leash. The confirmation uses it as a
   * second route: when the event feed has not indexed the
   * transaction yet, a version increase proves the action
   * landed. Null when it cannot be read in time, and the
   * version route is off.
   */
  private async snapshotVersion(component: string): Promise<number | null> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const sub = await Promise.race([
        this.indexer.substate(component),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error("snapshot timed out")), 5000);
        }),
      ]);
      return sub?.version ?? null;
    } catch {
      return null;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  /**
   * Submit one action and report how it actually ended. The
   * wallet's "submitted" is not an ending: the transaction can
   * still fail at finalization, and the failure is invisible
   * unless someone reads the finalize result. This snapshots
   * the target component's event feed, submits through the
   * wallet, then confirms the outcome from the indexer (see
   * finalize.ts). Actions with no component to watch (template
   * creates) come back unconfirmed; their callers confirm from
   * the created component itself.
   */
  async submitAction(
    instructions: Instruction[],
    maxFeeMicroTari = 2_000_000,
    confirmOpts?: ConfirmOptions,
  ): Promise<{ result: unknown; outcome: ActionOutcome }> {
    await this.guardWalletNetwork();
    const calls = calledMethods(instructions);
    if (this.wallet.account) calls.delete(this.wallet.account);
    const watch = [...calls.keys()][0];
    const before = watch ? await this.snapshotTxIds(watch) : null;
    const beforeVersion = watch ? await this.snapshotVersion(watch) : null;
    dispatchTxStage({ stage: "wallet" });
    let result: unknown;
    try {
      ({ result } = await this.submitWithFeeInputs(instructions, maxFeeMicroTari));
    } catch (e) {
      dispatchTxStage({
        stage: "error",
        message: e instanceof Error ? e.message : String(e),
      });
      throw e;
    }
    if (!watch || !before) {
      dispatchTxStage({ stage: "unconfirmed", txId: null });
      await this.deriveIdentity();
      return { result, outcome: UNCONFIRMED };
    }
    dispatchTxStage({ stage: "confirming" });
    const outcome = await confirmAction(this.indexer, watch, calls.get(watch)!, before, {
      ...confirmOpts,
      // The version before the submit, so the confirmation can
      // prove the action landed even when the event feed has
      // not indexed it yet.
      beforeVersion,
      // The derived key is what seals this account's
      // transactions, so it can tell the action's own
      // transaction apart from another actor's identical call.
      // When identity derivation failed it stays null and the
      // confirmation matches on component and method alone.
      signer: this.myKey,
    });
    if (outcome.kind === "confirmed") {
      dispatchTxStage({ stage: "confirmed", txId: outcome.txId });
    } else if (outcome.kind === "failed") {
      dispatchTxStage({
        stage: "failed",
        txId: outcome.txId,
        reason: outcome.reason,
      });
    } else {
      dispatchTxStage({ stage: "unconfirmed", txId: outcome.txId });
    }
    // The action moved money, even when it only paid a fee:
    // re-derive the balance so the wallet card never keeps
    // showing the figure from before the action.
    await this.deriveIdentity();
    return { result, outcome };
  }

  watched(): { circles: string[]; tenders: string[] } {
    try {
      const raw = JSON.parse(store.get("watched") ?? "{}") as {
        circles?: unknown;
        tenders?: unknown;
      };
      const list = (v: unknown): string[] =>
        Array.isArray(v)
          ? v.filter((a): a is string => typeof a === "string")
          : [];
      return { circles: list(raw.circles), tenders: list(raw.tenders) };
    } catch {
      return { circles: [], tenders: [] };
    }
  }

  watch(kind: "circles" | "tenders", address: string): void {
    const w = this.watched();
    const list = (w[kind] ??= []);
    if (!list.includes(address)) list.push(address);
    store.set("watched", JSON.stringify(w));
  }
}

/** µT to a TARI display string, trailing zeros trimmed. */
export function tari(ut: bigint): string {
  const whole = ut / 1_000_000n;
  const frac = (ut % 1_000_000n).toString().padStart(6, "0").replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : `${whole}`;
}

/** Parse a TARI amount typed by the user into µT. */
export function parseTari(s: string): bigint {
  const m = s.trim().match(/^(\d+)(?:\.(\d{1,6}))?$/);
  if (!m) throw new Error("Enter an amount like 5 or 0.25");
  return BigInt(m[1]) * 1_000_000n + BigInt((m[2] ?? "").padEnd(6, "0") || "0");
}

export function short(address: string): string {
  if (address.length <= 22) return address;
  return `${address.slice(0, 14)}…${address.slice(-6)}`;
}

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
}

/**
 * Headings open with a capital letter everywhere in the app,
 * whatever case the source string or the chain record carries.
 * The heading renderers pass their titles through here, so the
 * rule holds for data-driven headings too, not only literals.
 */
export function cap(text: string): string {
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : text;
}

/**
 * Remove every error banner under a screen's root. A screen
 * shows its latest error only: repeated failures replace the
 * banner instead of stacking copies of it down the page.
 */
export function clearErrors(root: HTMLElement): void {
  if (typeof root.querySelectorAll !== "function") return;
  root.querySelectorAll(".err").forEach((n) => n.remove());
}

export function errorBox(root: HTMLElement, err: unknown): void {
  clearErrors(root);
  const box = el("div", "err", err instanceof Error ? err.message : String(err));
  // An error is announced, not just shown: role alert makes a
  // screen reader speak it when it appears.
  setAria(box, "role", "alert");
  root.prepend(box);
}

/**
 * Set an ARIA attribute on a node. Guarded because the unit
 * tests render the screens against a small fake DOM that
 * implements only the surface the screens otherwise touch:
 * attribute setting must never become a render dependency.
 */
export function setAria(node: HTMLElement, name: string, value: string): void {
  if (typeof node.setAttribute === "function") node.setAttribute(name, value);
}

export function explorerLink(app: App, kind: "tx" | "component", id: string): HTMLAnchorElement {
  const a = el("a", undefined, short(id));
  a.href =
    kind === "tx" ? app.indexer.explorerTx(id) : app.indexer.explorerComponent(id);
  a.target = "_blank";
  a.rel = "noreferrer";
  a.className = "hash";
  return a;
}
