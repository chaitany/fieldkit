# ADR-0002: Transforms are a closed DSL, not generated code

**Status:** Accepted

## Context
The tempting design is "have the LLM write a JS function per field". It's flexible, but it means
running model-written code inside a customer's environment. You can't meaningfully review it at scale,
and every security questionnaire would flag it.

## Decision
Transforms are a discriminated union of ~10 operations (`trim`, `parseDate`, `normalizePhone`,
`splitName`, `enumMap`, …), defined once in zod and implemented as pure functions. A mapping is plain JSON.

## Consequences
- **Reviewable:** a mapping change is a JSON diff in a PR.
- **Replayable:** the same spec on the same input always gives the same output, which makes incidents debuggable.
- **Safe:** there is no code execution path from the model or the customer's data.
- **Cost:** genuinely bespoke logic needs a new op. In practice the same 10–15 ops cover the large
  majority of real exports, and adding one is a ~10-line, type-checked change.
