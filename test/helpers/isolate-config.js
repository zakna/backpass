import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Test-suite isolation for the user configuration file.
 *
 * `userConfigPath()` in `src/config.js` resolves `$XDG_CONFIG_HOME/backpass/config.json`,
 * falling back to `~/.config`. Without this module a developer's own configuration is a
 * silent layer under every `loadConfig` call and under every CLI subprocess a test spawns,
 * so the suite passes only on a machine that has no configuration at all.
 *
 * `package.json`'s test script loads this through `--import`, which `node --test`
 * forwards to each test file's child process, so the redirect is in place before any
 * test module is evaluated. Run a single file the same way
 * (`node --import ./test/helpers/isolate-config.js --test test/config.test.js`);
 * running one bare is exactly the unisolated case this exists to prevent.
 *
 * The directory is left empty on purpose: an absent file is the state the defaults and
 * the layering tests assert about. Tests that need a configuration still write one into
 * their own `XDG_CONFIG_HOME`, and this only changes what they save and restore around it.
 */

const configHome = fs.mkdtempSync(path.join(os.tmpdir(), "backpass-test-config-"));
process.env.XDG_CONFIG_HOME = configHome;

process.on("exit", () => {
  fs.rmSync(configHome, { recursive: true, force: true });
});
