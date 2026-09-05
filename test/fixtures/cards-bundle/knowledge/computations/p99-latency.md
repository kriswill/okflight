---
type: Attested Computation
title: "p99 request latency"
description: "Ninety-ninth percentile latency for a service over the last hour (file-form computation, dbt)."
status: draft
runtime: dbt
computation: lib/p99.sql
parameters:
  - { name: service, type: string, required: true }
attester:
  resource: lib/dbt-binding.py
generated: { by: human:kris, at: 2026-07-10T08:00:00Z }
stale_after: 2026-08-01T00:00:00Z
---

# p99 request latency

Ninety-ninth percentile latency for a service over the last hour (file-form computation, dbt).

## Related

- [p99](../glossary/p99.md)
