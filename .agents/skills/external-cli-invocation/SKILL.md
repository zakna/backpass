---
name: external-cli-invocation
description: Spawning an external CLI from backpass - src/acpx.js, src/agents.js probes and fallthrough, src/harness-invoke.js overlays, src/apply/lavish.js, or the Windows shim refusal.
user-invocable: false
metadata:
  internal: true
---

Every model call and the apply surface go out through a spawn boundary. These are the contracts each boundary owes.

- **A Windows shim refusal must be raised by name, before any generic handling.** On
  Windows every spawn of an npm `.cmd` goes through `windowsShimLaunch` (`src/subprocess.js`),
  which refuses an argument no quoting can neutralise (`%VAR%`, a double quote, a newline)
  rather than passing it to cmd.exe. That refusal arrives as a result with `code: null` and
  `spawnError.code === "ERR_WINDOWS_SHIM_UNSAFE_ARG"`, so any boundary that inspects the
  result generically first degrades it into "no session support", "exit null" or "failed to
  open the apply surface" - none of which names the refused value. Two rounds of this change
  were spent chasing that degradation at two separate boundaries. Today `run` in `src/acpx.js`
  is the single funnel for every model call and `openApplySurface` in `src/apply/lavish.js`
  covers apply; a new spawn boundary must raise it the same way.
- **acpx is alpha.** All model invocation is isolated behind `src/acpx.js` so an upstream
  CLI change has one blast radius. v1 uses plain `exec` and named sessions only; acpx flows
  are deferred until they are stable upstream. The one sanctioned exception is the
  per-harness native status table in `src/agents.js` (`claude auth status`, `opencode models`).
  Grok overlays ride acpx `--agent`; that hatch has no `-s` of its own (acpx 0.13.x:
  `unknown option '-s'`), so `openSession`'s `prompt()` sends the `prompt` subcommand
  before `-s` when `acpxAgentCommand` is set. Built-in agents keep the implicit form.
- **Only acpx session creation gets the adapter cold-start budget.** Built-in adapters may
  launch through a package-exec bridge, so `sessions new` uses
  `SESSION_CREATE_TIMEOUT_MS`; probe status/close retain `PROBE_TIMEOUT_MS` (including its
  per-agent override), and open sessions keep their shorter post-create limits. Handle
  `result.timedOut` before generic non-zero exits so a stalled create is never reported as
  missing session support. `test/acpx-session-create-timeout.test.js` covers both contracts.
- **Model and effort overrides are invocation-scoped.** Never ACP `set model` / Pi
  `set thought_level` (those rewrite `~/.pi/agent/settings.json`) and never edit-then-restore
  harness defaults. `src/harness-invoke.js` owns the harness overlay mechanisms and
  `src/acpx.js` owns verification and fallback. An unproven overlay must stop rather than
  pretend. Preserve the current spawn when no override is requested.
- **Agent auto-pick is probe-then-verify, never probe-only.** `src/agents.js` walks each
  role's ladder with a zero-token probe, but the claude adapter cannot be pre-verified by
  acpx (sessions succeed while logged out), so every real call runs under
  `AgentResolver.withFallthrough`, which demotes a candidate on a classifiable failure
  (`classifyAcpxFailure`). Effortful calls go through `sessionPrompt` so the overlay in
  `src/harness-invoke.js` can apply. Verdicts cache in `.backpass/agent-probe-cache.json`;
  Pi and OpenCode entries carry `providerAuthState`, so credential changes invalidate them.
  A probe miss retries once with backoff (`probeAndRecord` in `src/agents.js`); a timeout,
  a bare `exit N`, or an empty advertised-model list is never written as a negative cache
  hit, so a busy harness cannot poison the next run.
- **An ambiguous advertised model is ranked by auth class, never guessed.** Pi (and any
  harness that lists `provider/id`) can advertise the same bare ladder id under a
  subscription provider and an API-key provider - classic case: `openai-codex/gpt-5.6-luna`
  vs `openai/gpt-5.6-luna` when `OPENAI_API_KEY` is set. `resolveModelId` prefers the
  subscription-backed prefix using `src/provider-auth.js` (Pi provider definitions plus
  `auth.json` `type`; OpenCode's own auth file, where `openai` is ChatGPT OAuth). Prefix
  semantics are harness-specific. An unrankable collision is a loud `model-unavailable`
  that names the ids and tells the user to pass a provider-qualified id - never a silent
  pick, and never "model not advertised" with the ids hidden. The probe trail prints a
  winning tie-break.
- **The Lavish apply surface is chatty and its output is YAML-quoted.** `lavish-axi poll`
  can return feedback that is not a decision vector (a comment, a queued layout report) any
  number of times before the real one; `pollDecisions` in `src/apply/lavish.js` announces
  each wait state once and never per cycle. Session URLs are printed as `url: "http://..."`,
  so parse them with `extractUrl`, never a bare `\S+`. Browser launch is best effort
  (`src/apply/browser.js`): the printed URL is the contract. `test/fixtures/fake-lavish/`
  stands in for the CLI via `BACKPASS_LAVISH_BIN` in tests. `injectPayload` in
  `src/apply/lavish.js` must splice the templated `<script>` tag into `apply.html` with a
  function replacer, never a string one: a string second argument to `String.prototype.replace`
  interprets `$&`, `` $` ``, `$'`, and `$$` in it as replacement patterns, and the spliced
  text embeds untrusted proposal/evidence prose that can contain those sequences verbatim.
