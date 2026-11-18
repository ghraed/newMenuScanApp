import { apiClient } from '../src/api/client';
import { apiStartBackgroundRemoval } from '../src/api/scansApi';

jest.mock('../src/api/client', () => ({
  apiClient: { post: jest.fn() },
  parseApiResponse: jest.fn(),
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
