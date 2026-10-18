import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

const script = new URL("../scripts/quality-scan.sh", import.meta.url).pathname;

test("SONAR_REQUIRED=1 aborts before any work when SONAR_TOKEN is empty", () => {
  const env = { ...process.env, SONAR_REQUIRED: "1", SONAR_TOKEN: "" };
  const result = spawnSync("bash", [script], { env, encoding: "utf8" });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /aborted \(SONAR_REQUIRED=1 and SONAR_TOKEN is empty\)/);
  assert.doesNotMatch(result.stdout, /node --test/);
});
