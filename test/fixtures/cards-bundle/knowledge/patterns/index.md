# patterns

## Concepts

* [Backpressure](backpressure.md) - Let slow consumers slow producers.
* [Blue-Green Deployment](blue-green.md)
* [Bulkhead](bulkhead.md) - Partition resources so one failure can't sink all.
* [Cache-Aside](cache-aside.md) - Read-through caching with explicit invalidation.
* [Progressive Delivery with Automated Canary Analysis and Rollback](canary-analysis.md) - Ship to a slice, compare, promote or revert.
* [Circuit Breaker](circuit-breaker.md) - Fail fast when a dependency browns out.
* [CQRS](cqrs.md) - Split read and write models.
* [Dead Letter Queue](dead-letter.md) - Park poison messages for later triage.
* [Event Sourcing](event-sourcing.md) - State as an append-only event log.
* [Feature Toggle](feature-toggle.md)
* [Idempotency Keys](idempotency-keys.md) - Make retried writes safe to repeat.
* [Transactional Outbox](outbox.md) - Atomically persist state and events.
* [Process Manager](process-manager.md) - Coordinate multi-service workflows.
* [Retry with Exponential Backoff](retry-backoff.md) - Bounded retries with jitter for transient faults.
* [Saga](saga.md) - Long-lived transactions as compensating steps.
* [Strangler Fig Migration](strangler-fig.md) - Grow the new system around the old.
