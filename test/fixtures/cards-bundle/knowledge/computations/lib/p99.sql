select approx_percentile(latency_ms, 0.99) as p99 from {{ ref('request_log') }} where service = {{ var('service') }}
