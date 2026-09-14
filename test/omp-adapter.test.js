import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import * as omp from "../src/discovery/adapters/omp.js";
import { NON_INTERACTIVE, classifyInteraction } from "../src/interaction.js";
import { statOrNull } from "../src/discovery/adapters/shared.js";

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");

function candidateFor(file) {
  const stat = statOrNull(file);
  return { key: file, path: file, mtimeMs: stat.mtimeMs, bytes: stat.size };
}

function messages(events) {
  return events.filter((event) => event.kind === "message");
}

function tools(events) {
  return events.filter((event) => event.kind === "tool");
}

test("omp adapter reads a title-first session and folds tool results", () => {
  const file = path.join(FIXTURES, "omp-session.jsonl");
  const descriptor = omp.classify(candidateFor(file));

  assert.equal(descriptor.id, "omp-123");
  assert.equal(descriptor.cwd, "/repo/demo");
  assert.equal(descriptor.title, "OMP parser review");
  assert.equal(descriptor.model, "openai-codex/gpt-5.6-sol");
  assert.equal(descriptor.startedAt, Date.parse("2026-08-28T10:00:00.000Z"));
  assert.equal(descriptor.extra.isChild, false);
  assert.equal(descriptor.extra.titleSource, "user");

  const { events, model } = omp.read({ path: file });
  assert.equal(model, "openai-codex/gpt-5.6-sol");
  assert.deepEqual(
    messages(events).map((event) => `${event.role}: ${event.text}`),
    ["user: Inspect the parser.", "assistant: I will read the parser.", "assistant: The parser is correct."],
  );
  assert.ok(!JSON.stringify(events).includes("internal reasoning"), "thinking must not survive");

  const [toolCall] = tools(events);
  assert.equal(toolCall.name, "read");
  assert.deepEqual(toolCall.input, { path: "parser.js" });
  assert.equal(toolCall.result, "parser source");
  assert.equal(toolCall.status, "completed");
});

test("omp adapter recursively discovers sessions and marks nested sessions", () => {
  const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), "backpass-omp-home-"));
  const store = path.join(fakeHome, ".omp", "agent", "sessions", "-.agents");
  const parent = path.join(store, "parent");
  const deeper = path.join(parent, "review");
  fs.mkdirSync(deeper, { recursive: true });
  const fixture = path.join(FIXTURES, "omp-session.jsonl");
  fs.copyFileSync(fixture, path.join(store, "parent.jsonl"));
  fs.copyFileSync(fixture, path.join(parent, "child.jsonl"));
  fs.copyFileSync(fixture, path.join(deeper, "grandchild.jsonl"));
  fs.writeFileSync(path.join(store, "not-a-session.txt"), "ignored\n");

  const previousHome = process.env.HOME;
  process.env.HOME = fakeHome;
  try {
    const candidates = omp.enumerate();
    assert.deepEqual(candidates.map((candidate) => path.basename(candidate.path)).sort(), [
      "child.jsonl",
      "grandchild.jsonl",
      "parent.jsonl",
    ]);

    const child = omp.classify(candidates.find((candidate) => candidate.path.endsWith("/child.jsonl")));
    assert.equal(child.extra.isChild, true);
    assert.equal(child.extra.parentPath, path.join(store, "parent.jsonl"));
    assert.equal(
      classifyInteraction({ harness: "omp", interactionSignals: child.interactionSignals }),
      NON_INTERACTIVE,
    );
  } finally {
    if (previousHome === undefined) delete process.env.HOME;
    else process.env.HOME = previousHome;
  }
});

test("omp adapter ignores a truncated final record", () => {
  const file = path.join(FIXTURES, "omp-session-truncated.jsonl");
  const descriptor = omp.classify(candidateFor(file));
  assert.equal(descriptor.id, "omp-truncated");

  const { events } = omp.read({ path: file });
  assert.deepEqual(
    messages(events).map((event) => event.text),
    ["before truncation"],
  );
});
