'use strict';

const { Evidence } = require('../../src/domain/Evidence');
const { ExternalLink } = require('../../src/domain/ExternalLink');
const { createEvidenceSchema } = require('../../src/domain/validation/evidenceSchema');
const { createExternalLinkSchema } = require('../../src/domain/validation/externalLinkSchema');
const { randomUUID } = require('crypto');

describe('Evidence Domain Model', () => {
  test('Evidence.create() setzt Defaults', () => {
    const e = Evidence.create({
      ticketId: randomUUID(),
      title: 'LSASS Zugriff erkannt',
    });
    expect(e.id).toBeDefined();
    expect(e.type).toBe('log_entry');
    expect(e.source).toBe('manual');
    expect(e.createdAt).toBeDefined();
  });
});

describe('createEvidenceSchema Validierung', () => {
  const validTicketId = randomUUID();

  test('gültige Evidence wird akzeptiert', () => {
    const { error } = createEvidenceSchema.validate({
      ticketId: validTicketId,
      title: 'Sysmon Event 10 — LSASS Zugriff',
    });
    expect(error).toBeUndefined();
  });

  test('fehlendes ticketId wird abgelehnt', () => {
    const { error } = createEvidenceSchema.validate({ title: 'Test' });
    expect(error).toBeDefined();
    expect(error.details[0].path).toContain('ticketId');
  });

  test('fehlendes title wird abgelehnt', () => {
    const { error } = createEvidenceSchema.validate({ ticketId: validTicketId });
    expect(error).toBeDefined();
  });

  test('confidence außerhalb 0-100 wird abgelehnt', () => {
    const { error } = createEvidenceSchema.validate({
      ticketId: validTicketId,
      title: 'Test',
      confidence: 150,
    });
    expect(error).toBeDefined();
  });

  test('rawText bis 50000 Zeichen erlaubt', () => {
    const { error } = createEvidenceSchema.validate({
      ticketId: validTicketId,
      title: 'Test',
      rawText: 'A'.repeat(50000),
    });
    expect(error).toBeUndefined();
  });
});

describe('ExternalLink Domain Model', () => {
  test('ExternalLink.create() setzt Defaults', () => {
    const link = ExternalLink.create({
      internalTicketId: randomUUID(),
      externalSystem: 'qradar',
      externalId: 'OFF-009134',
    });
    expect(link.id).toBeDefined();
    expect(link.syncStatus).toBe('pending');
    expect(link.syncDirection).toBe('inbound');
  });

  test('deduplicationKey kombiniert System + ID', () => {
    const link = ExternalLink.create({
      internalTicketId: randomUUID(),
      externalSystem: 'servicenow',
      externalId: 'INC0012345',
    });
    expect(link.deduplicationKey).toBe('servicenow::INC0012345');
  });

  test('markSynced() setzt Status und Timestamp', () => {
    const link = ExternalLink.create({
      internalTicketId: randomUUID(),
      externalSystem: 'qradar',
      externalId: 'OFF-001',
    });
    link.markSynced();
    expect(link.syncStatus).toBe('synced');
    expect(link.lastSyncAt).not.toBeNull();
    expect(link.lastSyncError).toBeNull();
  });

  test('markFailed() speichert Fehlermeldung', () => {
    const link = ExternalLink.create({
      internalTicketId: randomUUID(),
      externalSystem: 'splunk',
      externalId: 'notable-123',
    });
    link.markFailed('Connection timeout');
    expect(link.syncStatus).toBe('failed');
    expect(link.lastSyncError).toBe('Connection timeout');
  });
});

describe('createExternalLinkSchema Validierung', () => {
  const validId = randomUUID();

  test('gültiger Link wird akzeptiert', () => {
    const { error } = createExternalLinkSchema.validate({
      internalTicketId: validId,
      externalSystem: 'qradar',
      externalId: 'OFF-009134',
    });
    expect(error).toBeUndefined();
  });

  test('unbekanntes externalSystem wird abgelehnt', () => {
    const { error } = createExternalLinkSchema.validate({
      internalTicketId: validId,
      externalSystem: 'unknown-system',
      externalId: '123',
    });
    expect(error).toBeDefined();
  });

  test('ungültige URL wird abgelehnt', () => {
    const { error } = createExternalLinkSchema.validate({
      internalTicketId: validId,
      externalSystem: 'qradar',
      externalId: 'OFF-001',
      externalUrl: 'not-a-url',
    });
    expect(error).toBeDefined();
  });
});
