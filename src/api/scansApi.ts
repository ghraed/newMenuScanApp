import { z } from 'zod';
import { apiClient, parseApiResponse, toApiError } from './client';
import { getApiBaseUrl } from './config';

const createScanResponseSchema = z.object({
  scanId: z.string().min(1),
});

const uploadImageResponseSchema = z.object({
  ok: z.boolean(),
});

const submitScanResponseSchema = z.object({
  jobId: z.string().min(1),
  status: z.union([z.literal('queued'), z.literal('processing')]),
});

const preprocessScanResponseSchema = z.object({
  ok: z.boolean(),
  processed: z.number().int().nonnegative(),
  total: z.number().int().positive(),
});

const PREPROCESS_SCAN_TIMEOUT_MS = 10 * 60 * 1000;

const jobResponseSchema = z.object({
  status: z.union([
    z.literal('queued'),
    z.literal('processing'),
    z.literal('ready'),
    z.literal('error'),
  ]),
  progress: z.number(),
  message: z.string().optional(),
  outputs: z
    .object({
      glbUrl: z.string().optional(),
      usdzUrl: z.string().optional(),
    })
    .optional(),
});

export type ApiCreateScanRequest = {
  deviceId: string;
  targetType: 'dish';
  scaleMeters: number;
  slotsTotal: number;
};

export type ApiCreateScanResponse = z.infer<typeof createScanResponseSchema>;
export type ApiUploadImageResponse = z.infer<typeof uploadImageResponseSchema>;
export type ApiSubmitScanResponse = z.infer<typeof submitScanResponseSchema>;
export type ApiPreprocessScanResponse = z.infer<typeof preprocessScanResponseSchema>;
export type ApiGetJobResponse = z.infer<typeof jobResponseSchema>;
export type FileType = 'glb' | 'usdz';

export type ApiUploadImageParams = {
  scanId: string;
  slot: number | string;
  heading: number | string;
  image: {
    uri: string;
    name?: string;
    type?: string;
  };
};

function normalizeLegacyJobResponse(data: unknown): unknown {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return data;
  }

  const record = data as Record<string, unknown>;
  if (!Array.isArray(record.outputs)) {
    return data;
  }

  const rest = { ...record };
  delete rest.outputs;
  return rest;
}

export async function apiCreateScan(
  payload: ApiCreateScanRequest,
): Promise<ApiCreateScanResponse> {
  try {
    const response = await apiClient.post('/scans', payload);
    return parseApiResponse(createScanResponseSchema, response.data, 'apiCreateScan');
  } catch (error) {
    throw toApiError(error, 'Failed to create scan');
  }
}

export async function apiUploadImage(
  params: ApiUploadImageParams,
): Promise<ApiUploadImageResponse> {
  const { scanId, slot, heading, image } = params;

  const formData = new FormData();
  formData.append('slot', String(slot));
  formData.append('heading', String(heading));
  formData.append('image', {
    uri: image.uri,
    name: image.name ?? `slot-${slot}.jpg`,
    type: image.type ?? 'image/jpeg',
  } as any);

  try {
    const response = await apiClient.post(`/scans/${scanId}/images`, formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    });

    return parseApiResponse(uploadImageResponseSchema, response.data, 'apiUploadImage');
  } catch (error) {
    throw toApiError(error, `Failed to upload image for scan ${scanId}`);
  }
}

export async function apiSubmitScan(scanId: string): Promise<ApiSubmitScanResponse> {
  try {
    const response = await apiClient.post(`/scans/${scanId}/submit`);
    return parseApiResponse(submitScanResponseSchema, response.data, 'apiSubmitScan');
  } catch (error) {
    throw toApiError(error, `Failed to submit scan ${scanId}`);
  }
}

export async function apiPreprocessScan(
  scanId: string,
  options?: {
    timeoutMs?: number;
  },
): Promise<ApiPreprocessScanResponse> {
  try {
    const response = await apiClient.post(`/scans/${scanId}/preprocess-bg`, undefined, {
      timeout: options?.timeoutMs ?? PREPROCESS_SCAN_TIMEOUT_MS,
    });
    return parseApiResponse(preprocessScanResponseSchema, response.data, 'apiPreprocessScan');
  } catch (error) {
    throw toApiError(error, `Failed to preprocess images for scan ${scanId}`);
  }
}

export async function apiGetJob(jobId: string): Promise<ApiGetJobResponse> {
  try {
    const response = await apiClient.get(`/jobs/${jobId}`);
    return parseApiResponse(jobResponseSchema, normalizeLegacyJobResponse(response.data), 'apiGetJob');
  } catch (error) {
    throw toApiError(error, `Failed to fetch job ${jobId}`);
  }
}

export function buildFileUrl(scanId: string, type: FileType): string {
  return `${getApiBaseUrl()}/api/files/${scanId}/${type}`;
}
