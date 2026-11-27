// Account state decoders, checked against a live recording: the
// operator account substate read from the Esmeralda indexer on
// 2026-11-17. Its owner key and its TARI vault are known from the
// wallet daemon, so the decoders must return exactly those.
import { describe, expect, it } from "vitest";
import { App } from "../src/app";
import { decode, hexToBytes } from "../src/cbor";
import {
  decodeAccountOwnerKey,
  decodeVaultResourceAddress,
  findAccountVault,
} from "../src/state";

const ACCOUNT_SUBSTATE =
  "8200818285582000000000000000000000000000000000000000000000000000000000000000008202815820a47e904bc63ebb9a22da57b4f59ad2cf1c299e972c0180de3235d577b4a64308" +
  "82a568617070726f76616c8200806762616c616e6365820080676465706f7369748200806c6765745f62616c616e6365738200807177697468647261775f617070726f766564820080820180417c8200808182a1d8835820" +
  "0101010101010101010101010101010101010101010101010101010101010101d88458207c66628b5547283e5cbe82d155c515972a3c2d13d2251d317bbb84aed7a9a344a0";

const OPERATOR_KEY =
  "a47e904bc63ebb9a22da57b4f59ad2cf1c299e972c0180de3235d577b4a64308";
const TARI_TOKEN =
  "resource_0101010101010101010101010101010101010101010101010101010101010101";
const OPERATOR_VAULT =
  "vault_7c66628b5547283e5cbe82d155c515972a3c2d13d2251d317bbb84aed7a9a344";

describe("account state decoders", () => {
  const root = decode(hexToBytes(ACCOUNT_SUBSTATE));

  it("reads the owner public key out of the account state", () => {
    expect(decodeAccountOwnerKey(root)).toBe(OPERATOR_KEY);
  });

  it("finds the account's TARI vault", () => {
    expect(findAccountVault(root, TARI_TOKEN)).toBe(OPERATOR_VAULT);
  });

  it("returns null for a resource the account does not hold", () => {
    expect(findAccountVault(root, "resource_" + "02".repeat(32))).toBeNull();
  });
});

// The operator account's TARI vault substate, recorded in the
// same read as the account substate above; its balance at
// recording time was 15,706,773 microtari.
const ACCOUNT =
  "component_7cfef3fc07a70824c2884ef79ddc4590d5a37221d3f010c3213edc7ec8dcb22c";
const VAULT_SUBSTATE =
  "82028182820383d883582001010101010101010101010101010101010101010101010101010101010101011a00efaa950000";

describe("vault state decoder", () => {
  it("reads the resource address carried by a vault", () => {
    expect(decodeVaultResourceAddress(decode(hexToBytes(VAULT_SUBSTATE)))).toBe(
      TARI_TOKEN,
    );
  });
});

function stubIndexer(app: App, fail = false): void {
  const accountRoot = decode(hexToBytes(ACCOUNT_SUBSTATE));
  const vaultRoot = decode(hexToBytes(VAULT_SUBSTATE));
  app.indexer.substate = async (id: string) => {
    if (fail) throw new Error("indexer down");
    if (id === ACCOUNT) return { version: 0, value: accountRoot };
    if (id === OPERATOR_VAULT) return { version: 0, value: vaultRoot };
    return null;
  };
}

describe("identity derivation", () => {
  it("replaces a stored key with the connected account's key", async () => {
    const app = new App();
    app.setMyKey("ff".repeat(32));
    app.wallet.account = ACCOUNT;
    stubIndexer(app);
    await app.deriveIdentity();
    expect(app.myKey).toBe(OPERATOR_KEY);
    expect(app.balance).toBe(15706773n);
  });

  it("clears the previous identity when the account changes and the read fails", async () => {
    const app = new App();
    app.wallet.account = ACCOUNT;
    stubIndexer(app);
    await app.deriveIdentity();
    expect(app.myKey).toBe(OPERATOR_KEY);
    app.wallet.account = "component_" + "99".repeat(32);
    stubIndexer(app, true);
    await app.deriveIdentity();
    expect(app.myKey).toBeNull();
    expect(app.balance).toBeNull();
  });
});
