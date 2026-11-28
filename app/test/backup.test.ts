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
import { mergeBids, checkSaltMatchesCommitment, removeBid, savedBids } from "../src/screens/seller";

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
  // The true commitment for this price, salt, and identity,
  // recomputed from the template's byte layout. The import
  // integrity check verifies it, so a fake value here would
  // fail every round trip.
  commitment:
    "abd88063167a373dbabff9cd2e6bd9c4340012549aa55f9771e38bcce7be4f2e",
};
const BID2: BidBackupRecord = {
  ...BID,
  commitment:
    "85a38f25523b56fd9755a910c84bb51e3f018c166fc09656d03b0eb43dd05114",
  saltHex: "99".repeat(32),
};

describe("plain backup", () => {
  it("round trips the records exactly", async () => {
    expect(await parseBidsFile(serializeBids([BID, BID2]))).toEqual([
      BID,
      BID2,
    ]);
  });

  it("is not mistaken for the encrypted form", () => {
    expect(isEncryptedBackup(serializeBids([BID]))).toBe(false);
  });

  it("refuses a file that is not a backup", async () => {
    await expect(parseBidsFile("not json")).rejects.toThrow(
      /not an Asiri bids backup/,
    );
    await expect(
      parseBidsFile(JSON.stringify({ format: "other" })),
    ).rejects.toThrow(/not an Asiri bids backup/);
  });

  it("refuses a backup carrying a damaged bid, and imports nothing", async () => {
    const text = serializeBids([BID]).replace(BID.saltHex, "zz");
    await expect(parseBidsFile(text)).rejects.toThrow(/incomplete or damaged/);
  });

  it("refuses a file whose salt does not match its commitment", async () => {
    // One good bid and one with a swapped salt: the whole file
    // is refused, not just the bad bid.
    const tampered = { ...BID2, saltHex: BID.saltHex };
    const text = serializeBids([BID, tampered]);
    await expect(parseBidsFile(text)).rejects.toThrow(
      /does not match its own commitment/,
    );
  });

  it("refuses a file whose commitment was edited", async () => {
    const tampered = { ...BID, commitment: "00".repeat(32) };
    const text = serializeBids([tampered]);
    await expect(parseBidsFile(text)).rejects.toThrow(
      /does not match its own commitment/,
    );
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

  it("reports a tampered bid inside, not a generic open failure", async () => {
    // The file opens with the right passphrase, but the bid
    // inside does not match its own commitment. The user is
    // told about the bad bid, not told the passphrase was
    // wrong.
    const tampered = { ...BID, saltHex: BID2.saltHex };
    const text = await encryptBids([tampered], "correct horse");
    await expect(decryptBidsFile(text, "correct horse")).rejects.toThrow(
      /does not match its own commitment/,
    );
  });

  it("needs a passphrase to encrypt at all", async () => {
    await expect(encryptBids([BID], "")).rejects.toThrow(
      /Choose a passphrase first/,
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

describe("salt check before reveal", () => {
  it("passes a bid whose salt matches its commitment", async () => {
    await expect(checkSaltMatchesCommitment(BID)).resolves.toBeUndefined();
  });

  it("refuses a bid whose salt does not match, before any submit", async () => {
    const wrongSalt = { ...BID, saltHex: BID2.saltHex };
    await expect(checkSaltMatchesCommitment(wrongSalt)).rejects.toThrow(
      /That salt does not match this bid\. Nothing was submitted\. No fee was spent/,
    );
  });

  it("refuses a bid whose commitment was edited", async () => {
    const wrongCommitment = { ...BID, commitment: "00".repeat(32) };
    await expect(checkSaltMatchesCommitment(wrongCommitment)).rejects.toThrow(
      /That salt does not match this bid/,
    );
  });
});

describe("remove a saved bid", () => {
  it("removes one bid and leaves the others", () => {
    mergeBids([BID, BID2]);
    expect(savedBids()).toHaveLength(2);
    removeBid(BID.tender, BID.commitment);
    expect(savedBids()).toEqual([BID2]);
  });

  it("removing a bid that is not saved changes nothing", () => {
    mergeBids([BID]);
    removeBid(BID.tender, BID2.commitment);
    expect(savedBids()).toEqual([BID]);
  });
});
