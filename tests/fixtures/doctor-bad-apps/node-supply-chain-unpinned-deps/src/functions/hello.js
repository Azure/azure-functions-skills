// BAD: unpinned-prod-deps + missing-lockfile. The package.json above uses ^,
// *, and "latest" specifiers without a committed lockfile. Each `npm install`
// can resolve to a different newer version — a compromised release of any
// of these deps gets auto-installed.
const { app } = require('@azure/functions');

app.http('hello', {
  methods: ['GET'],
  authLevel: 'function',
  handler: async (request, context) => {
    return { body: 'hello' };
  },
});
