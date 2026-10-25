/**
 * The faucet's configuration gate: without a Pollar server key and the app's
 * id it stays off (503 faucet_disabled), and a mainnet Pollar key is refused
 * at boot. The relayer never runs the faucet in an open mode.
 */
import * as btc from 'bitcoinjs-lib';
import { keyPairFromPrivkey } from '@writz/bitcoin-script';

const WIF = keyPairFromPrivkey(Buffer.alloc(32, 5), btc.networks.testnet).signer.toWIF();
const KEYS = ['BITCOIN_NETWORK', 'FAUCET_SIGNET_WIF', 'FAUCET_ENABLED', 'POLLAR_SECRET_KEY', 'POLLAR_APPLICATION_ID', 'WRITZ_ENV', 'PROTOCOL_SIGNING_KEY'];
let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  for (const k of KEYS) delete process.env[k];
  process.env.BITCOIN_NETWORK = 'signet';
  process.env.FAUCET_SIGNET_WIF = WIF;
});
afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

function load(): typeof import('../src/faucet/from-config.js') {
  let mod: typeof import('../src/faucet/from-config.js') | undefined;
  jest.isolateModules(() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    mod = require('../src/faucet/from-config.js');
  });
  return mod!;
}

test.each([
  ['no Pollar key and no application id', {}],
  ['a Pollar key without the application id', { POLLAR_SECRET_KEY: 'sec_testnet_abc' }],
  ['an application id without the Pollar key', { POLLAR_APPLICATION_ID: 'cmapp' }],
])('stays off with %s', (_label, env) => {
  Object.assign(process.env, env);
  const { faucet, disabledReason } = load().faucetFromConfig();
  expect(faucet).toBeUndefined();
  expect(disabledReason).toMatch(/social login/);
  expect(disabledReason).toMatch(/Pollar/);
});

test('FAUCET_ENABLED=false keeps it off whatever else is set', () => {
  Object.assign(process.env, { FAUCET_ENABLED: 'false', POLLAR_SECRET_KEY: 'sec_testnet_abc', POLLAR_APPLICATION_ID: 'cmapp' });
  expect(load().faucetFromConfig()).toMatchObject({ faucet: undefined, disabledReason: /switched off/ });
});

test('refuses to boot with a mainnet Pollar key', () => {
  process.env.POLLAR_SECRET_KEY = 'sec_mainnet_abc';
  expect(() => load()).toThrow(/sec_testnet_/);
});
