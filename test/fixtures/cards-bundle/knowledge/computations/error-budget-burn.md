---
type: Attested Computation
title: "Error budget burn rate"
description: "Burn rate of a service's error budget over a window, per the SLO catalog."
status: stable
runtime: bigquery
parameters:
  - { name: service, type: string, required: true }
  - { name: window_hours, type: integer, required: false }
executor:
  resource: ../references/queue-semantics.md
  receipt: [job_id, executed_sql, result]
attester:
  resource: lib/sql-equality.py
generated: { by: reference_agent/gemini-2.5-pro, at: 2026-06-28T14:00:00Z }
verified:
  - { by: process:slo-nightly, at: 2026-07-01T02:00:00Z }
  - { by: human:kris, at: 2026-07-02T09:00:00Z }
stale_after: 2099-12-31T00:00:00Z
sources:
  - id: slo-catalog
    resource: ../references/slo-catalog.md
    title: SLO Catalog
---

# Error budget burn rate

Burn rate of a service's error budget over a window, per the SLO catalog.

## Computation

```sql
SELECT 1 - SUM(good) / SUM(total) AS burn
FROM slo.events
WHERE service = @service
  AND ts > TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL @window_hours HOUR)
```

Budgets come from the catalog.[^slo-catalog]

[^slo-catalog]: SLO Catalog

## Related

- [SLO Catalog](../references/slo-catalog.md)
