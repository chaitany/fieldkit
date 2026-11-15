# ADR-0004: Preflight checks and source-schema drift detection

**Status:** Accepted

## Context
The most common onboarding failure isn't the first import. It's the *fourth*, after the customer's
admin adds a column or renames `Tel` to `Mobile`, and a nightly job quietly drops every phone number.

## Decision
- Each `MappingSpec` stores a **fingerprint** (SHA-256 of the sorted column names) of the source it was approved against.
- `preflight()` runs before any row is processed and checks: target match, required fields mapped,
  required fields approved, and fingerprint match.
- Drift is a **warning in dry runs** (that's how you find it) and **fatal in real runs**.

## Consequences
- Failures happen at second 0 with a clear message, not hours in with partial writes.
- Re-approval after drift is deliberate friction: a person confirms the new shape.
- Fingerprinting by column names doesn't catch semantic drift (same column, new meaning). Value
  distribution checks are a future enhancement.
