# Native benchmark dashboard

Generate the supplied Benchmark Explorer design from **existing** Vally 0.16.0
experiment output. This command never runs an agent, calls a model, or regrades.

```powershell
npm run eval:report -- --input C:\private\native-merged --output C:\reports\benchmark-site
```

The output directory must be new or empty and outside the input directory.
Open the generated `index.html` directly in a browser (`file://` works). The
HTML embeds its display data and JavaScript; the only other file is the logo.
No server, runtime fetch, database or publishing setup is required. The same two
files can later be hosted as a static site.

## Input contract

Use **one** canonical experiment directory, usually the output of
`vally experiment merge`. Never combine the merged output with its source shards.
It must contain `experiment-manifest.json`, `plan-snapshot.json` and each
manifest variant's `results.jsonl` and `run-summary.jsonl`. Standalone `vally eval`
and raw shard manifests are deliberately not supported.

This small adapter supports the existing `skill=off/on,model=<id>` native matrix,
with evals under `evals/<skill>/<scenario>/eval.yaml`. ON must provide only that
target skill; OFF must provide no skills. It validates native run, plan, variant,
model, eval/config provenance and trial identities before rendering. Different
experiments/runs are not combined. It does not prove runtime isolation from
these files alone; follow the [trusted local evaluation instructions](../experiments/README.md).
The dashboard omits unrecorded environment, reasoning-effort and seed settings.

## Display semantics

- Compare ON with OFF **within the same model and scenario**, not the experiment's
  global baseline. A missing counterpart is not comparable.
- Success rate is passing native grader verdicts with successful execution,
  divided by executed trials. Execution errors remain in that denominator;
  skipped and unexecuted trials do not. Grader failures are shown separately.
- Grader score is the native score, not a pass-rate substitute. Each trial's
  top-level grader results are also displayed separately without raw evidence.
- Metrics and scores use simple arithmetic means across executed trials. If any
  value is missing, that arm's mean is omitted rather than changing denominators
  or substituting zero. With one trial, the mean is exactly its native value.
- Tokens are `trajectory.metrics.tokenUsage.totalTokens`; cached tokens are not
  added again. Time is `trajectory.metrics.wallTimeMs`, not whole-trial
  `durationMs`. Turns, tools, errors and activations are native metrics, never
  recounted from events or inferred from `metadata.skillsLoaded`.
- Relative token change is `(ON - OFF) / OFF * 100`; a zero OFF denominator or
  missing value is not comparable. Other deltas are simple differences.
- Small sample counts do not establish statistical superiority. More tokens or
  time with the skill enabled must remain visible, not be presented as savings.

Vally's persisted experiment `run-summary.jsonl` is **provenance, not verdicts**.
Its persisted aggregate report is Markdown (and can include private paths);
the adapter does not parse it or reconstruct native reporting internals. Only
the simple presentation arithmetic above is performed on selected native fields.

## Publication boundary

Native output remains the source of truth. Generated HTML is disposable; there
is no new persisted benchmark data format. Keep native inputs private.

The adapter selects only identifier labels, opaque hash-prefix trial IDs,
provenance IDs, verdicts, scores and six native metrics. It rejects unsafe
identifier labels, escapes embedded JSON and renders strings with HTML escaping.
It never copies prompts, patches, configuration, raw paths, traces, free-text
grader evidence, internal URLs, credentials or the native Markdown report.
Review the generated site before publication; identifiers themselves must be
appropriate for the intended audience. Use a new/empty output directory so old
private files cannot accidentally be included in the publication.

`dashboard/index.html` and the authorized logo retain the provided static mock's
layout, styles, overview/detail navigation, model/search filters and English /
Japanese selection. The original fictional measurements, fixed sample counts
and model/environment placeholders are replaced by generated native data.
