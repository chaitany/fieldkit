# ADR-0003: Offline first, PII masked by default

**Status:** Accepted

## Context
FDEs get deployed into banks, hospitals, and government networks where "we send your data to a
third-party model" ends the conversation. Even permissive customers want to know exactly what leaves the box.

## Decision
- The **heuristic mapper** (alias + edit distance + token Jaccard + type compatibility, greedy assignment)
  is a first-class engine, not a toy. It maps 9/9 fields on the sample export with no network access.
- The LLM mapper is opt-in (`ANTHROPIC_API_KEY`), uses `temperature: 0`, and has a timeout. **Any**
  failure falls back to the heuristic, and the reason is shown in the UI and the audit log.
- Samples are masked to their shape (`415-555-0101` → `999-999-9999`) unless the operator explicitly opts in.

## Consequences
- The product works in air-gapped environments on day one.
- The heuristic gives us a baseline for measuring the LLM (see the roadmap: mapping evals).
- Low-cardinality enum values (for example `Active Customer`) are still sent, because the LLM needs
  them to build enum maps. This is documented as a known disclosure.
