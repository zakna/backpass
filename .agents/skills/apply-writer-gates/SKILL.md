---
name: apply-writer-gates
description: Changing src/apply/writer.js - the apply gates, the whole-file-or-nothing rule, rollback, or a concurrent-writer test.
user-invocable: false
metadata:
  internal: true
---

AGENTS.md states the rule that `src/apply/writer.js` is the only module that writes to the repo. These are the gates and failure modes behind it.

Bootstrap (`src/commands/bootstrap.js`, a repo with no memory file) is the one run that
writes without the apply gate, and it only ever creates files, never overwrites.
For proposals carrying a memory-file hash, nothing is written until the gates pass:
the memory file still exists and hashes to `proposal.memoryFile.hash` (`memoryFileSnapshot`,
using `memoryTextHash` from `src/memory.js` so the check and the proposal cannot disagree),
every non-memory edit target still hashes to its `proposal.targetFiles` entry (same
contract, so a hand-edited skill refuses the apply instead of being patched blind), the
accepted subset clears `budgetGateKind` (`src/tokens.js`), every accepted edit for a file
composes against that file's one pre-write image, every created skill target is still
absent, and, when the proposal carries any skill writes, the current run's resolved
`skillsDir` (defaulting to the canonical skills dir when unset) still matches
`proposal.config.skillsDir` - a mismatch refuses the apply naming both values rather than
writing to the stale propose-time path. Any of them failing writes nothing and records no
rejection. Accepted paths are
resolved before mutation, and duplicate resolved targets refuse the whole apply. Each file
is therefore applied whole or not at all. Skills and non-memory files land before the
memory file; a later failure rolls back files, skills, and loading-layout entries created
by the round. A rollback never overwrites a file whose identity or contents changed after
this round committed it - that conflict is reported and the concurrent version is kept.
A second writer therefore has two correct outcomes, decided by which side of a file's
rename/read-back window it lands on: `could not be verified after writing` (nothing was
committed, so apply stops there) or `rollback conflict` (it was committed, so rollback
leaves it). Both write nothing and keep the other writer's bytes. That window is
microseconds wide, so a test must choose its interleaving from inside the apply process -
hook the rename through `--import` (`test/fixtures/concurrent-writer.js`,
`replace-before-skill-rollback.js`), never poll the file from the test process and write
when it looks ready. A poller picks an outcome at random and reads as a flake.
