// Bids backup: the plain round trip, malformed files refused,
// the encrypted round trip under a passphrase, a wrong
// passphrase failing, no salt readable in the encrypted form,
// and the import merge skipping bids already saved.
//
// The DOM here is only the localStorage stub: the backup
// module itself is pure, and the merge reads and writes
// through seller.ts's storage helpers.
import { beforeEach, describe, expect, it } from "vitest";
import {
  decryptBidsFile,
  encryptBids,
  isEncryptedBackup,
  parseBidsFile,
  serializeBids,
  type BidBackupRecord,
} from "../src/backup";
import { mergeBids, savedBids } from "../src/screens/seller";

const backing = new Map<string, string>();
beforeEach(() => {
  backing.clear();
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => backing.get(k) ?? null,
    setItem: (k: string, v: string) => void backing.set(k, v),
    removeItem: (k: string) => void backing.delete(k),
  };
});

const BID: BidBackupRecord = {
  tender: "component_" + "11".repeat(32),
  price: "1500000",
  saltHex: "ab".repeat(32),
  identity: "01".repeat(32),
  commitment: "cd".repeat(32),
};
const BID2: BidBackupRecord = {
  ...BID,
  commitment: "ef".repeat(32),
  saltHex: "99".repeat(32),
};

describe("plain backup", () => {
  it("round trips the records exactly", () => {
    expect(parseBidsFile(serializeBids([BID, BID2]))).toEqual([BID, BID2]);
  });

  it("is not mistaken for the encrypted form", () => {
    expect(isEncryptedBackup(serializeBids([BID]))).toBe(false);
  });

  it("refuses a file that is not a backup", () => {
    expect(() => parseBidsFile("not json")).toThrow(/not an asiri bids backup/);
    expect(() => parseBidsFile(JSON.stringify({ format: "other" }))).toThrow(
      /not an asiri bids backup/,
    );
  });

  it("refuses a backup carrying a damaged bid, and imports nothing", () => {
    const text = serializeBids([BID]).replace(BID.saltHex, "zz");
    expect(() => parseBidsFile(text)).toThrow(/incomplete or damaged/);
  });
});

describe("encrypted backup", () => {
  it("round trips under its passphrase", async () => {
    const text = await encryptBids([BID, BID2], "correct horse");
    expect(isEncryptedBackup(text)).toBe(true);
    expect(await decryptBidsFile(text, "correct horse")).toEqual([BID, BID2]);
  });

  it("fails under a wrong passphrase", async () => {
    const text = await encryptBids([BID], "correct horse");
    await expect(decryptBidsFile(text, "wrong horse")).rejects.toThrow(
      /could not be opened/,
    );
  });

  it("fails under an empty passphrase, asking for one", async () => {
    const text = await encryptBids([BID], "correct horse");
    await expect(decryptBidsFile(text, "")).rejects.toThrow(/passphrase/);
  });

  it("refuses envelopes outside the exporter's own parameters", async () => {
    const good = await encryptBids([BID], "correct horse");
    const doc = JSON.parse(good) as {
      kdf: { iterations: number; salt: string };
      cipher: { iv: string };
    };
    const weak = JSON.stringify({
      ...doc,
      kdf: { ...doc.kdf, iterations: 1 },
    });
    await expect(decryptBidsFile(weak, "correct horse")).rejects.toThrow(
      /could not be opened/,
    );
    const huge = JSON.stringify({
      ...doc,
      kdf: { ...doc.kdf, iterations: 1_000_000_000_000 },
    });
    await expect(decryptBidsFile(huge, "correct horse")).rejects.toThrow(
      /could not be opened/,
    );
    const shortSalt = JSON.stringify({
      ...doc,
      kdf: { ...doc.kdf, salt: btoa("\x01\x02\x03\x04") },
    });
    await expect(decryptBidsFile(shortSalt, "correct horse")).rejects.toThrow(
      /could not be opened/,
    );
    const shortIv = JSON.stringify({
      ...doc,
      cipher: { ...doc.cipher, iv: btoa("\x01") },
    });
    await expect(decryptBidsFile(shortIv, "correct horse")).rejects.toThrow(
      /could not be opened/,
    );
  });

  it("carries no readable salt, price, or commitment", async () => {
    const text = await encryptBids([BID], "correct horse");
    expect(text).not.toContain(BID.saltHex);
    expect(text).not.toContain(BID.commitment);
    expect(text).not.toContain(BID.price);
  });

  it("needs a passphrase to encrypt at all", async () => {
    await expect(encryptBids([BID], "")).rejects.toThrow(
      /choose a passphrase first/,
    );
  });
});

describe("import merge", () => {
  it("adds new bids and skips ones already saved", () => {
    expect(mergeBids([BID])).toBe(1);
    expect(mergeBids([BID, BID2])).toBe(1);
    expect(mergeBids([BID, BID2])).toBe(0);
    expect(savedBids()).toHaveLength(2);
  });
});
