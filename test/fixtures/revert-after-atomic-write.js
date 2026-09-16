import fs from "node:fs";

const target = process.env.BACKPASS_TEST_REVERT_TARGET;
const text = process.env.BACKPASS_TEST_REVERT_TEXT;
const renameSync = fs.renameSync;
let reverted = false;

fs.renameSync = function revertAfterAtomicWrite(source, destination) {
  const result = renameSync.call(this, source, destination);
  if (!reverted && target && text !== undefined && destination === target) {
    reverted = true;
    fs.writeFileSync(destination, text);
  }
  return result;
};
