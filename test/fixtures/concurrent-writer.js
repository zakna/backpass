import fs from "node:fs";

/**
 * A second writer that lands at one named point inside apply's own write sequence.
 *
 * A test cannot aim an out-of-process write at a single step of that sequence. The window
 * between a file's atomic rename and its post-write verification is microseconds wide, so
 * a poller watching the file from outside falls on either side of it by luck, and the two
 * sides produce different (both correct) failure reports. Hooking the rename the writer is
 * about to make replaces that coin flip with a chosen interleaving.
 *
 * `BACKPASS_TEST_CHANGE_ON_RENAME` is the rename destination that triggers, and
 * `BACKPASS_TEST_CHANGE_WHEN` picks the side: `before` leaves the target a verified commit
 * of an earlier step, `after` lands inside that target's own verification window. Every
 * entry of the `BACKPASS_TEST_CHANGE_WRITES` JSON object (path -> text) is then written.
 * It fires once, so rollback's rename onto the same target cannot re-trigger it.
 */
const trigger = process.env.BACKPASS_TEST_CHANGE_ON_RENAME;
const afterRename = process.env.BACKPASS_TEST_CHANGE_WHEN === "after";
const writes = JSON.parse(process.env.BACKPASS_TEST_CHANGE_WRITES ?? "{}");
const renameSync = fs.renameSync;
let fired = false;

fs.renameSync = function concurrentWriter(source, destination) {
  const triggered = !fired && Boolean(trigger) && destination === trigger;
  if (triggered && !afterRename) fired = write();
  const result = renameSync.call(this, source, destination);
  if (triggered && afterRename) fired = write();
  return result;
};

function write() {
  for (const [file, text] of Object.entries(writes)) fs.writeFileSync(file, text);
  return true;
}
