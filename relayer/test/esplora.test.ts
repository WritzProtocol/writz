import { EsploraClient } from '../src/bitcoin/esplora.js';

function mockFetchOnce(body: string, ok = true, status = 200) {
  (global.fetch as unknown as jest.Mock) = jest.fn().mockResolvedValue({
    ok,
    status,
    text: async () => body,
  });
}

describe('EsploraClient.getTipHeight', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('parses a well-formed height response', async () => {
    mockFetchOnce('842_193'.replace('_', '')); // "842193"
    const client = new EsploraClient('https://example.invalid');
    await expect(client.getTipHeight()).resolves.toBe(842193);
  });

  test('parses a height response with trailing whitespace', async () => {
    mockFetchOnce('842193\n');
    const client = new EsploraClient('https://example.invalid');
    await expect(client.getTipHeight()).resolves.toBe(842193);
  });

  test('throws instead of returning NaN for a malformed response body', async () => {
    // e.g. an HTML error page from a misconfigured proxy in front of Esplora.
    mockFetchOnce('<html><body>502 Bad Gateway</body></html>');
    const client = new EsploraClient('https://example.invalid');
    await expect(client.getTipHeight()).rejects.toThrow(/could not parse a block height/);
  });

  test('throws instead of returning NaN for an empty response body', async () => {
    mockFetchOnce('');
    const client = new EsploraClient('https://example.invalid');
    await expect(client.getTipHeight()).rejects.toThrow(/could not parse a block height/);
  });
});

describe('EsploraClient retry and fallback', () => {
  const PRIMARY = 'https://primary.invalid';
  const FALLBACK = 'https://fallback.invalid';
  const noSleep = async () => {};

  function respond(status: number, body = '') {
    return { ok: status >= 200 && status < 300, status, text: async () => body };
  }

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('does not retry by default (the header sync brings its own backoff)', async () => {
    const fetchMock = jest.fn().mockResolvedValue(respond(429, 'slow down'));
    (global.fetch as unknown as jest.Mock) = fetchMock;
    const client = new EsploraClient(PRIMARY);

    await expect(client.getTipHeight()).rejects.toMatchObject({ status: 429 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test('retries a 429 with backoff, then succeeds', async () => {
    const fetchMock = jest.fn()
      .mockResolvedValueOnce(respond(429))
      .mockResolvedValueOnce(respond(503))
      .mockResolvedValueOnce(respond(200, '327734'));
    (global.fetch as unknown as jest.Mock) = fetchMock;
    const sleep = jest.fn(async (_ms: number) => {});
    const client = new EsploraClient(PRIMARY, 1_000, { retries: 2, retryBaseDelayMs: 100, sleep });

    await expect(client.getTipHeight()).resolves.toBe(327734);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(sleep.mock.calls.map((c) => c[0])).toEqual([100, 200]);
  });

  test('falls back to the second host once the primary keeps failing', async () => {
    const fetchMock = jest.fn((url: string) =>
      Promise.resolve(url.startsWith(PRIMARY) ? respond(429) : respond(200, '327734')),
    );
    (global.fetch as unknown as jest.Mock) = fetchMock;
    const client = new EsploraClient(PRIMARY, 1_000, { retries: 1, fallbackBaseUrl: FALLBACK, sleep: noSleep });

    await expect(client.getTipHeight()).resolves.toBe(327734);
    expect(fetchMock.mock.calls.map((c) => c[0])).toEqual([
      `${PRIMARY}/blocks/tip/height`,
      `${PRIMARY}/blocks/tip/height`,
      `${FALLBACK}/blocks/tip/height`,
    ]);
  });

  test('throws the fallback error when both hosts are unavailable', async () => {
    (global.fetch as unknown as jest.Mock) = jest.fn((url: string) =>
      Promise.resolve(respond(url.startsWith(PRIMARY) ? 429 : 502)),
    );
    const client = new EsploraClient(PRIMARY, 1_000, { fallbackBaseUrl: FALLBACK, sleep: noSleep });

    await expect(client.getTipHeight()).rejects.toMatchObject({ status: 502 });
  });

  test('neither retries nor falls back on a 404', async () => {
    const fetchMock = jest.fn().mockResolvedValue(respond(404, 'Transaction not found'));
    (global.fetch as unknown as jest.Mock) = fetchMock;
    const client = new EsploraClient(PRIMARY, 1_000, { retries: 2, fallbackBaseUrl: FALLBACK, sleep: noSleep });

    await expect(client.getTxInfo('ab'.repeat(32))).rejects.toMatchObject({ status: 404 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test('a network error is retried', async () => {
    const fetchMock = jest.fn()
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValueOnce(respond(200, '5'));
    (global.fetch as unknown as jest.Mock) = fetchMock;
    const client = new EsploraClient(PRIMARY, 1_000, { retries: 1, sleep: noSleep });

    await expect(client.getTipHeight()).resolves.toBe(5);
  });
});
