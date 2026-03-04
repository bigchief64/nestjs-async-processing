import {
  ReportProcessor,
  ReportStateStore,
} from '../src/reports/report-jobs';

describe('ReportProcessor', () => {
  let store: ReportStateStore;
  let processor: ReportProcessor;

  beforeEach(() => {
    store = new ReportStateStore();
    processor = new ReportProcessor(store);
  });

  it('retries a transient job and completes on the next attempt', async () => {
    await expect(
      processor.process({
        id: 'job-1',
        attemptsMade: 0,
        data: { reportId: 'retry-demo', scenario: 'retry' },
      } as never),
    ).rejects.toThrow('simulated transient error');

    const result = await processor.process({
      id: 'job-1',
      attemptsMade: 1,
      data: { reportId: 'retry-demo', scenario: 'retry' },
    } as never);

    expect(result.state).toBe('completed');
    expect(result.attempts).toBe(2);
    expect(ReportProcessor.retryBackoff(2)).toEqual({
      type: 'exponential',
      delay: 2_000,
    });
  });

  it('skips duplicate processing after a successful completion', async () => {
    const first = await processor.process({
      id: 'job-2',
      attemptsMade: 0,
      data: { reportId: 'idempotent-demo' },
    } as never);

    const second = await processor.process({
      id: 'job-2',
      attemptsMade: 1,
      data: { reportId: 'idempotent-demo' },
    } as never);

    expect(second).toEqual(first);
    expect(store.get('idempotent-demo')?.attempts).toBe(1);
  });

  it('marks exhausted poison jobs as dead-lettered', async () => {
    await expect(
      processor.process({
        id: 'job-3',
        attemptsMade: 1,
        data: { reportId: 'poison-demo', scenario: 'poison' },
      } as never),
    ).rejects.toThrow('simulated poison message');

    const failed = processor.markDeadLetter(
      {
        attemptsMade: 1,
        data: { reportId: 'poison-demo', scenario: 'poison' },
      } as never,
      new Error('simulated poison message'),
    );

    expect(failed.state).toBe('dead-letter');
    expect(failed.error).toBe('simulated poison message');
    expect(failed.attempts).toBe(2);
  });
});
