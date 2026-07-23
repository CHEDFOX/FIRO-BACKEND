# ADR-0006: One AI Gateway, not separate AI microservices

- **Status:** Accepted (Phase 1)

## Context
The brief asks for "separate AI services: recommendation, planner, story
generation, trip assistant, content enrichment, moderation." Read literally, that
is several microservices from day one.

## Decision
Decouple AI **logically** through a narrow `AiPort` interface and a single **AI
Gateway** (sync/stream) plus **one worker pool** (async/batch). The distinct
capabilities (enrich, plan, summarize, moderate, assist, embed) are internal
handlers behind the port — not separate deployables. **No business module imports
the Anthropic SDK.**

## Rationale
- The coupling risk the brief worries about is solved by the *interface boundary*
  (`AiPort`), not by physical service separation.
- One Gateway centralizes the things that must be consistent: model tiering
  (Haiku/Sonnet/Opus for cost), the versioned prompt registry, structured-output
  validation, retries/timeouts, budgets/quotas, caching, and **PII redaction**.
- Embeddings use **Voyage AI** behind a separate `EmbeddingsPort` (Claude has no
  embeddings endpoint).

## Consequences
- (+) Consistent cost/safety controls; simple ops; easy to swap providers.
- (+) A capability can later be extracted to its own service behind the same port
  if its load profile demands it (same seam as ADR-0001).
- (−) All AI traffic shares one gateway process; mitigated by the async worker
  pool and per-capability budgets/backpressure.

## Alternatives rejected
- **A microservice per AI capability now:** premature fragmentation.
- **Letting modules call the LLM SDK directly:** the exact tight coupling the
  brief (rightly) wants to avoid.
