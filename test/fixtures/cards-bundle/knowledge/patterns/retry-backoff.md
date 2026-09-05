---
type: Pattern
title: "Retry with Exponential Backoff"
description: "Bounded retries with jitter for transient faults."
generated: { by: human:kris, at: 2026-05-02T10:00:00Z }
verified: { by: process:pattern-review, at: 2026-05-03T02:00:00Z }
sources:
  - id: aws-backoff
    resource: https://aws.amazon.com/blogs/architecture/exponential-backoff-and-jitter/
    title: Exponential Backoff And Jitter
---

# Retry with Exponential Backoff

Bounded retries with jitter for transient faults.

Full jitter, per the AWS write-up.[^aws-backoff]

[^aws-backoff]: Exponential Backoff And Jitter
