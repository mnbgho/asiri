// The landing page, built to the approved design in
// Section 15A of the build plan: a three part pill nav, the
// hero with its seal, the live tender feed, the A-S-I-R-I
// letter grid, the five steps with the try-to-rig-it panel,
// the questions, the manifesto with its stat card, and the
// blue footer. Every claim here stays inside what the chain
// can prove, and every figure is read from the chain or
// recomputed from its record: the feed reads the featured
// circle live, the stat card's number comes from the
// zero-extraction ledger data, and the rig panel's two
// record attacks quote the falsification cards' own
// rejection rows.
import { App, el, setAria } from "../app";
import { FALSIFICATION_CARDS } from "../falsification-data";
import { LEDGER } from "../proof-data";
import { decodeCircleState, decodeTenderState } from "../state";
import { BUILDER_RUN_LABEL, money } from "./common";

export type RigKind = "peek" | "rules" | "friend" | "money";

export interface RigAnswer {
  call: string;
  rejected: string[];
  source: string;
}

function cardRejection(
  cardId: string,
  pick: number,
): { check: string; detail: string; title: string } {
  const card = FALSIFICATION_CARDS.find((c) => c.id === cardId);
  if (!card) throw new Error(`falsification card missing: ${cardId}`);
  const r = card.rejections.standalone[pick];
  if (!r) throw new Error(`falsification rejection missing: ${cardId}`);
  return { check: r.check, detail: r.detail, title: card.title };
}

// The four attacks, answered from the record. Two are
// impossible by construction: the template has no method
// for them, which is a fact about the published template,
// stated as such. Two are lies about a real tender's
// record, answered with the exact check both verifiers
// failed the tampered copy at, quoted from the
// falsification cards. Nothing here claims an attempt was
// made on chain: the panel shows the attempt and why it
// cannot stand, which is all the evidence that exists.
export function rigAnswer(kind: RigKind): RigAnswer {
  switch (kind) {
    case "peek":
      return {
        call: "> call: read the price inside a sealed commitment",
        rejected: [
          "rejected · there is no method to call. a commitment is a hash of the price, a salt only the seller holds, and the seller's payment identity. the only opening is the owner's own reveal, inside the reveal window.",
        ],
        source: "impossible by construction: no method returns a price before its owner reveals it, to anyone, the buyer included.",
      };
    case "rules":
      return {
        call: "> call: set the budget cap again, after the tender has locked",
        rejected: [
          "rejected · the rules are hashed and frozen at lock and fund, and there is no setter on a locked tender. both verifiers recompute the rules hash from the record on every run, so an edited record fails its first check.",
        ],
        source: "impossible by construction, and rechecked on every verification run.",
      };
    case "friend": {
      const r = cardRejection("winner-swapped", 1);
      return {
        call: "> tamper: put a different seller's name on the gate tender's award record",
        rejected: [
          "the one legal path is an override: a published rationale whose hash sits in the record, and approver signatures at the circle's threshold. below that bar, no override stands and the computed award is the one that settles.",
          `rejected · ${r.check}: ${r.detail}`,
        ],
        source: `from the falsification cards: "${r.title}", a tampered copy of the real gate tender record. both verifiers reject it at that check.`,
      };
    }
    case "money": {
      const r = cardRejection("escrow-balance-inflated", 0);
      return {
        call: "> tamper: write the gate tender's escrow record as if 5 tari never moved",
        rejected: [
          "escrow leaves only through the template's own settlement paths: paying the winner after delivery, resolving a dispute, or refunding the circle. there is no withdrawal method to call.",
          `rejected · ${r.check}: ${r.detail}`,
        ],
        source: `from the falsification cards: "${r.title}", a tampered copy of the real gate tender record. both verifiers reject it at that check.`,
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
  // reading, from its own config.
  const nav = el("nav", "lp-nav");
  const verpill = el("span", "verpill");
  verpill.append(
    el("span", "vdot"),
    document.createTextNode(app.indexer.cfg.label),
  );
  const links = el("div", "pillbar");
  for (const [label, hash] of [
    ["tenders", "#feed"],
    ["how it works", "#how"],
    ["questions", "#faq"],
    ["the proof", "#proof"],
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
  nav.append(verpill, links, signin);
  root.append(nav);

  // Hero, centred at 896px over the dot grid and the glow.
  const hero = el("section", "hero");
  const heroIn = el("div", "hero-in");
  heroIn.append(el("span", "badge", "sealed tenders for buying circles"));
  const h1 = el("h1");
  h1.append(
    document.createTextNode("everyone says their tender is fair. asiri shows you "),
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
  heroIn.append(
    cta,
    el("p", "small", "+ sealed bids + locked rules + public proof"),
    sealArt(),
  );
  hero.append(heroIn);
  root.append(hero);

  // The live feed of the featured circle's tenders.
  const feed = el("section", "blk");
  feed.id = "feed";
  const fh = el("div", "blk-head");
  fh.append(
    el("h2", undefined, "tenders from the featured circle"),
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

  // How a tender runs: the five steps, then the rig panel.
  const how = el("section", "blk");
  how.id = "how";
  const hh = el("div", "blk-head");
  hh.append(
    el("h2", undefined, "how a tender runs"),
    el("p", undefined, "five steps. the money sits in the template from the first step to the last."),
  );
  how.append(hh);
  const steps = el("div", "lsteps");
  const stepData: [string, string, string][] = [
    [
      "1",
      "lock the rules",
      "the circle publishes what it is buying, the budget cap, the bond, and the windows. the template hashes them and freezes them.",
    ],
    [
      "2",
      "escrow the budget",
      "the full budget moves into the tender vault in the same transaction. a tender cannot award money it does not hold.",
    ],
    [
      "3",
      "bid in secret",
      "sellers post a bond and a hash of their price. the chain records that a bid exists. the price itself is never transmitted.",
    ],
    [
      "4",
      "reveal to win",
      "after the deadline, sellers open their bids to compete. the lowest valid revealed price wins, computed by the template, ties to the earliest reveal.",
    ],
    [
      "5",
      "deliver, then settle",
      "the circle confirms delivery and the template pays the winner. no confirmation, no payment. unspent budget returns to the circle.",
    ],
  ];
  for (const [n, title, text] of stepData) {
    const s = el("div", "lstep");
    const body = el("div");
    body.append(el("h3", undefined, title), el("p", undefined, text));
    s.append(el("span", "n", n), body);
    steps.append(s);
  }
  how.append(steps);

  const rig = el("div", "riglab");
  rig.id = "rig";
  const rigLeft = el("div");
  rigLeft.append(
    el("h3", undefined, "do not take our word for it. try to rig it."),
    el(
      "p",
      undefined,
      "the four attacks every tender committee knows. two cannot be called at all: the template has no method for them. two are lies about a real tender's record, and both verifiers catch each one in the open, at the check quoted.",
    ),
  );
  const rigBtns = el("div", "rig-btns");
  const console_ = el("div", "rig-console");
  setAria(console_, "aria-live", "polite");
  const consoleHead = () =>
    el("div", "cm", "asiri template · esmeralda evidence season");
  console_.append(
    consoleHead(),
    el("div", "dim", "waiting for an attack…"),
  );
  for (const [kind, label] of RIG_BUTTONS) {
    const b = el("button", undefined, label);
    b.addEventListener("click", () => {
      const a = rigAnswer(kind);
      console_.replaceChildren(
        consoleHead(),
        el("div", undefined, a.call),
        ...a.rejected.map((line) => el("div", "rj", line)),
        el("div", "ok", a.source),
        el("div", "ok", "the tender is untouched."),
      );
    });
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
  faqLeft.append(el("h2", undefined, "some questions, answered"));
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
      "a bond, posted with the bid. reveal, win or lose, and it returns in full. stay silent while the tender awards and the bond is split, half to the circle, half locked forever. if the tender instead expires with no award, an unrevealed bond comes back whole. the seller also keeps a salt safe: lose it and the bid can never be revealed.",
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
    const s = el("summary", undefined, q);
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
      "product",
      [
        ["tenders", "#feed"],
        ["how it works", "#how"],
        ["questions", "#faq"],
        ["the proof", "#proof"],
      ],
    ],
    [
      "verify",
      [
        ["verification results", "#/app/results"],
        ["falsification cards", "#/app/results"],
        ["run the verifier", "#/app/verify"],
        ["help", "#/app/help"],
      ],
    ],
    [
      "the app",
      [
        ["overview", "#/app/overview"],
        ["start a tender", "#/app/create"],
        ["seller desk", "#/app/seller"],
        ["approvals", "#/app/approvals"],
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
