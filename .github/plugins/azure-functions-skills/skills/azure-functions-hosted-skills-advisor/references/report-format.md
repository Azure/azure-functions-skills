# Report format

The report has one job: show the reader where the current code falls short and
how a hosted skill would improve it. Write it in the user's language, in plain
sentences a developer can act on. Use relative paths and 1-based line numbers from
inspected source. Avoid copying sensitive payloads or entire handlers.

Leave out priority, confidence, adoption status, and score labels; use the scoring
rubric only to decide which findings to include and in what order. Also leave out
a general function inventory, rejected candidates, code to keep deterministic,
coverage notes, and open questions.

````markdown
# Hosted skills opportunity report

Target: <workspace and app roots>
App: <language and programming model, such as Python v2 or .NET isolated>; Hosted Skills support: <supported / blocked>
Opportunities found: <integer, including zero>
<Only when the sketches use placeholder API names: one sentence saying so.>

## 1. <specific opportunity, phrased as the improvement>

Where: <path:start-end> in `<function>` (<trigger type>)

### What's limited today

- <a concrete flaw in the current code, with path:line evidence: records it drops,
  inputs its rules miss, failures it can't recover, or manual work it creates>
- <one bullet per distinct flaw; two to four bullets>

### How a hosted skill helps

<Two to four sentences: what the skill decides or repairs, where it plugs into the
existing code, what the existing deterministic code still does, and what changes
for the team or customer as a result.>

```<app language>
<short sketch; label app-specific helper placeholders; omit for blocked languages>
```

```yaml
<relevant .agent.md fragment, when applicable>
```

### Keep in mind

- Cost and latency: <which events call the model and where the call runs>
- Uncertain output: <how code validates non-deterministic output, and when a person reviews it>
- Fallback: <what happens on a timeout, provider failure, or invalid output; for
  recovery, also cover quarantine, bounded attempts, and idempotent replay>
````

Repeat the opportunity section for each accepted finding, strongest first. For a
blocked language, keep "What's limited today", replace the sketch with one sentence
saying Hosted Skills doesn't support that language yet, and drop "Keep in mind".
When there are none, write "No hosted skill opportunities found." with one sentence
explaining why. Do not manufacture a weak suggestion to avoid an empty report.

Keep each "Keep in mind" bullet to one or two sentences. Keep "How a hosted skill
helps" to four sentences. State API or documentation caveats once in the header,
not in each opportunity. Put skill instructions inside the `.agent.md` fragment
instead of a separate paragraph. Never recommend calling a
hosted skill in another app over HTTP.

Before saving, verify that each cited location exists, each supported opportunity
has an app-language sketch and all three "Keep in mind" bullets, and the count
matches. If the default report exists, save `hosted-skills-advisor-report-2.md`
(or the next unused suffix). Report the actual path. Recheck source files against
their initial state without reverting any pre-existing customer changes.
