// BAD: lifecycle-scripts — this script runs on every `npm install` and could be
// abused to drop a second-stage payload (the durabletask pattern). Doctor's
// lifecycle-scripts Tier 1 check flags any package.json with preinstall /
// postinstall.
console.log('post-install hook running');
