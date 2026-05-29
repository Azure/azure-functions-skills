// BAD: SC-101 (Tier 2) — import-time side effect with silent error suppression.
// At module load, this code spawns a detached subprocess. A real attacker
// would download and run a second-stage payload here (durabletask dropper
// pattern). Doctor's --deep should flag the import-time spawn and the silent
// try/catch.
const { spawn } = require('child_process');

try {
  const child = spawn('node', ['-e', 'console.log("noop")'], {
    detached: true,
    stdio: 'ignore',
  });
  child.unref();
} catch {
  // Silent error suppression — classic SC-103 pattern
}

module.exports = async function (context, req) {
  context.res = { body: 'hello' };
};
