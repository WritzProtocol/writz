import {
  assertDeployTarget,
  findTargetConflicts,
  resolveDeployTarget,
  MAINNET_PASSPHRASE,
  TESTNET_PASSPHRASE,
  type RawTargetEnv,
} from '../src/deploy-target';

/** A testnet relayer with nothing wrong with it, for tests that break one thing. */
const validTestnet: RawTargetEnv = {
  target: 'testnet',
  bitcoinNetwork: 'signet',
  networkPassphrase: TESTNET_PASSPHRASE,
  stellarRpcUrl: 'https://soroban-testnet.stellar.org',
  corsOrigin: 'https://testnet.writz.xyz',
  defindexVaultId: 'CVAULTTESTNET',
};

/** A mainnet relayer with nothing wrong with it. */
const validMainnet: RawTargetEnv = {
  target: 'mainnet',
  bitcoinNetwork: 'mainnet',
  networkPassphrase: MAINNET_PASSPHRASE,
  stellarRpcUrl: 'https://mainnet.sorobanrpc.com',
  corsOrigin: 'https://app.writz.xyz',
  defindexVaultId: 'CVAULTMAINNET',
  kmsKeyId: 'alias/writz-protocol-key',
};

describe('resolveDeployTarget', () => {
  test('unset and blank mean local, so local dev needs no WRITZ_ENV', () => {
    expect(resolveDeployTarget(undefined)).toBe('local');
    expect(resolveDeployTarget('')).toBe('local');
    expect(resolveDeployTarget('  ')).toBe('local');
  });

  test('accepts the three real targets', () => {
    expect(resolveDeployTarget('local')).toBe('local');
    expect(resolveDeployTarget('testnet')).toBe('testnet');
    expect(resolveDeployTarget('mainnet')).toBe('mainnet');
  });

  test('rejects an unrecognized value instead of falling back to local', () => {
    // Falling back would silently disable every check below - the exact
    // failure this module exists to prevent.
    expect(() => resolveDeployTarget('prod')).toThrow(/WRITZ_ENV/);
    expect(() => resolveDeployTarget('Testnet')).toThrow(/WRITZ_ENV/);
  });
});

describe('findTargetConflicts - local', () => {
  test('checks nothing, however contradictory the env is', () => {
    expect(findTargetConflicts({})).toEqual([]);
    expect(
      findTargetConflicts({
        target: 'local',
        bitcoinNetwork: 'mainnet',
        networkPassphrase: MAINNET_PASSPHRASE,
        defindexVaultId: '',
        corsOrigin: '*',
      }),
    ).toEqual([]);
  });
});

describe('findTargetConflicts - testnet', () => {
  test('passes on a correctly configured testnet relayer', () => {
    expect(findTargetConflicts(validTestnet)).toEqual([]);
  });

  test('accepts "testnet" as the legacy alias for signet', () => {
    expect(findTargetConflicts({ ...validTestnet, bitcoinNetwork: 'testnet' })).toEqual([]);
  });

  test('catches a testnet target running on Bitcoin mainnet', () => {
    const problems = findTargetConflicts({ ...validTestnet, bitcoinNetwork: 'mainnet' });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/BITCOIN_NETWORK/);
  });

  test('catches a testnet target pointed at the public Stellar network', () => {
    const problems = findTargetConflicts({
      ...validTestnet,
      networkPassphrase: MAINNET_PASSPHRASE,
    });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/STELLAR_NETWORK_PASSPHRASE/);
  });

  test('requires its own vault id - the point of scoping config per target', () => {
    const problems = findTargetConflicts({ ...validTestnet, defindexVaultId: '' });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/DEFINDEX_VAULT_ID/);
  });

  test('does not impose the mainnet-only custody and CORS rules', () => {
    expect(
      findTargetConflicts({
        ...validTestnet,
        corsOrigin: '*',
        kmsKeyId: undefined,
        protocolSigningKeyWif: 'cVj...',
      }),
    ).toEqual([]);
  });
});

describe('findTargetConflicts - mainnet', () => {
  test('passes on a fully configured mainnet relayer', () => {
    expect(findTargetConflicts(validMainnet)).toEqual([]);
  });

  test('catches a mainnet target still on signet', () => {
    const problems = findTargetConflicts({ ...validMainnet, bitcoinNetwork: 'signet' });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/BITCOIN_NETWORK/);
  });

  test('catches the testnet passphrase and a testnet RPC url', () => {
    expect(
      findTargetConflicts({ ...validMainnet, networkPassphrase: TESTNET_PASSPHRASE })[0],
    ).toMatch(/STELLAR_NETWORK_PASSPHRASE/);
    expect(
      findTargetConflicts({
        ...validMainnet,
        stellarRpcUrl: 'https://soroban-testnet.stellar.org',
      })[0],
    ).toMatch(/test network/);
  });

  test('requires KMS and refuses the WIF fallback key', () => {
    expect(findTargetConflicts({ ...validMainnet, kmsKeyId: '' })[0]).toMatch(/KMS_KEY_ID/);
    expect(
      findTargetConflicts({ ...validMainnet, protocolSigningKeyWif: 'cVj...' })[0],
    ).toMatch(/PROTOCOL_SIGNING_KEY/);
  });

  test('refuses a wildcard or unset CORS origin', () => {
    expect(findTargetConflicts({ ...validMainnet, corsOrigin: '*' })[0]).toMatch(/CORS_ORIGIN/);
    expect(findTargetConflicts({ ...validMainnet, corsOrigin: undefined })[0]).toMatch(
      /CORS_ORIGIN/,
    );
  });

  test('reports every problem at once rather than one per failed boot', () => {
    // The realistic mistake: the testnet service cloned into a mainnet one.
    const problems = findTargetConflicts({ ...validTestnet, target: 'mainnet' });
    expect(problems).toEqual([
      expect.stringMatching(/BITCOIN_NETWORK/),
      expect.stringMatching(/STELLAR_NETWORK_PASSPHRASE/),
      expect.stringMatching(/test network/),
      expect.stringMatching(/KMS_KEY_ID/),
    ]);
  });
});

describe('assertDeployTarget', () => {
  test('returns the target when the env agrees with it', () => {
    expect(assertDeployTarget(validTestnet)).toBe('testnet');
    expect(assertDeployTarget(validMainnet)).toBe('mainnet');
    expect(assertDeployTarget({})).toBe('local');
  });

  test('throws one error naming the target and listing every conflict', () => {
    expect(() => assertDeployTarget({ ...validTestnet, target: 'mainnet' })).toThrow(
      /Deploy target "mainnet" is misconfigured/,
    );
  });
});
