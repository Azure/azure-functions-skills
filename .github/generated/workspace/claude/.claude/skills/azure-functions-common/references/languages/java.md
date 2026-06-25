# Azure Functions Diagnostics Reference — Java

Use this file when investigating Azure Functions issues involving Java apps, the Java worker, annotations, Maven deployment, Java dependency versions, or Java runtime support.

## Public repositories

| Repository | URL | Use |
|-----------|-----|-----|
| azure-functions-java-worker | https://github.com/Azure/azure-functions-java-worker | Java worker runtime, gRPC server, loader, invocation handling |
| azure-functions-java-library | https://github.com/Azure/azure-functions-java-library | Java annotations and Azure Functions types |
| azure-functions-java-additions | https://github.com/Azure/azure-functions-java-additions | Java core library, SDK types, optional libraries |
| azure-maven-plugins | https://github.com/microsoft/azure-maven-plugins | Maven deployment and build integration |
| azure-functions-host | https://github.com/Azure/azure-functions-host | Host/runtime behavior that affects Java apps |

## Public documentation and registries

| Topic | URL |
|------|-----|
| Java developer guide | https://learn.microsoft.com/en-us/azure/azure-functions/functions-reference-java |
| Quarkus integration | https://learn.microsoft.com/en-us/azure/azure-functions/functions-create-first-quarkus |
| Spring Cloud Function on Azure | https://learn.microsoft.com/en-us/azure/developer/java/spring-framework/getting-started-with-spring-cloud-function-in-azure |
| Maven Central | https://search.maven.org/ |
| Supported languages | https://learn.microsoft.com/en-us/azure/azure-functions/supported-languages |
| Best practices | https://learn.microsoft.com/en-us/azure/azure-functions/functions-best-practices |
| Diagnostics overview | https://learn.microsoft.com/en-us/azure/azure-functions/functions-diagnostics |

## Investigation guidance

- Check official docs, Java worker issues/wiki, and related host/library issues before root-cause recommendations.
- Search `Azure/azure-functions-java-worker`, `Azure/azure-functions-java-library`, and `Azure/azure-functions-host` when the issue spans worker and host boundaries.
- Compare Maven Central metadata when dependency changes are suspected.
- Public host PR examples for Java-related host changes: https://github.com/Azure/azure-functions-host/pull/8365, https://github.com/Azure/azure-functions-host/pull/9084, https://github.com/Azure/azure-functions-host/pull/10231.