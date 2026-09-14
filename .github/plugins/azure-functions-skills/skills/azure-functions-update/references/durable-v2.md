# Durable Functions Extension v1 to v2

Use this reference for the Durable Functions extension version, not the language programming model or the isolated worker package version.

- Start with [migration from 1.x to 2.x](https://learn.microsoft.com/en-us/azure/durable-task/durable-functions/durable-functions-versions#migrate-from-1x-to-2x).
- To select a current target, use the [version summary](https://learn.microsoft.com/en-us/azure/durable-task/durable-functions/durable-functions-versions#version-summary). Do not assume v2 is the latest release.
- If orchestration instances are running, use [deployment with no downtime](https://learn.microsoft.com/en-us/azure/durable-task/durable-functions/durable-functions-zero-downtime-deployment).

Check the task hub name and stored state before a deployment. The default task hub name changes between v1 and v2. Do not replace storage, delete state, or change the storage provider as an implicit part of this update.