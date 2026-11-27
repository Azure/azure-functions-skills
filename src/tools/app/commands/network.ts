import { boolFlag, stringFlag, type ParsedArgs } from '../args.js';
import type { AzureClient } from '../azure.js';
import { detectPlan, type HostingPlan, type Plan, type Site } from '../inspect.js';
import { EXIT, ToolError, type Finding } from '../output.js';
import { WEB_API_VERSION, queryGraph, type AppTarget } from '../target.js';
import { appTarget, requireApproval, tryRead, waitFor, writeArm as write, type PlanStep } from './common.js';
import { readHostStatus } from './ops.js';
import type { CommandSpec, ToolContext } from './types.js';

export const NETWORK_API_VERSION = '2024-05-01';
const PROVIDER_API_VERSION = '2021-04-01';
const PROVIDER_WAIT_MS = 300_000;
const HOST_WAIT_MS = 120_000;

interface SubnetRule {
  delegation: string;
  minPrefix: number;
  recommendedPrefix: number;
  needsAppProvider: boolean;
}

const RULES: Partial<Record<HostingPlan, SubnetRule>> = {
  FlexConsumption: { delegation: 'Microsoft.App/environments', minPrefix: 27, recommendedPrefix: 27, needsAppProvider: true },
  Premium: { delegation: 'Microsoft.Web/serverFarms', minPrefix: 28, recommendedPrefix: 26, needsAppProvider: false },
  Dedicated: { delegation: 'Microsoft.Web/serverFarms', minPrefix: 28, recommendedPrefix: 26, needsAppProvider: false },
};

interface Subnet {
  id?: string;
  name?: string;
  properties?: {
    addressPrefix?: string;
    addressPrefixes?: string[];
    delegations?: { name?: string; properties?: { serviceName?: string } }[];
    ipConfigurations?: unknown[];
    privateEndpoints?: unknown[];
    serviceAssociationLinks?: { properties?: { linkedResourceType?: string; link?: string } }[];
    [key: string]: unknown;
  };
}

interface VirtualNetwork {
  id?: string;
  location?: string;
  properties?: { addressSpace?: { addressPrefixes?: string[] }; subnets?: Subnet[] };
}

const VNET_ID = /^(\/subscriptions\/[0-9a-f-]{36}\/resourceGroups\/[-\w.()]+\/providers\/Microsoft\.Network\/virtualNetworks\/[-\w.]+)(\/subnets\/([-\w.]+))?$/i;
const RESOURCE_NAME = /^[A-Za-z0-9][-\w.]{0,79}$/;

function cidr(prefix: string): { start: number; end: number; length: number } {
  const match = /^(\d+)\.(\d+)\.(\d+)\.(\d+)\/(\d+)$/.exec(prefix.trim());
  if (!match) throw new ToolError(EXIT.usage, `Not an IPv4 CIDR: ${prefix}`);
  const length = Number(match[5]);
  const address = ((Number(match[1]) << 24) | (Number(match[2]) << 16) | (Number(match[3]) << 8) | Number(match[4])) >>> 0;
  const size = 2 ** (32 - length);
  const start = address - (address % size);
  return { start, end: start + size - 1, length };
}

function formatIp(value: number): string {
  return [24, 16, 8, 0].map(shift => (value >>> shift) & 255).join('.');
}

/** Returns the first aligned block of `/length` inside the address spaces that overlaps no used prefix. */
export function findFreePrefix(spaces: readonly string[], used: readonly string[], length: number): string | undefined {
  const taken = used.map(cidr);
  const size = 2 ** (32 - length);
  for (const space of spaces.map(cidr)) {
    if (space.length > length) continue;
    for (let start = space.start; start + size - 1 <= space.end; start += size) {
      const end = start + size - 1;
      if (!taken.some(block => block.start <= end && start <= block.end)) return `${formatIp(start)}/${length}`;
    }
  }
  return undefined;
}

function prefixesOf(subnet: Subnet): string[] {
  return subnet.properties?.addressPrefixes ?? (subnet.properties?.addressPrefix ? [subnet.properties.addressPrefix] : []);
}

function sameId(a: string | null | undefined, b: string | null | undefined): boolean {
  return Boolean(a && b && a.toLowerCase() === b.toLowerCase());
}

async function loadSite(client: AzureClient, app: AppTarget): Promise<{ site: Site; hostingPlan: HostingPlan }> {
  const site = await client.arm<Site>('GET', app.id, WEB_API_VERSION);
  const plan = !site.properties.functionAppConfig && site.properties.serverFarmId ? await client.arm<Plan>('GET', site.properties.serverFarmId, WEB_API_VERSION) : undefined;
  return { site, hostingPlan: detectPlan(site, plan) };
}

function withVersion(path: string, version: string): string {
  return `${path}?api-version=${version}`;
}

interface SubnetChoice {
  subnetId: string;
  steps: PlanStep[];
  findings: Finding[];
}

/** Picks a private /16 (or a /24 in 192.168.0.0/16) that overlaps no VNet in the subscription. */
async function freeAddressSpace(client: AzureClient, subscriptionId: string): Promise<string> {
  const rows = await queryGraph(client, "resources | where type =~ 'microsoft.network/virtualnetworks' | project id, prefixes = properties.addressSpace.addressPrefixes", subscriptionId);
  const used = rows.flatMap(row => (Array.isArray(row.prefixes) ? row.prefixes.filter((item): item is string => typeof item === 'string') : []));
  const space = findFreePrefix(['10.0.0.0/8', '172.16.0.0/12'], used, 16) ?? findFreePrefix(['192.168.0.0/16'], used, 24);
  if (!space) throw new ToolError(EXIT.usage, 'Every private range is already used by a VNet in this subscription. Pass --address-space <cidr>.');
  return space;
}

async function chooseSubnet(args: ParsedArgs, context: ToolContext, app: AppTarget, site: Site, rule: SubnetRule): Promise<SubnetChoice> {
  const { client } = context;
  const subnetFlag = stringFlag(args, 'subnet');
  const vnetFlag = stringFlag(args, 'vnet');
  const createSubnet = boolFlag(args, 'create-subnet');
  const createVnet = boolFlag(args, 'create-vnet');
  const modes = [Boolean(subnetFlag), Boolean(vnetFlag && createSubnet), createVnet].filter(Boolean).length;
  if (modes !== 1 || (vnetFlag && !createSubnet)) {
    throw new ToolError(EXIT.usage, 'Choose one: --subnet <subnet-id>, --vnet <vnet-id|name> --create-subnet, or --create-vnet.');
  }
  const subnetName = stringFlag(args, 'subnet-name') ?? 'snet-functions';
  if (!RESOURCE_NAME.test(subnetName)) throw new ToolError(EXIT.usage, `Invalid --subnet-name "${subnetName}".`);
  const delegations = [{ name: 'delegation', properties: { serviceName: rule.delegation } }];

  if (createVnet) {
    const vnetName = stringFlag(args, 'vnet-name') ?? `vnet-${app.name}`;
    if (!RESOURCE_NAME.test(vnetName)) throw new ToolError(EXIT.usage, `Invalid --vnet-name "${vnetName}".`);
    const vnetId = `/subscriptions/${app.subscriptionId}/resourceGroups/${app.resourceGroup}/providers/Microsoft.Network/virtualNetworks/${vnetName}`;
    if (await tryRead(() => client.arm('GET', vnetId, NETWORK_API_VERSION))) {
      throw new ToolError(EXIT.usage, `VNet ${vnetName} already exists. Use --vnet ${vnetId} --create-subnet instead.`);
    }
    const explicitSpace = stringFlag(args, 'address-space');
    const findings: Finding[] = [];
    let space = explicitSpace;
    if (!space) {
      space = await freeAddressSpace(client, app.subscriptionId);
      findings.push({ severity: 'info', code: 'AddressSpaceChosen', message: `Chose ${space}, which overlaps no VNet in subscription ${app.subscriptionId}.`, fix: 'Peered networks in other subscriptions and on-premises ranges are not checked; pass --address-space if you plan to peer or connect a VPN.' });
    }
    const prefix = findFreePrefix([space], [], rule.recommendedPrefix);
    if (!prefix) throw new ToolError(EXIT.usage, `--address-space ${space} is smaller than /${rule.recommendedPrefix}.`);
    return {
      subnetId: `${vnetId}/subnets/${subnetName}`,
      findings,
      steps: [{ action: 'create vnet', method: 'PUT', url: withVersion(vnetId, NETWORK_API_VERSION), body: { location: site.location, properties: { addressSpace: { addressPrefixes: [space] }, subnets: [{ name: subnetName, properties: { addressPrefix: prefix, delegations } }] } } }],
    };
  }

  const vnetMatch = VNET_ID.exec(subnetFlag ?? vnetFlag ?? '');
  let vnetId = vnetMatch?.[1];
  if (!vnetId && vnetFlag && RESOURCE_NAME.test(vnetFlag)) vnetId = `/subscriptions/${app.subscriptionId}/resourceGroups/${app.resourceGroup}/providers/Microsoft.Network/virtualNetworks/${vnetFlag}`;
  if (!vnetId || (subnetFlag && !vnetMatch?.[3])) throw new ToolError(EXIT.usage, subnetFlag ? '--subnet must be a full subnet resource ID.' : '--vnet must be a VNet resource ID or a VNet name in the app resource group.');
  const vnet = await client.arm<VirtualNetwork>('GET', vnetId, NETWORK_API_VERSION);
  const findings: Finding[] = [];
  if (vnet.location && site.location && vnet.location.replace(/\s/g, '').toLowerCase() !== site.location.replace(/\s/g, '').toLowerCase()) {
    findings.push({ severity: 'error', code: 'VnetRegionMismatch', message: `The VNet is in ${vnet.location}; the app is in ${site.location}.`, fix: 'Use a VNet in the same region, or --create-vnet.' });
  }

  if (createSubnet) {
    if ((vnet.properties?.subnets ?? []).some(subnet => subnet.name?.toLowerCase() === subnetName.toLowerCase())) {
      throw new ToolError(EXIT.usage, `Subnet ${subnetName} already exists. Pass --subnet ${vnetId}/subnets/${subnetName}, or a different --subnet-name.`);
    }
    const used = (vnet.properties?.subnets ?? []).flatMap(prefixesOf);
    const prefix = findFreePrefix(vnet.properties?.addressSpace?.addressPrefixes ?? [], used, rule.recommendedPrefix);
    if (!prefix) findings.push({ severity: 'error', code: 'NoFreeAddressSpace', message: `No free /${rule.recommendedPrefix} range is left in the VNet.`, fix: 'Add address space to the VNet, use another VNet, or --create-vnet.' });
    const subnetId = `${vnetId}/subnets/${subnetName}`;
    return { subnetId, findings, steps: prefix ? [{ action: 'create subnet', method: 'PUT', url: withVersion(subnetId, NETWORK_API_VERSION), body: { properties: { addressPrefix: prefix, delegations } } }] : [] };
  }

  const subnetId = subnetFlag as string;
  const subnet = await client.arm<Subnet>('GET', subnetId, NETWORK_API_VERSION);
  const lengths = prefixesOf(subnet).map(prefix => cidr(prefix).length);
  if (lengths.length && Math.min(...lengths) > rule.minPrefix) {
    findings.push({ severity: 'error', code: 'SubnetTooSmall', message: `The subnet is /${Math.min(...lengths)}; this plan needs /${rule.minPrefix} or larger (/${rule.recommendedPrefix} recommended).`, fix: 'Use --vnet <id> --create-subnet to add a correctly sized subnet.' });
  }
  const services = (subnet.properties?.delegations ?? []).map(item => item.properties?.serviceName ?? '');
  if (services.some(service => service.toLowerCase() !== rule.delegation.toLowerCase())) {
    findings.push({ severity: 'error', code: 'SubnetDelegatedElsewhere', message: `The subnet is delegated to ${services.join(', ')}; this plan needs ${rule.delegation}.`, fix: 'Use an empty subnet or create a new one with --create-subnet.' });
  }
  if ((subnet.properties?.ipConfigurations?.length ?? 0) > 0 || (subnet.properties?.privateEndpoints?.length ?? 0) > 0) {
    findings.push({ severity: 'error', code: 'SubnetInUse', message: 'The subnet already has network interfaces or private endpoints.', fix: 'Integration needs a dedicated subnet. Use --create-subnet.' });
  }
  const steps: PlanStep[] = [];
  if (services.length === 0) {
    steps.push({ action: 'delegate subnet', method: 'PUT', url: withVersion(subnetId, NETWORK_API_VERSION), body: { properties: { ...subnet.properties, delegations } } });
  }
  return { subnetId, findings, steps };
}

export const networkCommands: CommandSpec[] = [
  {
    name: 'vnet integrate',
    usage: 'vnet integrate --app <name|id> [--slot <s>] (--subnet <subnet-id> | --vnet <vnet-id|name> --create-subnet [--subnet-name snet-functions] | --create-vnet [--vnet-name <name>] [--address-space <cidr, default: first free private /16>]) [--approve]',
    description: 'Connect the app to a VNet subnet for outbound traffic: checks region, size, delegation, and providers, creates what is missing, integrates, and verifies.',
    handler: async (args, context) => {
      const { client } = context;
      const app = await appTarget(client, args);
      const { site, hostingPlan } = await loadSite(client, app);
      const rule = RULES[hostingPlan];
      if (!rule) {
        throw new ToolError(EXIT.precheck, `VNet integration is not available on ${hostingPlan}.`, {
          findings: [{ severity: 'error', code: 'PlanNotSupported', message: `${hostingPlan} apps cannot use regional VNet integration.`, fix: hostingPlan === 'Consumption' ? 'Move to Flex Consumption (`docs search migrate flex consumption`).' : 'Configure networking on the Container Apps environment.' }],
        });
      }
      const choice = await chooseSubnet(args, context, app, site, rule);
      const current = site.properties.virtualNetworkSubnetId;
      if (sameId(current, choice.subnetId) && choice.steps.length === 0) {
        return { summary: `${app.label} is already integrated with this subnet.`, data: { verified: true, subnetId: choice.subnetId } };
      }
      const errors = choice.findings.filter(finding => finding.severity === 'error');
      if (errors.length) throw new ToolError(EXIT.precheck, `Pre-check failed: ${errors.map(finding => finding.code).join(', ')}.`, { findings: choice.findings });

      const steps: PlanStep[] = [];
      if (rule.needsAppProvider) {
        const provider = await client.arm<{ registrationState?: string }>('GET', `/subscriptions/${app.subscriptionId}/providers/Microsoft.App`, PROVIDER_API_VERSION);
        if (provider.registrationState !== 'Registered') {
          steps.push({ action: 'register Microsoft.App', method: 'POST', url: withVersion(`/subscriptions/${app.subscriptionId}/providers/Microsoft.App/register`, PROVIDER_API_VERSION) });
        }
      }
      steps.push(...choice.steps);
      steps.push({ action: 'integrate app', method: 'PATCH', url: withVersion(app.id, WEB_API_VERSION), body: { properties: { virtualNetworkSubnetId: choice.subnetId } } });

      requireApproval(args, `vnet integrate ${app.ref}`, {
        risk: current ? 'R2' : 'R1',
        impact: `${current ? `Move ${app.label} from ${current} to` : `Integrate ${app.label} with`} ${choice.subnetId}. The app restarts; outbound traffic goes through the VNet${hostingPlan === 'FlexConsumption' ? ' (all traffic on Flex Consumption)' : ''}. Storage and other dependencies must stay reachable from the subnet (NSG, route table, private DNS).`,
        steps,
        rollback: current ? `vnet integrate ${app.ref} --subnet ${current}` : `vnet remove ${app.ref}`,
      }, choice.findings);

      const check = `app inspect ${app.ref}`;
      for (const step of steps) {
        if (step.action === 'register Microsoft.App') {
          await write(context, step, check);
          const registered = await waitFor(
            () => tryRead(() => client.arm<{ registrationState?: string }>('GET', `/subscriptions/${app.subscriptionId}/providers/Microsoft.App`, PROVIDER_API_VERSION)),
            provider => provider.registrationState === 'Registered',
            { sleep: context.sleep, waitMs: PROVIDER_WAIT_MS, intervalMs: 10_000 },
          );
          if (!registered.done) throw new ToolError(EXIT.failed, 'Microsoft.App provider registration is still in progress.', { next: ['Wait a few minutes, then rerun the same command with --approve; completed steps are skipped.'] });
        } else {
          await write(context, step, check);
        }
      }
      const after = await client.arm<Site>('GET', app.id, WEB_API_VERSION);
      const verified = sameId(after.properties.virtualNetworkSubnetId, choice.subnetId);
      const host = verified ? await waitFor(() => tryRead(() => readHostStatus(client, app)), status => status.state === 'Running', { sleep: context.sleep, waitMs: HOST_WAIT_MS, intervalMs: 10_000 }) : undefined;
      const findings: Finding[] = [];
      if (!verified) findings.push({ severity: 'warning', code: 'IntegrationNotVerified', message: 'virtualNetworkSubnetId does not match yet.', fix: 'Run `app inspect` in a minute. Do not resend.' });
      if (host && !host.done) {
        findings.push({ severity: 'warning', code: 'HostNotVerified', message: `The host is ${host.value?.state ?? 'unreachable'} after integration${host.value?.errors?.length ? `: ${host.value.errors.join('; ')}` : ''}.`, fix: 'Check that storage, Key Vault, and other dependencies are reachable from the subnet (NSG, route table, private DNS), then `logs query --preset errors --since 15m`. Roll back with the rollback command if needed.' });
      }
      return {
        summary: verified ? `${app.label} is integrated with ${choice.subnetId}${host?.done ? ' and the host is Running' : ''}.` : `${app.label}: the integration request succeeded but the app does not show the subnet yet.`,
        data: { verified, hostState: host?.value?.state, subnetId: choice.subnetId, steps: steps.map(step => step.action) },
        findings: [...choice.findings.filter(item => item.severity === 'info'), ...findings],
        next: host?.done ? [] : ['Check the app still starts: `host status`, then `logs query --preset errors --since 15m`.'],
      };
    },
  },
  {
    name: 'vnet remove',
    usage: 'vnet remove --app <name|id> [--slot <s>] [--approve]',
    description: 'Disconnect the app from its VNet subnet and verify. The VNet and subnet are kept.',
    handler: async (args, context) => {
      const { client } = context;
      const app = await appTarget(client, args);
      const site = await client.arm<Site>('GET', app.id, WEB_API_VERSION);
      const current = site.properties.virtualNetworkSubnetId;
      if (!current) return { summary: `${app.label} has no VNet integration.`, data: { verified: true } };
      const step: PlanStep = { action: 'remove integration', method: 'DELETE', url: withVersion(`${app.id}/networkConfig/virtualNetwork`, WEB_API_VERSION) };
      requireApproval(args, `vnet remove ${app.ref}`, {
        risk: 'R2',
        impact: `Disconnect ${app.label} from ${current}. The app restarts; private resources reachable only through the VNet become unreachable.`,
        steps: [step],
        rollback: `vnet integrate ${app.ref} --subnet ${current}`,
      });
      await write(context, step, `app inspect ${app.ref}`);
      const after = await client.arm<Site>('GET', app.id, WEB_API_VERSION);
      const verified = !after.properties.virtualNetworkSubnetId;
      return {
        summary: verified ? `${app.label} is no longer integrated. The subnet was kept.` : `${app.label}: removal was sent but the app still shows a subnet.`,
        data: { verified, subnetKept: current },
        findings: verified ? [] : [{ severity: 'warning', code: 'RemovalNotVerified', message: 'virtualNetworkSubnetId is still set.', fix: 'Run `app inspect` in a minute. Do not resend.' }],
        next: ['Delete the subnet or VNet only if nothing else uses it, with `rest DELETE <id>` and user approval.'],
      };
    },
  },
];
