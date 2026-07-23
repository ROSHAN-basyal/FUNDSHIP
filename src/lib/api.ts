import type { Bootstrap, User } from '../types';

const TOKEN_KEY = 'sajilo_token';
const API_ROOT = import.meta.env.VITE_API_URL || '/api';

export const session = {
  get: () => localStorage.getItem(TOKEN_KEY),
  set: (token: string) => localStorage.setItem(TOKEN_KEY, token),
  clear: () => localStorage.removeItem(TOKEN_KEY),
};

export async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API_ROOT}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(session.get() ? { Authorization: `Bearer ${session.get()}` } : {}),
      ...options.headers,
    },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || 'Something went wrong.');
  return body;
}

export async function login(credentialId: string, password: string) {
  const data = await request<{ token: string; user: User }>('/auth/login', {
    method: 'POST', body: JSON.stringify({ credentialId, password }),
  });
  session.set(data.token);
  return data;
}

export const getBootstrap = () => request<Bootstrap>('/bootstrap');

export const mutate = (path: string, body?: unknown, method = 'POST') =>
  request<Bootstrap>(path, { method, body: body === undefined ? undefined : JSON.stringify(body) });
