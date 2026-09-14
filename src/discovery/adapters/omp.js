import fs from "node:fs";
import path from "node:path";

import { emptyInteractionSignals, interactionSignals } from "../../interaction.js";
import {
  attachToolResults,
  contentToEvents,
  home,
  parseJsonLine,
  readHeadLines,
  readJsonl,
  statOrNull,
} from "./shared.js";

/**
 * OMP: ~/.omp/agent/sessions/<escaped-cwd>/<session>.jsonl
 *
 * A top-level session starts with a title record, then a session record. Spawned sessions
 * live below a directory named for their parent session. OMP is kept as its own harness
 * even though its message blocks resemble Pi's: provenance and child-session semantics
 * must not be lost by reusing the Pi adapter.
 */

const HEADER_LINES = 40;

export const name = "omp";

export function storeRoot() {
  return home(".omp", "agent", "sessions");
}

/**
 * Walk the whole store without following symbolic links. This makes recursive discovery
 * safe when a store contains a link back to one of its parent directories.
 *
 * @param {{ cutoffMs?: number }} [options]
 */
export function enumerate({ cutoffMs } = {}) {
  const out = [];
  const seen = new Set();
  walk(storeRoot());
  return out;

  function walk(dir) {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));

    for (const entry of entries) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(file);
        continue;
      }
      if (!entry.isFile() || !entry.name.endsWith(".jsonl")) continue;

      const stat = statOrNull(file);
      if (!stat || (cutoffMs && stat.mtimeMs < cutoffMs)) continue;
      const key = realpathOrResolve(file);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ key, path: file, mtimeMs: stat.mtimeMs, bytes: stat.size });
    }
  }
}

export function classify(candidate) {
  let titleEntry = null;
  let sessionEntry = null;
  let model = null;
  for (const line of readHeadLines(candidate.path, HEADER_LINES)) {
    const entry = parseJsonLine(line);
    if (!entry) continue;
    if (entry.type === "title" && !titleEntry) titleEntry = entry;
    if (entry.type === "session" && !sessionEntry) sessionEntry = entry;
    if (entry.type === "model_change") model = model || modelFrom(entry);
  }
  if (!sessionEntry?.cwd) return null;

  const parentPath = parentSessionPath(candidate.path);
  const isChild = Boolean(parentPath);
  const title =
    stringOrNull(titleEntry?.title) || stringOrNull(sessionEntry.title) || fallbackTitle(candidate, isChild);
  return {
    id: stringOrNull(sessionEntry.id) || path.basename(candidate.path, ".jsonl"),
    cwd: sessionEntry.cwd,
    gitRoot: stringOrNull(sessionEntry.git_root || sessionEntry.gitRoot),
    gitBranch: stringOrNull(sessionEntry.git_branch || sessionEntry.gitBranch),
    remotes: recordedRemotes(sessionEntry),
    title,
    startedAt: timestampMs(sessionEntry.timestamp, candidate.mtimeMs),
    model: model || stringOrNull(sessionEntry.model),
    extra: {
      titleSource: stringOrNull(titleEntry?.source),
      source: stringOrNull(titleEntry?.source),
      isChild,
      parentPath,
    },
    interactionSignals: isChild ? interactionSignals({ parentId: parentPath }) : emptyInteractionSignals(),
  };
}

export function read(ref) {
  const entries = readJsonl(ref.path);
  const events = [];
  let model = ref.model || null;

  for (const entry of entries) {
    if (entry.type === "model_change") {
      model = model || modelFrom(entry);
      continue;
    }
    if (entry.type !== "message" || !entry.message) continue;

    const message = entry.message;
    const role = message.role;
    if (role === "toolResult") {
      const isError = message.isError === true || message.is_error === true;
      events.push({
        kind: "tool-result",
        id: message.toolCallId ?? message.tool_call_id ?? message.id,
        result: textOf(message.content),
        status: isError ? "error" : "completed",
      });
      continue;
    }
    if (role !== "user" && role !== "assistant") continue;
    contentToEvents(role, message.content, events);
  }

  return { events: attachToolResults(events), model };
}

function modelFrom(entry) {
  return stringOrNull(entry.model) || stringOrNull(entry.modelId);
}

function recordedRemotes(session) {
  const values = session.git_remotes || session.gitRemotes || session.remotes;
  return Array.isArray(values) ? values.filter((value) => typeof value === "string" && value.trim()) : [];
}

function stringOrNull(value) {
  return typeof value === "string" && value.trim() ? value : null;
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

function textOf(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((block) => (typeof block === "string" ? block : (block?.text ?? block?.output ?? "")))
      .filter(Boolean)
      .join("\n");
  }
  if (content && typeof content === "object") return content.text ?? content.output ?? content;
  return content;
}

function fallbackTitle(candidate, isChild) {
  return isChild ? path.basename(candidate.path, ".jsonl") : null;
}

function parentSessionPath(file) {
  const relative = path.relative(storeRoot(), file);
  if (relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) return null;
  const parts = relative.split(path.sep);
  if (parts.length < 3) return null;
  const parentName = parts[parts.length - 2];
  return path.join(storeRoot(), ...parts.slice(0, -2), `${parentName}.jsonl`);
}

function realpathOrResolve(file) {
  try {
    return fs.realpathSync(file);
  } catch {
    return path.resolve(file);
  }
}
