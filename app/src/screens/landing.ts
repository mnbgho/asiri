// The landing page, built to the approved design in
// Section 15A of the build plan: a three part pill nav, the
// hero with its seal, the live tender feed, the A-S-I-R-I
// letter grid, the seven steps with the try-to-rig-it panel,
// the questions, the manifesto with its stat card, and the
// blue footer. Every claim here stays inside what the chain
// can prove, and every figure is read from the chain or
// recomputed from its record: the feed reads the featured
// circle live, the proof strip in the hero recomputes its
// figures from the mainnet record data, the stat card's
// number comes from the zero-extraction ledger data, and
// the rig panel's answers quote the mainnet attack tender's
// record: the chain's own rejections, with the transactions
// that carry them.
import { App, cap, el, setAria } from "../app";
import {
  MAINNET_ATTACK_OVERRIDE,
  MAINNET_ATTACK_RECORD,
  MAINNET_ATTACK_SEALED_BID,
  MAINNET_ATTACKS,
  type MainnetAttack,
} from "../mainnet-attack-data";
import {
  MAINNET_TENDER_RECORDS,
  type MainnetTenderRecord,
} from "../mainnet-results-data";
import { LEDGER } from "../proof-data";
import { decodeCircleState, decodeTenderState } from "../state";
import { BUILDER_RUN_LABEL, money } from "./common";

export type RigKind = "peek" | "rules" | "friend" | "money";

export interface RigAnswer {
  call: string;
  rejected: string[];
  source: string;
}

function attackByKey(key: string): MainnetAttack {
  const a = MAINNET_ATTACKS.find((x) => x.key === key);
  if (!a) throw new Error(`attack missing: ${key}`);
  return a;
}

export interface MainnetProofFacts {
  tenders: number;
  attacksRefused: number;
  // The check count both verifiers share, present only
  // when each verifier passed every mainnet record in full
  // with identical counts. If the record ever stops
  // supporting that, the strip leaves the figure out
  // rather than printing one the record does not back.
  checks: { passed: number; total: number } | null;
}

// The hero proof strip's figures, recomputed from the
// mainnet record data on every render: the season records
// plus the attack tender's record, and the attack list
// itself. Nothing here is typed by hand, so the strip
// cannot drift from the record it points at.
export function mainnetProofFacts(): MainnetProofFacts {
  const records: MainnetTenderRecord[] = [
    ...MAINNET_TENDER_RECORDS,
    MAINNET_ATTACK_RECORD,
  ];
  const sum = (pick: (r: MainnetTenderRecord) => number) =>
    records.reduce((s, r) => s + pick(r), 0);
  const total = sum((r) => r.standaloneTotal);
  const passed = sum((r) => r.standalonePass);
  const appTotal = sum((r) => r.appTotal);
  const appPassed = sum((r) => r.appPass);
  const checks =
    total > 0 && passed === total && appTotal === total && appPassed === total
      ? { passed, total }
      : null;
  return {
    tenders: records.length,
    attacksRefused: MAINNET_ATTACKS.length,
    checks,
  };
}

// The four attacks, answered from the live mainnet attack
// record. Peeking is impossible by construction: the
// template has no method for it, which is a fact about the
// published template, stated as such, and the attack
// tender's unrevealed bid now shows the construction
// holding on mainnet. The other three were attempted on
// mainnet, against the attack tender inside its own
// windows, and the answers quote the chain's own
// rejections and the transactions that carry them, from
// mainnet-attack-data.ts. The falsification cards still
// sit on the results page, answering the different
// question of what happens when a record is tampered with
// after the fact.
export function rigAnswer(kind: RigKind): RigAnswer {
  switch (kind) {
    case "peek": {
      const s = MAINNET_ATTACK_SEALED_BID;
      return {
        call: "> call: read the price inside a sealed commitment",
        rejected: [
          "rejected · there is no method to call. a commitment is a hash of the price, a salt only the seller holds, and the seller's payment identity. the only opening is the owner's own reveal, inside the reveal window.",
          `observed on mainnet · on the attack tender, ${s.by}'s ${money(BigInt(s.priceMicro))} bid was committed and never revealed. the tender settled around it and both verifiers passed it in full, and its price never entered the record. the bid stayed sealed, and its bond forfeited on the recorded split.`,
        ],
        source: "impossible by construction, and observed live on mainnet: the attack tender's unrevealed bid ended the tender still sealed. its record is on the results page.",
      };
    }
    case "rules": {
      const a = attackByKey("update-rules");
      return {
        call: "> call: update_rules, to set the budget cap again after the tender has locked",
        rejected: [
          "rejected · the rules are hashed and frozen at lock and fund, and there is no setter on a locked tender. both verifiers recompute the rules hash from the record on every run, so an edited record fails its first check.",
          `rejected · ${a.rejection}. the chain's own words on transaction ${a.tx}: the operator's update_rules call after the lock, refused on mainnet.`,
        ],
        source: "impossible by construction, and refused live on mainnet: the attack tender's record is on the results page.",
      };
    }
    case "friend": {
      const zero = attackByKey("override-zero-rationale");
      const unrevealed = attackByKey("override-unrevealed");
      const o = MAINNET_ATTACK_OVERRIDE;
      return {
        call: "> call: override the award to a friendlier seller",
        rejected: [
          "the one legal path is an override: a published rationale whose hash sits in the record, and approver signatures at the circle's threshold. below that bar, no override stands and the computed award is the one that settles.",
          `rejected · ${zero.rejection}. transaction ${zero.tx}: an override proposal with an all-zero rationale hash, refused on mainnet.`,
          `rejected · ${unrevealed.rejection}. transaction ${unrevealed.tx}: an override proposal choosing a bid nobody revealed, refused on mainnet.`,
          `not enough signatures: an override for ${o.chosenAccount} was proposed (transaction ${o.proposeTx}) and signed by one approver (transaction ${o.signTx}), below the threshold of ${o.threshold}. a live read straight after showed the award unchanged, still ${o.awardWinner}, with no override recorded.`,
          "and there is no award method to call instead: the tender template's method list has none. the winner is computed inside close_reveal.",
        ],
        source: "live on mainnet: the attack tender's override attempts are on the results page.",
      };
    }
    case "money": {
      const loser = attackByKey("claim-payment-loser");
      const bond = attackByKey("claim-bond-nonbidder");
      const twice = attackByKey("claim-payment-twice");
      const refund = attackByKey("release-refund-direct");
      return {
        call: "> call: take the escrow out of the tender",
        rejected: [
          "escrow leaves only through the template's own settlement paths: paying the winner after delivery, resolving a dispute, or refunding the circle. there is no withdrawal method to call.",
          `rejected · ${loser.rejection}. transaction ${loser.tx}: the loser's claim on the payment, refused on mainnet.`,
          `rejected · ${bond.rejection}. transaction ${bond.tx}: a bond claim from an account that never bid, refused on mainnet.`,
          `rejected · ${twice.rejection}. transaction ${twice.tx}: the winner's second claim on the payment, refused on mainnet.`,
          `rejected · ${refund.rejection}. transaction ${refund.tx}: a direct release_refund call on the tender itself, refused by the component's own access rules.`,
        ],
        source: "live on mainnet: the attack tender's claim attempts are on the results page.",
      };
    }
  }
}

const RIG_BUTTONS: [RigKind, string][] = [
  ["peek", "peek at the sealed bids"],
  ["rules", "change the budget after bids"],
  ["friend", "award my friend instead"],
  ["money", "move the escrow to my wallet"],
];

function sealArt(): HTMLElement {
  const art = el("div", "seal");
  setAria(art, "role", "img");
  setAria(
    art,
    "aria-label",
    "a sealed tender, drawn as concentric seals around a lock",
  );
  const ring1 = el("div", "seal-ring seal-ring-outer");
  const ring2 = el("div", "seal-ring seal-ring-inner");
  const shackle = el("div", "seal-shackle");
  const lock = el("div", "seal-lock");
  lock.append(el("span", "seal-keyhole"));
  art.append(ring1, ring2, shackle, lock);
  for (const [cls, text] of [
    ["seal-chip chip-lt", "rules locked"],
    ["seal-chip chip-rt", "budget escrowed"],
    ["seal-chip chip-lb", "bids sealed as hashes"],
    ["seal-chip chip-rb", "opened only by their owners"],
  ] as const) {
    art.append(el("span", cls, text));
  }
  return art;
}

export async function renderLanding(
  app: App,
  root: HTMLElement,
  go: (hash: string) => void,
): Promise<void> {
  // Nav, three parts: the network pill on the left, the
  // centred link pill, the sign in pill on the right. The
  // network pill names the network the app is actually
  // reading, from its own config. On a phone the nav is
  // ASIRI on the left and a hamburger on the right, and the
  // three parts drop down from it as one panel: the parts
  // live inside .lp-menu, which vanishes (display: contents)
  // on desktop so they lay out exactly as before.
  const nav = el("nav", "lp-nav");
  const logo = el("a", "lp-logo", "ASIRI");
  logo.href = "#/";
  const verpill = el("span", "verpill");
  verpill.append(
    el("span", "vdot"),
    document.createTextNode(app.indexer.cfg.label),
  );
  const links = el("div", "pillbar");
  for (const [label, hash] of [
    ["Tenders", "#feed"],
    ["How it works", "#how"],
    ["Questions", "#faq"],
    ["The proof", "#proof"],
  ] as const) {
    const a = el("a", undefined, label);
    a.href = hash;
    links.append(a);
  }
  const signin = el("button", "signin");
  const disc = el("span", "disc", "a");
  signin.append(
    document.createTextNode("open the app"),
    disc,
    el("span", "wordmark", "asiri"),
  );
  signin.addEventListener("click", () => go("#/app/overview"));
  const menu = el("div", "lp-menu");
  menu.append(verpill, links, signin);
  const burger = el("button", "lp-burger burger");
  setAria(burger, "aria-label", "open the menu");
  setAria(burger, "aria-expanded", "false");
  burger.append(el("span"), el("span"), el("span"));
  const setMenuOpen = (open: boolean): void => {
    // classList.toggle exists in a real browser; the unit
    // test fake DOM implements add and contains only, so the
    // class string is edited directly and works in both.
    const parts = nav.className.split(/\s+/).filter(Boolean);
    const has = parts.includes("menu-open");
    if (open && !has) nav.className = [...parts, "menu-open"].join(" ");
    if (!open && has)
      nav.className = parts.filter((c) => c !== "menu-open").join(" ");
    setAria(burger, "aria-expanded", open ? "true" : "false");
    setAria(burger, "aria-label", open ? "close the menu" : "open the menu");
  };
  burger.addEventListener("click", () => {
    setMenuOpen(!nav.className.split(/\s+/).includes("menu-open"));
  });
  // Tapping a menu link closes the menu at once: the landing
  // re-renders on navigation anyway, and the immediate close
  // reads faster than waiting for it.
  menu.addEventListener("click", (e) => {
    const target = e.target as HTMLElement | null;
    if (target && typeof target.closest === "function" && target.closest("a, button")) {
      setMenuOpen(false);
    }
  });
  nav.append(logo, menu, burger);
  root.append(nav);

  // Hero, centred at 896px over the dot grid and the glow.
  const hero = el("section", "hero");
  const heroIn = el("div", "hero-in");
  heroIn.append(el("span", "badge", "sealed tenders for buying circles"));
  const h1 = el("h1");
  h1.append(
    document.createTextNode("Everyone says their tender is fair. asiri shows you "),
    el("span", "b", "the proof."),
  );
  heroIn.append(
    h1,
    el(
      "p",
      "sub",
      "buying circles lock the rules and the budget before bidding opens. sellers bid in secret. the template awards the lowest valid revealed price, and even the buyer cannot peek.",
    ),
  );
  const cta = el("div", "cta");
  const launch = el("button", "btn", "launch the app");
  launch.addEventListener("click", () => go("#/app/overview"));
  const verify = el("button", "btn btn-white", "verify a tender");
  verify.addEventListener("click", () => go("#/app/verify"));
  cta.append(launch, verify);
  // The proof strip: the mainnet record as a row of facts
  // in the hero itself, so the strongest facts are on the
  // first screen. Every figure comes from
  // mainnetProofFacts(), recomputed from the record data.
  const facts = mainnetProofFacts();
  const strip = el("div", "proofstrip");
  const factCell = (n: string, cap: string) => {
    const c = el("div", "ps-cell");
    c.append(el("span", "n", n), el("span", "cap", cap));
    return c;
  };
  strip.append(factCell(String(facts.tenders), "tenders run on mainnet"));
  if (facts.checks) {
    strip.append(
      factCell(
        `${facts.checks.passed} of ${facts.checks.total}`,
        "checks passed by two verifiers",
      ),
    );
  }
  strip.append(
    factCell(String(facts.attacksRefused), "attacks refused by the chain"),
  );
  const recordLink = el("a", "ps-link", "read the mainnet record →");
  recordLink.href = "#/app/results";
  strip.append(recordLink);
  heroIn.append(
    cta,
    el("p", "small", "+ sealed bids + locked rules + public proof"),
    strip,
    sealArt(),
  );
  hero.append(heroIn);
  root.append(hero);

  // The live feed of the featured circle's tenders.
  const feed = el("section", "blk");
  feed.id = "feed";
  const fh = el("div", "blk-head");
  fh.append(
    el("h2", undefined, "Tenders from the featured circle"),
    el("p", undefined, `read straight from the chain · ${BUILDER_RUN_LABEL}`),
  );
  feed.append(fh);
  const feedBody = el("div");
  feedBody.append(el("div", "empty", "reading the network…"));
  feed.append(feedBody);
  const feedClose = el("div", "center-row");
  const openApp = el("button", "btn", "open the app");
  openApp.addEventListener("click", () => go("#/app/overview"));
  feedClose.append(openApp);
  feed.append(feedClose);
  root.append(feed);

  // The letter grid: A-S-I-R-I, one mechanism per letter.
  const letters = el("section", "letters");
  const lgrid = el("div", "lgrid");
  for (const [letter, head, cap] of [
    [
      "A",
      "award by template",
      "no person picks the winner. the template computes it.",
    ],
    [
      "S",
      "sealed bids",
      "a bid is a hash and a bond. the price goes nowhere.",
    ],
    [
      "I",
      "immutable rules",
      "locked before bidding opens. edited by nobody, ever.",
    ],
    [
      "R",
      "reveal to win",
      "only opened bids can win. a bid nobody opens cannot win.",
    ],
    [
      "I",
      "inspect everything",
      "every tender record re-checks in the open, wallet or not.",
    ],
  ] as const) {
    const cell = el("div", "lcell");
    const capEl = el("span", "cap");
    capEl.append(el("b", undefined, head), document.createTextNode(cap));
    cell.append(el("span", "arr", "→"), el("span", "L", letter), capEl);
    lgrid.append(cell);
  }
  letters.append(lgrid);
  root.append(letters);

  // How it works: the seven steps of a tender's run, in the
  // order they happen, then the rig panel. Each step links to
  // the screen where that step is done or proven, so the
  // strip doubles as a map of the app.
  const how = el("section", "blk");
  how.id = "how";
  const hh = el("div", "blk-head");
  hh.append(
    el("h2", undefined, "How it works"),
    el("p", undefined, "seven steps, in the order they run. the money sits in the template from the lock to the payment."),
  );
  how.append(hh);
  const steps = el("div", "lsteps");
  const stepData: [string, string, string, string, string][] = [
    [
      "1",
      "form a circle",
      "the buyers form a circle and name its approvers: the members whose signatures confirm delivery, settle disputes, and can override an award.",
      "start a circle",
      "#/app/create",
    ],
    [
      "2",
      "lock the rules and the budget",
      "the circle publishes what it is buying, the budget cap, the bond, and the windows. the template hashes the rules and freezes them, and the full budget moves into the tender's vault in the same step. a tender cannot award money it does not hold.",
      "create the tender",
      "#/app/create",
    ],
    [
      "3",
      "sellers commit sealed bids",
      "each seller posts the bond and a hash of their price. the chain records that a bid exists, and nothing of the price: it is never transmitted with the bid, and nobody can read it.",
      "bid on a tender",
      "#/app/seller",
    ],
    [
      "4",
      "bids open only on reveal",
      "when the reveal window opens, each seller opens their own bid. a bid nobody opens stays sealed forever, and it cannot win.",
      "reveal a bid",
      "#/app/seller",
    ],
    [
      "5",
      "the lowest revealed bid wins",
      "the template computes the award itself: the lowest valid revealed price, ties to the earliest reveal. no person picks the winner.",
      "see the awards proven",
      "#/app/results",
    ],
    [
      "6",
      "delivery is confirmed",
      "the winner delivers what was bought, and the circle's approvers confirm the delivery at their threshold. no confirmation, no payment.",
      "the approvals screen",
      "#/app/approvals",
    ],
    [
      "7",
      "then the winner is paid",
      "the template pays the winner from the escrow and returns the unspent budget to the circle. the whole run stays on the record, and two verifiers recompute it.",
      "read the proof",
      "#/app/results",
    ],
  ];
  for (const [n, title, text, linkLabel, linkHash] of stepData) {
    const s = el("div", "lstep");
    const body = el("div");
    body.append(el("h3", undefined, cap(title)), el("p", undefined, text));
    const a = el("a", "step-link", `${linkLabel} →`);
    a.href = linkHash;
    body.append(a);
    s.append(el("span", "n", n), body);
    steps.append(s);
  }
  how.append(steps);

  const rig = el("div", "riglab");
  rig.id = "rig";
  const rigLeft = el("div");
  rigLeft.append(
    el("h3", undefined, "Do not take our word for it. Try to rig it."),
    el(
      "p",
      undefined,
      "the four ways a tender gets rigged, each one tried against a real tender on mainnet. peeking cannot even be called: the template has no method for it, and on the attack tender a bid that was never revealed stayed sealed to the end, unable to win. the other three were called inside the tender's own windows, and the chain refused every one. the answers quote the record itself: the refused transactions by id, and the sealed bid that never opened.",
    ),
  );
  const rigBtns = el("div", "rig-btns");
  const console_ = el("div", "rig-console");
  setAria(console_, "aria-live", "polite");
  const consoleHead = () =>
    el("div", "cm", "asiri template · mainnet attack record");
  const fillConsole = (a: RigAnswer): void => {
    console_.replaceChildren(
      consoleHead(),
      el("div", undefined, a.call),
      ...a.rejected.map((line) => el("div", "rj", line)),
      el("div", "ok", a.source),
      el("div", "ok", "the tender is untouched."),
    );
  };
  // The console opens on the first attack's answer, not empty:
  // a visitor who never clicks a button still sees what the
  // chain does to a rig attempt.
  fillConsole(rigAnswer("peek"));
  for (const [kind, label] of RIG_BUTTONS) {
    const b = el("button", undefined, label);
    b.addEventListener("click", () => fillConsole(rigAnswer(kind)));
    rigBtns.append(b);
  }
  rigLeft.append(rigBtns);
  rig.append(rigLeft, console_);
  how.append(rig);
  root.append(how);

  // Questions, two columns: links on the left, the
  // accordion on the right.
  const faq = el("section", "faq");
  faq.id = "faq";
  const faqLeft = el("div");
  faqLeft.append(el("h2", undefined, "Some questions, answered"));
  const flinks = el("div", "flinks");
  for (const [label, hash] of [
    ["run the verifier", "#/app/verify"],
    ["read the receipts", "#/app/results"],
    ["see the falsification cards", "#/app/results"],
  ] as const) {
    const a = el("a", undefined, `${label} `);
    a.href = hash;
    a.append(el("span", "arr", "→"));
    flinks.append(a);
  }
  faqLeft.append(flinks);
  faq.append(faqLeft);
  const acc = el("div", "acc");
  const qa: [string, string][] = [
    [
      "who is asiri for?",
      "groups that already buy together: shop networks restocking the same goods, cooperatives buying inputs, restaurant groups, ngo field offices, community treasuries. if your group pools money to buy, the tender is where it leaks.",
    ],
    [
      "can the buyer see the bids early?",
      "no. a bid on chain is a hash of the price, a salt only the seller holds, and the seller's payment identity. there is no method that returns a price, no admin key, and no operator in the settlement path who could be asked, bribed, or hacked for one.",
    ],
    [
      "what exactly is proven?",
      "that the winner is the lowest valid revealed price under rules locked before bidding, that every reveal matches a commitment posted inside the window, and that the money moved only on delivery confirmation, a signed public override, a dispute resolution, or a refund. what is never claimed: that no lower bid existed among sellers who stayed silent. silence cannot win, which is why the lowest bidder reveals.",
    ],
    [
      "what if the circle wants a different winner?",
      "it can, in the open. an override names another revealed bid, publishes the full reason, whose hash sits in the tender record, and collects approver signatures at the circle's threshold. below that bar, no override stands and the computed award is the one that settles.",
    ],
    [
      "what does a seller risk?",
      "a bond, posted with the bid. reveal, win or lose, and it returns in full. stay silent while the tender awards and the bond is split, half to the circle, half locked forever. if the tender instead expires with no award, an unrevealed bond comes back whole. the seller also keeps the salt private: lose it and the bid can never be revealed.",
    ],
    [
      "do i need a wallet to check a tender?",
      "no. every tender record is public and the verifier runs in the browser against the public indexer. a wallet, sapient by default, is needed only to act: bid, reveal, approve, confirm.",
    ],
    [
      "what does asiri charge?",
      `nothing. there is no platform fee, no asiri treasury, and no operator account in the template. each caller pays the network fee for their own transaction, shown by their wallet before they approve it. the ledger on the results page recomputes what the operator took across all ${LEDGER.rows.length} evidence tenders: zero.`,
    ],
  ];
  for (const [q, a] of qa) {
    const d = el("details");
    const s = el("summary", undefined, cap(q));
    s.append(el("span", "pl", "+"));
    d.append(s, el("p", undefined, a));
    acc.append(d);
  }
  faq.append(acc);
  root.append(faq);

  // The manifesto row: the stat card and the line. The
  // card's number is the ledger's own operator total,
  // rendered from the ledger data, not typed here.
  const proof = el("section", "manifesto");
  proof.id = "proof";
  const stat = el("div", "statcard");
  stat.append(
    el("div", "n", money(BigInt(LEDGER.totals.operatorPaid))),
    el(
      "p",
      undefined,
      `taken by the operator across all ${LEDGER.rows.length} evidence tenders. the ledger is recomputed from every recorded outflow destination, and it closes to the microtari.`,
    ),
  );
  const mwrap = el("div");
  mwrap.append(
    el(
      "p",
      "mline",
      "do not take our word for it. every tender carries its whole record on chain, and two independent verifiers recompute the money from that record.",
    ),
  );
  const mcta = el("div", "cta");
  const receipts = el("button", "btn", "see the receipts");
  receipts.addEventListener("click", () => go("#/app/results"));
  const runIt = el("button", "btn btn-white", "run the verifier");
  runIt.addEventListener("click", () => go("#/app/verify"));
  mcta.append(receipts, runIt);
  mwrap.append(mcta);
  proof.append(stat, mwrap);
  root.append(proof);

  // The blue footer: brand, link columns, credits, seals.
  // There is no newsletter input: no mailing list exists,
  // and a form that goes nowhere would be a fake surface.
  const foot = el("footer", "lp-foot");
  const footIn = el("div", "foot-in");
  const footGrid = el("div", "foot-grid");
  const brand = el("div");
  const footBrand = el("div", "foot-brand");
  footBrand.append(
    el("span", "disc disc-light", "a"),
    el("span", "wordmark", "asiri"),
  );
  brand.append(
    footBrand,
    el(
      "p",
      "foot-intro",
      "asiri means a secret that stays kept. sealed tenders for buying circles, on tari ootle, where the rules lock before bidding and prices nobody reveals never open.",
    ),
    el(
      "p",
      "foot-note",
      `you are viewing the ${app.indexer.cfg.label}. reads come from the public indexer, writes go through your own wallet. the app holds no keys and keeps no server.`,
    ),
  );
  footGrid.append(brand);
  const footCols = el("div", "foot-cols");
  for (const [title, linksList] of [
    [
      "Product",
      [
        ["Tenders", "#feed"],
        ["How it works", "#how"],
        ["Questions", "#faq"],
        ["The proof", "#proof"],
      ],
    ],
    [
      "Verify",
      [
        ["Verification results", "#/app/results"],
        ["Falsification cards", "#/app/results"],
        ["Run the verifier", "#/app/verify"],
        ["Help", "#/app/help"],
      ],
    ],
    [
      "The app",
      [
        ["Circles and tenders", "#/app/overview"],
        ["Start a circle or tender", "#/app/create"],
        ["Bid and reveal", "#/app/seller"],
        ["Approvals", "#/app/approvals"],
      ],
    ],
  ] as const) {
    const col = el("div");
    col.append(el("div", "foot-col-title", title));
    for (const [label, hash] of linksList) {
      const a = el("a", undefined, label);
      a.href = hash;
      col.append(a);
    }
    footCols.append(col);
  }
  footGrid.append(footCols);
  footIn.append(footGrid);
  const credits = el("div", "foot-credits");
  credits.append(
    el("span", undefined, "asiri, a sealed tender protocol."),
    el(
      "span",
      "foot-credits-right",
      "every figure on this page is read from the chain or recomputed from its record.",
    ),
  );
  footIn.append(credits);
  const seals = el("div", "foot-seals");
  for (const word of ["award", "sealed", "rules", "reveal", "inspect"]) {
    seals.append(el("span", undefined, word));
  }
  footIn.append(seals);
  foot.append(footIn);
  root.append(foot);

  // live feed. The "reading the network…" placeholder stays on
  // screen until the reads finish: clearing it up front left the
  // section blank for as long as a slow indexer took, which reads
  // as a broken page. Rows are gathered first and swapped in
  // whole, and the empty note replaces the placeholder only when
  // there is nothing to show.
  void (async () => {
    const featured = app.indexer.cfg.featuredCircle;
    const rows: HTMLElement[] = [];
    if (featured) {
      try {
        const sub = await app.indexer.substate(featured);
        if (sub) {
          const circle = decodeCircleState(sub.value);
          for (const tAddr of circle.tenders) {
            try {
              const tsub = await app.indexer.substate(tAddr);
              if (!tsub) continue;
              const t = decodeTenderState(tsub.value);
              const row = el("button", "frow");
              const av = el("span", "av", circle.name.slice(0, 2).toLowerCase());
              const name = el("span", undefined, t.circleName || "sealed tender");
              const pill = el("span", "pill pill-tint", t.state.toLowerCase());
              const meta = el("span", "tm");
              meta.append(
                el("b", undefined, money(t.rules.budgetCap)),
                document.createTextNode(`${t.commitments.length} bids committed`),
              );
              row.append(av, name, pill, meta);
              row.addEventListener("click", () => go(`#/app/tender/${tAddr}`));
              rows.push(row);
            } catch {
              /* skip unreadable tenders */
            }
          }
        }
      } catch {
        /* the feed falls through to its empty note */
      }
    }
    if (rows.length) {
      feedBody.replaceChildren(...rows);
    } else {
      feedBody.replaceChildren(
        el(
          "div",
          "empty",
          app.network === "mainnet"
            ? "no tenders to show on mainnet yet. switch to the esmeralda testnet inside the app to watch the trial tenders run."
            : "no tenders to show yet. the featured circle's tenders will appear here as they are created.",
        ),
      );
    }
  })();
}
