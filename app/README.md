# Asiri app

The web app for Asiri, sealed tenders for buying circles on Tari
Ootle. It is a static site: no application server, no database,
no keys held. The chain is the database.

- Reads come from the public Ootle indexer for the selected
  network (a first visit opens on the first network with
  templates configured, the Esmeralda testnet today; the sidebar
  switch moves between Mainnet and Esmeralda),
- Writes are transaction requests built in the browser and
  approved in the visitor's own wallet (Sapient or the Tari web
  wallet, through the window.tari provider),
- The verify screen runs the same checks as the standalone
  script in `../scripts/verify.py`, in the browser, with no
  wallet at all.

## Run it

```sh
npm install
npm run dev     # local development
npm run build   # type-checks and writes dist/, serve it statically
npm test        # encoding, builder, verifier and app-state tests
```

The encoding tests pin every argument and record layout against
values produced by the pinned rust crates (tari_bor), so a layout
drift in either direction fails loudly.

## Layout

- `src/cbor.ts` The tari_bor encoding dialect, encoder and decoder
- `src/args.ts` Instruction argument builders
- `src/builders.ts` One instruction list per template action
- `src/model.ts` The public info records and their decoders
- `src/state.ts` Component state decoders for indexer substates
- `src/indexer.ts` The indexer read client
- `src/wallet.ts` The window.tari provider flow
- `src/verify.ts` The verifier's checks
- `src/screens/` The landing page and the app screens (overview,
  tender record, circle, create, seller desk, approvals, verify,
  results)
