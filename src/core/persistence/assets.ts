import { base64ToFile, memoryApi } from './api';
import { saveCurrentProject, scheduleProjectSave } from './coordinator';
import { useMemoryStore } from '../../integration/store/memoryStore';

export async function beginGenerationJob(
  role: string,
  prompt: string,
  model: string,
  parameters: Record<string, unknown> = {}
): Promise<string | null> {
  if (useMemoryStore.getState().status !== 'online') return null;
  await saveCurrentProject();
  const projectId = useMemoryStore.getState().currentProjectId;
  if (!projectId) return null;
  const result = await memoryApi.startGenerationJob({
    projectId,
    role,
    prompt,
    model,
    provider: model.includes('gemini') ? 'gemini' : 'comfyui',
    parameters,
  });
  return result.id;
}

export async function persistGeneratedAsset(options: {
  jobId?: string | null;
  role: string;
  content: string;
  prompt: string;
  model: string;
  parameters?: Record<string, unknown>;
  supersedesAssetId?: string;
}): Promise<{ id: string; url: string } | null> {
  if (useMemoryStore.getState().status !== 'online') return null;
  const projectId = useMemoryStore.getState().currentProjectId;
  if (!projectId) return null;
  const form = new FormData();
  form.append('file', await base64ToFile(options.content, `${options.role}.png`));
  form.append('projectId', projectId);
  form.append('role', options.role);
  form.append('prompt', options.prompt);
  form.append('model', options.model);
  form.append('provider', options.model.includes('gemini') ? 'gemini' : 'comfyui');
  form.append('params', JSON.stringify(options.parameters || {}));
  if (options.supersedesAssetId) form.append('supersedesAssetId', options.supersedesAssetId);
  const asset = await memoryApi.uploadAsset(form);
  if (options.jobId) {
    await memoryApi.finishGenerationJob(options.jobId, { status: 'completed', assetId: asset.id });
  }
  scheduleProjectSave(true);
  return asset;
}

export async function failGenerationJob(jobId: string | null, error: unknown) {
  if (!jobId) return;
  await memoryApi.finishGenerationJob(jobId, {
    status: 'failed',
    error: error instanceof Error ? error.message : String(error),
  }).catch(() => undefined);
}
