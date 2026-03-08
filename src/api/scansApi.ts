import { z } from 'zod';
import { apiClient, parseApiResponse, toApiError } from './client';
import { getApiBaseUrl } from './config';
import { ObjectSelection } from '../types/scanSession';

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

const legacyPreprocessResponseSchema = z.object({
  ok: z.boolean(),
  processed: z.number().int().nonnegative(),
  total: z.number().int().positive(),
});

const backgroundJobResponseSchema = z.object({
  jobId: z.string().min(1),
  status: z.union([
    z.literal('queued'),
    z.literal('processing'),
    z.literal('partial'),
    z.literal('ready'),
    z.literal('error'),
  ]),
  progress: z.number(),
  availableSlots: z.array(z.number().int().nonnegative()).default([]),
  previewAvailable: z.boolean().default(false),
  message: z.string().optional(),
});

const jobResponseSchema = z.object({
  status: z.union([
    z.literal('queued'),
    z.literal('processing'),
    z.literal('partial'),
    z.literal('ready'),
    z.literal('error'),
  ]),
  progress: z.number(),
  message: z.string().optional(),
  availableSlots: z.array(z.number().int().nonnegative()).optional(),
  previewAvailable: z.boolean().optional(),
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
export type ApiStartBackgroundRemovalResponse = {
  jobId: string;
  status: 'queued' | 'processing' | 'partial' | 'ready' | 'error';
  progress: number;
  availableSlots: number[];
  previewAvailable: boolean;
  message?: string;
  legacyCompleted?: boolean;
};
export type ApiGetJobResponse = z.infer<typeof jobResponseSchema>;
export type FileType = 'glb' | 'usdz';

export type ApiUploadImageParams = {
  scanId: string;
  slot: number | string;
  heading: number | string;
  objectSelection?: ObjectSelection;
  image: {
    uri: string;
    name?: string;
    type?: string;
  };
};

type ApiPreprocessScanOptions = {
  objectSelection?: ObjectSelection;
  timeoutMs?: number;
};

const START_BG_TIMEOUT_MS = 8000;

function buildSelectionPayload(selection?: ObjectSelection) {
  if (!selection) {
    return undefined;
  }

  return {
    method: selection.method,
    bbox: selection.bbox,
    point: selection.point,
    selectedAt: selection.selectedAt,
  };
}

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
  const { scanId, slot, heading, image, objectSelection } = params;

  const formData = new FormData();
  formData.append('slot', String(slot));
  formData.append('heading', String(heading));
  const selectionPayload = buildSelectionPayload(objectSelection);
  if (selectionPayload) {
    const encoded = JSON.stringify(selectionPayload);
    formData.append('objectSelection', encoded);
    formData.append('object_selection', encoded);
    formData.append('selectionMethod', selectionPayload.method);
    formData.append('selectionBBox', JSON.stringify(selectionPayload.bbox));
  }
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

export async function apiStartBackgroundRemoval(
  scanId: string,
  options?: ApiPreprocessScanOptions,
): Promise<ApiStartBackgroundRemovalResponse> {
  try {
    const selectionPayload = buildSelectionPayload(options?.objectSelection);
    const body = selectionPayload
      ? {
          objectSelection: selectionPayload,
          object_selection: selectionPayload,
          selectionMethod: selectionPayload.method,
          selectionBBox: selectionPayload.bbox,
        }
      : undefined;

    const response = await apiClient.post(`/scans/${scanId}/preprocess-bg`, body, {
      timeout: options?.timeoutMs ?? START_BG_TIMEOUT_MS,
    });

    const asyncParsed = backgroundJobResponseSchema.safeParse(response.data);
    if (asyncParsed.success) {
      return {
        ...asyncParsed.data,
        availableSlots: asyncParsed.data.availableSlots ?? [],
        previewAvailable: asyncParsed.data.previewAvailable ?? false,
      };
    }

    const legacyParsed = legacyPreprocessResponseSchema.safeParse(response.data);
    if (legacyParsed.success) {
      return {
        jobId: `legacy:${scanId}`,
        status: 'ready',
        progress: 100,
        availableSlots: [],
        previewAvailable: legacyParsed.data.processed > 0,
        message: legacyParsed.data.ok
          ? undefined
          : 'Background removal finished with partial results.',
        legacyCompleted: true,
      };
    }

    throw new Error('apiStartBackgroundRemoval: invalid response');
  } catch (error) {
    throw toApiError(error, `Failed to start background removal for scan ${scanId}`);
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

export function buildRgbaUrl(scanId: string, slot: number): string {
  return `${getApiBaseUrl()}/api/scans/${scanId}/images/${slot}/rgba`;
}
