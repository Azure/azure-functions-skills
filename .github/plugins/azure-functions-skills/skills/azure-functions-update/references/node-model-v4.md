# Node.js Programming Model v4

Use this reference to migrate JavaScript or TypeScript from programming model v3 to v4.

- Start with the [official migration guide](https://learn.microsoft.com/en-us/azure/azure-functions/functions-node-upgrade-v4). Select JavaScript or TypeScript.
- For binding or API details, use the applicable section of the [Node.js developer guide](https://learn.microsoft.com/en-us/azure/azure-functions/functions-reference-node?pivots=nodejs-model-v4).

The v3 and v4 programming models cannot run together in one app. Registration of a v4 function causes v3 functions to be ignored. Verify all expected functions, not only the changed endpoint.