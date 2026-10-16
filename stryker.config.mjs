// @ts-check
// StrykerJS mutation testing for backpass. scripts/quality-scan.sh runs it on
// the files changed since main on a branch and on every file on main; a plain
// `pnpm exec stryker run` mutates everything.
//
// There is no StrykerJS runner for node:test, so the tap runner runs each test
// file with `node`, whose test reporter prints TAP.

/**
 * Tests left out of mutation runs only; `pnpm test` still runs every one of
 * them. Stryker refuses to start unless its first, unmutated run is green, so
 * a test that cannot pass inside Stryker's sandbox goes here, by exact name.
 * @type {string[]}
 */
const excludedTests = [];

const escapeRegExp = (/** @type {string} */ s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** @type {import("@stryker-mutator/api/core").PartialStrykerOptions} */
export default {
  testRunner: "tap",
  // pnpm does not hoist plugins where Stryker's auto-discovery looks, so the
  // tap runner must be named explicitly ("no TestRunner plugins were loaded").
  plugins: ["@stryker-mutator/tap-runner"],
  tap: {
    testFiles: ["test/**/*.test.js"],
    nodeArgs: [
      "--test-reporter=tap",
      // Same isolation as `pnpm test`: never read the machine's own
      // ~/.config/backpass/config.json (see AGENTS.md).
      "--import",
      "./test/helpers/isolate-config.js",
      ...excludedTests.map((name) => `--test-skip-pattern=^${escapeRegExp(name)}$`),
      "-r",
      "{{hookFile}}",
      "{{testFile}}",
    ],
  },
  mutate: ["src/**/*.js", "bin/**/*.js", "scripts/**/*.js"],
  coverageAnalysis: "perTest",
  reporters: ["clear-text", "progress", "html", "json"],
  htmlReporter: { fileName: ".cache/quality/stryker/mutation.html" },
  jsonReporter: { fileName: ".cache/quality/stryker/mutation.json" },
  tempDirName: ".cache/stryker-tmp",
  ignorePatterns: [".cache", ".backpass", ".no-mistakes"],
  incrementalFile: ".cache/stryker/incremental.json",
  // Reporting only: the score is shown, never a gate.
  thresholds: { high: 80, low: 60, break: null },
};
