import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { convert } from "../scripts/stryker-sonar.js";

const SCRIPT = fileURLToPath(new URL("../scripts/stryker-sonar.js", import.meta.url));
const ROOT = "/repo";

const source = ["export function f(a) {", "  return a > 1;", "}"].join("\n");

function mutant(status, overrides = {}) {
  return {
    id: status,
    mutatorName: "EqualityOperator",
    replacement: "a >= 1",
    status,
    location: { start: { line: 2, column: 10 }, end: { line: 2, column: 15 } },
    ...overrides,
  };
}

test("only survived and not-covered mutants become issues", () => {
  const report = {
    files: {
      "src/f.js": {
        source,
        mutants: [
          mutant("Survived"),
          mutant("Killed"),
          mutant("NoCoverage", { mutatorName: "BooleanLiteral", replacement: "true" }),
          mutant("Timeout"),
          mutant("Ignored"),
        ],
      },
    },
  };
  const { rules, issues } = convert(report, { projectRoot: ROOT });

  assert.deepEqual(
    issues.map((i) => i.ruleId),
    ["stryker.survived", "stryker.no-coverage"],
  );
  assert.deepEqual(issues[0].primaryLocation, {
    message: "EqualityOperator mutant survived the tests: a >= 1",
    filePath: "src/f.js",
    textRange: { startLine: 2, startColumn: 9, endLine: 2, endColumn: 14 },
  });
  assert.match(issues[1].primaryLocation.message, /^BooleanLiteral mutant is not covered by any test: true$/);
  assert.deepEqual(
    rules.map((r) => [r.id, r.engineId, r.impacts.length]),
    [
      ["stryker.no-coverage", "stryker", 1],
      ["stryker.survived", "stryker", 1],
    ],
  );
});

test("absolute report paths are made relative to the project root", () => {
  const report = { files: { [path.join(ROOT, "src", "f.js")]: { source, mutants: [mutant("Survived")] } } };
  assert.equal(convert(report, { projectRoot: ROOT }).issues[0].primaryLocation.filePath, "src/f.js");
});

test("a range past the end of its line is clamped, never sent as an invalid offset", () => {
  const report = {
    files: {
      "src/f.js": {
        source,
        mutants: [mutant("Survived", { location: { start: { line: 2, column: 3 }, end: { line: 9, column: 80 } } })],
      },
    },
  };
  // Line 9 does not exist: the range ends at the last line, at its length.
  assert.deepEqual(convert(report, { projectRoot: ROOT }).issues[0].primaryLocation.textRange, {
    startLine: 2,
    startColumn: 2,
    endLine: 3,
    endColumn: 1,
  });
});

test("a location without usable columns keeps only its start line", () => {
  const report = {
    files: { "src/f.js": { source, mutants: [mutant("Survived", { location: { start: { line: 2 } } })] } },
  };
  assert.deepEqual(convert(report, { projectRoot: ROOT }).issues[0].primaryLocation.textRange, { startLine: 2 });
});

test("a report with no uncaught mutants writes empty lists", () => {
  // SonarQube rejects a report whose lists are missing, so both must be [].
  assert.deepEqual(convert({ files: {} }), { rules: [], issues: [] });
});

test("the CLI writes the issue file and rejects invalid JSON", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "stryker-sonar-"));
  try {
    const input = path.join(dir, "mutation.json");
    const output = path.join(dir, "sonar.json");
    fs.writeFileSync(input, JSON.stringify({ files: { "src/f.js": { source, mutants: [mutant("Survived")] } } }));
    const ok = spawnSync(process.execPath, [SCRIPT, input, output], { cwd: dir, encoding: "utf8" });
    assert.equal(ok.status, 0, ok.stderr);
    assert.equal(JSON.parse(fs.readFileSync(output, "utf8")).issues.length, 1);

    fs.writeFileSync(input, "not json");
    const bad = spawnSync(process.execPath, [SCRIPT, input, output], { cwd: dir, encoding: "utf8" });
    assert.equal(bad.status, 1);
    assert.match(bad.stderr, /read Stryker report/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
