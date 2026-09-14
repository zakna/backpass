import path from "node:path";

import { emptyInteractionSignals, interactionSignals } from "../../interaction.js";
import { attachToolResults, contentToEvents, home, listFiles, readJsonFile, statOrNull } from "./shared.js";

/**
 * Jcode: ~/.jcode/sessions/session_*.json
 *
 * Saved sessions are one JSON object per file. The session metadata sits beside a
 * `messages` array whose user and assistant content uses the same typed-block vocabulary
 * as the JSONL adapters. Journal JSONL files and `.bak` copies are separate artifacts,
 * so only direct `.json` files in the saved-session directory are enumerated.
 *
 * Jcode does not record a repository remote in the session envelope. Live worktrees can
 * still reach tier 1 association; deleted worktrees remain best-effort unless another
 * source supplies a remote.
 */

export const name = "jcode";

export function storeRoot() {
  return home(".jcode", "sessions");
}

/**
 * @param {{ cutoffMs?: number }} [options]
 */
export function enumerate({ cutoffMs } = {}) {
  const out = [];
  for (const file of listFiles(storeRoot(), ".json")) {
    const stat = statOrNull(file);
    if (!stat) continue;
    if (cutoffMs && stat.mtimeMs < cutoffMs) continue;
    out.push({ key: file, path: file, mtimeMs: stat.mtimeMs, bytes: stat.size });
  }
  return out;
}

export function classify(candidate) {
  const session = readJsonFile(candidate.path);
  if (!isSessionObject(session) || !workingDirectoryOf(session)) return null;

  return {
    id: stringOrNull(session.id) || path.basename(candidate.path, ".json"),
    cwd: workingDirectoryOf(session),
    gitRoot: stringOrNull(session.git_root || session.gitRoot),
    gitBranch: stringOrNull(session.git_branch || session.gitBranch),
    remotes: recordedRemotes(session),
    title: stringOrNull(session.title) || stringOrNull(session.short_name),
    startedAt: timestampMs(session.created_at, candidate.mtimeMs),
    model: stringOrNull(session.model),
    extra: {
      providerKey: stringOrNull(session.provider_key),
      isDebug: session.is_debug === true,
      isCanary: session.is_canary === true,
      status: stringOrNull(session.status),
      shortName: stringOrNull(session.short_name),
      parentId: stringOrNull(session.parent_id),
    },
    interactionSignals: session.parent_id
      ? interactionSignals({ parentId: session.parent_id })
      : emptyInteractionSignals(),
  };
}

export function read(ref) {
  const session = readJsonFile(ref.path);
  if (!isSessionObject(session)) return { events: [], model: ref.model || null };

  const events = [];
  let model = stringOrNull(session.model) || ref.model || null;
  for (const message of session.messages) {
    if (!message || typeof message !== "object") continue;
    const role = message.role;
    if (role !== "user" && role !== "assistant") continue;
    if (!model && role === "assistant") model = stringOrNull(message.model);
    contentToEvents(role, message.content, events);
  }

  return { events: attachToolResults(events), model };
}

function isSessionObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value) && Array.isArray(value.messages);
}

function workingDirectoryOf(session) {
  return stringOrNull(session.working_dir || session.cwd);
}

function stringOrNull(value) {
  return typeof value === "string" && value.trim() ? value : null;
}

function recordedRemotes(session) {
  const values = session.git_remotes || session.gitRemotes || session.remotes;
  return Array.isArray(values) ? values.filter((value) => typeof value === "string" && value.trim()) : [];
}

function timestampMs(value, fallback) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value < 100_000_000_000 ? Math.round(value * 1000) : Math.round(value);
  }
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}
