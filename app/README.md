# asiri app

The web app for asiri, sealed tenders for buying circles on tari
ootle. It is a static site: no application server, no database,
no keys held. The chain is the database.

- reads come from the public ootle indexer for the selected
  network (a first visit opens on the first network with
  templates configured, the esmeralda testnet today; the sidebar
  switch moves between mainnet and esmeralda),
- writes are transaction requests built in the browser and
  approved in the visitor's own wallet (sapient or the tari web
  wallet, through the window.tari provider),
- the verify screen runs the same checks as the standalone
  script in `../scripts/verify.py`, in the browser, with no
  wallet at all.

## run it

```sh
npm install
npm run dev     # local development
npm run build   # type-checks and writes dist/, serve it statically
npm test        # encoding, builder, verifier and app-state tests
```

The encoding tests pin every argument and record layout against
values produced by the pinned rust crates (tari_bor), so a layout
drift in either direction fails loudly.

## layout

- `src/cbor.ts` the tari_bor encoding dialect, encoder and decoder
- `src/args.ts` instruction argument builders
- `src/builders.ts` one instruction list per template action
- `src/model.ts` the public info records and their decoders
- `src/state.ts` component state decoders for indexer substates
- `src/indexer.ts` the indexer read client
- `src/wallet.ts` the window.tari provider flow
- `src/verify.ts` the verifier's checks
- `src/screens/` the landing page and the app screens (overview,
  tender record, circle, create, seller desk, approvals, verify,
  results)
