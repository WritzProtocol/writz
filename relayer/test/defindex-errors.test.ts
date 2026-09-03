import { CONTRACT_ERROR_NAMES, mapDefindexError } from '../src/defindex/errors.js';

function contractError(stellarErrorCode: string, message = 'Contract call failed') {
  return {
    error: 'ContractError',
    message,
    statusCode: 400,
    networkDetails: { stellarErrorCode },
  };
}

describe('mapDefindexError - ContractError code table', () => {
  for (const [code, name] of Object.entries(CONTRACT_ERROR_NAMES)) {
    test(`code ${code} maps to ${name}`, () => {
      const result = mapDefindexError(contractError(code));
      expect(result).toEqual({ status: 502, error: name });
    });
  }

  test('unrecognized code falls back to the upstream message, not a made-up name', () => {
    const result = mapDefindexError(contractError('999', 'Unknown contract failure'));
    expect(result).toEqual({ status: 502, error: 'Unknown contract failure' });
  });

  test('extracts the code from an alternate wire format like "Error(Contract, #117)"', () => {
    const result = mapDefindexError({
      error: 'ContractError',
      message: 'simulation failed',
      networkDetails: { context: 'HostError: Error(Contract, #117)' },
    });
    expect(result).toEqual({ status: 502, error: 'InsufficientAmount' });
  });

  test('falls back to a generic label when no code and no message are present', () => {
    const result = mapDefindexError({ error: 'ContractError' });
    expect(result).toEqual({ status: 502, error: 'ContractError' });
  });
});

describe('mapDefindexError - other DeFindex API error shapes', () => {
  test('NotFound -> 404', () => {
    const result = mapDefindexError({ error: 'NotFound', message: 'vault not found' });
    expect(result).toEqual({ status: 404, error: 'vault not found' });
  });

  test('BadRequest -> 400 with upstream message', () => {
    const result = mapDefindexError({ error: 'BadRequest', message: 'address is not a valid public key' });
    expect(result).toEqual({ status: 400, error: 'address is not a valid public key' });
  });

  test('ValidationFailed -> 400 with upstream message', () => {
    const result = mapDefindexError({ error: 'ValidationFailed', message: 'vaultAddress is required' });
    expect(result).toEqual({ status: 400, error: 'vaultAddress is required' });
  });

  test('Unauthorized (our API key) -> 500, never leaks as a contract-level Unauthorized', () => {
    const result = mapDefindexError({ error: 'Unauthorized', message: 'Invalid API key' });
    expect(result.status).toBe(500);
    expect(result.error).toBe('DeFindex API authentication failed - check DEFINDEX_API_KEY');
  });

  test('Forbidden -> 500', () => {
    const result = mapDefindexError({ error: 'Forbidden', message: 'blocked' });
    expect(result.status).toBe(500);
    expect(result.error).toBe('DeFindex API authentication failed - check DEFINDEX_API_KEY');
  });

  test('TooManyRequests -> 502', () => {
    const result = mapDefindexError({ error: 'TooManyRequests', message: 'slow down' });
    expect(result).toEqual({ status: 502, error: 'DeFindex API rate limit exceeded' });
  });

  test('unrecognized error discriminant falls back to the upstream message', () => {
    const result = mapDefindexError({ error: 'ServiceUnavailable', message: 'DeFindex is down for maintenance' });
    expect(result).toEqual({ status: 502, error: 'DeFindex is down for maintenance' });
  });

  test('a raw network-level throw with no .error field -> generic 502 fallback', () => {
    const result = mapDefindexError(new Error('connect ECONNREFUSED'));
    expect(result).toEqual({ status: 502, error: 'DeFindex API unavailable' });
  });

  test('a non-object thrown value -> generic 502 fallback', () => {
    const result = mapDefindexError('timeout');
    expect(result).toEqual({ status: 502, error: 'DeFindex API unavailable' });
  });
});
