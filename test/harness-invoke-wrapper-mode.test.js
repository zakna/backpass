import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { prepareHarnessInvocation } from "../src/harness-invoke.js";

test(
  "argv wrapper script is executable by its owner only",
  { skip: process.platform === "win32" },
  () => {
    const invocation = prepareHarnessInvocation({ agent: "codex", writeAccess: true });
    try {
      const wrapper = invocation.env.CODEX_PATH;
      assert.ok(wrapper, "codex overlay should produce a wrapper");
      const mode = fs.statSync(wrapper).mode & 0o777;
      assert.equal(mode & 0o700, 0o700, "owner can execute");
      assert.equal(mode & 0o077, 0, `group/other get no access, got ${mode.toString(8)}`);
    } finally {
      invocation.dispose();
    }
  },
);
