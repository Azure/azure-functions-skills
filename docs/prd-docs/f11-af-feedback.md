# F11: af-feedback — Improvement Loop

**Status:** 📋 Proposed  
**仮スペック Section:** 4.4, 6  
**Depends on:** F1 (Skill Graph Metadata)

## Problem

Skills are static once deployed. There's no structured way to collect feedback on:

- Whether a skill actually solved the user's problem
- Which transitions felt natural vs. forced
- What guidance was missing or incorrect
- Which skill gaps exist in the graph

Without feedback, the skill graph can't evolve based on real usage.

## Feature

`af-feedback` is a lightweight feedback collection skill that captures user experience signals and routes them to the skill improvement pipeline. It sits at the end of most skill chains as an optional next step.

## Feedback Types

| Type | Signal | Collection Method |
|------|--------|-------------------|
| **Task success** | "Did the skill help you complete the task?" | Yes/No prompt |
| **Transition quality** | "Was the suggested next step useful?" | Yes/No + optional comment |
| **Missing guidance** | "Was anything unclear or missing?" | Free text |
| **Skill gap** | "What were you trying to do that no skill covered?" | Free text |
| **Rating** | Overall experience | 1-5 scale |

## Skill Metadata

```yaml
id: af-feedback
title: Azure Functions Skills Feedback
intent:
  - provide_feedback
  - report_issue
  - suggest_improvement
completion_signals:
  - feedback_submitted
suggestions:
  on_success: []
  on_failure: []
entry_conditions:
  - task_completed
  - user_wants_to_give_feedback
```

## Feedback Flow

```
1. Prompt appears after task completion
   "How was your experience with af-deploy?"

2. Quick rating (optional)
   ⭐⭐⭐⭐⭐ (1-5)

3. Specific questions (optional)
   "Did the deployment succeed?" → Yes/No
   "Was the suggested next step (af-observability) useful?" → Yes/No
   "Any comments?" → Free text

4. Submit
   → Stored in telemetry / GitHub issue / feedback endpoint
```

## Storage Options

| Option | Pros | Cons |
|--------|------|------|
| Application Insights custom events | Already configured, queryable | Requires App Insights setup |
| GitHub Issues (labeled) | Visible to team, trackable | Requires GitHub auth |
| Local file (`~/.azure-functions-skills/feedback.json`) | No auth required, works offline | Not aggregatable |
| Anonymous telemetry endpoint | Centralized, no auth | Privacy considerations |

## Initial Implementation

For the first version, use **local file storage** as the simplest option:

```json
{
  "feedback": [
    {
      "timestamp": "2026-04-14T10:30:00Z",
      "skill": "af-deploy",
      "rating": 4,
      "taskSuccess": true,
      "transitionUseful": true,
      "comment": "Deployment worked, but CORS config was missing from guidance."
    }
  ]
}
```

Future versions can aggregate local feedback and submit to a central endpoint (opt-in).

## Integration with Skill Graph

Feedback data informs graph evolution:

- Skills with low success rates → review and improve content
- Transitions marked "not useful" → reduce priority or remove edge
- Frequently reported gaps → create new skills
- High-rated skills → promote in `af-help` recommendations

## Cross-Target Implementation

| Target | Surfacing |
|--------|-----------|
| GHCP | Post-task prompt with quick feedback options |
| Claude Code | End-of-skill feedback collection |
| Codex | Agent instruction with feedback prompt |
| Repo Template | Feedback link in `copilot-instructions.md` |
