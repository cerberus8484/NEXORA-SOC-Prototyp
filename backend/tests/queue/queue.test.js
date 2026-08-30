'use strict';

const { InMemoryQueueService }  = require('../../src/queue/InMemoryQueueService');
const { QueueService, QUEUES }  = require('../../src/queue/QueueService');
const { IntegrationProcessor }  = require('../../src/integrations/IntegrationProcessor');
const { IntegrationService }    = require('../../src/integrations/IntegrationService');
const { InMemoryIntegrationRepository } = require('../../src/repositories/IntegrationRepository');
const { auditService }          = require('../../src/services/AuditService');

beforeEach(() => auditService.clearLog());

// ── QueueService Interface ──────────────────────────────────

describe('QueueService Interface', () => {
  test('nicht implementierte Methoden werfen Fehler', async () => {
    const q = new QueueService();
    await expect(q.enqueue('q', {})).rejects.toThrow('nicht implementiert');
    await expect(q.registerWorker('q', () => {})).rejects.toThrow('nicht implementiert');
    await expect(q.start()).rejects.toThrow('nicht implementiert');
    await expect(q.stop()).rejects.toThrow('nicht implementiert');
  });
});

// ── InMemoryQueueService ───────────────────────────────────

describe('InMemoryQueueService', () => {
  let queue;
  beforeEach(() => { queue = new InMemoryQueueService(); });

  test('enqueue() ohne Worker speichert Job', async () => {
    await queue.start();
    const jobId = await queue.enqueue('test.queue', { foo: 'bar' });
    expect(jobId).toBeDefined();
    expect(queue.getJobs('test.queue').length).toBe(1);
  });

  test('enqueue() mit Worker führt Handler aus', async () => {
    const processed = [];
    await queue.registerWorker('test.q', async (job) => { processed.push(job.data); });
    await queue.start();
    await queue.enqueue('test.q', { value: 42 });
    expect(processed.length).toBe(1);
    expect(processed[0].value).toBe(42);
  });

  test('fehlschlagender Handler → Job-Status = failed', async () => {
    await queue.registerWorker('fail.q', async () => { throw new Error('Verarbeitungsfehler'); });
    await queue.start();
    await queue.enqueue('fail.q', { x: 1 });
    const jobs = queue.getJobs('fail.q');
    expect(jobs[0].status).toBe('failed');
    expect(jobs[0].failReason).toBe('Verarbeitungsfehler');
  });

  test('QUEUES Konstanten sind definiert', () => {
    expect(QUEUES.INTEGRATION_PROCESS).toBeDefined();
  });
});

// ── IntegrationProcessor ───────────────────────────────────

describe('IntegrationProcessor', () => {
  let repo, processor;

  beforeEach(() => {
    repo      = new InMemoryIntegrationRepository();
    processor = new IntegrationProcessor(repo);
    auditService.clearLog();
  });

  test('verarbeitet Event → Status processed', async () => {
    // Event manuell in Repo speichern
    const { IntegrationEvent } = require('../../src/integrations/IntegrationEvent');
    const event = IntegrationEvent.create({
      source:         'generic',
      rawPayload:     { title: 'Test' },
      normalizedData: { title: 'Test', priority: 'medium', source: 'generic' },
      status:         'queued',
    });
    await repo.save(event);

    await processor.process({ id: 'job-1', data: { eventId: event.id }, retryCount: 0 });

    const all    = await repo.findAll();
    const saved  = all.find(e => e.id === event.id);
    expect(saved.status).toBe('processed');
    expect(saved.processedAt).toBeDefined();
  });

  test('verarbeitet das Event — Pipeline-Status, KEIN INTEGRATION_PROCESSED im Audit (Datenminimierung)', async () => {
    const { IntegrationEvent } = require('../../src/integrations/IntegrationEvent');
    const event = IntegrationEvent.create({
      source: 'generic', rawPayload: { title: 'T' },
      normalizedData: { title: 'T', priority: 'low', source: 'generic' },
      status: 'queued',
    });
    await repo.save(event);
    await processor.process({ id: 'job-2', data: { eventId: event.id }, retryCount: 0 });

    const processed = (await repo.findAll()).find((e) => e.id === event.id);
    expect(['processed', 'ticket_created']).toContain(processed.status);
    const log = auditService.getLog();
    expect(log.some(e => e.action === 'INTEGRATION_PROCESSED')).toBe(false);
  });

  test('fehlerhafter Adapter → Status failed nach MAX_RETRIES', async () => {
    const { IntegrationEvent } = require('../../src/integrations/IntegrationEvent');
    const failAdapter = { process: async () => { throw new Error('Adapter Fehler'); } };
    const failProcessor = new IntegrationProcessor(repo, { generic: failAdapter });

    const event = IntegrationEvent.create({
      source: 'generic', rawPayload: { title: 'F' },
      normalizedData: { title: 'F', priority: 'high', source: 'generic' },
      status: 'queued',
    });
    await repo.save(event);

    // retryCount = MAX_RETRIES - 1 = 2 → letzter Versuch → failed
    await expect(
      failProcessor.process({ id: 'job-3', data: { eventId: event.id }, retryCount: 2 })
    ).resolves.toBeUndefined(); // kein Fehler nach finalem Versuch

    const all   = await repo.findAll();
    const saved = all.find(e => e.id === event.id);
    expect(saved.status).toBe('failed');

    const log = auditService.getLog();
    expect(log.some(e => e.action === 'INTEGRATION_FAILED')).toBe(true);
  });

  test('fehlerhafter Job ohne eventId wird übersprungen', async () => {
    await expect(
      processor.process({ id: 'job-noid', data: {}, retryCount: 0 })
    ).resolves.toBeUndefined();
  });
});

// ── IntegrationService + Queue Integration ─────────────────

describe('IntegrationService mit Queue', () => {
  let repo, queue, service;

  beforeEach(async () => {
    repo    = new InMemoryIntegrationRepository();
    queue   = new InMemoryQueueService();
    service = new IntegrationService(repo, queue);
    await queue.start();
    process.env.WEBHOOK_SECRET_GENERIC = 'test-secret';
    auditService.clearLog();
  });

  test('valides Event → Status queued → Job in Queue', async () => {
    await service.ingest('generic', { title: 'C2 Beacon', priority: 'high' });
    const events = await repo.findAll();
    expect(events.length).toBe(1);
    expect(events[0].status).toBe('queued');
    const jobs = queue.getJobs(QUEUES.INTEGRATION_PROCESS);
    expect(jobs.length).toBe(1);
    expect(jobs[0].data.eventId).toBe(events[0].id);
  });

  test('abgelehntes Event → kein Queue-Job', async () => {
    try {
      await service.ingest('generic', { title: '' });
    } catch {}
    const jobs = queue.getJobs(QUEUES.INTEGRATION_PROCESS);
    expect(jobs.length).toBe(0);
  });

  test('Duplikat → kein Queue-Job', async () => {
    await service.ingest('generic', { title: 'Dup', externalId: 'X1' });
    await service.ingest('generic', { title: 'Dup', externalId: 'X1' });
    const jobs = queue.getJobs(QUEUES.INTEGRATION_PROCESS);
    expect(jobs.length).toBe(1); // nur ein Job für das Original
  });
});
