import { createMMKV } from 'react-native-mmkv';

export const API_BASE_URL = 'http://192.168.1.100:8000';

// Set locally when backend auth is enabled.
export const API_KEY: string | undefined = undefined;

export const API_PREFIX = '/api';

const configStorage = createMMKV({ id: 'api-config-storage' });
const API_BASE_URL_STORAGE_KEY = 'api:base-url';

function normalizeBaseUrl(url: string) {
  return url.trim().replace(/\/+$/, '');
}

export function getApiBaseUrl(): string {
  const stored = configStorage.getString(API_BASE_URL_STORAGE_KEY);
  if (!stored) {
    return API_BASE_URL;
  }

  const normalized = normalizeBaseUrl(stored);
  return normalized || API_BASE_URL;
}

export function setApiBaseUrl(nextUrl: string): string {
  const normalized = normalizeBaseUrl(nextUrl);
  if (!normalized) {
    throw new Error('API base URL cannot be empty.');
  }

  configStorage.set(API_BASE_URL_STORAGE_KEY, normalized);
  return normalized;
}

export function resetApiBaseUrl(): void {
  configStorage.remove(API_BASE_URL_STORAGE_KEY);
}

export function getApiUrl(): string {
  return `${getApiBaseUrl()}${API_PREFIX}`;
}
