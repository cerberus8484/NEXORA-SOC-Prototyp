'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { SCHEMA_VERSION } = require('../../src/domain/mlRoutingPolicy');
const { loadActiveRoutingPolicy, getActiveRoutingPolicy, _resetForTest } = require('../../src/services/routingPolicyInstance');

function writePolicy(content) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'routing-policy-'));
  const file = path.join(dir, 'recommended-routing-policy.json');
  fs.writeFileSync(file, JSON.stringify(content), 'utf8');
  return { dir, file };
}

const readyPolicy = (overrides = {}) => ({
  schemaVersion: SCHEMA_VERSION,
  status: 'ready',
  policyName: 'conservative_review_bias',
  recommendedThreshold: 0.7,
  ...overrides,
});

describe('routingPolicyInstance.loadActiveRoutingPolicy (fail-safe by design)', () => {
  test('unset ENV → inactive', () => {
    expect(loadActiveRoutingPolicy({})).toEqual({ active: false, reason: 'unset' });
  });

  test('valid ready policy → active with threshold + name (no filesystem path leaked)', () => {
    const { dir, file } = writePolicy(readyPolicy());
    try {
      const result = loadActiveRoutingPolicy({ ML_ROUTING_POLICY_PATH: file });
      expect(result.active).toBe(true);
      expect(result.policyName).toBe('conservative_review_bias');
      expect(result.threshold).toBe(0.7);
      // Der Dateipfad darf nicht im Return-Objekt stehen (No-Leak).
      expect(result.source).toBeUndefined();
      expect(JSON.stringify(result)).not.toContain(file);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('threshold exactly 0 → active (0 = auto-accept-all ist gültig, aber bewusst belegbar)', () => {
    const { dir, file } = writePolicy(readyPolicy({ recommendedThreshold: 0 }));
    try {
      const result = loadActiveRoutingPolicy({ ML_ROUTING_POLICY_PATH: file });
      expect(result.active).toBe(true);
      expect(result.threshold).toBe(0);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('blocked policy → inactive (never routes on an unproven policy)', () => {
    const { dir, file } = writePolicy(readyPolicy({ status: 'blocked', recommendedThreshold: null }));
    try {
      expect(loadActiveRoutingPolicy({ ML_ROUTING_POLICY_PATH: file })).toEqual({ active: false, reason: 'policy_blocked' });
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('schema mismatch → inactive', () => {
    const { dir, file } = writePolicy(readyPolicy({ schemaVersion: 'nexora.ml.routing-policy.v999' }));
    try {
      expect(loadActiveRoutingPolicy({ ML_ROUTING_POLICY_PATH: file })).toEqual({ active: false, reason: 'schema_mismatch' });
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('missing threshold → inactive', () => {
    const { dir, file } = writePolicy(readyPolicy({ recommendedThreshold: 'nope' }));
    try {
      expect(loadActiveRoutingPolicy({ ML_ROUTING_POLICY_PATH: file })).toEqual({ active: false, reason: 'no_threshold' });
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('unreadable/missing file → inactive (load_error), no throw', () => {
    const result = loadActiveRoutingPolicy({ ML_ROUTING_POLICY_PATH: path.join(os.tmpdir(), 'does-not-exist-xyz.json') });
    expect(result.active).toBe(false);
    expect(result.reason).toBe('load_error');
  });
});

describe('routingPolicyInstance.getActiveRoutingPolicy (memoised)', () => {
  afterEach(() => {
    _resetForTest();
    delete process.env.ML_ROUTING_POLICY_PATH;
  });

  test('default (no ENV) → inactive', () => {
    _resetForTest();
    expect(getActiveRoutingPolicy().active).toBe(false);
  });

  test('picks up a ready policy after reset', () => {
    const { dir, file } = writePolicy(readyPolicy());
    try {
      process.env.ML_ROUTING_POLICY_PATH = file;
      _resetForTest();
      expect(getActiveRoutingPolicy()).toMatchObject({ active: true, threshold: 0.7 });
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
