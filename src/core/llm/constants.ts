/** Preferred Ollama model for image-team agents — must fit local VRAM (qwen3.8 / gemma4:26b stall on 8GB). */
export const IMAGE_TEAM_TEXT_MODEL = 'llama3.1';
/** User-selected local model for manhwa planning, dialogue, and prompt craft. */
export const MANHWA_TEXT_MODEL = 'gemma4:26b';

/** Nano Banana 2 — Gemini 3.1 Flash Image (Google AI Studio). */
export const GEMINI_IMAGE_MODEL = 'gemini-3.1-flash-image';
export const GEMINI_IMAGE_MODEL_FALLBACK = 'gemini-2.5-flash-image';

/** Local ComfyUI Wan 2.2 TI2V-5B (8GB-friendly with offload). */
export const LOCAL_VIDEO_MODEL = 'wan-2.2-ti2v-5b';
export const VEO_VIDEO_MODEL = 'veo-3.1-lite-generate-preview';

export const DEFAULT_MODELS = {
  text: 'llama3.2',
  image: 'z-image-turbo',
  music: 'lyria-3-clip-preview',
  video: VEO_VIDEO_MODEL,
} as const;

export const AVAILABLE_MODELS = {
  text: [
    'gemma4:26b',
    'qwen3.8',
    'llama3.1',
    'llama3.2',
    'deepseek-r1'
  ],
  image: [
    GEMINI_IMAGE_MODEL,
    'z-image-turbo',
  ],
  music: [
    'lyria-3-clip-preview',
    'lyria-3-pro-preview'
  ],
  video: [
    VEO_VIDEO_MODEL,
    'veo-3.1-fast-generate-preview',
    'veo-3.1-generate-preview',
    LOCAL_VIDEO_MODEL,
  ]
} as const;

export type ModelType = keyof typeof AVAILABLE_MODELS;

export function hasGeminiApiKey(): boolean {
  try {
    const viteKey = typeof import.meta !== 'undefined' ? (import.meta as any).env?.VITE_GEMINI_API_KEY : '';
    const key = (process.env.GEMINI_API_KEY || viteKey || '').trim();
    return key.length > 0;
  } catch {
    return Boolean((process.env.GEMINI_API_KEY || '').trim());
  }
}

export function isGeminiImageModel(modelName?: string): boolean {
  const name = (modelName || '').toLowerCase();
  return (
    name.includes('gemini') &&
    (name.includes('flash-image') || name.includes('pro-image') || name.includes('flash_image'))
  );
}

export function isGeminiVideoModel(modelName?: string): boolean {
  const name = (modelName || '').toLowerCase();
  return name.includes('veo');
}

export function isLocalComfyImageModel(modelName?: string): boolean {
  const name = (modelName || '').toLowerCase();
  return name.includes('z-image') || name === 'z-image-turbo';
}

export function isLocalComfyVideoModel(modelName?: string): boolean {
  const name = (modelName || '').toLowerCase();
  return name.includes('wan') || name === LOCAL_VIDEO_MODEL;
}

export function isImageGenerationModel(modelName?: string): boolean {
  return isLocalComfyImageModel(modelName) || isGeminiImageModel(modelName);
}

/** Use Nano Banana for creative image teams when keyed; otherwise local Z-Image. */
export function resolveImageOutputModel(teamId?: string): string {
  const geminiCreativeTeams = new Set([
    'social-creative-studio',
    'website-banner-studio',
    'logo-design-studio',
  ]);
  if (teamId && geminiCreativeTeams.has(teamId) && hasGeminiApiKey()) {
    return GEMINI_IMAGE_MODEL;
  }
  return DEFAULT_MODELS.image;
}

/** Prefer Veo when keyed; otherwise local Wan 2.2 TI2V-5B. */
export function resolveVideoOutputModel(_teamId?: string): string {
  if (hasGeminiApiKey()) return VEO_VIDEO_MODEL;
  return LOCAL_VIDEO_MODEL;
}

export function resolveTextModel(modelName?: string): string {
  const name = (modelName || '').toLowerCase();
  if (name.includes('gemma4')) return 'gemma4:26b';
  if (name.includes('qwen')) return 'qwen3.8';
  if (name.includes('deepseek')) return 'deepseek-r1';
  if (name.includes('llama3.1')) return 'llama3.1';
  if (name.includes('llama')) return 'llama3.2';
  return DEFAULT_MODELS.text;
}
