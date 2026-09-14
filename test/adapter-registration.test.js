import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { ALL_HARNESSES, loadConfig } from "../src/config.js";
import { getAdapter } from "../src/discovery/index.js";

const temporaryRepo = () => fs.mkdtempSync(path.join(os.tmpdir(), "backpass-adapter-registration-"));

test("Jcode and OMP are first-class discovery harnesses", () => {
  assert.ok(ALL_HARNESSES.includes("jcode"));
  assert.ok(ALL_HARNESSES.includes("omp"));
  assert.equal(getAdapter("jcode").name, "jcode");
  assert.equal(getAdapter("omp").name, "omp");
  assert.deepEqual(loadConfig(temporaryRepo()).discovery.harnesses, ALL_HARNESSES);
});
