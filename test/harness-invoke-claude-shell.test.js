import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { prepareHarnessInvocation } from "../src/harness-invoke.js";

/**
 * Claude agents launched by backpass prefer bash for their shell tool when available: zsh
 * aborts an unquoted `--include=*.md` with `no matches found`. Only the Claude invocation carries it.
 */

const posix = process.platform !== "win32";

function withEnv(overrides, fn) {
  const saved = {};
  for (const key of Object.keys(overrides)) {
    saved[key] = process.env[key];
    if (overrides[key] === undefined) delete process.env[key];
    else process.env[key] = overrides[key];
  }
  try {
    return fn();
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

function fakeBashDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "backpass-claude-shell-"));
  const bash = path.join(dir, "bash");
  fs.writeFileSync(bash, "#!/bin/sh\n");
  fs.chmodSync(bash, 0o755);
  const pi = path.join(dir, "pi");
  fs.writeFileSync(pi, "#!/bin/sh\n");
  fs.chmodSync(pi, 0o755);
  return { dir, bash };
}

test("claude invocation resolves bash from PATH", { skip: !posix }, () => {
  const { dir, bash } = fakeBashDir();
  try {
    for (const opts of [{}, { model: "m" }, { writeAccess: true }, { effort: "high", writeAccess: true }]) {
      withEnv({ CLAUDE_CODE_SHELL: undefined, PATH: dir }, () => {
        const invocation = prepareHarnessInvocation({ agent: "claude", ...opts });
        assert.deepEqual(invocation.env, { CLAUDE_CODE_SHELL: bash });
        invocation.dispose();
      });
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("an already-set CLAUDE_CODE_SHELL wins over PATH resolution", { skip: !posix }, () => {
  const { dir } = fakeBashDir();
  try {
    withEnv({ CLAUDE_CODE_SHELL: "/opt/custom/bash", PATH: dir }, () => {
      const invocation = prepareHarnessInvocation({ agent: "claude" });
      assert.deepEqual(invocation.env, { CLAUDE_CODE_SHELL: "/opt/custom/bash" });
    });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("claude without any bash on PATH leaves the harness default", { skip: !posix }, () => {
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), "backpass-claude-nobash-"));
  try {
    withEnv({ CLAUDE_CODE_SHELL: undefined, PATH: empty }, () => {
      assert.equal(prepareHarnessInvocation({ agent: "claude" }).env, undefined);
    });
  } finally {
    fs.rmSync(empty, { recursive: true, force: true });
  }
});

test("other harnesses never get CLAUDE_CODE_SHELL", { skip: !posix }, () => {
  const { dir } = fakeBashDir();
  try {
    withEnv({ CLAUDE_CODE_SHELL: undefined, PI_ACP_PI_COMMAND: undefined, PATH: dir }, () => {
      for (const opts of [
        { agent: "codex" },
        { agent: "opencode" },
        { agent: "opencode", model: "m" },
        { agent: "pi" },
        { agent: "some-other-agent" },
      ]) {
        const invocation = prepareHarnessInvocation(opts);
        assert.equal(invocation.env?.CLAUDE_CODE_SHELL, undefined, `${opts.agent} must not carry it`);
        invocation.dispose();
      }
      const pi = prepareHarnessInvocation({ agent: "pi", effort: "high" });
      assert.equal(pi.env?.CLAUDE_CODE_SHELL, undefined);
      pi.dispose();
    });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
