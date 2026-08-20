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
