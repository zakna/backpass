import fs from "node:fs";
import path from "node:path";

import { normalizeRemote } from "../repo.js";

/**
 * Association tiers (design section 2.1, plus sibling clones).
 *
 *   tier 1    deterministic  - transcript cwd is (or sits under) a live worktree path
 *   tier 1.5  deterministic  - live cwd under a local clone that shares a git remote
 *                              (sibling worktrees `git worktree list` cannot see).
 *                              Survives `--strict`. Claude records no remote, so this
 *                              is how a second clone's interactive history attaches.
 *   tier 2    deterministic  - a recorded git remote matches one of the repo's remotes;
 *                              survives worktree deletion (codex, grok)
 *   tier 3    best-effort    - dead cwd whose last segment is the repo dir name, or that
 *                              matches a user-supplied worktree glob; excluded by --strict
 *
 * Returns null when the transcript belongs to some other repo.
 */

function realpathOrResolve(p) {
  try {
    return fs.realpathSync(p);
  } catch {
    return path.resolve(p);
  }
}

function isUnder(child, parent) {
  if (child === parent) return true;
  return child.startsWith(parent.endsWith(path.sep) ? parent : parent + path.sep);
}

/**
 * Glob support is intentionally minimal: `*` (one segment) and `**` (many).
 * `home` is the machine the glob describes - the remote host's home for a remote
 * session, so `~/work/*` means the same thing on both sides of an ssh connection.
 */
export function globToRegExp(glob, { home = process.env.HOME || "" } = {}) {
  const expanded = glob.startsWith("~/") ? path.posix.join(home, glob.slice(2)) : glob;
  let out = "";
  for (let i = 0; i < expanded.length; i += 1) {
    const c = expanded[i];
    if (c === "*") {
      if (expanded[i + 1] === "*") {
        out += ".*";
        i += 1;
        if (expanded[i + 1] === "/") i += 1;
      } else {
        out += "[^/]*";
      }
    } else if ("\\^$.|?+()[]{}".includes(c)) {
      out += `\\${c}`;
    } else {
      out += c;
    }
  }
  return new RegExp(`^${out}/?$`);
}

/** Tier 1 / 1.5 - a live path under one of `worktrees`, or exactly one of them. */
function liveWorktreeMatch(candidates, worktrees, hit) {
  for (const candidate of candidates) {
    const real = realpathOrResolve(candidate);
    for (const worktree of worktrees) {
      if (real === worktree) return hit(worktree, true);
      if (isUnder(real, worktree)) return hit(worktree, false);
    }
  }
  return null;
}

/** Tier 2 - the first recorded remote this repo also has, or null. */
function recordedRemoteMatch(remotes, repoRemotes, suffix = "") {
  for (const remote of remotes) {
    const norm = normalizeRemote(remote);
    if (norm && repoRemotes.has(norm)) {
      return { tier: 2, confidence: "remote", reason: `recorded remote ${norm}${suffix}` };
    }
  }
  return null;
}

/** Tier 3 - the association for one dead path, or null. */
function deadPathMatch(resolved, repo, globs, test, where, flavor = path) {
  if (flavor.basename(resolved.replace(/\/+$/, "")) === repo.name) {
    return { tier: 3, confidence: "path", reason: `dead path ending in /${repo.name}${where}` };
  }
  for (const glob of globs) {
    if (test(glob)) {
      return { tier: 3, confidence: "glob", reason: `dead path matches glob ${glob}${where}` };
    }
  }
  return null;
}

/** Tiers 1, 1.5 and 2 - everything decidable without a path being dead. */
function liveAssociation(candidates, remotes, repo) {
  // Tier 1 - live path under a known worktree of this clone.
  const live = liveWorktreeMatch(candidates, repo.worktrees, (worktree, exact) => ({
    tier: 1,
    confidence: exact ? "exact" : "nested",
    reason: exact ? `cwd is worktree ${worktree}` : `cwd is inside worktree ${worktree}`,
  }));
  if (live) return live;

  // Tier 1.5 - live path under a sibling clone that shares a remote.
  const sibling = liveWorktreeMatch(candidates, repo.siblingWorktrees || [], (worktree, exact) => ({
    tier: 1.5,
    confidence: "sibling",
    reason: exact ? `cwd is sibling clone ${worktree}` : `cwd is inside sibling clone ${worktree}`,
  }));
  if (sibling) return sibling;

  // Tier 2 - recorded remote, valid even when the worktree is long gone.
  return recordedRemoteMatch(remotes, new Set(repo.remotes));
}

export function associate(descriptor, repo, options = {}) {
  if (options.facts) return associateRemote(descriptor, repo, options);
  const { cwd, remotes = [], gitRoot = null } = descriptor;
  const globs = options.worktreeGlobs || [];
  const candidates = [cwd, gitRoot].filter(Boolean);

  const found = liveAssociation(candidates, remotes, repo);
  if (found) return found;

  // Tier 3 - best-effort, only for paths that no longer exist.
  for (const candidate of candidates) {
    const resolved = path.resolve(candidate);
    if (fs.existsSync(resolved)) continue;
    const dead = deadPathMatch(resolved, repo, globs, (glob) => globToRegExp(glob).test(resolved), "");
    if (dead) return dead;
  }

  return null;
}

/**
 * Association for a session that ran on another machine (design section 6.5).
 *
 * The tier rules are the local ones, applied to facts computed where the paths are real
 * (`src/discovery/remote/git-facts.js`): whether the cwd still exists over there, which
 * checkout it sits in, and that checkout's git remotes. What changes is the ceiling.
 * Tier 1 means "this clone", and nothing on another host is this clone, so a remote
 * session is never tier 1 - it reaches tier 1.5 by sharing a remote with this repo,
 * which is the same bar a sibling clone clears here. That also means a second checkout
 * over there with no overlapping remote is never associated, matching the sibling rule.
 *
 * @param {{ cwd?: string, remotes?: string[], gitRoot?: string | null }} descriptor
 * @param {object} repo
 * @param {{ facts?: Record<string, object>, host?: string, home?: string, worktreeGlobs?: string[] }} [options]
 */
export function associateRemote({ cwd, remotes = [], gitRoot = null }, repo, options = {}) {
  const { facts = {}, host = "", home = "", worktreeGlobs: globs = [] } = options;
  const candidates = [cwd, gitRoot].filter(Boolean);
  const repoRemotes = new Set(repo.remotes);

  // Tier 1.5 - a live checkout over there that shares a remote with this repo.
  for (const candidate of candidates) {
    const fact = facts[candidate];
    if (!fact?.toplevel) continue;
    const shared = (fact.remotes || []).map(normalizeRemote).find((r) => r && repoRemotes.has(r));
    if (shared) {
      return { tier: 1.5, confidence: "remote-clone", reason: `cwd is in clone ${fact.toplevel} on ${host}` };
    }
  }

  // Tier 2 - a remote the transcript itself recorded (codex, grok).
  const recorded = recordedRemoteMatch(remotes, repoRemotes, ` (on ${host})`);
  if (recorded) return recorded;

  // Tier 3 - best-effort, only for paths that no longer exist over there.
  for (const candidate of candidates) {
    const fact = facts[candidate];
    if (fact?.exists) continue;
    const resolved = fact?.real || candidate;
    const dead = deadPathMatch(
      String(resolved),
      repo,
      globs,
      (glob) => globToRegExp(glob, { home }).test(resolved),
      ` on ${host}`,
      path.posix,
    );
    if (dead) return dead;
  }

  return null;
}

export function passesStrict(association, strict) {
  if (!association) return false;
  return strict ? association.tier <= 2 : true;
}
