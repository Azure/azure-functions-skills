# Scoring

Score only candidates that survive the suitability checks. This is a qualitative
code review, not a measured return-on-investment estimate. Scores are internal:
they decide which findings make the report and in what order, and the report
doesn't show them.

| Dimension | Score | Meaning |
| --- | --- | --- |
| Likely value | 0 | No evidenced semantic judgment; deterministic code is sufficient. Reject. |
| Likely value | 1 | Plausible assistance, but ambiguity or operational benefit is weak. |
| Likely value | 2 | Clear interpretation or diagnosis task with useful source context. |
| Likely value | 3 | Clear task plus evidence of dropped work, repeated failures, brittle rules, or an existing model loop. |
| Adoption ease | 0 | Unsupported native language, safety requirement cannot be met, or integration contract cannot be established. |
| Adoption ease | 1 | Programming-model migration (such as Python v1 to v2 or .NET in-process to isolated), substantial model migration, sensitive-data controls, or major recovery plumbing needed. |
| Adoption ease | 2 | Localized supported integration with explicit validation and bounded side effects still to add. |
| Adoption ease | 3 | Existing supported runtime/configuration and a narrow, already validated reasoning boundary. |

Include a finding only when value is 2 or more, or value is 1 with ease 3. Value 0
is always rejected. Score both components so that "easy" does not hide a weak use
case. Drop a candidate supported only by indirect evidence, such as a helper you
couldn't read.

Python and .NET are the only supported languages today. If the exact .NET API isn't
documented yet, keep the sketch's API names as labeled placeholders. Node.js, Java,
and PowerShell findings are blocked (ease 0); include them only with value 2 or more.

Sort accepted findings by `value + ease`, then value, then source path and line.
Do not fill a quota or promote findings to make a report look useful. Group multiple
symptoms of the same reasoning boundary into one finding.

## Required tradeoffs

Weigh these for every accepted finding. The report's "Keep in mind" bullets cover
cost and latency, uncertain output, and fallback in one or two sentences each;
apply the rest in the sketch and the "How a hosted skill helps" text.

- Cost: which events invoke a model, expected token/tool drivers, and a proposed
  budget or concurrency limit to confirm. Unknown volume means unknown cost.
- Latency: synchronous versus asynchronous placement, timeout behavior, and whether
  callers or message locks can tolerate the added work.
- Non-determinism: output schema validation, evidence requirements, uncertain or
  invalid output handling, and any human approval needed.
- Fallback: what stays deterministic and what happens on timeout, provider failure,
  invalid output, or an unrepairable record. Do not silently drop work.
- Data and side effects: redact sensitive input, constrain tools, authorize tenant
  access, preserve idempotency, and bound replay or repair attempts in code/storage.

Do not promise exact cost, accuracy, or latency without measurements. An existing
TODO, complex branch, or regex count is evidence of code shape, not proof of value.
