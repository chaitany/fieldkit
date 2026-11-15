# ADR-0001: The LLM proposes, a human approves, the schema enforces

**Status:** Accepted

## Context
LLMs are very good at reading `ACV ($)` and knowing it means annual revenue. They are also
confidently wrong sometimes: they invent a column called `EmailAddr`, or map `Inactive` to `customer`.
In customer onboarding, one wrong mapping silently corrupts thousands of records in a system
someone else owns.

## Decision
Three independent layers, each of which works without the others:
1. **Validation of LLM output.** The response is parsed with zod. Any source column not in the profile is
   rejected *for that field only* and replaced with the heuristic suggestion. The UI shows the reason.
2. **Human approval gate.** Suggestions arrive with `approved: false`. `runPipeline({ dryRun: false })`
   throws if any required field is unapproved. Approvals are written to the audit log.
3. **Schema enforcement.** Every output row goes through the target's zod validator. Nothing is coerced past it.

## Consequences
- The LLM can only make the reviewer faster. It can never make the output wrong without a human signing off.
- Dry runs deliberately ignore the approval gate, so you can iterate quickly while the real run stays strict.
- Confidence scores are shown but don't gate anything; that judgement belongs to the reviewer.
