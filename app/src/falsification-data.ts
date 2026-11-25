// The falsification cards for the evidence tenders,
// as data. Each card is a labelled tamper of a real
// tender record above: exactly one change, quoted
// here with the failing check rows from both
// verifiers' captured runs against the tampered
// copy, in the verifiers' own words. The generation
// asserts every row against the captured run it
// quotes, the two verifiers' failing check lists
// against each other, the control summaries against
// their captured runs, and the rationale card's
// hashes against the exception invoice. Nothing is
// retyped. The download payload is the cards file
// the section was generated from, with only the
// internal working-folder pointers left out.

export interface FalsificationRejection {
  check: string;
  detail: string;
}

export interface FalsificationCard {
  id: string;
  title: string;
  tenderKey: string;
  tender: string;
  lie: string;
  field: string;
  originalText: string;
  tamperedText: string;
  note: string | null;
  rejections: {
    standalone: FalsificationRejection[];
    app: FalsificationRejection[];
  };
  passedText: { standalone: string; app: string };
}

export interface FalsificationControl {
  tenderKey: string;
  label: string;
  standalone: { pass: number; fail: number; couldNotRead: number; total: number };
  app: { pass: number; fail: number; couldNotRead: number; total: number };
}

export const FALSIFICATION_META = {
  "schema": "asiri-falsification-cards-1",
  "generated": "2026-11-20",
  "network": "esmeralda",
  "methodNote": "Each card is a copy of a real tender record from the Esmeralda evidence season with exactly one labelled change, made on the decoded record and re-encoded; the re-encoding round-trips every original record byte for byte, and a decoded comparison of each copy against its original shows only the stated change. Both verifiers ran against the copies from local record sources: the records themselves, the preserved tender template record, and transaction bodies from the preserved wallet history. No network reads, no chain writes, and the original records were never edited.",
  "controls": [
    {
      "tenderKey": "gate",
      "label": "The gate tender, untampered",
      "standalone": {
        "pass": 13,
        "fail": 0,
        "couldNotRead": 0,
        "total": 13
      },
      "app": {
        "pass": 13,
        "fail": 0,
        "couldNotRead": 0,
        "total": 13
      }
    },
    {
      "tenderKey": "tie",
      "label": "The tie tender, untampered",
      "standalone": {
        "pass": 13,
        "fail": 0,
        "couldNotRead": 0,
        "total": 13
      },
      "app": {
        "pass": 13,
        "fail": 0,
        "couldNotRead": 0,
        "total": 13
      }
    },
    {
      "tenderKey": "override",
      "label": "The override tender, untampered",
      "standalone": {
        "pass": 15,
        "fail": 0,
        "couldNotRead": 0,
        "total": 15
      },
      "app": {
        "pass": 15,
        "fail": 0,
        "couldNotRead": 0,
        "total": 15
      }
    }
  ]
} as const;

export const FALSIFICATION_CARDS: FalsificationCard[] = [
  {
    "id": "award-price-lowered",
    "title": "The lowered award price",
    "tenderKey": "gate",
    "tender": "component_3dbc5322267ca40712de3876c651938bf51730c0e4f29487c39c9e2dcdb36850",
    "lie": "The award was made at 14 tari, not 15, and the record was written up afterwards.",
    "field": "Tender state, award record, winning price",
    "originalText": "15 tari (15,000,000 microtari)",
    "tamperedText": "14 tari (14,000,000 microtari)",
    "note": null,
    "rejections": {
      "standalone": [
        {
          "check": "award is the lowest valid revealed price",
          "detail": "award 14000000 at counter 1, best valid reveal 15000000"
        },
        {
          "check": "settlement equals the award",
          "detail": "settled 15000000 at epoch 13155, winner matches the award"
        }
      ],
      "app": [
        {
          "check": "award is the lowest valid revealed price",
          "detail": "award 14000000, best valid reveal 15000000 at counter 1"
        },
        {
          "check": "settlement equals the award",
          "detail": "settled 15000000 at epoch 13155, winner matches the award"
        }
      ]
    },
    "passedText": {
      "standalone": "11 of 13 checks passed",
      "app": "11 of 13 checks passed"
    }
  },
  {
    "id": "reveal-price-changed",
    "title": "The edited reveal price",
    "tenderKey": "gate",
    "tender": "component_3dbc5322267ca40712de3876c651938bf51730c0e4f29487c39c9e2dcdb36850",
    "lie": "The winning bid was really 14.5 tari; the 15 tari figure in the record was edited in afterwards.",
    "field": "Tender state, reveal record for seller1's commitment f7cabc37753e, price",
    "originalText": "15 tari (15,000,000 microtari)",
    "tamperedText": "14.5 tari (14,500,000 microtari)",
    "note": null,
    "rejections": {
      "standalone": [
        {
          "check": "reveals verify against commitments",
          "detail": "price mismatch for f7cabc37753e"
        },
        {
          "check": "award is the lowest valid revealed price",
          "detail": "award 15000000 at counter 1, best valid reveal 14500000"
        }
      ],
      "app": [
        {
          "check": "reveals verify against commitments",
          "detail": "price mismatch for f7cabc37753e"
        },
        {
          "check": "award is the lowest valid revealed price",
          "detail": "award 15000000, best valid reveal 14500000 at counter 1"
        }
      ]
    },
    "passedText": {
      "standalone": "11 of 13 checks passed",
      "app": "11 of 13 checks passed"
    }
  },
  {
    "id": "winner-swapped",
    "title": "The swapped winner",
    "tenderKey": "gate",
    "tender": "component_3dbc5322267ca40712de3876c651938bf51730c0e4f29487c39c9e2dcdb36850",
    "lie": "Seller2 won the gate tender, and seller1's name was put on the award.",
    "field": "Tender state, award record, winner",
    "originalText": "seller1, key ca4312fd72cb3fb495172aa5b90cb3e46b7ed4f46390aa043e07b8c76fc92770",
    "tamperedText": "seller2, key 161b42299db925887a49aed8d30b86b0b9ef80888e311f9376fd20dc4385755a",
    "note": "An honesty note on the second row: when these cards were first run, that row's detail was a fixed sentence in both verifiers, and on this record it read \"winner matches the award\" where the winner does not match. The verdict was right and the sentence was wrong. Both verifiers now state the comparison they actually made, and this card was re-run: the rows above are the corrected output. On the first card the same sentence stands, and there it is true, because that card changed the price, not the winner.",
    "rejections": {
      "standalone": [
        {
          "check": "award is the lowest valid revealed price",
          "detail": "award 15000000 at counter 1, best valid reveal 15000000"
        },
        {
          "check": "settlement equals the award",
          "detail": "settled 15000000 at epoch 13155, winner does not match the award"
        }
      ],
      "app": [
        {
          "check": "award is the lowest valid revealed price",
          "detail": "award 15000000, best valid reveal 15000000 at counter 1"
        },
        {
          "check": "settlement equals the award",
          "detail": "settled 15000000 at epoch 13155, winner does not match the award"
        }
      ]
    },
    "passedText": {
      "standalone": "11 of 13 checks passed",
      "app": "11 of 13 checks passed"
    }
  },
  {
    "id": "escrow-balance-inflated",
    "title": "The escrow that grew",
    "tenderKey": "gate",
    "tender": "component_3dbc5322267ca40712de3876c651938bf51730c0e4f29487c39c9e2dcdb36850",
    "lie": "5 tari still sat in the escrow vault after settlement; the money did not all move as the record says.",
    "field": "Escrow vault substate, balance",
    "originalText": "0 microtari",
    "tamperedText": "5,000,000 microtari (5 tari)",
    "note": null,
    "rejections": {
      "standalone": [
        {
          "check": "escrow funding",
          "detail": "escrow 5000000 + paid out 20000000 of cap 20000000"
        }
      ],
      "app": [
        {
          "check": "escrow funding",
          "detail": "escrow 5000000 + paid out 20000000 of cap 20000000"
        }
      ]
    },
    "passedText": {
      "standalone": "12 of 13 checks passed",
      "app": "12 of 13 checks passed"
    }
  },
  {
    "id": "fabricated-cheaper-reveal",
    "title": "The reveal that was never made",
    "tenderKey": "gate",
    "tender": "component_3dbc5322267ca40712de3876c651938bf51730c0e4f29487c39c9e2dcdb36850",
    "lie": "A third bid of 13 tari was revealed and quietly passed over, so the winner was not the lowest revealed bid.",
    "field": "Tender state, reveals list, one record appended",
    "originalText": "2 reveals",
    "tamperedText": "3 reveals, with one appended: 13,000,000 microtari at counter 3, commitment beb418635e1f087ea8ed86842bca41f5688b535482d3273d6d99d913c7ac29c7",
    "note": null,
    "rejections": {
      "standalone": [
        {
          "check": "record counts",
          "detail": "3 commitments, 3 reveals; commitment records are inconsistent"
        },
        {
          "check": "reveals verify against commitments",
          "detail": "no reveal transaction found for beb418635e1f"
        },
        {
          "check": "award is the lowest valid revealed price",
          "detail": "award 15000000 at counter 3, best valid reveal 13000000"
        },
        {
          "check": "award counts",
          "detail": "award records 3 commitments and 2 reveals"
        }
      ],
      "app": [
        {
          "check": "record counts",
          "detail": "3 commitments, 3 reveals; commitment records are inconsistent"
        },
        {
          "check": "reveals verify against commitments",
          "detail": "no reveal transaction found for beb418635e1f"
        },
        {
          "check": "award is the lowest valid revealed price",
          "detail": "award 15000000, best valid reveal 13000000 at counter 3"
        },
        {
          "check": "award counts",
          "detail": "award records 3 commitments and 2 reveals"
        }
      ]
    },
    "passedText": {
      "standalone": "9 of 13 checks passed",
      "app": "9 of 13 checks passed"
    }
  },
  {
    "id": "reveal-omitted",
    "title": "The reveal that vanished",
    "tenderKey": "tie",
    "tender": "component_23f8e02e400ad07858c4435c52685a4143d2711deb356548df2968ae7916a7c4",
    "lie": "One of the tie tender's reveals was deleted from the record after the fact, and nobody would know.",
    "field": "Tender state, reveals list, one record removed",
    "originalText": "3 reveals",
    "tamperedText": "2 reveals, with one removed: 16,000,000 microtari at counter 3, commitment 5db55067fd82b6243862138f8c462d88914e4f7a4291f4690d8d041a79a5943a",
    "note": null,
    "rejections": {
      "standalone": [
        {
          "check": "record counts",
          "detail": "3 commitments, 2 reveals; commitment records are inconsistent"
        },
        {
          "check": "award counts",
          "detail": "award records 3 commitments and 3 reveals"
        }
      ],
      "app": [
        {
          "check": "record counts",
          "detail": "3 commitments, 2 reveals; commitment records are inconsistent"
        },
        {
          "check": "award counts",
          "detail": "award records 3 commitments and 3 reveals"
        }
      ]
    },
    "passedText": {
      "standalone": "11 of 13 checks passed",
      "app": "11 of 13 checks passed"
    }
  },
  {
    "id": "rationale-word-changed",
    "title": "The rationale, reworded",
    "tenderKey": "override",
    "tender": "component_49377a6f26dfb108ca406bbe445551832512aef96c017499c6f2fda5f4970aab",
    "lie": "The published override rationale is not the text the approvers signed off on; one word was changed after publication.",
    "field": "The published rationale text presented with the record (the chain record itself is untouched)",
    "originalText": "the word \"proven\"; the published text hashes to 5f06ee5e5946d4ee12ce4a16461492a2e3047118fdfd0cdc5382e58e0f4029a8",
    "tamperedText": "the word \"promised\"; the published text hashes to a139d73a93c2791f6c205f83113d2df15006337b38c3534a680da45a820de9ad",
    "note": null,
    "rejections": {
      "standalone": [
        {
          "check": "override rationale text",
          "detail": "published text hashes to a139d73a93c2791f6c205f83113d2df15006337b38c3534a680da45a820de9ad"
        }
      ],
      "app": [
        {
          "check": "override rationale text",
          "detail": "published text hashes to a139d73a93c2791f6c205f83113d2df15006337b38c3534a680da45a820de9ad"
        }
      ]
    },
    "passedText": {
      "standalone": "14 of 15 checks passed",
      "app": "14 of 15 checks passed"
    }
  }
];

export const FALSIFICATION_CARDS_FILENAME = "falsification-cards.json";

export const FALSIFICATION_CARDS_JSON: string = "{\n  \"schema\": \"asiri-falsification-cards-1\",\n  \"generated\": \"2026-11-20\",\n  \"network\": \"esmeralda\",\n  \"controls\": {\n    \"gate\": {\n      \"standalone\": {\n        \"pass\": 13,\n        \"fail\": 0,\n        \"could_not_read\": 0,\n        \"total\": 13\n      },\n      \"app\": {\n        \"pass\": 13,\n        \"fail\": 0,\n        \"could_not_read\": 0,\n        \"total\": 13\n      }\n    },\n    \"tie\": {\n      \"standalone\": {\n        \"pass\": 13,\n        \"fail\": 0,\n        \"could_not_read\": 0,\n        \"total\": 13\n      },\n      \"app\": {\n        \"pass\": 13,\n        \"fail\": 0,\n        \"could_not_read\": 0,\n        \"total\": 13\n      }\n    },\n    \"override\": {\n      \"standalone\": {\n        \"pass\": 15,\n        \"fail\": 0,\n        \"could_not_read\": 0,\n        \"total\": 15\n      },\n      \"app\": {\n        \"pass\": 15,\n        \"fail\": 0,\n        \"could_not_read\": 0,\n        \"total\": 15\n      }\n    }\n  },\n  \"cards\": [\n    {\n      \"id\": \"award-price-lowered\",\n      \"title\": \"The lowered award price\",\n      \"tender_key\": \"gate\",\n      \"tender\": \"component_3dbc5322267ca40712de3876c651938bf51730c0e4f29487c39c9e2dcdb36850\",\n      \"lie\": \"The award was made at 14 tari, not 15, and the record was written up afterwards.\",\n      \"field\": \"Tender state, award record, winning price\",\n      \"original\": {\n        \"price_microtari\": 15000000,\n        \"price_tari\": \"15\"\n      },\n      \"tampered\": {\n        \"price_microtari\": 14000000,\n        \"price_tari\": \"14\"\n      },\n      \"rejections\": {\n        \"standalone\": [\n          {\n            \"check\": \"award is the lowest valid revealed price\",\n            \"detail\": \"award 14000000 at counter 1, best valid reveal 15000000\"\n          },\n          {\n            \"check\": \"settlement equals the award\",\n            \"detail\": \"settled 15000000 at epoch 13155, winner matches the award\"\n          }\n        ],\n        \"app\": [\n          {\n            \"check\": \"award is the lowest valid revealed price\",\n            \"detail\": \"award 14000000, best valid reveal 15000000 at counter 1\"\n          },\n          {\n            \"check\": \"settlement equals the award\",\n            \"detail\": \"settled 15000000 at epoch 13155, winner matches the award\"\n          }\n        ]\n      }\n    },\n    {\n      \"id\": \"reveal-price-changed\",\n      \"title\": \"The edited reveal price\",\n      \"tender_key\": \"gate\",\n      \"tender\": \"component_3dbc5322267ca40712de3876c651938bf51730c0e4f29487c39c9e2dcdb36850\",\n      \"lie\": \"The winning bid was really 14.5 tari; the 15 tari figure in the record was edited in afterwards.\",\n      \"field\": \"Tender state, reveal record for seller1's commitment f7cabc37753e, price\",\n      \"original\": {\n        \"price_microtari\": 15000000,\n        \"price_tari\": \"15\"\n      },\n      \"tampered\": {\n        \"price_microtari\": 14500000,\n        \"price_tari\": \"14.5\"\n      },\n      \"rejections\": {\n        \"standalone\": [\n          {\n            \"check\": \"reveals verify against commitments\",\n            \"detail\": \"price mismatch for f7cabc37753e\"\n          },\n          {\n            \"check\": \"award is the lowest valid revealed price\",\n            \"detail\": \"award 15000000 at counter 1, best valid reveal 14500000\"\n          }\n        ],\n        \"app\": [\n          {\n            \"check\": \"reveals verify against commitments\",\n            \"detail\": \"price mismatch for f7cabc37753e\"\n          },\n          {\n            \"check\": \"award is the lowest valid revealed price\",\n            \"detail\": \"award 15000000, best valid reveal 14500000 at counter 1\"\n          }\n        ]\n      }\n    },\n    {\n      \"id\": \"winner-swapped\",\n      \"title\": \"The swapped winner\",\n      \"tender_key\": \"gate\",\n      \"tender\": \"component_3dbc5322267ca40712de3876c651938bf51730c0e4f29487c39c9e2dcdb36850\",\n      \"lie\": \"Seller2 won the gate tender, and seller1's name was put on the award.\",\n      \"field\": \"Tender state, award record, winner\",\n      \"original\": {\n        \"winner\": \"ca4312fd72cb3fb495172aa5b90cb3e46b7ed4f46390aa043e07b8c76fc92770\",\n        \"winner_name\": \"seller1\"\n      },\n      \"tampered\": {\n        \"winner\": \"161b42299db925887a49aed8d30b86b0b9ef80888e311f9376fd20dc4385755a\",\n        \"winner_name\": \"seller2\"\n      },\n      \"rejections\": {\n        \"standalone\": [\n          {\n            \"check\": \"award is the lowest valid revealed price\",\n            \"detail\": \"award 15000000 at counter 1, best valid reveal 15000000\"\n          },\n          {\n            \"check\": \"settlement equals the award\",\n            \"detail\": \"settled 15000000 at epoch 13155, winner does not match the award\"\n          }\n        ],\n        \"app\": [\n          {\n            \"check\": \"award is the lowest valid revealed price\",\n            \"detail\": \"award 15000000, best valid reveal 15000000 at counter 1\"\n          },\n          {\n            \"check\": \"settlement equals the award\",\n            \"detail\": \"settled 15000000 at epoch 13155, winner does not match the award\"\n          }\n        ]\n      }\n    },\n    {\n      \"id\": \"escrow-balance-inflated\",\n      \"title\": \"The escrow that grew\",\n      \"tender_key\": \"gate\",\n      \"tender\": \"component_3dbc5322267ca40712de3876c651938bf51730c0e4f29487c39c9e2dcdb36850\",\n      \"lie\": \"5 tari still sat in the escrow vault after settlement; the money did not all move as the record says.\",\n      \"field\": \"Escrow vault substate, balance\",\n      \"original\": {\n        \"balance_microtari\": 0\n      },\n      \"tampered\": {\n        \"balance_microtari\": 5000000\n      },\n      \"rejections\": {\n        \"standalone\": [\n          {\n            \"check\": \"escrow funding\",\n            \"detail\": \"escrow 5000000 + paid out 20000000 of cap 20000000\"\n          }\n        ],\n        \"app\": [\n          {\n            \"check\": \"escrow funding\",\n            \"detail\": \"escrow 5000000 + paid out 20000000 of cap 20000000\"\n          }\n        ]\n      }\n    },\n    {\n      \"id\": \"fabricated-cheaper-reveal\",\n      \"title\": \"The reveal that was never made\",\n      \"tender_key\": \"gate\",\n      \"tender\": \"component_3dbc5322267ca40712de3876c651938bf51730c0e4f29487c39c9e2dcdb36850\",\n      \"lie\": \"A third bid of 13 tari was revealed and quietly passed over, so the winner was not the lowest revealed bid.\",\n      \"field\": \"Tender state, reveals list, one record appended\",\n      \"original\": {\n        \"reveals\": 2\n      },\n      \"tampered\": {\n        \"reveals\": 3,\n        \"appended\": {\n          \"seller\": \"3c09d1ef2139285a70017b579b340b4e4204c05f505349c78afd08e608d96166\",\n          \"seller_name\": \"the third account, whose real commitment on this tender was never revealed\",\n          \"price_microtari\": 13000000,\n          \"counter\": 3,\n          \"commitment\": \"beb418635e1f087ea8ed86842bca41f5688b535482d3273d6d99d913c7ac29c7\"\n        }\n      },\n      \"rejections\": {\n        \"standalone\": [\n          {\n            \"check\": \"record counts\",\n            \"detail\": \"3 commitments, 3 reveals; commitment records are inconsistent\"\n          },\n          {\n            \"check\": \"reveals verify against commitments\",\n            \"detail\": \"no reveal transaction found for beb418635e1f\"\n          },\n          {\n            \"check\": \"award is the lowest valid revealed price\",\n            \"detail\": \"award 15000000 at counter 3, best valid reveal 13000000\"\n          },\n          {\n            \"check\": \"award counts\",\n            \"detail\": \"award records 3 commitments and 2 reveals\"\n          }\n        ],\n        \"app\": [\n          {\n            \"check\": \"record counts\",\n            \"detail\": \"3 commitments, 3 reveals; commitment records are inconsistent\"\n          },\n          {\n            \"check\": \"reveals verify against commitments\",\n            \"detail\": \"no reveal transaction found for beb418635e1f\"\n          },\n          {\n            \"check\": \"award is the lowest valid revealed price\",\n            \"detail\": \"award 15000000, best valid reveal 13000000 at counter 3\"\n          },\n          {\n            \"check\": \"award counts\",\n            \"detail\": \"award records 3 commitments and 2 reveals\"\n          }\n        ]\n      }\n    },\n    {\n      \"id\": \"reveal-omitted\",\n      \"title\": \"The reveal that vanished\",\n      \"tender_key\": \"tie\",\n      \"tender\": \"component_23f8e02e400ad07858c4435c52685a4143d2711deb356548df2968ae7916a7c4\",\n      \"lie\": \"One of the tie tender's reveals was deleted from the record after the fact, and nobody would know.\",\n      \"field\": \"Tender state, reveals list, one record removed\",\n      \"original\": {\n        \"reveals\": 3\n      },\n      \"tampered\": {\n        \"reveals\": 2,\n        \"removed\": {\n          \"seller\": \"3c09d1ef2139285a70017b579b340b4e4204c05f505349c78afd08e608d96166\",\n          \"price_microtari\": 16000000,\n          \"counter\": 3,\n          \"commitment\": \"5db55067fd82b6243862138f8c462d88914e4f7a4291f4690d8d041a79a5943a\"\n        }\n      },\n      \"rejections\": {\n        \"standalone\": [\n          {\n            \"check\": \"record counts\",\n            \"detail\": \"3 commitments, 2 reveals; commitment records are inconsistent\"\n          },\n          {\n            \"check\": \"award counts\",\n            \"detail\": \"award records 3 commitments and 3 reveals\"\n          }\n        ],\n        \"app\": [\n          {\n            \"check\": \"record counts\",\n            \"detail\": \"3 commitments, 2 reveals; commitment records are inconsistent\"\n          },\n          {\n            \"check\": \"award counts\",\n            \"detail\": \"award records 3 commitments and 3 reveals\"\n          }\n        ]\n      }\n    },\n    {\n      \"id\": \"rationale-word-changed\",\n      \"title\": \"The rationale, reworded\",\n      \"tender_key\": \"override\",\n      \"tender\": \"component_49377a6f26dfb108ca406bbe445551832512aef96c017499c6f2fda5f4970aab\",\n      \"lie\": \"The published override rationale is not the text the approvers signed off on; one word was changed after publication.\",\n      \"field\": \"The published rationale text presented with the record (the chain record itself is untouched)\",\n      \"original\": {\n        \"word\": \"proven\",\n        \"text_sha256\": \"5f06ee5e5946d4ee12ce4a16461492a2e3047118fdfd0cdc5382e58e0f4029a8\"\n      },\n      \"tampered\": {\n        \"word\": \"promised\",\n        \"text_sha256\": \"a139d73a93c2791f6c205f83113d2df15006337b38c3534a680da45a820de9ad\"\n      },\n      \"rejections\": {\n        \"standalone\": [\n          {\n            \"check\": \"override rationale text\",\n            \"detail\": \"published text hashes to a139d73a93c2791f6c205f83113d2df15006337b38c3534a680da45a820de9ad\"\n          }\n        ],\n        \"app\": [\n          {\n            \"check\": \"override rationale text\",\n            \"detail\": \"published text hashes to a139d73a93c2791f6c205f83113d2df15006337b38c3534a680da45a820de9ad\"\n          }\n        ]\n      }\n    }\n  ]\n}\n";
