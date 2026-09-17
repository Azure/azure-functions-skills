# Emulator selection

These are official documentation snapshots accessed on 2026-09-17, not image test
results. Select the service, variant, exact version/image digest, client SDK, binding
extension, protocol, API, persistence, quotas, and source date before accepting evidence.

| Service/variant | Useful local coverage | Material limits |
| --- | --- | --- |
| Azurite | Blob, Queue, Table APIs | No Files or ADLS Gen2; Table preview; not production scale |
| Service Bus emulator | AMQP TCP messaging; administration client entity management | No JMS, partitioned entities, AMQP WebSockets, Entra, VNet, autoscale, geo-DR, or large messages |
| Event Hubs emulator | AMQP and Kafka streaming | Kafka producer/consumer APIs only; no on-the-fly SDK management, Entra, VNet, Capture, schema registry, autoscale, or geo-DR |
| Cosmos DB Windows/legacy Linux | Selected APIs for the exact platform | Key/TLS access; no scale-out or geo-replication; platform-specific limits |
| Cosmos DB Linux vNext | NoSQL gateway mode, selected features | HTTP default; .NET/Java require HTTPS; some APIs return success without implementation |
| Event Grid/Key Vault | No official emulator identified in reviewed guidance | Local replay/fakes do not prove real service integration |

Service Bus depends on its SQL Server container; Event Hubs depends on Azurite.
Both messaging emulators lose data/entities across restart. JSON configuration changes
require restart. Service Bus guidance specifies sequential testing. Event Hubs Kafka
uses SASL plaintext and PLAIN; that does not test a customer's TLS transport.

Cosmos vNext lists Change Feed as supported, but verify the selected Functions trigger
extension. Custom index policy changes can return success without taking effect.
Do not accept that response as behavior proof. NoSQL gateway mode does not prove direct
mode. Use HTTPS and approved certificate trust for .NET/Java; never disable validation.
Its health probes show emulator health, not Functions listener readiness.

Cosmos vNext enables usage telemetry by default. Approve outbound data and destination
or disable it through documented configuration before startup.
Check equivalent telemetry and external effects for every selected emulator.

## Run boundary

Prefer an already available compatible emulator only within its ownership and permission.
Ask before downloads, licenses, image pulls, container start/stop, ports, volumes, or
certificate changes. Identify all dependent images, not just the broker.
Do not silently use a production endpoint when an emulator is absent.

If a required feature is missing, mark that check blocked and define an
[Azure handoff](azure-handoff.md). Changing transport for a scoped emulator fixture
needs approval and leaves the original transport unverified.
Microsoft publication does not mean production parity, an SLA, or official support.
Do not use emulator timing as a production performance result.

## Primary sources

- [Azurite](https://learn.microsoft.com/azure/storage/common/storage-use-azurite):
  updated 2025-10-23.
- [Service Bus overview](https://learn.microsoft.com/azure/service-bus-messaging/overview-emulator):
  dated 2026-02-05, updated 2026-08-28.
- [Event Hubs overview](https://learn.microsoft.com/azure/event-hubs/overview-emulator):
  dated 2026-08-25, updated 2026-08-26.
- [Cosmos emulator](https://learn.microsoft.com/azure/cosmos-db/emulator):
  dated 2026-09-01.
- [Cosmos Linux vNext](https://learn.microsoft.com/azure/cosmos-db/emulator-linux):
  dated 2026-06-02.

Recheck the capability page for the selected release before execution.
