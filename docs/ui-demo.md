# Archived recorded UI tour

**[Open the interactive Arcloom demo](https://arcloomdemo.vercel.app)** · [Watch the narrated walkthrough](https://youtu.be/Z8RMloVLsig)

The Vercel preview is an interactive, read-only tour of Arcloom. It uses the same React components as the full application with two explicit recorded synthetic states: a reviewed `r1` investigation and the post-patch `r2` workspace.

Visitors can navigate every workspace view, filter investigations, inspect case details and receipts, explore the graph, inspect recorded withdrawal and diagnostic results, and download recorded investigation and handoff JSON. A visible demo banner and snapshot labels distinguish this tour from live execution.

## Data and interaction

The bundled records came from the project's owned synthetic HTTP lab and actual FalkorDB-backed API. They contain no login tokens, signing keys, model API keys or database credentials. Recorded evidence, audit checks and query plans describe the captured run. The graph filter operates in the browser over those recorded nodes.

The demo adapter accepts a fixed set of reads. Writes are rejected before any network request. The viewer role omits administrative credential forms and approval/execution controls. Browser-agent tool registration is disabled for this static tour. Selecting a different recorded revision reloads the tour; it does not migrate or change a graph.

The normal application build continues to use the authenticated API. A failed API or graph request never activates demo data. Demo mode is selected only at build time.

## Build and preview

```bash
npm --prefix apps/web ci
npm --prefix apps/web run build:demo
npm --prefix apps/web run preview:demo -- --port 4173
```

The default `vercel.json` now builds the ordinary application (`npm run build`,
`dist`), which contains no recorded snapshots. Serving that frontend alone does
not supply authentication or persistence: account access requires a same-origin
persistent API, journal/evidence storage, runner and FalkorDB as described in
[operations](operations.md). Do not present a static-only deployment as the full
account service.

An operator who explicitly wants the archived recorded tour can select
`vercel.recorded-tour.json` with the Vercel CLI `--local-config` option. That
configuration builds `dist-demo` and needs no backend; it remains read-only and
contains the labelled historical records. This source change does not update an
already published deployment.

Run `npm --prefix apps/web run e2e:demo` to exercise navigation, exports, graph tools, policy and historical cases at 320, 390, 768, 1024 and 1440px. These browser tests use a separate static server and require no backend credentials.

The graph automatically fits its cards and relationship routes on first render, focus changes and canvas resizing. Use **Read labels** to inspect a card at full size and **Fit graph** to return to the complete path. Both the focused investigation and the whole recorded workspace are included in responsive checks. The deployed tour also passed Chromium and WebKit checks at all five widths; [validation details](testing.md).

## Full hosted operation

Judges can explore the UI without downloading the repository. Running new investigations requires the full application: API, persistent journal/outbox, evidence storage, authorized runner and FalkorDB. [Local setup](../README.md#run-locally) provides the complete workflow; [operations](operations.md) describes persistent hosting requirements. FalkorDB Cloud hosts the graph, while application and evidence persistence must also be deployed for a fully live service.
