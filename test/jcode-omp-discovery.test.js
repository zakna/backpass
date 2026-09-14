import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { loadConfig } from "../src/config.js";
import { discoverTranscripts } from "../src/discovery/index.js";
import { State } from "../src/state.js";

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");

function writeFixture(target, fixtureName, cwd) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const text = fs.readFileSync(path.join(FIXTURES, fixtureName), "utf8").replaceAll("/repo/demo", cwd);
  fs.writeFileSync(target, text);
}

test("discovery keeps Jcode and OMP content sources separate and associates both with the repo", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "backpass-jcode-omp-discovery-home-"));
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "backpass-jcode-omp-discovery-repo-"));
  const jcodeFile = path.join(home, ".jcode", "sessions", "session-jcode.json");
  const ompFile = path.join(home, ".omp", "agent", "sessions", "-.agents", "session-omp.jsonl");
  writeFixture(jcodeFile, "jcode-session.json", repoRoot);
  writeFixture(ompFile, "omp-session.jsonl", repoRoot);

  const previousHome = process.env.HOME;
  process.env.HOME = home;
  try {
    const config = loadConfig(repoRoot, {
      discovery: { harnesses: ["jcode", "omp"], since: "all" },
    });
    config.state = new State(repoRoot).ensure();
    const result = await discoverTranscripts({
      repo: { root: repoRoot, name: path.basename(repoRoot), worktrees: [repoRoot], remotes: [] },
      config,
      strict: true,
    });

    assert.deepEqual(result.transcripts.map((transcript) => transcript.harness).sort(), ["jcode", "omp"]);
    assert.ok(result.transcripts.every((transcript) => transcript.association.tier === 1));
    assert.equal(result.transcripts.find((transcript) => transcript.harness === "jcode").model, "gpt-5.6-sol");
    assert.equal(
      result.transcripts.find((transcript) => transcript.harness === "omp").model,
      "openai-codex/gpt-5.6-sol",
    );
  } finally {
    if (previousHome === undefined) delete process.env.HOME;
    else process.env.HOME = previousHome;
  }
});
