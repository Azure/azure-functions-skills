const MASK = '***';

const RULES: ReadonlyArray<readonly [RegExp, string]> = [
  // Connection-string parts.
  [/\b(AccountKey|SharedAccessKey|SharedAccessSignature|InstrumentationKey|Password|Pwd)=[^;\s"']+/gi, `$1=${MASK}`],
  // Query-string credentials: function keys and SAS signatures.
  [/([?&](?:code|sig|key|token|access_token)=)[^&\s"']+/gi, `$1${MASK}`],
  [/\b(Bearer)\s+[A-Za-z0-9._~+/-]+=*/g, `$1 ${MASK}`],
  // KEY=value and "key": "value" pairs whose name looks like a credential.
  [/\b([A-Za-z0-9_]*(?:SECRET|PASSWORD|TOKEN|CONNECTION_STRING|CONNECTIONSTRING|_KEY)[A-Za-z0-9_]*)=("?)[^"\s]+\2/gi, `$1=${MASK}`],
  [/("[A-Za-z0-9_]*(?:secret|password|token|connectionString|key)"\s*:\s*)"[^"]*"/gi, `$1"${MASK}"`],
];

/** Removes credential-looking values from text before it is printed or logged. */
export function redact(text: string): string {
  return RULES.reduce((current, [pattern, replacement]) => current.replace(pattern, replacement), text);
}
