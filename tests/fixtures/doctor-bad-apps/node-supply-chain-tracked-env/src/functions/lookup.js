// BAD: SC-109 (Tier 2) — hardcoded credentials in source. The connection
// string with embedded password should never be in source; it should come
// from app settings via process.env.
const { app } = require('@azure/functions');

// BAD: hardcoded production-looking secret
const DB_PASSWORD = 'P@ssw0rd!ProductionDB2024';
const AWS_ACCESS_KEY_ID = 'AKIAIOSFODNN7EXAMPLE';

const CONNECTION = `Server=prod-db.example.com;User=admin;Password=${DB_PASSWORD}`;

app.http('lookup', {
  methods: ['GET'],
  authLevel: 'function',
  handler: async (request, context) => {
    context.log('connecting to', CONNECTION);
    return { body: 'ok' };
  },
});
