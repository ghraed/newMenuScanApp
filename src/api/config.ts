import { createMMKV } from 'react-native-mmkv';

export const API_BASE_URL = 'https://scan.rozer.fun';
export const MENU_API_BASE_URL = 'https://rozer.fun';

// Optional fallback key baked into the app build. Prefer configuring this in Settings.
export const API_KEY: string | undefined = undefined;

export const API_PREFIX = '/api';

const configStorage = createMMKV({ id: 'api-config-storage' });
const API_BASE_URL_STORAGE_KEY = 'api:base-url';
const MENU_API_BASE_URL_STORAGE_KEY = 'menu-api:base-url';
const API_KEY_STORAGE_KEY = 'api:key';

function normalizeBaseUrl(url: string) {
  return url.trim().replace(/\/+$/, '');
}

function normalizeApiKey(value: string) {
  return value.trim();
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

export function getApiKey(): string | undefined {
  const stored = configStorage.getString(API_KEY_STORAGE_KEY);
  if (typeof stored === 'string') {
    const normalized = normalizeApiKey(stored);
    return normalized || undefined;
  }

  const fallback = API_KEY?.trim();
  return fallback ? fallback : undefined;
}

export function setApiKey(nextKey: string): string {
  const normalized = normalizeApiKey(nextKey);
  if (!normalized) {
    throw new Error('API key cannot be empty.');
  }

  configStorage.set(API_KEY_STORAGE_KEY, normalized);
  return normalized;
}

export function resetApiKey(): void {
  configStorage.remove(API_KEY_STORAGE_KEY);
}

export function getApiUrl(): string {
  return `${getApiBaseUrl()}${API_PREFIX}`;
}

export function getHealthUrl(): string {
  return `${getApiBaseUrl()}/up`;
}

export function getMenuApiBaseUrl(): string {
  const stored = configStorage.getString(MENU_API_BASE_URL_STORAGE_KEY);
  if (!stored) {
    return MENU_API_BASE_URL;
  }

  const normalized = normalizeBaseUrl(stored);
  return normalized || MENU_API_BASE_URL;
}

export function setMenuApiBaseUrl(nextUrl: string): string {
  const normalized = normalizeBaseUrl(nextUrl);
  if (!normalized) {
    throw new Error('Menu API base URL cannot be empty.');
  }

  configStorage.set(MENU_API_BASE_URL_STORAGE_KEY, normalized);
  return normalized;
}

export function resetMenuApiBaseUrl(): void {
  configStorage.remove(MENU_API_BASE_URL_STORAGE_KEY);
}

export function getMenuApiUrl(): string {
  return `${getMenuApiBaseUrl()}${API_PREFIX}`;
}

export function getMenuHealthUrl(): string {
  return `${getMenuApiBaseUrl()}/up`;
}
