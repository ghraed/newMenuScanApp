export const API_BASE_URL = 'http://192.168.1.100:8000';

// Set locally when backend auth is enabled.
export const API_KEY: string | undefined = undefined;

export const API_PREFIX = '/api';

export const API_URL = `${API_BASE_URL.replace(/\/+$/, '')}${API_PREFIX}`;
