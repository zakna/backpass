#!/usr/bin/env node
/**
 * Converts a StrykerJS `mutation.json` report (mutation-testing-report-schema) into the
 * SonarQube generic issue format, so mutants the tests did not catch show up as issues on
 * the dashboard. Only Survived and NoCoverage mutants become issues; the mutation score
 * stays in Stryker's own report.
 *
 *   node scripts/stryker-sonar.js mutation.json sonar-mutants.json
 *
 * Stryker positions are 1-based lines and columns; SonarQube wants 1-based lines and
 * 0-based columns, and rejects the whole report when an offset lies past the end of its
 * line, so every range is clamped to the source text Stryker embeds in the report.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ENGINE = "stryker";

/** The Stryker statuses that become issues, mapped to their rule. */
const RULES = {
  Survived: {
    id: "stryker.survived",
    name: "Mutant survived the tests",
    description: "StrykerJS changed this code and every test still passed, so no test checks this behaviour.",
    engineId: ENGINE,
    cleanCodeAttribute: "TESTED",
    impacts: [{ softwareQuality: "MAINTAINABILITY", severity: "MEDIUM" }],
  },
  NoCoverage: {
    id: "stryker.no-coverage",
    name: "Mutant not covered by any test",
    description: "No test runs this code, so StrykerJS could not test the mutant.",
    engineId: ENGINE,
    cleanCodeAttribute: "TESTED",
    impacts: [{ softwareQuality: "MAINTAINABILITY", severity: "LOW" }],
  },
};

const MAX_MESSAGE = 1000;

/**
 * @param {{ files?: Record<string, { source?: string, mutants?: any[] }> }} report
 * @param {{ projectRoot?: string }} [options] root that report file names are made relative to
 */
export function convert(report, { projectRoot = process.cwd() } = {}) {
  const issues = [];
  const used = new Set();
  for (const [fileName, file] of Object.entries(report?.files ?? {})) {
    const lines = (file.source ?? "").split(/\r?\n/);
    const filePath = path.relative(projectRoot, path.resolve(projectRoot, fileName)).split(path.sep).join("/");
    for (const mutant of file.mutants ?? []) {
      const rule = RULES[mutant.status];
      if (!rule) continue;
      used.add(mutant.status);
      issues.push({
        ruleId: rule.id,
        effortMinutes: 10,
        primaryLocation: {
          message: message(mutant),
          filePath,
          textRange: textRange(mutant.location, lines),
        },
      });
    }
  }
  const rules = Object.entries(RULES)
    .filter(([status]) => used.has(status))
    .map(([, rule]) => rule)
    .sort((a, b) => a.id.localeCompare(b.id));
  return { rules, issues };
}

function message(mutant) {
  const verb = mutant.status === "Survived" ? "survived the tests" : "is not covered by any test";
  const change = mutant.replacement === undefined ? "" : `: ${oneLine(mutant.replacement)}`;
  const text = `${mutant.mutatorName} mutant ${verb}${change}`;
  return text.length > MAX_MESSAGE ? `${text.slice(0, MAX_MESSAGE - 3)}...` : text;
}

function oneLine(text) {
  return String(text).replaceAll(/\s+/g, " ").trim();
}

/** A SonarQube text range for a Stryker location, or the start line alone when it cannot be placed. */
function textRange(location, lines) {
  const startLine = clampLine(location?.start?.line, lines);
  const endLine = Math.max(startLine, clampLine(location?.end?.line, lines));
  const startColumn = clampColumn(location?.start?.column, lines[startLine - 1]);
  const endColumn = clampColumn(location?.end?.column, lines[endLine - 1]);
  if (startColumn === undefined || endColumn === undefined || (startLine === endLine && endColumn <= startColumn)) {
    return { startLine };
  }
  return { startLine, startColumn, endLine, endColumn };
}

function clampLine(line, lines) {
  if (!Number.isInteger(line) || line < 1) return 1;
  return Math.min(line, Math.max(lines.length, 1));
}

function clampColumn(column, lineText) {
  if (!Number.isInteger(column) || column < 1 || lineText === undefined) return undefined;
  return Math.min(column - 1, lineText.length);
}

function main(argv) {
  if (argv.length !== 2) {
    process.stderr.write("usage: stryker-sonar <mutation.json> <sonar-issues.json>\n");
    return 2;
  }
  const [input, output] = argv;
  let report;
  try {
    report = JSON.parse(fs.readFileSync(input, "utf8"));
  } catch (err) {
    process.stderr.write(`read Stryker report: ${err.message}\n`);
    return 1;
  }
  const result = convert(report);
  fs.writeFileSync(output, `${JSON.stringify(result, null, 2)}\n`);
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
