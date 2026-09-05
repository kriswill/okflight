---
type: Attested Computation
title: Gross margin for fiscal year
description: Gross margin, computed from a shared SQL file (§10.3 file form).
runtime: bigquery
computation: lib/margin.sql
parameters:
  - { name: year, type: integer, required: true }
generated: { by: okflight/0.4.0, at: 2026-07-01T00:00:00Z }
---

# Definition

Margin divides [gross profit](./profit.md) by [revenue](./revenue.md); the SQL
lives in `lib/margin.sql` so dbt and OKF share one file.
