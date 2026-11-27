const SECRET_NAME = /(KEY|SECRET|PASSWORD|PWD|TOKEN|CONNECTION|SAS)|Storage$/i;
const SECRET_VALUE = /(AccountKey=|SharedAccessKey=|SharedAccessSignature|[?&]sig=|Password=|Pwd=|InstrumentationKey=|ClientSecret=)/i;
const KEY_VAULT_REF = /^@Microsoft\.KeyVault\(/i;

export const REDACTED = '<redacted>';

export interface SettingView {
  name: string;
  value: string;
  source: 'plain' | 'keyVaultReference' | 'redacted';
}

export function isKeyVaultReference(value: string): boolean {
  return KEY_VAULT_REF.test(value.trim());
}

export function redactValue(name: string, value: string): SettingView {
  if (isKeyVaultReference(value)) return { name, value, source: 'keyVaultReference' };
  if (SECRET_NAME.test(name) || SECRET_VALUE.test(value)) return { name, value: REDACTED, source: 'redacted' };
  return { name, value, source: 'plain' };
}

export function redactSettings(settings: Record<string, string>): SettingView[] {
  return Object.keys(settings)
    .sort((a, b) => a.localeCompare(b))
    .map(name => redactValue(name, settings[name] ?? ''));
}

const SECRET_FIELD = /(password|secret|accountkey|connectionstring|token|masterkey|primarykey|secondarykey|^key$|sas)/i;
const KEY_LISTING_PATH = /\/(listkeys|listsecrets|listsyncfunctiontriggerstatus|listpublishingcredentials|publishxml|listpublishingprofilexmlwithsecrets|keys)(\/|$)|\/list[a-z]*keys?$/i;
const SETTINGS_PATH = /\/config\/(appsettings|connectionstrings|slotconfignames)(\/list)?$/i;

/** True when the response is a key or credential listing, so only names may be shown. */
export function isKeyListingPath(path: string): boolean {
  return KEY_LISTING_PATH.test(path);
}

function namesOnly(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(namesOnly);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, inner]) => [key, namesOnly(inner)]));
  return typeof value === 'string' && value ? REDACTED : value;
}

function redactFields(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactFields);
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const pairName = typeof record.name === 'string' && typeof record.value === 'string' ? record.name : undefined;
    return Object.fromEntries(
      Object.entries(record).map(([key, inner]) => {
        if (pairName !== undefined && key === 'value') return [key, redactValue(pairName, inner as string).value];
        if (typeof inner === 'string' && inner && SECRET_FIELD.test(key)) return [key, isKeyVaultReference(inner) ? inner : REDACTED];
        return [key, redactFields(inner)];
      }),
    );
  }
  return typeof value === 'string' ? scrubText(value) : value;
}

/**
 * Redacts a REST response before it is printed: key listings keep only names, app settings use the
 * setting-name rules, and everything else drops secret-looking fields and scrubs text.
 */
export function redactResponse(path: string, body: unknown): unknown {
  if (isKeyListingPath(path)) return namesOnly(body);
  if (SETTINGS_PATH.test(path) && body && typeof body === 'object' && 'properties' in body) {
    const properties = (body as { properties: Record<string, unknown> }).properties;
    const redacted = Object.fromEntries(
      Object.entries(properties ?? {}).map(([name, inner]) => {
        if (typeof inner === 'string') return [name, redactValue(name, inner).value];
        if (inner && typeof inner === 'object' && 'value' in inner) return [name, { ...inner, value: REDACTED }];
        return [name, inner];
      }),
    );
    return { ...(body as object), properties: redacted };
  }
  return redactFields(body);
}

/** Removes bearer tokens and common secret fragments from text before it is printed. */
export function scrubText(text: string): string {
  return text
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/g, 'Bearer <redacted>')
    .replace(/(AccountKey|SharedAccessKey|Password|Pwd|ClientSecret)=([^;"'\s]+)/gi, '$1=<redacted>')
    .replace(/([?&]sig=)[^&"'\s]+/gi, '$1<redacted>');
}
