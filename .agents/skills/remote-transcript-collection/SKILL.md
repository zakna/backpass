---
name: remote-transcript-collection
description: Changing how backpass collects transcripts from configured SSH hosts - src/discovery/hosts.js, src/discovery/remote/ (ssh.js, bundle.js, git-facts.js), or the remote transcript cache.
user-invocable: false
metadata:
  internal: true
---

Remote collection is a tier of the one corpus, not a second scope. These are the invariants behind `discovery.hosts`.

- **SSH hosts are a collection tier, not a second scope.** `src/discovery/hosts.js` runs
  three remote commands per configured host - locate Node/git, probe `discover`, probe
  `fetch` - over one explicit ControlMaster that is opened before locate and closed after
  fetch or at command teardown; the descriptors join the one corpus with the same tiers, sample and
  cap. `src/discovery/remote/ssh.js` is the sole ssh spawn boundary (constant option set,
  destination/node-path refusal, `classifySshFailure`, `BACKPASS_SSH_BIN`), and a Windows
  shim refusal must be raised by name there like every other spawn. Nothing installs on
  the remote: `src/discovery/remote/bundle.js` ships `PROBE_MANIFEST` plus the request as
  one stdin program, so a stray import in a manifest module breaks every host at once -
  `test/remote-bundle.test.js` runs the probe from a directory holding only the manifest.
  The payload never reaches the remote shell; the refused node path is the only variable
  command text and is single-quoted. The locate snippet and loader bodies carry no single
  quote, backslash, or `!`. Remote tiers have no tier 1
  (nothing over there is this clone); facts come from `remote/git-facts.js`, computed
  where the paths are real, and `associateRemote` applies the local rules to them. Hosts
  are personal configuration: `discovery.hosts` in `.backpassrc.json` is a `UserError` by
  construction, which is what keeps the feature inside VISION's "never someone else's
  transcripts". Every host is fail-soft with a named message; host keys are never
  auto-accepted and `StrictHostKeyChecking=no` is never suggested.
- **A remote session's content is fetched, cached, and read through the same adapter.**
  `prefetchRemoteTranscripts` runs before the analysis pool for exactly the pending
  sampled transcripts. File-backed stores send the raw file so `rawPath` still names a
  real local file and the analysis escape hatch survives the trip; SQLite stores send the
  adapter's events, since there is no per-session file. `src/discovery/cache.js` hashes
  (host, harness, key) into a name so an untrusted remote path can never steer a write,
  writes tmp+rename, and prunes at 30 days unused. A short frame fails that one transcript
  with `remote fetch incomplete` and refetches next run - never a truncated session
  analyzed as a whole one. Identity is `ssh://<host>/<path>` (`transcriptSource`), evidence
  labels carry the host (`gapSource`), and one session present on two machines is kept
  once, local copy first.
