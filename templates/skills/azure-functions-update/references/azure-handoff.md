# Azure and customer-environment handoff

Update owns Functions migration decisions and validation requirements. Azure Skills
owns resource creation/changes, deployment, SKU, RBAC, network, quota, and broad platform
work. Do not provision a sandbox directly from this skill.

For required service-backed validation, prepare:

- Behavior not proved locally and exact expected result.
- Minimum resource types/versions, OS, SKU, region, network, and policy properties.
- Test identity, least-privilege roles, fixture, data classification, observation method.
- Subscription/resource-group proposal, owner, time/cost limit, expiry, tags.
- Named writes, resource ownership, cleanup method and acceptance condition.
- Artifact identity from [the plan and evidence record](plan.md).

Obtain separate approval for the target, resource scope, identity, writes, cost, duration,
and cleanup. Prefer dedicated time-limited resources. No changes to existing customer
resources unless selected explicitly. Validation approval is not deployment approval.

Discover available Azure Skills and their requirements. If unavailable, deliver the
handoff and mark dependent checks blocked; do not bypass it with direct provisioning.
Return from the handoff with resource identifiers, test evidence, cost and cleanup
status, then evaluate acceptance. Failed cleanup remains visible and owned.

The handoff serves the already user-selected update plan. Do not start a second code
migration workflow or use the handoff as an implicit request to activate this skill.
If the Azure workflow requires broader changes, return the scope decision to the user.

SKU migration, including Linux Consumption to Flex, needs a separate platform decision.
Keep local work separate from an unresolved hosting-plan change. Customer-environment
tests require their own grants; a sandbox pass does not prove customer network, identity,
data, policy, or scale.

For a local-only app, do not ask for real app names or Azure access unless a required
condition needs them. For a deployed app, use only the approved metadata collection
scope. Do not retrieve full settings values under a names-only grant.
