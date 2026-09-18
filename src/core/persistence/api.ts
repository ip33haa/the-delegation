const API_BASE = `${import.meta.env.BASE_URL}api`.replace(/\/+/g, '/');

export interface SavedProjectSummary {
  id: string;
  teamId: string;
  storyId: string | null;
  title: string;
  brief: string | null;
  phase: string;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: init?.body instanceof FormData
      ? init.headers
      : { 'Content-Type': 'application/json', ...init?.headers },
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    const error = new Error(payload.error || `Memory API failed (${response.status})`);
    (error as Error & { status?: number }).status = response.status;
    throw error;
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export const memoryApi = {
  health: () => request<{ ok: boolean }>('/health'),
  listProjects: (archived = false) =>
    request<SavedProjectSummary[]>(`/projects?archived=${archived}`),
  createProject: (body: any) =>
    request<{ id: string; storyId: string | null }>('/projects', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  loadProject: (id: string) =>
    request<SavedProjectSummary & { snapshot: any }>(`/projects/${id}`),
  saveProject: (id: string, body: any) =>
    request<{ ok: true }>(`/projects/${id}`, {
      method: 'PUT',
      body: JSON.stringify(body),
    }),
  updateProject: (id: string, body: { title?: string; archived?: boolean }) =>
    request<{ ok: true }>(`/projects/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
  deleteProject: (id: string) =>
    request<void>(`/projects/${id}`, { method: 'DELETE' }),
  uploadAsset: (form: FormData) =>
    request<{ id: string; url: string }>('/assets', { method: 'POST', body: form }),
  startGenerationJob: (body: any) =>
    request<{ id: string }>('/generation-jobs', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  finishGenerationJob: (id: string, body: any) =>
    request<{ ok: true }>(`/generation-jobs/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
  storyMemory: (storyId: string) => request<any>(`/stories/${storyId}/memory`),
};

export async function base64ToFile(content: string, filename: string): Promise<File> {
  const source = content.startsWith('data:') ? content : `data:image/png;base64,${content}`;
  const blob = await fetch(source).then((response) => response.blob());
  return new File([blob], filename, { type: blob.type || 'image/png' });
}
