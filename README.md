# Reliable Async Job Processing Pattern (NestJS + Redis)

This project demonstrates a production-oriented pattern for moving heavy workloads out of the HTTP request path and into an asynchronous worker system.

Many backend services initially perform expensive work directly inside API handlers. While this works early on, it quickly leads to slow responses, timeouts, and cascading failures as traffic increases.

This example shows how to safely process long-running work using **NestJS and Redis-backed job processing** while protecting the system from common failure scenarios.

---

## Architecture Overview

The system separates request handling from background processing using a queue and worker.

Client Request
│
▼
HTTP Controller
POST /reports/generate
│
▼
Queue Producer
│
▼
Redis Queue
│
▼
Worker Process
│
▼
Job Processor

The API remains responsive while workers process jobs asynchronously. Workers can be scaled independently from the HTTP layer.

---

## Project Structure

.
|-- package.json
|-- src
| |-- app.module.ts
| |-- main.ts
| -- reports | |-- report-jobs.ts | |-- reports.controller.ts | -- reports.module.ts
|-- test
| -- report-jobs.spec.ts |-- tsconfig.build.json -- tsconfig.json

## Implementation Files

### reports.controller.ts

Exposes the API endpoint `POST /reports/generate` and enqueues a report generation job.

### report-jobs.ts

Implements the queue producer, worker, job processor, retry policy, dead-letter handling, job status store, and structured logging.

### report-jobs.spec.ts

Unit tests covering retry behavior, idempotent job handling, and failure scenarios.

---

## Why Move Work Off The Request Path

Performing heavy operations synchronously inside API handlers can create several problems:

- HTTP connections remain open longer than necessary
- worker threads become blocked by slow tasks
- tail latency increases dramatically under load
- failures in downstream systems propagate directly to clients

By enqueueing work instead:

- the API returns immediately
- Redis buffers bursts of incoming jobs
- workers process tasks independently
- the system scales horizontally

---

## Failure Modes Considered

Queue-based systems introduce several common failure scenarios. This project demonstrates safe handling for:

- worker crashes during job execution
- temporary dependency failures
- jobs that repeatedly fail (poison messages)
- duplicate job submissions

The demo includes simulated scenarios (`crash`, `retry`, `poison`) and suppresses duplicate jobs using a stable job identifier.

---

## Idempotent Job Processing

Most job queue systems provide **at-least-once delivery**, meaning a job may execute more than once.

Retries, worker restarts, or duplicate submissions can cause repeated execution.

The processor checks an in-memory status store before performing work. If a report has already completed, the worker returns the stored result instead of executing the job again.

This ensures the system behaves correctly even when duplicate jobs occur.

---

## Controlled Retry Strategy

Retries help recover from transient failures, but uncontrolled retries can overwhelm dependencies or hide poison messages.

This project demonstrates:

- exponential retry backoff
- capped retry delays
- dead-letter handling after retry exhaustion

Jobs that exceed retry limits are marked as **dead-letter** so they can be inspected rather than retried indefinitely.

---

## Running the Demo

1. Start Redis on `127.0.0.1:6379`

2. Install dependencies

```npm install```

1. Build the project

```npm run build```

1. Start the application

```npm start```

---

## Example Request

Send a POST request to:

POST /reports/generate

Example payload:

```json
{
  "reportId": "weekly-42",
  "scenario": "retry"
}
```
