'use strict';

const { IntegrationService } = require('../../src/integrations/IntegrationService');

function fakeQueue() {
  return {
    started: false,
    stopped: false,
    handler: null,
    async registerWorker(_queue, handler) { this.handler = handler; },
    async start() { this.started = true; },
    async stop()  { this.stopped = true; },
  };
}

describe('IntegrationService.stopWorker', () => {
  it('stoppt die Queue, wenn der Worker lief', async () => {
    const q = fakeQueue();
    const svc = new IntegrationService(undefined, q);
    await svc.startWorker({});
    expect(q.started).toBe(true);

    await svc.stopWorker();
    expect(q.stopped).toBe(true);
  });

  it('ist ein No-Op, wenn der Worker nie gestartet wurde', async () => {
    const q = fakeQueue();
    const svc = new IntegrationService(undefined, q);
    await svc.stopWorker();
    expect(q.stopped).toBe(false);
  });
});
