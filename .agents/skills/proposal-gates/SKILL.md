---
name: proposal-gates
description: Changing src/proposal.js gates - the extract/move/remove kinds, the harm floor for deletions, or the per-edit distinct-session evidence floor.
user-invocable: false
metadata:
  internal: true
---

What `buildProposal` and `measureWorkspace` accept, and why each floor exists.

- **An extract is one measured memory change plus the skill(s) it pays for.** `anchoredHunks`
  merges adjacent removals, so extracting neighbouring sections yields one change and N
  skills - one honest accept/reject decision, since a merged change cannot be
  half-accepted. `buildProposal` allows N skills only when they share ONE memory hunk;
  separately measured skills must stay separate edits. An extract may create `SKILL.md`
  or extend an existing one when the staged file still has every prior line plus every
  line the memory hunks remove (`normalizeRecoveryLine`). A `move` is the same verbatim
  carry inside the memory file: normalized removed and added line multisets must match
  exactly, so repositioning cannot smuggle additions and does not hit the harm floor.
  Edits carry `skills: []` for
  created files; read them through `editSkills` (`src/skills.js`), which also understands
  the pre-0.1.8 single `skill`. Writer apply splits a multi-file extract by hunk `file`
  (`filesOfEdit` / `sliceEditForFile` in `src/proposal.js`).
- **Extraction and deletion never share one decision.** `measureWorkspace` splits a pure
  removal that mixes skill-carried and vanishing text at that boundary (`splitRemovalHunk`;
  a split that cannot anchor uniquely keeps the merged hunk instead of guessing). In
  `buildProposal`, an extract's skills must carry every line its memory hunks remove
  (dash-and-whitespace-folded, `normalizeRecoveryLine`), and any other edit whose hunk only
  deletes memory-file text is a removal whatever its kind: each deleted unit needs
  `minGapEvidence` distinct sessions of `class: "harm"` negatives (`harmSessions` in the
  fold). Extract and move skip that floor because the text never leaves the always-loaded
  surface. The same floor covers skill files, where no evidence can attribute at all, so a
  pure deletion inside a skill file is refused outright - skill content is rewritten or
  extracted, never dropped. Non-compliance never satisfies the floor; the >= 20%-relevance
  placement table stays prompt guidance by the captain's explicit decision - do not harden it.
- **One session floor covers the whole always-loaded surface.** Every edit whose kind is
  not `extract` or `move` must quote `minGapEvidence` distinct sessions - add, rewrite and
  remove alike. `buildProposal` discards empty quote text, then counts canonical non-empty
  source labels from the edit's own `evidence` that also appear in `summary.sources`
  (the labels this run's fold issued; `gapSource` / `disambiguateSourceLabels` in
  `src/gap-ledger.js`, folded in `src/fold.js`). Labels must remain one-to-one with
  canonical sessions; `test/proposal.test.js` covers the evidence-floor contract. The
  model's `transcripts` field is not read. A misspelled or date-shifted label is not a second session. Sourceless quotes
  remain visible as `unknown source` but do not count. There is no shape predicate
  separating an additive rewrite from a tightening, so a one-session tightening is
  refused too. Never reintroduce a lexical-overlap, token-growth, or other text classifier
  here. In user scope the same edits also clear `minGapProjects` (unchanged default),
  counted by `countedEvidenceProjects` from cited gap clusters and from
  `summary.sourceProjects`, the fold's source -> project map that lets instruction-row
  evidence answer for a rewrite. Keep that map keyed by the same unique labels.
  `sourceProjects` is empty without a project;
  `summary.sources` is the allowlist for both scopes.
