import { app } from '@azure/functions';

app.http('triage', {
  methods: ['POST'],
  authLevel: 'function',
  handler: async request => {
    const text = await request.text();
    const route = /urgent|outage/i.test(text) ? 'on-call' : 'manual-review';
    return { jsonBody: { route } };
  },
});
