import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ApiTokenItem, CreateTokenResult } from './apiTokensApi';
import {
  listTokens,
  createToken,
  revokeToken,
  TOKEN_DISPLAY_PREFIX_LEN,
} from './apiTokensApi';

// ── Mock api-Client ─────────────────────────────────────────────────────────
vi.mock('../../../lib/apiClient', () => ({
  api: {
    get:  vi.fn(),
    post: vi.fn(),
    del:  vi.fn(),
  },
}));

import { api } from '../../../lib/apiClient';

const mockApi = api as unknown as {
  get:  ReturnType<typeof vi.fn>;
  post: ReturnType<typeof vi.fn>;
  del:  ReturnType<typeof vi.fn>;
};

const mockToken: ApiTokenItem = {
  id:          'token-uuid-1',
  userId:      'user-uuid-1',
  name:        'Mein Skript',
  prefix:      'soc_a3f9b2c...',
  createdAt:   '2026-06-15T10:00:00.000Z',
  expiresAt:   null,
  lastUsedAt:  null,
  revoked:     false,
};

beforeEach(() => {
  vi.clearAllMocks();
});

// ── Typ-Invarianten ─────────────────────────────────────────────────────────

describe('ApiTokenItem Typ-Invariante: kein tokenHash-Feld', () => {
  it('ApiTokenItem hat kein tokenHash-Feld', () => {
    const t: ApiTokenItem = mockToken;
    expect(t).not.toHaveProperty('tokenHash');
    expect(t).not.toHaveProperty('token_hash');
  });

  it('prefix ist kein vollständiger Token-Wert', () => {
    // prefix hat 12 + 3 Zeichen = 15 max, kein vollständiger 68-stelliger Token
    expect(mockToken.prefix.length).toBeLessThan(20);
    expect(mockToken.prefix.endsWith('...')).toBe(true);
  });
});

describe('TOKEN_DISPLAY_PREFIX_LEN', () => {
  it('ist 12 (soc_XXXXXXXX)', () => {
    expect(TOKEN_DISPLAY_PREFIX_LEN).toBe(12);
  });
});

// ── listTokens ──────────────────────────────────────────────────────────────

describe('listTokens()', () => {
  it('gibt Token-Liste zurück', async () => {
    mockApi.get.mockResolvedValue({ data: [mockToken] });
    const result = await listTokens();
    expect(result).toEqual([mockToken]);
  });

  it('ruft GET /tokens auf', async () => {
    mockApi.get.mockResolvedValue({ data: [] });
    await listTokens();
    expect(mockApi.get).toHaveBeenCalledWith('/tokens');
  });

  it('gibt leeres Array zurück wenn keine Tokens', async () => {
    mockApi.get.mockResolvedValue({ data: [] });
    const result = await listTokens();
    expect(result).toEqual([]);
  });
});

// ── createToken ─────────────────────────────────────────────────────────────

describe('createToken()', () => {
  const mockCreateResult: CreateTokenResult = {
    token:    'soc_' + 'a'.repeat(64),
    apiToken: mockToken,
  };

  it('gibt { token, apiToken } zurück', async () => {
    mockApi.post.mockResolvedValue(mockCreateResult);
    const result = await createToken({ name: 'Neues Skript' });
    expect(result.token).toMatch(/^soc_/);
    expect(result.apiToken).toBeDefined();
  });

  it('ruft POST /tokens mit name auf', async () => {
    mockApi.post.mockResolvedValue(mockCreateResult);
    await createToken({ name: 'Test' });
    expect(mockApi.post).toHaveBeenCalledWith('/tokens', { name: 'Test', expiresAt: undefined });
  });

  it('übergibt expiresAt wenn angegeben', async () => {
    mockApi.post.mockResolvedValue(mockCreateResult);
    const exp = '2027-01-01T00:00:00.000Z';
    await createToken({ name: 'T', expiresAt: exp });
    expect(mockApi.post).toHaveBeenCalledWith('/tokens', { name: 'T', expiresAt: exp });
  });

  it('apiToken enthält kein tokenHash', async () => {
    mockApi.post.mockResolvedValue(mockCreateResult);
    const { apiToken } = await createToken({ name: 'T' });
    expect(apiToken).not.toHaveProperty('tokenHash');
  });
});

// ── revokeToken ─────────────────────────────────────────────────────────────

describe('revokeToken()', () => {
  it('ruft DEL /tokens/:id auf', async () => {
    mockApi.del.mockResolvedValue(undefined);
    await revokeToken('token-uuid-1');
    expect(mockApi.del).toHaveBeenCalledWith('/tokens/token-uuid-1');
  });

  it('gibt void zurück', async () => {
    mockApi.del.mockResolvedValue(undefined);
    const result = await revokeToken('token-uuid-1');
    expect(result).toBeUndefined();
  });
});
