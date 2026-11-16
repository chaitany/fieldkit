# ADR-0005: Cost controls for a public demo

**Status:** Accepted

## Context
A public link to an app that calls a paid LLM API is an open wallet. It gets shared, crawled, and
scripted. The demo must show AI mapping to anyone evaluating the project, with a worst-case
bill measured in cents, not hundreds of dollars.

## Decision
Defence in depth. Each layer works without the others:

| # | Layer | Bounds |
|---|---|---|
| 1 | **Opt-in per request.** The visitor picks Offline, Hosted AI, or Own key. Offline never touches the network. | Accidental spend |
| 2 | **Hosted key runs on the built-in sample only** (`FIELDKIT_HOSTED_SAMPLE_ONLY`). Identified by SHA-256 of the content. | Arbitrary-size inputs and token cost per call |
| 3 | **Result cache** (24h TTL) keyed on content + options. With layer 2 there are only two cacheable variants, so each warm instance makes **at most a couple of real calls per day** in normal use. Failed calls aren't cached and still consume quota. | Repeat clicks |
| 4 | **Quotas:** per-visitor daily AI runs (IP hashed with a salt, never stored raw), a global daily cap, and a per-minute limit on every POST route. 429 responses include `Retry-After`. | Scripts and bots |
| 5 | **Bring your own key.** The key is kept in React state only (not localStorage), sent as a header, validated by format, never logged or written to the audit trail (which records `keySource`, not the key). | Lets evaluators test their own data at their own cost |
| 6 | **Outside the app:** a dedicated Anthropic workspace with a low monthly spend cap. | Everything else, including bugs in layers 1–5 |

## Consequences
- In-memory limiters are **per instance**. On serverless hosts with several warm instances, limits
  are approximate. That's acceptable because layers 2, 3 and 6 bound the real cost. The `Limiter`
  interface lets a Redis/Upstash implementation drop in for strict global limits.
- BYOK means the visitor trusts this deployment with their key for one request. The UI says
  exactly how it's handled; security-conscious visitors can run it locally instead.
- `ANTHROPIC_BASE_URL` support was added for testing (a mock server exercises the quota paths) and
  for customers who require traffic to go through a corporate LLM gateway.
