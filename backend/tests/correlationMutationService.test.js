'use strict';

const { createTimedTxQueryFn } = require('../src/correlation/CorrelationMutationService');

describe('createTimedTxQueryFn', () => {
  test('increments timeout metric on statement timeout', async () => {
    const inc = jest.fn();
    const queryFn = createTimedTxQueryFn({
      query: jest.fn().mockRejectedValue(Object.assign(new Error('canceling statement due to statement timeout'), { code: '57014' })),
    }, {
      dbQueryTimeoutsTotal: { inc },
    });

    await expect(queryFn('SELECT 1', [])).rejects.toThrow('statement timeout');
    expect(inc).toHaveBeenCalledTimes(1);
  });

  test('does not increment metric for non-timeout errors', async () => {
    const inc = jest.fn();
    const queryFn = createTimedTxQueryFn({
      query: jest.fn().mockRejectedValue(new Error('connection reset')),
    }, {
      dbQueryTimeoutsTotal: { inc },
    });

    await expect(queryFn('SELECT 1', [])).rejects.toThrow('connection reset');
    expect(inc).not.toHaveBeenCalled();
  });
});
