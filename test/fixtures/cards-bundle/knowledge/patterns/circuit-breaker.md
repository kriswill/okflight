---
type: Pattern
title: "Circuit Breaker"
description: "Fail fast when a dependency browns out."
generated: { by: reference_agent/gemini-2.5-pro, at: 2026-06-20T22:53:05Z }
verified: { by: human:kris, at: 2026-06-25T09:00:00Z }
sources:
  - id: fowler-cb
    resource: https://martinfowler.com/bliki/CircuitBreaker.html
    title: CircuitBreaker (Fowler)
    author: human:mfowler
    last_modified: 2014-03-06T00:00:00Z
  - id: incident-history
    resource: all SEV1 incidents tagged circuit-breaker
    title: Incident history
    usage_count: 42
usage_window: { from: 2026-06-01T00:00:00Z, to: 2026-06-30T00:00:00Z }
---

# Circuit Breaker

Fail fast when a dependency browns out.

The half-open probe interval follows Fowler's original sketch,[^fowler-cb] tuned against last quarter's incidents.[^incident-history]

[^fowler-cb]: CircuitBreaker (Fowler)
[^incident-history]: Incident history
