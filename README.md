# Nuvo

Dual investment on tokenized stocks, settled every Friday on Robinhood Chain.
Spec: `nuvo-site-brief.md`.

This folder is a standalone Next.js app. It lives inside the Recess repository
folder but is not part of it (`NUVO/` is listed in the parent `.gitignore`), and
it shares no code, tokens or routes with Recess.

```
npm install     # once
npm run dev     # http://localhost:3100
npm run video   # rebuild public/video from NUVO/background-nuvo.mp4
```

Stage rule from the brief: no backend. No contracts, no `app/api`, no database,
no indexer. The data layer is an adapter with a `MockClient`; `chain.ts` and
`abi.ts` are typed drafts for the next stage.
