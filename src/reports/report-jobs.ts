import {
  BadRequestException,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import { BackoffOptions, Job, Queue, QueueEvents, Worker } from 'bullmq';

type Scenario = 'ok' | 'retry' | 'crash' | 'poison';
type JobState = 'queued' | 'processing' | 'completed' | 'dead-letter';

export interface ReportJobInput {
  reportId: string;
  scenario?: Scenario;
}

export interface ReportStatus {
  state: JobState;
  attempts: number;
  result?: string;
  error?: string;
  crashSeen?: boolean;
}

@Injectable()
export class ReportStateStore {
  private readonly states = new Map<string, ReportStatus>();

  upsert(reportId: string, patch: Partial<ReportStatus>) {
    const next = { attempts: 0, state: 'queued' as JobState, ...this.get(reportId), ...patch };
    this.states.set(reportId, next);
    return next;
  }

  get(reportId: string) {
    return this.states.get(reportId);
  }
}

@Injectable()
export class ReportProcessor {
  private readonly logger = new Logger(ReportProcessor.name);

  constructor(private readonly store: ReportStateStore) {}

  static retryBackoff(attemptsMade: number): BackoffOptions {
    return { type: 'exponential', delay: Math.min(500 * 2 ** attemptsMade, 4_000) };
  }

  async process(job: Pick<Job<ReportJobInput>, 'id' | 'attemptsMade' | 'data'>) {
    const { reportId, scenario = 'ok' } = job.data;
    const current = this.store.get(reportId);
    if (current?.state === 'completed') {
      this.log('duplicate_skip', reportId, job.attemptsMade, current);
      return current;
    }

    const state = this.store.upsert(reportId, {
      state: 'processing',
      attempts: job.attemptsMade + 1,
    });
    this.log('processing', reportId, job.attemptsMade, state);
    await new Promise((resolve) => setTimeout(resolve, 25));

    if (scenario === 'crash' && !current?.crashSeen) {
      this.store.upsert(reportId, { crashSeen: true });
      throw new Error('simulated worker crash');
    }
    if (scenario === 'retry' && job.attemptsMade === 0) {
      throw new Error('simulated transient error');
    }
    if (scenario === 'poison') {
      throw new Error('simulated poison message');
    }

    const completed = this.store.upsert(reportId, {
      state: 'completed',
      result: `report:${reportId}:ready`,
      error: undefined,
    });
    this.log('completed', reportId, job.attemptsMade, completed);
    return completed;
  }

  markDeadLetter(job: Pick<Job<ReportJobInput>, 'attemptsMade' | 'data'>, error: Error) {
    const failed = this.store.upsert(job.data.reportId, {
      state: 'dead-letter',
      attempts: job.attemptsMade + 1,
      error: error.message,
    });
    this.log('dead_letter', job.data.reportId, job.attemptsMade, failed);
    return failed;
  }

  private log(event: string, reportId: string, attemptsMade: number, status: ReportStatus) {
    this.logger.log(JSON.stringify({ event, reportId, attemptsMade, status }));
  }
}

@Injectable()
export class ReportQueueService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ReportQueueService.name);
  private readonly connection = {
    host: process.env.REDIS_HOST ?? '127.0.0.1',
    port: Number(process.env.REDIS_PORT ?? 6379),
  };
  private queue?: Queue<ReportJobInput>;
  private events?: QueueEvents;
  private worker?: Worker<ReportJobInput, ReportStatus>;

  constructor(
    private readonly store: ReportStateStore,
    private readonly processor: ReportProcessor,
  ) {}

  async onModuleInit() {
    this.queue = new Queue('reports', { connection: this.connection });
    this.events = new QueueEvents('reports', { connection: this.connection });
    this.worker = new Worker(
      'reports',
      (job) => this.processor.process(job),
      { connection: this.connection },
    );
    this.worker.on('failed', (job, error) => {
      if (job && job.attemptsMade + 1 >= (job.opts.attempts ?? 1)) {
        this.processor.markDeadLetter(job, error);
      }
    });
  }

  async onModuleDestroy() {
    await this.worker?.close();
    await this.events?.close();
    await this.queue?.close();
  }

  async enqueue(input: ReportJobInput) {
    const scenario = input.scenario ?? 'ok';
    const reportId = input.reportId?.trim();
    if (!reportId) {
      throw new BadRequestException('reportId is required');
    }
    if (!this.queue) {
      throw new ServiceUnavailableException('queue is not ready');
    }
    this.store.upsert(reportId, { state: 'queued' });
    const attemptPlan = scenario === 'poison' ? 2 : 3;
    const existing = await this.queue.getJob(`report:${reportId}`);
    const duplicate = Boolean(existing);
    const job = duplicate
      ? existing
      : await this.queue.add(
          'generate-report',
          { reportId, scenario },
          {
            jobId: `report:${reportId}`,
            attempts: attemptPlan,
            backoff: ReportProcessor.retryBackoff(0),
            removeOnComplete: 100,
          },
        );

    this.logger.log(
      JSON.stringify({
        event: duplicate ? 'duplicate_submission' : 'enqueued',
        reportId,
        queue: 'reports',
      }),
    );

    return {
      jobId: job?.id,
      duplicate,
      status: this.store.get(reportId),
      retry: ReportProcessor.retryBackoff(0),
    };
  }
}
