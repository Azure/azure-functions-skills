# Networking (Inspection R0, Authoring R1 / R2)

Read [core/ARM-CORE.md](core/ARM-CORE.md) and [core/COMMON-CLI.md](core/COMMON-CLI.md) first.
For writes, follow the write protocol in [authoring.md](authoring.md). Sections 1 and 2 are
read only; sections 3 to 7 are writes.

Networking changes can cut off the app, its storage, or **this agent's own access** to SCM and
host admin endpoints. Before any write, state which callers can still reach the app afterward,
including the agent, and what the rollback request is.

Extra providers and api-versions used only here:

| Provider | api-version |
| --- | --- |
| `Microsoft.Network` (virtual networks, subnets, private endpoints, DNS zone groups) | `2024-05-01` |
| `Microsoft.Network/privateDnsZones` and `.../virtualNetworkLinks` | `2020-06-01` |
| `Microsoft.Storage/storageAccounts` (read only) | `2023-05-01` |

`{netv}` = `api-version=2024-05-01`, `{dnsv}` = `api-version=2020-06-01`.

## Plan rules

| Plan | VNet integration | Subnet delegation | Minimum subnet | Outbound routing |
| --- | --- | --- | --- | --- |
| Flex Consumption | Yes | `Microsoft.App/environments` | `/27` (`/26` for several apps) | All traffic always uses the VNet; do not set `outboundVnetRouting` |
| Premium, Dedicated | Yes | `Microsoft.Web/serverFarms` | `/28` (`/26` recommended) | `outboundVnetRouting` (below) |
| Consumption (legacy) | No | - | - | - |

- The VNet must be in the same region as the app. The subnet must be empty or used only by the
  same plan (Premium / Dedicated) or by Flex Consumption apps.
- Flex Consumption needs the `Microsoft.App` resource provider registered in the subscription.
- Inbound private endpoints are supported on Flex Consumption, Premium, and Dedicated. Legacy
  Consumption supports neither inbound private endpoints nor VNet integration; recommend Flex.

## 1. Read the network configuration (R0)

| Item | Request | Fields to show |
| --- | --- | --- |
| App | `GET {site}?{av}` | `publicNetworkAccess`, `virtualNetworkSubnetId`, `outboundVnetRouting` (`allTraffic`, `applicationTraffic`, `contentShareTraffic`, `imagePullTraffic`, `backupRestoreTraffic`), `vnetRouteAllEnabled`, `vnetContentShareEnabled`, `httpsOnly`, `hostNameSslStates` |
| Site config | `GET {site}/config/web?{av}` | `ipSecurityRestrictions`, `ipSecurityRestrictionsDefaultAction`, `scmIpSecurityRestrictions`, `scmIpSecurityRestrictionsDefaultAction`, `scmIpSecurityRestrictionsUseMain`, `vnetRouteAllEnabled` |
| VNet integration | `GET {site}/networkConfig/virtualNetwork?{av}` | `properties.subnetResourceId`, `properties.swiftSupported` (`404` = none) |
| Integration subnet | `GET <subnetResourceId>?{netv}` | `addressPrefix` / `addressPrefixes`, `delegations[].properties.serviceName`, `networkSecurityGroup.id`, `routeTable.id`, `serviceEndpoints`, `natGateway.id` |
| Inbound private endpoints | `GET {site}/privateEndpointConnections?{av}` | per item: `properties.privateEndpoint.id`, `properties.privateLinkServiceConnectionState.status`, `properties.ipAddresses` |
| Private endpoint | `GET <privateEndpointId>?{netv}` | `subnet.id`, `customDnsConfigs`, `privateLinkServiceConnections[].properties.groupIds` |
| Private DNS for an endpoint | `GET <privateEndpointId>/privateDnsZoneGroups?{netv}` | `privateDnsZoneConfigs[].properties.privateDnsZoneId`, `recordSets` |
| DNS zone links | `GET <privateDnsZoneId>/virtualNetworkLinks?{dnsv}` | `virtualNetwork.id`, `registrationEnabled`, `virtualNetworkLinkState` |
| Storage network | `GET <storage account id>?api-version=2023-05-01` | `publicNetworkAccess`, `networkAcls` (`defaultAction`, `bypass`, `virtualNetworkRules`, `ipRules`), `privateEndpointConnections` |

- Find the storage account from `AzureWebJobsStorage` / `AzureWebJobsStorage__accountName` (names
  only; never print the connection string) and, on Flex, `functionAppConfig.deployment.storage`.
- Show access restriction rules as a table: `priority`, `name`, `action`, and one of `ipAddress`,
  `tag` + `ipAddress` (service tag), or `vnetSubnetResourceId`. Include the default action.
- If a `Microsoft.Network` read returns `403`, the network may be in another subscription or the
  user lacks Reader there. Report it; do not guess.

## 2. Diagnose connectivity (R0)

Diagnosis uses configuration evidence plus the detectors and logs in [inspection.md](inspection.md)
§5 and §7. In-app `nslookup` / TCP tests are not offered through REST on Linux or Flex; do not
use the Kudu command API for them.

| Symptom | Check in order |
| --- | --- |
| Host does not start, or functions disappear after locking down storage | storage `networkAcls` and `publicNetworkAccess`; app VNet integration present; storage private endpoints for `blob`, `queue`, `table` (and `file` on Premium / Dedicated content shares) with DNS zone groups linked to the integration VNet; on Premium / Dedicated `outboundVnetRouting.contentShareTraffic` |
| Calls to a private resource (database, storage, Key Vault) time out or resolve to a public IP | VNet integration present; Premium / Dedicated `outboundVnetRouting.applicationTraffic` or `allTraffic`; subnet NSG and route table; private DNS zone for that service linked to the integration VNet |
| Public calls fail after integration | subnet NSG outbound rules, route table, and NAT gateway (Flex routes all traffic through the VNet) |
| `403 Ip Forbidden` from the site or host admin endpoints | `ipSecurityRestrictions` and its default action |
| SCM deploy or deployment history fails with `403` or a timeout | `scmIpSecurityRestrictions`, `scmIpSecurityRestrictionsUseMain`, `publicNetworkAccess`, private endpoint on the SCM host |
| Private endpoint does not work | connection `status` is `Approved`; DNS zone `privatelink.azurewebsites.net` has a zone group on the endpoint and a link to every client VNet |

Also run detectors whose `metadata.name` or `description` mentions network, VNet, DNS, or
connectivity. Report each finding with the evidence field and value that supports it.

## 3. Subnet delegation (R1, network resource)

`vnet integrate` does this for you. Use the steps below only when the user wants to prepare a
subnet without integrating an app. Needed before VNet integration when the subnet has no delegation. This changes a
`Microsoft.Network` resource that other workloads may share; name it in the approval.

1. `GET <subnetId>?{netv}`.
2. Refuse when it has a different delegation or other resources in `ipConfigurations`
   (unless they belong to the same plan / Flex apps), or its prefix is smaller than the plan minimum.
3. Add `{"name":"delegation","properties":{"serviceName":"<plan delegation>"}}` to
   `properties.delegations`, keeping every other subnet property.
4. `PUT <subnetId>?{netv}` with the full modified subnet object (`name`, `properties`).
   The PUT replaces the subnet; never send only the delegation.

To create a subnet or VNet for an app, use `vnet integrate --create-subnet` or `--create-vnet`.
For anything larger (hub-spoke, peering, firewalls), use the ARM deployment flow in authoring.md
"Create a new Function App" steps 2 to 5 with the user's or an official template.

## 4. VNet integration (R1 add, R2 remove or change)

**Use the tool.** It checks the plan, region, subnet size, delegation, and other users of the
subnet; picks a free address prefix; registers `Microsoft.App` for Flex; and verifies the result.

```bash
node <skill-dir>/scripts/functions-app.mjs vnet integrate --app <app> --vnet <vnet> --create-subnet   # plan
node <skill-dir>/scripts/functions-app.mjs vnet integrate --app <app> --vnet <vnet> --create-subnet --approve
node <skill-dir>/scripts/functions-app.mjs vnet integrate --app <app> --subnet <subnetId> --approve
node <skill-dir>/scripts/functions-app.mjs vnet integrate --app <app> --create-vnet --approve
node <skill-dir>/scripts/functions-app.mjs vnet remove --app <app> --approve
```

- `--create-vnet` without `--address-space` picks the first private /16 that no VNet in the
  subscription uses (finding `AddressSpaceChosen`). Peered VNets in other subscriptions and
  on-premises ranges are not checked; ask the user before peering or VPN plans.
- After integrating, the tool waits for the host to be `Running`. `HostNotVerified` means a
  dependency is probably unreachable from the subnet: check section 2 before rolling back.
- If public outbound calls fail only after integration, the subnet has no working outbound path
  (NSG, route table, or no NAT gateway on a subnet without default outbound access). Check with
  the section 2 row "Public calls fail after integration"; do not remove the integration first.

Without the tool, the REST steps are:

- Add: `PATCH {site}?{av}` with `{"properties":{"virtualNetworkSubnetId":"<subnetId>"}}`.
  The app restarts. Verify with `GET {site}/networkConfig/virtualNetwork?{av}`.
- Change subnet (R2): show the outbound path that changes, then PATCH the new subnet ID.
- Remove (R2): `DELETE {site}/networkConfig/virtualNetwork?{av}`. State which private resources
  become unreachable. Rollback is the Add request with the previous subnet ID.
- Before adding, check that the storage account and every private dependency stay reachable
  (section 2 first row). Integration plus private-only storage without private DNS stops the host.

## 5. Outbound routing (R1, Premium and Dedicated only)

`PATCH {site}?{av}` with only the changed flags, for example
`{"properties":{"outboundVnetRouting":{"applicationTraffic":true}}}`.

- `allTraffic: true` routes application and configuration traffic (content share, image pull,
  backup, managed identity tokens) through the VNet. Confirm NSG, route table, and DNS allow
  them first; otherwise the host can stop.
- Never set these on Flex Consumption.

## 6. Inbound access restrictions and public access (R1; R2 when it can block callers)

Rules are replaced as whole lists. Read site config, merge, then send the full list:

`PATCH {site}/config/web?{av}` with, for example:

```json
{
  "properties": {
    "ipSecurityRestrictions": [
      { "name": "office", "priority": 100, "action": "Allow", "ipAddress": "203.0.113.0/24" },
      { "name": "frontdoor", "priority": 200, "action": "Allow", "tag": "ServiceTag", "ipAddress": "AzureFrontDoor.Backend" },
      { "name": "app-subnet", "priority": 300, "action": "Allow", "vnetSubnetResourceId": "<subnetId>" }
    ],
    "ipSecurityRestrictionsDefaultAction": "Deny",
    "scmIpSecurityRestrictionsUseMain": false
  }
}
```

- `ipSecurityRestrictionsDefaultAction: "Deny"` and SCM rules can block this agent's deploy and
  host admin calls. Show the caller's public IP impact before approval (R2).
- Disable public access (R2): `PATCH {site}?{av}` with `{"properties":{"publicNetworkAccess":"Disabled"}}`.
  Require a working private endpoint first. After this, SCM and host admin calls work only from a
  network that can reach the private endpoint.
- Rollback: send the previous lists and default actions, or `publicNetworkAccess: "Enabled"`.

## 7. Inbound private endpoint (R1 create with cost, R2 delete)

Creating a private endpoint adds billable `Microsoft.Network` resources. Prefer an ARM deployment
when the project has IaC. Otherwise, with approval of the whole plan:

1. Endpoint: `PUT /subscriptions/{sub}/resourceGroups/{rg}/providers/Microsoft.Network/privateEndpoints/{peName}?{netv}`

   ```json
   {
     "location": "<VNet region>",
     "properties": {
       "subnet": { "id": "<private endpoint subnet id>" },
       "privateLinkServiceConnections": [
         { "name": "<peName>", "properties": { "privateLinkServiceId": "<site id>", "groupIds": ["sites"] } }
       ]
     }
   }
   ```

   For a slot use `groupIds: ["sites-<slot>"]`. Use a subnet without the VNet integration
   delegation. Poll the `202` per ARM-CORE.
2. DNS zone (skip if it exists): `PUT /subscriptions/{sub}/resourceGroups/{rg}/providers/Microsoft.Network/privateDnsZones/privatelink.azurewebsites.net?{dnsv}`
   with `{"location":"global"}`.
3. Link the zone to each client VNet (skip existing links):
   `PUT <zoneId>/virtualNetworkLinks/<linkName>?{dnsv}` with
   `{"location":"global","properties":{"virtualNetwork":{"id":"<vnet id>"},"registrationEnabled":false}}`.
4. Zone group: `PUT <privateEndpointId>/privateDnsZoneGroups/default?{netv}` with
   `{"properties":{"privateDnsZoneConfigs":[{"name":"privatelink-azurewebsites-net","properties":{"privateDnsZoneId":"<zoneId>"}}]}}`.
5. Verify: `GET {site}/privateEndpointConnections?{av}` shows `Approved`, and the zone group has
   A records for the app and SCM host names.

- Pending connection (created by someone else): approve or reject with
  `PUT {site}/privateEndpointConnections/{connectionName}?{av}` and
  `{"properties":{"privateLinkServiceConnectionState":{"status":"Approved","description":"<reason>"}}}`
  (`Rejected` is R2).
- Delete (R2): `DELETE <privateEndpointId>?{netv}`. If public access is disabled, state that the
  app becomes unreachable until public access is enabled or another endpoint exists.
- Do not delete a shared private DNS zone or VNet link; other endpoints may use it.

## Not covered

Hybrid connections, gateway-required (classic) VNet integration, NAT gateway / route table / NSG
edits, Azure Front Door or Application Gateway setup, and storage account firewall or private
endpoint changes. Report the needed change and stop.
