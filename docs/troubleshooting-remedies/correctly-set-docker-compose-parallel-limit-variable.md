# Correctly set Docker Compose Parallel limit Variable

## Problem Summary

By default, Docker Compose starts multiple services in parallel to speed up the process. However, in some environments (especially on resource-constrained machines or CI pipelines), this can cause issues like -:
 - TLS handshake time out when pulling/downloading images from ECR
 - High CPU or memory usage
 - Services failing to start because dependencies aren’t ready yet

## Resolution Summary

1. Open your terminal.
2. Run:`COMPOSE_PARALLEL_LIMIT=1 chs-dev up`.

Setting: `COMPOSE_PARALLEL_LIMIT=1`  forces Docker Compose to start services one at a time, serially, instead of in parallel.

## Rationale

This prevents resource contention which happens when there are too many processes competing for network access through the vpn.

