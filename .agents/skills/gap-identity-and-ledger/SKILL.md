---
name: gap-identity-and-ledger
description: Changing gap corroboration or gap identity - src/gap-ledger.js, src/consolidate.js, gap domains (orchestration vs project), or coveredBySkill failed triggers.
user-invocable: false
metadata:
  internal: true
---

How a mistake seen in several sessions becomes one corroborated gap cluster.

- **Gap corroboration persists across runs through `.backpass/gap-ledger.json`**
  (`src/gap-ledger.js`, wired in `foldForRun`): one sighting per (gap, transcript id), so a
  session never counts twice. A run only folds ledger observations from its selected sample;
  persisted sessions outside the cap cannot reintroduce a skewed corpus. Record this run's
  evidence _before_ pruning - old evidence files stay on disk and would re-add an expired or
  covered sighting otherwise. Uncorroborated gaps stay hidden; never surface singletons to
  the prompt or report.
- **Gap identity is judged, not word-matched.** Bigram similarity cannot recognize real
  paraphrase (measured on production data: max cross-session score 0.34 vs the 0.45 bar),
  so it is only the fallback. The analysis turn cites open-gap ids (`matchesGap`, shown via
  `renderOpenGapIndex`; an invalid citation falls back, never fails), and, with at least two
  open entries, `foldForRun` runs ONE consolidation call (`src/consolidate.js`) that merges paraphrased entries
  (`mergeGapEntries`) - record, consolidate, prune, in that order. Consolidation failure
  degrades to lexical identity with a warning, never an abort. Gaps also carry `domain`;
  `orchestration` sightings (mistakes caused by the external harness or tooling that
  orchestrated the task, not by this repo) are counted in
  `totals.orchestrationGapSightings` and travel into clustering as votes. Cluster
  domain is decided after grouping (`src/fold.js`): withhold a cluster from a
  proposal only when a majority of its sightings vote orchestration (ties stay
  project). Mixed clusters always appear in the evidence report with total and
  orchestration sighting counts, so one inconsistent classifier call cannot drop a real
  recurrence below `minGapEvidence`. There is deliberately no orchestrator-memory
  write path. When this repository IS that orchestrating tool, those mistakes are
  `project` (`src/prompts/analysis.md`).
  A gap may also carry `coveredBySkill`: the analysis (shown every skill's name and
  trigger line) judged an existing skill's content to cover the mistake - a failed
  trigger. The fold counts those citations per skill onto the cluster
  (`failedTriggerSkill`/`failedTriggerSessions`) so synthesis fixes the description
  with real cross-session evidence, and skill content joins `pruneGapLedger` coverage
  so a gap resolved by a skill retires instead of aging out.
