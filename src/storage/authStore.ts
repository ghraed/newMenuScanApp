import { createMMKV } from 'react-native-mmkv';

export type AuthRestaurant = {
  id: number;
  name: string;
  slug: string;
};

export type AuthUser = {
  id: number;
  name: string;
  email: string;
  restaurant: AuthRestaurant | null;
};

const authStorage = createMMKV({ id: 'auth-storage' });
const AUTH_TOKEN_STORAGE_KEY = 'auth:token';
const AUTH_USER_STORAGE_KEY = 'auth:user';

export function getAuthToken(): string | undefined {
  const token = authStorage.getString(AUTH_TOKEN_STORAGE_KEY);
  return typeof token === 'string' && token.trim() ? token : undefined;
}

export function setAuthToken(token: string): string {
  const normalized = token.trim();
  if (!normalized) {
    throw new Error('Auth token cannot be empty.');
  }

  authStorage.set(AUTH_TOKEN_STORAGE_KEY, normalized);
  return normalized;
}

export function getAuthUser(): AuthUser | undefined {
  const raw = authStorage.getString(AUTH_USER_STORAGE_KEY);
  if (!raw) {
    return undefined;
  }

  try {
    return JSON.parse(raw) as AuthUser;
  } catch {
    return undefined;
  }
}

export function setAuthUser(user: AuthUser): AuthUser {
  authStorage.set(AUTH_USER_STORAGE_KEY, JSON.stringify(user));
  return user;
}

export function saveAuthSession(token: string, user: AuthUser): void {
  setAuthToken(token);
  setAuthUser(user);
}

export function clearAuthSession(): void {
  authStorage.remove(AUTH_TOKEN_STORAGE_KEY);
  authStorage.remove(AUTH_USER_STORAGE_KEY);
}
