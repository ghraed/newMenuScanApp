import { apiClient } from '../src/api/client';
import { apiGetScan, apiStartBackgroundRemoval } from '../src/api/scansApi';

jest.mock('../src/api/client', () => ({
  apiClient: { get: jest.fn(), post: jest.fn() },
  parseApiResponse: (schema: { parse: (data: unknown) => unknown }, data: unknown) => schema.parse(data),
  toApiError: (error: unknown) => error,
}));

jest.mock('../src/api/config', () => ({
  getApiBaseUrl: () => 'https://scan.example.test',
}));

test('accepts a queued background job with a null message', async () => {
  (apiClient.post as jest.Mock).mockResolvedValueOnce({
    data: {
      jobId: 'job-123',
      status: 'queued',
      progress: 0,
      availableSlots: [],
      previewAvailable: false,
      message: null,
    },
  });

  await expect(apiStartBackgroundRemoval('scan-123')).resolves.toMatchObject({
    jobId: 'job-123',
    status: 'queued',
    message: undefined,
  });
});

test('fetches current model links from the scan endpoint', async () => {
  const outputs = {
    glbUrl: 'https://scan.example.test/api/scans/scan-123/files/glb',
    glbSignedUrl: 'https://storage.example.test/fresh-glb',
    usdzSignedUrl: 'https://storage.example.test/fresh-usdz',
  };
  (apiClient.get as jest.Mock).mockResolvedValueOnce({
    data: { scanId: 'scan-123', outputs },
  });

  await expect(apiGetScan('scan-123')).resolves.toEqual({
    scanId: 'scan-123',
    outputs,
  });
  expect(apiClient.get).toHaveBeenCalledWith('/scans/scan-123');
});
