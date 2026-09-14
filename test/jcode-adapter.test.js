import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import * as jcode from "../src/discovery/adapters/jcode.js";
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

test("jcode adapter classifies and reads a saved session", () => {
  const file = path.join(FIXTURES, "jcode-session.json");
  const descriptor = jcode.classify(candidateFor(file));

  assert.equal(descriptor.id, "jcode-123");
  assert.equal(descriptor.cwd, "/repo/demo");
  assert.equal(descriptor.title, "Parser maintenance");
  assert.equal(descriptor.model, "gpt-5.6-sol");
  assert.equal(descriptor.startedAt, Date.parse("2026-08-27T10:00:00.000Z"));
  assert.deepEqual(descriptor.remotes, []);
  assert.equal(descriptor.extra.providerKey, "openai-codex");
  assert.equal(descriptor.extra.isDebug, true);

  const { events, model } = jcode.read({ path: file });
  assert.equal(model, "gpt-5.6-sol");
  assert.deepEqual(
    messages(events).map((event) => `${event.role}: ${event.text}`),
    ["user: Inspect the parser.", "assistant: I will read the parser.", "assistant: The parser is correct."],
  );
  assert.ok(!JSON.stringify(events).includes("internal reasoning"), "reasoning must not survive");

  const [toolCall] = tools(events);
  assert.equal(toolCall.name, "read");
  assert.deepEqual(toolCall.input, { path: "parser.js" });
  assert.equal(toolCall.result, "parser source");
  assert.equal(toolCall.status, "completed");
});

test("jcode adapter enumerates only canonical saved JSON sessions", () => {
  const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), "backpass-jcode-home-"));
  const store = path.join(fakeHome, ".jcode", "sessions");
  fs.mkdirSync(store, { recursive: true });
  fs.copyFileSync(path.join(FIXTURES, "jcode-session.json"), path.join(store, "canonical.json"));
  fs.copyFileSync(path.join(FIXTURES, "jcode-session.json"), path.join(store, "canonical.json.bak"));
  fs.writeFileSync(path.join(store, "journal.jsonl"), "{}\n");
  fs.writeFileSync(path.join(store, "broken.json"), '{"id":');

  const previousHome = process.env.HOME;
  process.env.HOME = fakeHome;
  try {
    assert.deepEqual(
      jcode
        .enumerate()
        .map((candidate) => path.basename(candidate.path))
        .sort(),
      ["broken.json", "canonical.json"],
    );
    assert.equal(jcode.classify(candidateFor(path.join(store, "broken.json"))), null);
  } finally {
    if (previousHome === undefined) delete process.env.HOME;
    else process.env.HOME = previousHome;
  }
});
