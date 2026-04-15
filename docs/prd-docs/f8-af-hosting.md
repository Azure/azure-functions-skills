# F8: af-hosting — Hosting Plan Guidance

**Status:** 📋 Proposed  
**仮スペック Section:** 4.2, 6, 8  
**Depends on:** F1 (Skill Graph Metadata)

## Problem

Azure Functions offers multiple hosting plans (Flex Consumption, Consumption, Premium, Dedicated, Container Apps), each with different pricing, scaling, networking, and feature trade-offs. Developers often choose the wrong plan, leading to unexpected costs, cold start issues, or missing features (like VNET integration). There's no structured guidance that helps them compare plans based on their specific requirements.

## Feature

`af-hosting` helps developers choose and configure the right Azure Functions hosting plan by analyzing their requirements and providing plan-specific guidance.

## Hosting Plan Matrix

| Feature | Flex Consumption | Consumption | Premium (EP) | Dedicated (ASP) | Container Apps |
|---------|-----------------|-------------|-------------|-----------------|----------------|
| **Scaling** | Event-driven, per-function | Event-driven | Pre-warmed + event | Manual / auto-scale rules | KEDA-based |
| **Cold start** | ~1s | 1-10s | None (always warm) | None | Varies |
| **Max timeout** | Unlimited | 5/10 min | Unlimited | Unlimited | Unlimited |
| **VNET** | ✅ | ❌ | ✅ | ✅ | ✅ |
| **Min instances** | 0 | 0 | 1+ | 1+ | 0 |
| **Max instances** | 1000 | 200 | 100 | 20-100 | 300 |
| **Pricing** | Per-execution + memory | Per-execution | Per-instance/hour | Per-instance/hour | Per-vCPU-s |
| **Private endpoints** | ✅ | ❌ | ✅ | ✅ | ✅ |
| **GPU** | ❌ | ❌ | ❌ | ❌ | ✅ |
| **Custom containers** | ❌ | ❌ | ✅ | ✅ | ✅ |

## Decision Flow

```
1. Do you need VNET integration?
   ├── Yes → Flex Consumption, Premium, Dedicated, or Container Apps
   └── No → Any plan

2. What's your traffic pattern?
   ├── Sporadic / unpredictable → Flex Consumption or Consumption
   ├── Steady with peaks → Premium
   └── Constant high volume → Dedicated

3. Can you tolerate cold starts?
   ├── No → Premium or Dedicated
   └── Yes → Flex Consumption or Consumption

4. Budget constraint?
   ├── Pay-per-use only → Flex Consumption or Consumption
   └── Predictable monthly → Dedicated

5. Need custom containers?
   ├── Yes → Container Apps or Premium
   └── No → Any plan
```

## Skill Metadata

```yaml
id: af-hosting
title: Azure Functions Hosting Plan Guidance
intent:
  - choose_hosting_plan
  - compare_skus
  - optimize_cost
  - plan_migration
completion_signals:
  - hosting_plan_selected
  - plan_comparison_shown
suggestions:
  on_success:
    - target: af-deploy
      reason: "After choosing a hosting plan, deploy the app."
      priority: 100
    - target: af-feedback
      reason: "Share feedback on the hosting guidance."
      priority: 30
  on_failure:
    - target: af-help
      reason: "If hosting decision is blocked, get general guidance."
      priority: 70
entry_conditions:
  - planning_deployment
  - cost_concerns
  - scaling_requirements
```

## Scenario-Based Recommendations

### Low-traffic API

**Profile:** < 100K executions/month, HTTP triggers, no VNET needed  
**Recommendation:** Flex Consumption  
**Reason:** Cheapest for low traffic, fast cold starts, pay-per-use

### Enterprise background processing

**Profile:** Queue/Service Bus triggers, VNET required, consistent load  
**Recommendation:** Premium (EP1/EP2)  
**Reason:** Always-warm, VNET, unlimited timeout, predictable performance

### Startup MVP

**Profile:** Unpredictable traffic, budget-sensitive, quick iteration  
**Recommendation:** Flex Consumption  
**Reason:** Scale-to-zero, no minimum cost, fast deployment

### High-throughput event processing

**Profile:** Event Hub/Kafka, millions of events/day, latency-sensitive  
**Recommendation:** Premium (EP2/EP3)  
**Reason:** Pre-warmed instances, larger memory, VNET for Event Hub private endpoints

## Cross-Target Implementation

| Target | Surfacing |
|--------|-----------|
| GHCP | Interactive Q&A to determine requirements, comparison table output |
| Claude Code | Decision flow with reasoning for each recommendation |
| Codex | Agent instruction with hosting plan selection logic |
| Repo Template | Hosting plan note in `copilot-instructions.md` based on detected config |
