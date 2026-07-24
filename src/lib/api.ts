import type { Bootstrap, User } from '../types';

const TOKEN_KEY = 'sajilo_token';
const SNAPSHOT_KEY = 'fundship_last_verified_snapshot';
const API_ROOT = import.meta.env.VITE_API_URL || '/api';

export const session = {
  get: () => localStorage.getItem(TOKEN_KEY),
  set: (token: string) => localStorage.setItem(TOKEN_KEY, token),
  clear: () => {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(SNAPSHOT_KEY);
  },
};

export function cachedBootstrap(): Bootstrap | null {
  try {
    const parsed = JSON.parse(localStorage.getItem(SNAPSHOT_KEY) || 'null') as Bootstrap | null;
    return parsed?.user ? parsed : null;
  } catch {
    localStorage.removeItem(SNAPSHOT_KEY);
    return null;
  }
}

export function rememberBootstrap(data: Bootstrap) {
  localStorage.setItem(SNAPSHOT_KEY, JSON.stringify(data));
  return data;
}

export function applyPollVote(data: Bootstrap, pollId: string, choice: string, revision: number) {
  const createdAt = new Date().toISOString();
  const groups = data.groups.map((group) => ({
    ...group,
    polls: group.polls.map((poll) => {
      if (poll.id !== pollId) return poll;
      const voteDetails = [
        ...poll.voteDetails.filter((vote) => vote.userId !== data.user.id),
        {
          userId: data.user.id,
          name: data.user.name,
          avatarColor: data.user.avatarColor,
          choice,
          createdAt,
        },
      ];
      return {
        ...poll,
        myVote: choice,
        voteDetails,
        yesCount: voteDetails.filter((vote) => vote.choice === 'yes').length,
        noCount: voteDetails.filter((vote) => vote.choice === 'no').length,
      };
    }),
  }));
  return rememberBootstrap({ ...data, revision: Math.max(data.revision || 0, revision), groups });
}

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

export const getBootstrap = async () => rememberBootstrap(await request<Bootstrap>('/bootstrap'));

export type SyncResponse =
  | { changed: false; revision: number }
  | { changed: true; revision: number; snapshot: Bootstrap };

export const getSync = (after: number) => request<SyncResponse>(`/sync?after=${Math.max(0, after)}`);

export const mutate = async (path: string, body?: unknown, method = 'POST') =>
  rememberBootstrap(await request<Bootstrap>(
    path,
    { method, body: body === undefined ? undefined : JSON.stringify(body) },
  ));
