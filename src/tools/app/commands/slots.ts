import { boolFlag, intFlag, stringFlag } from '../args.js';
import { SCM_RESOURCE, type AzureClient } from '../azure.js';
import { scmHost, type Site } from '../inspect.js';
import { EXIT, ToolError, type Finding } from '../output.js';
import { WEB_API_VERSION, withSlot, type AppTarget } from '../target.js';
import { appTarget, requireApproval, tryRead, waitFor, writeArm } from './common.js';
import { invokeFunction } from './invoke.js';
import { readHostStatus, type HostStatus } from './ops.js';
import type { CommandSpec } from './types.js';

const SWAP_WAIT_MS = 900_000;
const HOST_POLL_MS = 10_000;
const RESYNC_WAIT_MS = 20_000;

interface SlotState {
  target: AppTarget;
  site?: Site;
  host?: HostStatus;
  contentShare?: string;
  build?: string;
}

function slotName(target: AppTarget): string {
  return target.slot ?? 'production';
}

function productionOf(app: AppTarget): AppTarget {
  return { ...app, id: app.siteId, slot: undefined, label: app.name, ref: `--app ${app.name}` };
}

async function contentShareOf(client: AzureClient, target: AppTarget): Promise<string | undefined> {
  const settings = await tryRead(() => client.arm<{ properties: Record<string, string> }>('POST', `${target.id}/config/appsettings/list`, WEB_API_VERSION, { idempotent: true }));
  return settings?.properties.WEBSITE_CONTENTSHARE || undefined;
}

async function activeBuild(client: AzureClient, site: Site | undefined): Promise<string | undefined> {
  const scm = site && scmHost(site);
  if (!scm) return undefined;
  const deployments = await tryRead(() => client.request<{ id: string; active?: boolean }[]>('GET', `https://${scm}/api/deployments`, SCM_RESOURCE));
  return deployments?.find(item => item.active)?.id;
}

function sharedShareFindings(states: { name: string; contentShare?: string }[]): Finding[] {
  const byShare = new Map<string, string[]>();
  for (const state of states) if (state.contentShare) byShare.set(state.contentShare, [...(byShare.get(state.contentShare) ?? []), state.name]);
  return [...byShare.values()].filter(names => names.length > 1).map(names => ({
    severity: 'warning' as const,
    code: 'SharedContentShare',
    message: `${names.join(' and ')} use the same WEBSITE_CONTENTSHARE, so they share one content file share; deploying to one slot changes the other.`,
    fix: `Give each slot its own share: \`settings set --slot <s> --name WEBSITE_CONTENTSHARE --value <unique-name> --sticky\` (lowercase, max 63 chars), then deploy again.`,
  }));
}

async function readSlot(client: AzureClient, target: AppTarget): Promise<SlotState> {
  const [site, host, contentShare] = await Promise.all([
    tryRead(() => client.arm<Site>('GET', target.id, WEB_API_VERSION)),
    tryRead(() => readHostStatus(client, target)),
    contentShareOf(client, target),
  ]);
  return { target, site, host, contentShare };
}

async function keyVaultFindings(client: AzureClient, target: AppTarget): Promise<Finding[]> {
  const refs = await tryRead(() => client.arm<{ value: { name: string; properties: { status?: string; details?: string } }[] }>('GET', `${target.id}/config/configreferences/appsettings`, WEB_API_VERSION));
  return (refs?.value ?? [])
    .filter(ref => ref.properties.status && ref.properties.status !== 'Resolved')
    .map(ref => ({
      severity: 'error' as const,
      code: 'KeyVaultReferenceUnresolved',
      message: `${slotName(target)}: ${ref.name.split('/').pop()} is ${ref.properties.status}. ${ref.properties.details ?? ''}`.trim(),
      fix: `Slots have their own managed identity. Grant this slot's identity "Key Vault Secrets User" on the vault, then run \`settings list ${target.ref}\`.`,
    }));
}

function sameName(a: string | undefined, b: string): boolean {
  return (a ?? '').toLowerCase() === b.toLowerCase();
}

export const slotsCommands: CommandSpec[] = [
  {
    name: 'slots list',
    usage: 'slots list --app <name|id>',
    description: 'List production and deployment slots with state, host name, sticky (slot) setting names, and content-share conflicts.',
    details: ['stickySettings are the names that stay with their slot during a swap (config/slotConfigNames). Values are never printed.'],
    handler: async (args, { client }) => {
      const app = await appTarget(client, args);
      const production = productionOf(app);
      const [site, slots, sticky] = await Promise.all([
        client.arm<Site>('GET', production.id, WEB_API_VERSION),
        client.arm<{ value: Site[] }>('GET', `${production.id}/slots`, WEB_API_VERSION),
        tryRead(() => client.arm<{ properties: { appSettingNames?: string[] | null; connectionStringNames?: string[] | null } }>('GET', `${production.id}/config/slotConfigNames`, WEB_API_VERSION)),
      ]);
      const targets: { target: AppTarget; site: Site }[] = [
        { target: production, site },
        ...slots.value.map(slot => ({ target: withSlot(production, slot.name.split('/').pop() ?? slot.name), site: slot })),
      ];
      const shares = await Promise.all(targets.map(item => contentShareOf(client, item.target)));
      const rows = targets.map((item, index) => ({
        name: slotName(item.target),
        state: item.site.properties.state,
        hostName: item.site.properties.defaultHostName,
        contentShare: shares[index],
        lastSwap: item.site.properties.slotSwapStatus ?? undefined,
      }));
      const findings = sharedShareFindings(rows);
      return {
        summary: `${app.name}: ${rows.length} slot(s) including production.`,
        data: {
          slots: rows,
          stickySettings: { appSettings: sticky?.properties.appSettingNames ?? [], connectionStrings: sticky?.properties.connectionStringNames ?? [] },
        },
        findings,
        next: ['Swap with `slots swap --app <app> --slot <s>`; mark a setting slot-specific with `settings set ... --sticky`.'],
      };
    },
  },
  {
    name: 'slots swap',
    usage: 'slots swap --app <name|id> --slot <source> [--target production] [--check-function <name>] [--wait 900] [--approve]',
    description: 'Swap a slot into production (or --target) once, then verify the swap, both hosts, deployed builds, and Key Vault references.',
    details: [
      'Pre-checks: the source host must be Running; a shared WEBSITE_CONTENTSHARE is reported.',
      'Verification: slotSwapStatus on the target, both hosts Running, active deployment IDs before/after, Key Vault reference status on both slots.',
      '--check-function calls that function on both slots after the swap (HTTP triggers only). If a slot rejects its keys (401), the tool syncs that slot\'s triggers once and calls again.',
      'Rollback: run the same swap again.',
    ],
    handler: async (args, context) => {
      const { client, sleep } = context;
      const source = stringFlag(args, 'slot');
      if (!source || source.toLowerCase() === 'production') throw new ToolError(EXIT.usage, 'Pass the source slot with --slot, for example --slot staging. Production is the default --target.');
      const targetName = stringFlag(args, 'target') ?? 'production';
      if (targetName.toLowerCase() === source.toLowerCase()) throw new ToolError(EXIT.usage, '--slot and --target must differ.');
      const waitMs = intFlag(args, 'wait', SWAP_WAIT_MS / 1000, 1800) * 1000;
      const from = await appTarget(client, args);
      const to = withSlot(productionOf(from), targetName);
      const command = `slots swap ${from.ref}${to.slot ? ` --target ${to.slot}` : ''}`;

      const [before, after] = await Promise.all([readSlot(client, from), readSlot(client, to)]);
      const findings: Finding[] = sharedShareFindings([{ name: slotName(from), contentShare: before.contentShare }, { name: slotName(to), contentShare: after.contentShare }]);
      if (!before.site) throw new ToolError(EXIT.usage, `Slot ${from.label} was not found.`, { next: [`Run \`slots list --app ${from.name}\`.`] });
      if (before.host?.state !== 'Running') {
        throw new ToolError(EXIT.precheck, `${from.label} host is ${before.host?.state ?? 'unreachable'}; swapping it would put a broken build into ${slotName(to)}.`, {
          findings,
          next: [`Fix the source first: \`host status ${from.ref}\`, \`logs query ${from.ref} --preset errors\`.`],
        });
      }
      if (after.host?.state !== 'Running') findings.push({ severity: 'warning', code: 'TargetHostNotRunning', message: `${to.label} host is ${after.host?.state ?? 'unreachable'} before the swap.` });

      const step = { action: `swap ${slotName(from)} into ${slotName(to)}`, method: 'POST', url: `${from.id}/slotsswap?api-version=${WEB_API_VERSION}`, body: { targetSlot: slotName(to), preserveVnet: true } };
      requireApproval(args, command, {
        risk: 'R2',
        impact: `Swap ${from.label} into ${to.label}. Traffic on ${to.label} moves to the build now in ${slotName(from)}; non-sticky settings move with the code. Brief cold start on both slots.`,
        steps: [step],
        rollback: command,
      }, findings);

      const builds = { before: { [slotName(to)]: await activeBuild(client, after.site), [slotName(from)]: await activeBuild(client, before.site) } as Record<string, string | undefined>, after: {} as Record<string, string | undefined> };
      const started = context.now().getTime();
      await writeArm(context, step, `slots list --app ${from.name}`, waitMs);

      const targetSite = await client.arm<Site>('GET', to.id, WEB_API_VERSION);
      const status = targetSite.properties.slotSwapStatus;
      const swapRecorded = sameName(status?.sourceSlotName, slotName(from)) && sameName(status?.destinationSlotName, slotName(to));
      const hosts = await Promise.all([from, to].map(target =>
        waitFor(() => tryRead(() => readHostStatus(client, target)), value => value.state === 'Running', { sleep, waitMs: 180_000, intervalMs: HOST_POLL_MS })));
      builds.after[slotName(to)] = await activeBuild(client, targetSite);
      builds.after[slotName(from)] = await activeBuild(client, before.site);

      if (!swapRecorded) findings.push({ severity: 'warning', code: 'SwapNotRecorded', message: `${to.label} does not show this swap in slotSwapStatus yet (${JSON.stringify(status ?? null)}).`, fix: `Do not swap again. Run \`slots list --app ${from.name}\` in a minute.` });
      const moved = builds.before[slotName(from)] && builds.after[slotName(to)] ? builds.before[slotName(from)] === builds.after[slotName(to)] : undefined;
      if (moved === false) findings.push({ severity: 'warning', code: 'BuildNotMoved', message: `${slotName(to)} now reports build ${builds.after[slotName(to)]}, expected ${builds.before[slotName(from)]}.`, fix: 'Check `deployments list` on both slots.' });
      hosts.forEach((host, index) => {
        const target = index === 0 ? from : to;
        if (!host.done) findings.push({ severity: 'error', code: 'HostNotRunning', message: `${target.label} host is ${host.value?.state ?? 'unreachable'} after the swap.`, fix: `Run \`host status ${target.ref}\` and \`logs query ${target.ref} --preset errors\`.` });
      });
      findings.push(...(await keyVaultFindings(client, to)), ...(await keyVaultFindings(client, from)));

      let checks: unknown;
      const checkFunction = stringFlag(args, 'check-function');
      if (checkFunction) {
        checks = [];
        for (const target of [to, from]) {
          let outcome = await tryRead(() => invokeFunction(context, target, checkFunction, {}));
          let resynced: boolean | undefined;
          if (outcome?.findings.some(finding => finding.code === 'KeyRejected')) {
            // Observed after swaps: the runtime rejects ARM keys until triggers are synced; a restart does not help.
            await client.arm('POST', `${target.id}/syncfunctiontriggers`, WEB_API_VERSION);
            await sleep(RESYNC_WAIT_MS);
            outcome = await tryRead(() => invokeFunction(context, target, checkFunction, {}));
            resynced = true;
            const fixed = !outcome?.findings.some(finding => finding.code === 'KeyRejected');
            if (fixed) findings.push({ severity: 'info', code: 'KeysResynced', message: `${target.label} rejected its keys after the swap; syncing triggers fixed it.` });
          }
          (checks as unknown[]).push({ slot: slotName(target), status: outcome?.result.status, elapsedMs: outcome?.result.elapsedMs, body: outcome?.result.body, ...(resynced ? { resynced } : {}) });
          findings.push(...(outcome?.findings ?? []));
        }
      }

      const verified = swapRecorded && hosts.every(host => host.done);
      return {
        summary: verified
          ? `Swapped ${from.label} into ${to.label}; both hosts are Running.`
          : `Swap of ${from.label} into ${to.label} completed but verification is incomplete (see findings).`,
        data: { verified, swap: status, elapsedSeconds: Math.round((context.now().getTime() - started) / 1000), builds, checks, rollback: command },
        findings,
        next: boolFlag(args, 'approve') ? [`Roll back if needed: \`${command} --approve\`.`] : undefined,
      };
    },
  },
];
