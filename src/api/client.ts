import axios, { AxiosError, InternalAxiosRequestConfig } from 'axios';
import { ZodSchema } from 'zod';
import { getApiKey, getApiUrl } from './config';

type ErrorPayload = {
  message?: string;
  error?: string;
  details?: unknown;
};

export const apiClient = axios.create({
  timeout: 20000,
});

apiClient.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  config.baseURL = getApiUrl();

  const apiKey = getApiKey();
  if (apiKey) {
    config.headers = config.headers ?? {};
    config.headers['X-API-KEY'] = apiKey;
  }

  return config;
});

export function parseApiResponse<T>(schema: ZodSchema<T>, data: unknown, context: string): T {
  const parsed = schema.safeParse(data);
  if (parsed.success) {
    return parsed.data;
  }

  const issues = parsed.error.issues
    .map(issue => `${issue.path.join('.') || 'root'}: ${issue.message}`)
    .join('; ');

  throw new Error(`${context}: invalid response (${issues})`);
}

export function toApiError(error: unknown, fallbackMessage: string): Error {
  if (axios.isAxiosError(error)) {
    const axiosError = error as AxiosError<ErrorPayload>;

    if (axiosError.response) {
      const status = axiosError.response.status;
      const data = axiosError.response.data;
      const detail =
        data?.message ||
        data?.error ||
        (typeof data === 'string' ? data : undefined) ||
        axiosError.message;
      const hint = status === 401 ? ' (check API key in Settings)' : '';
      return new Error(
        `${fallbackMessage} (HTTP ${status}${detail ? `: ${detail}` : ''})${hint}`,
      );
    }

    if (axiosError.request) {
      if (axiosError.code === 'ECONNABORTED') {
        return new Error(`${fallbackMessage} (request timed out)`);
      }
      return new Error(`${fallbackMessage} (network error or timeout)`);
    }

    return new Error(`${fallbackMessage} (${axiosError.message})`);
  }

  if (error instanceof Error) {
    return new Error(`${fallbackMessage} (${error.message})`);
  }

  return new Error(fallbackMessage);
}
