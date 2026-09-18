import {
  detectStyle,
  getQualityClose,
  photoRealismSuffix,
  SHORT_PROMPT_FALLBACK,
  stripSdTagSpam,
} from '../../agent/nanoBananaPrompt';
import { getActiveAgentSet } from '../../../integration/store/teamStore';

const COMFY_BASE = (import.meta.env.VITE_COMFYUI_URL || '/comfyui').replace(/\/$/, '');
const OLLAMA_BASE = (import.meta.env.VITE_OLLAMA_URL || '/ollama').replace(/\/$/, '');

/** Z-Image Turbo (NVFP4) — keep filenames in sync with ComfyUI model folders. */
const UNET = 'z_image_turbo_nvfp4.safetensors';
const CLIP = 'qwen_3_4b_fp4_mixed.safetensors';
const VAE = 'ae.safetensors';

/** Distilled Turbo recipe: CFG must stay ~1; 8 steps matches the proven 8GB API workflow. */
const ZIMAGE_STEPS = 8;
const ZIMAGE_REFINE_STEPS = 6;
const ZIMAGE_CFG = 1;
const ZIMAGE_SAMPLER = 'res_multistep';
const ZIMAGE_SCHEDULER = 'simple';
const ZIMAGE_DETAIL_SAMPLER = 'dpmpp_sde';
const ZIMAGE_DETAIL_SCHEDULER = 'ddim_uniform';
/** AuraFlow shift — 3 is the official structural sweet spot. */
const ZIMAGE_SHIFT = 3;
const ZIMAGE_REFINE_DENOISE = 0.35;

export type ImageQualityMode = 'turbo' | 'detail';

export interface GenerateImageOptions {
  aspectRatio?: string;
  imageSize?: string;
  referenceImages?: string[];
  denoise?: number;
  qualityMode?: ImageQualityMode;
  /** Best-of-N seeds (default 2). Set 1 to skip multi-seed. */
  bestOf?: number;
  /** Light second-pass refine (default true for final delivers). */
  refine?: boolean;
  teamId?: string;
}

export async function unloadOllamaModels() {
  const models = ['gemma4:26b', 'llama3.1', 'llama3.2', 'qwen3.8', 'deepseek-r1'];
  await Promise.allSettled(
    models.map((model) =>
      fetch(`${OLLAMA_BASE}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, prompt: '', keep_alive: 0 }),
      })
    )
  );
}

export async function freeComfyMemory() {
  await Promise.allSettled([
    fetch(`${COMFY_BASE}/interrupt`, { method: 'POST' }),
    fetch(`${COMFY_BASE}/free`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ unload_models: false, free_memory: true }),
    }),
  ]);
  await new Promise((r) => setTimeout(r, 2000));
}

function snap64(n: number) {
  return Math.max(64, Math.round(n / 64) * 64);
}

function sizeToMaxEdge(imageSize?: string) {
  const s = (imageSize || '1024').toLowerCase();
  if (s === '512' || s === '0.5k') return 512;
  if (s === '768' || s === '0.75k' || s === '1k') return s === '1k' ? 1024 : 768;
  if (s === '2k') return 1024;
  if (s === '4k') return 1024;
  return 1024;
}

function dimsFor(aspectRatio?: string, imageSize?: string) {
  const nominal = sizeToMaxEdge(imageSize);
  const [aw, ah] = (aspectRatio || '1:1').split(':').map(Number);
  const ratio = aw && ah ? aw / ah : 1;
  const targetPixels = nominal * nominal;
  const width = Math.sqrt(targetPixels * ratio);
  const height = targetPixels / width;
  return { width: snap64(width), height: snap64(height) };
}

/**
 * Pick a framing that matches the brief so the canvas isn't fighting the subject.
 */
export function inferAspectRatio(prompt: string): string {
  const p = prompt.toLowerCase();
  if (/\b(portrait|headshot|close-?up|bust|selfie|full[- ]?body|standing figure|fashion look)\b/.test(p)) {
    return '3:4';
  }
  if (/\b(tall|vertical|9:16|phone wallpaper|story)\b/.test(p)) {
    return '9:16';
  }
  if (/\b(landscape|wide|cinematic|panorama|environment|scenery|16:9|establishing|banner|hero)\b/.test(p)) {
    return '16:9';
  }
  if (/\b(square|1:1|avatar|icon|logo|wordmark|lockup)\b/.test(p)) {
    return '1:1';
  }
  return '3:4';
}

/** Force team-appropriate canvas before sampling. */
export function resolveTeamAspectRatio(teamId: string | undefined, prompt: string, override?: string): string {
  if (override) return override;
  if (teamId === 'logo-design-studio' || teamId === 'social-creative-studio') return '1:1';
  if (teamId === 'website-banner-studio') return '16:9';
  return inferAspectRatio(prompt);
}

function samplerForMode(mode: ImageQualityMode): { sampler: string; scheduler: string } {
  if (mode === 'detail') {
    return { sampler: ZIMAGE_DETAIL_SAMPLER, scheduler: ZIMAGE_DETAIL_SCHEDULER };
  }
  return { sampler: ZIMAGE_SAMPLER, scheduler: ZIMAGE_SCHEDULER };
}

/**
 * Qwen / Lumina2 prefers clear natural-language prompts over SD1.5-style tag soup.
 */
export function prepareZImagePrompt(raw: string, teamId?: string): string {
  let text = stripSdTagSpam((raw || '').trim());
  if (!text) {
    return `${SHORT_PROMPT_FALLBACK}. ${getQualityClose('generic')}.`;
  }

  text = text
    .replace(/\r\n/g, '\n')
    .replace(/[;|]+/g, '.')
    .replace(/\n+/g, '. ')
    .replace(/\s*,\s*/g, ', ')
    .replace(/\s{2,}/g, ' ')
    .replace(/\.(\s*\.)+/g, '.')
    .trim();

  if (teamId === 'logo-design-studio') {
    const logoHints =
      'Flat vector-like logo design, crisp geometry, balanced mark and wordmark lockup, clean solid background, no mockup, no photoreal clutter';
    if (!/flat vector|wordmark|lockup/i.test(text)) {
      text += `. ${logoHints}.`;
    }
  }

  const style = detectStyle(text);

  if (text.length < 80) {
    text += `. ${getQualityClose(style, text)}.`;
  }

  const realism = photoRealismSuffix(text);
  if (realism && !text.toLowerCase().includes(realism.toLowerCase().slice(0, 24))) {
    text += `. ${realism}.`;
  }

  if (text.length > 1800) text = text.slice(0, 1800).replace(/\s+\S*$/, '');

  return text;
}

function extractComfyError(entry: any): string {
  const messages = entry?.status?.messages || [];
  for (let i = messages.length - 1; i >= 0; i--) {
    const [type, payload] = messages[i] || [];
    if (type === 'execution_error') {
      const msg = payload?.exception_message || payload?.exception_type || 'unknown error';
      const node = payload?.node_type ? ` (${payload.node_type})` : '';
      return `${String(msg).trim()}${node}`;
    }
  }
  return entry?.status?.status_str || 'unknown error';
}

function isComfyDownError(message: string) {
  return /failed to fetch|networkerror|econnrefused|comfyui is not reachable|err_connection_refused/i.test(
    message
  );
}

function isTransientComfyError(message: string) {
  if (isComfyDownError(message)) return false;
  return /errno 22|invalid argument|generation failed|timed out|not reachable/i.test(message);
}

export async function assertComfyReachable() {
  try {
    const res = await fetch(`${COMFY_BASE}/system_stats`, { method: 'GET' });
    if (!res.ok) {
      throw new Error(`ComfyUI responded with ${res.status}`);
    }
  } catch (err) {
    throw new Error(
      `ComfyUI is not reachable on port 8188. Start it with run_z_image_turbo.bat, then retry. ${
        err instanceof Error ? err.message : err
      }`
    );
  }
}

function buildPromptGraph(
  prompt: string,
  width: number,
  height: number,
  seed: number,
  referenceImage?: string,
  denoise: number = 1,
  samplerName: string = ZIMAGE_SAMPLER,
  scheduler: string = ZIMAGE_SCHEDULER,
  steps: number = ZIMAGE_STEPS,
  teamId?: string,
  filenamePrefix = 'delegation-z-image'
): Record<string, unknown> {
  const text = prepareZImagePrompt(prompt, teamId);
  const graph: Record<string, any> = {
    '3': {
      class_type: 'KSampler',
      inputs: {
        cfg: ZIMAGE_CFG,
        denoise,
        latent_image: referenceImage ? ['42', 0] : ['13', 0],
        model: ['11', 0],
        negative: ['33', 0],
        positive: ['27', 0],
        sampler_name: samplerName,
        scheduler,
        seed,
        steps,
      },
    },
    '8': {
      class_type: 'VAEDecode',
      inputs: { samples: ['3', 0], vae: ['29', 0] },
    },
    '9': {
      class_type: 'SaveImage',
      inputs: { filename_prefix: filenamePrefix, images: ['8', 0] },
    },
    '11': {
      class_type: 'ModelSamplingAuraFlow',
      inputs: { model: ['28', 0], shift: ZIMAGE_SHIFT },
    },
    '13': {
      class_type: 'EmptySD3LatentImage',
      inputs: { batch_size: 1, height, width },
    },
    '27': {
      class_type: 'CLIPTextEncode',
      inputs: { clip: ['30', 0], text },
    },
    '28': {
      class_type: 'UNETLoader',
      inputs: { unet_name: UNET, weight_dtype: 'default' },
    },
    '29': {
      class_type: 'VAELoader',
      inputs: { vae_name: VAE },
    },
    '30': {
      class_type: 'CLIPLoader',
      inputs: { clip_name: CLIP, device: 'default', type: 'lumina2' },
    },
    '33': {
      class_type: 'ConditioningZeroOut',
      inputs: { conditioning: ['27', 0] },
    },
  };

  if (referenceImage) {
    graph['40'] = {
      class_type: 'LoadImage',
      inputs: { image: referenceImage },
    };
    graph['41'] = {
      class_type: 'ImageScale',
      inputs: {
        image: ['40', 0],
        upscale_method: 'lanczos',
        width,
        height,
        crop: 'center',
      },
    };
    graph['42'] = {
      class_type: 'VAEEncode',
      inputs: { pixels: ['41', 0], vae: ['29', 0] },
    };
  }

  return graph;
}

/** Two-pass refine: first sample → decode → encode → light denoise. */
function buildRefineGraph(
  prompt: string,
  width: number,
  height: number,
  seed: number,
  sourceImageName: string,
  samplerName: string,
  scheduler: string,
  teamId?: string
): Record<string, unknown> {
  const text = prepareZImagePrompt(prompt, teamId);
  return {
    '28': {
      class_type: 'UNETLoader',
      inputs: { unet_name: UNET, weight_dtype: 'default' },
    },
    '11': {
      class_type: 'ModelSamplingAuraFlow',
      inputs: { model: ['28', 0], shift: ZIMAGE_SHIFT },
    },
    '29': {
      class_type: 'VAELoader',
      inputs: { vae_name: VAE },
    },
    '30': {
      class_type: 'CLIPLoader',
      inputs: { clip_name: CLIP, device: 'default', type: 'lumina2' },
    },
    '27': {
      class_type: 'CLIPTextEncode',
      inputs: { clip: ['30', 0], text },
    },
    '33': {
      class_type: 'ConditioningZeroOut',
      inputs: { conditioning: ['27', 0] },
    },
    '40': {
      class_type: 'LoadImage',
      inputs: { image: sourceImageName },
    },
    '41': {
      class_type: 'ImageScale',
      inputs: {
        image: ['40', 0],
        upscale_method: 'lanczos',
        width,
        height,
        crop: 'center',
      },
    },
    '42': {
      class_type: 'VAEEncode',
      inputs: { pixels: ['41', 0], vae: ['29', 0] },
    },
    '3': {
      class_type: 'KSampler',
      inputs: {
        cfg: ZIMAGE_CFG,
        denoise: ZIMAGE_REFINE_DENOISE,
        latent_image: ['42', 0],
        model: ['11', 0],
        negative: ['33', 0],
        positive: ['27', 0],
        sampler_name: samplerName,
        scheduler,
        seed,
        steps: ZIMAGE_REFINE_STEPS,
      },
    },
    '8': {
      class_type: 'VAEDecode',
      inputs: { samples: ['3', 0], vae: ['29', 0] },
    },
    '9': {
      class_type: 'SaveImage',
      inputs: { filename_prefix: 'delegation-z-image-refine', images: ['8', 0] },
    },
  };
}

async function bytesToBase64(bytes: Uint8Array): Promise<string> {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/** Laplacian-ish sharpness proxy from PNG bytes (higher = sharper). */
function sharpnessScore(bytes: Uint8Array): number {
  // Cheap proxy: entropy of mid-file bytes + non-zero density. Avoids full decode.
  if (bytes.length < 64) return 0;
  const sample = bytes.subarray(Math.floor(bytes.length * 0.2), Math.floor(bytes.length * 0.8));
  let sum = 0;
  let sumSq = 0;
  const step = Math.max(1, Math.floor(sample.length / 4000));
  let n = 0;
  for (let i = 0; i < sample.length; i += step) {
    const v = sample[i];
    sum += v;
    sumSq += v * v;
    n += 1;
  }
  if (n === 0) return 0;
  const mean = sum / n;
  const variance = sumSq / n - mean * mean;
  return variance + bytes.length / 1e6;
}

export async function generateImage(
  prompt: string,
  _modelName?: string,
  onProgress?: (msg: string) => void,
  options: GenerateImageOptions = {}
): Promise<{ data: string; usage?: any }> {
  const teamId = options.teamId || getActiveAgentSet()?.id;
  const aspectRatio = resolveTeamAspectRatio(teamId, prompt, options.aspectRatio);
  const imageSize = options.imageSize || '1024';
  const qualityMode: ImageQualityMode = options.qualityMode || 'turbo';
  const { sampler, scheduler } = samplerForMode(qualityMode);
  const bestOf = Math.max(1, Math.min(3, options.bestOf ?? 2));
  const refine = options.refine !== false;
  const { width, height } = dimsFor(aspectRatio, imageSize);

  onProgress?.(
    `Freeing GPU, then generating with Z-Image Turbo ${width}×${height} (${sampler}/${scheduler}, ${ZIMAGE_STEPS} steps, ${qualityMode}${refine ? '+refine' : ''}, best-of-${bestOf})...`
  );
  await assertComfyReachable();
  await unloadOllamaModels();
  await freeComfyMemory();

  const referenceImage = options.referenceImages?.[0]
    ? await uploadReferenceImage(options.referenceImages[0])
    : undefined;
  const denoise = referenceImage
    ? Math.min(0.95, Math.max(0.65, options.denoise ?? 0.84))
    : 1;
  if (referenceImage) {
    onProgress?.(`Using reference at ${Math.round((1 - denoise) * 100)}% structure strength...`);
  }

  let lastError = 'ComfyUI image generation failed';
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      return await generateWithQualityPipeline(
        prompt,
        width,
        height,
        onProgress,
        referenceImage,
        denoise,
        sampler,
        scheduler,
        bestOf,
        refine,
        teamId
      );
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      if (isComfyDownError(lastError)) {
        throw new Error(
          `ComfyUI is not reachable on port 8188. Start it with run_z_image_turbo.bat, then retry.`
        );
      }
      if (
        attempt === 1 &&
        /out of memory|oom|cuda|allocation/i.test(lastError) &&
        sizeToMaxEdge(imageSize) > 768
      ) {
        onProgress?.('VRAM tight — retrying at 768px...');
        await freeComfyMemory();
        try {
          const smaller = dimsFor(aspectRatio, '768');
          return await generateWithQualityPipeline(
            prompt,
            smaller.width,
            smaller.height,
            onProgress,
            referenceImage,
            denoise,
            sampler,
            scheduler,
            1,
            refine,
            teamId
          );
        } catch (err2) {
          lastError = err2 instanceof Error ? err2.message : String(err2);
        }
      }
      if (attempt < 3 && isTransientComfyError(lastError)) {
        onProgress?.(`ComfyUI hiccup — retry ${attempt}/3...`);
        await freeComfyMemory();
        await new Promise((r) => setTimeout(r, 1500 * attempt));
        continue;
      }
      throw new Error(
        `${lastError}. If this keeps happening, restart ComfyUI with run_z_image_turbo.bat (TQDM_DISABLE is set).`
      );
    }
  }
  throw new Error(lastError);
}

async function generateWithQualityPipeline(
  prompt: string,
  width: number,
  height: number,
  onProgress: ((msg: string) => void) | undefined,
  referenceImage: string | undefined,
  denoise: number,
  sampler: string,
  scheduler: string,
  bestOf: number,
  refine: boolean,
  teamId?: string
): Promise<{ data: string; usage?: any }> {
  let best: { data: string; score: number; filename?: string; type?: string; subfolder?: string } | null = null;

  for (let i = 0; i < bestOf; i++) {
    onProgress?.(bestOf > 1 ? `Sampling candidate ${i + 1}/${bestOf}...` : 'Sampling...');
    const seed = Math.floor(Math.random() * 2 ** 31);
    const result = await queueAndWaitForImage(
      prompt,
      width,
      height,
      onProgress,
      referenceImage,
      denoise,
      sampler,
      scheduler,
      ZIMAGE_STEPS,
      seed,
      teamId
    );
    const score = sharpnessScore(Uint8Array.from(atob(result.data), (c) => c.charCodeAt(0)));
    if (!best || score > best.score) {
      best = { data: result.data, score, filename: result.filename, type: result.type, subfolder: result.subfolder };
    }
  }

  if (!best) throw new Error('ComfyUI finished without an image');

  if (refine && best.filename) {
    onProgress?.(`Refine pass (denoise ${ZIMAGE_REFINE_DENOISE})...`);
    try {
      const sourceName = best.subfolder
        ? `${best.subfolder}/${best.filename}`.replace(/\\/g, '/')
        : best.filename;
      // Comfy LoadImage reads from input/ — re-upload the winning output.
      const uploaded = await uploadReferenceImage(`data:image/png;base64,${best.data}`);
      const refined = await queueGraphAndDownload(
        buildRefineGraph(
          prompt,
          width,
          height,
          Math.floor(Math.random() * 2 ** 31),
          uploaded,
          sampler,
          scheduler,
          teamId
        ),
        onProgress,
        sampler,
        scheduler
      );
      return {
        data: refined.data,
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0, count: bestOf },
      };
    } catch (err) {
      console.warn('[ComfyUI] Refine pass failed; keeping best seed:', err);
    }
  }

  return {
    data: best.data,
    usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0, count: bestOf },
  };
}

async function uploadReferenceImage(source: string): Promise<string> {
  const match = source.match(/^data:(image\/[a-z0-9.+-]+);base64,(.+)$/i);
  const mime = match?.[1] || 'image/png';
  const raw = match?.[2] || source;
  const binary = atob(raw);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

  const extension = mime.includes('jpeg') ? 'jpg' : mime.split('/')[1] || 'png';
  const filename = `delegation-reference-${crypto.randomUUID()}.${extension}`;
  const form = new FormData();
  form.append('image', new Blob([bytes], { type: mime }), filename);
  form.append('type', 'input');
  form.append('overwrite', 'true');

  const response = await fetch(`${COMFY_BASE}/upload/image`, {
    method: 'POST',
    body: form,
  });
  if (!response.ok) {
    throw new Error(`ComfyUI could not upload the character reference (${response.status})`);
  }
  const uploaded = await response.json();
  const name = String(uploaded.name || filename);
  const subfolder = String(uploaded.subfolder || '').replace(/\\/g, '/').replace(/^\/|\/$/g, '');
  return subfolder ? `${subfolder}/${name}` : name;
}

async function queueAndWaitForImage(
  prompt: string,
  width: number,
  height: number,
  onProgress?: (msg: string) => void,
  referenceImage?: string,
  denoise: number = 1,
  samplerName: string = ZIMAGE_SAMPLER,
  scheduler: string = ZIMAGE_SCHEDULER,
  steps: number = ZIMAGE_STEPS,
  seed?: number,
  teamId?: string
): Promise<{ data: string; filename?: string; type?: string; subfolder?: string; usage?: any }> {
  const resolvedSeed = seed ?? Math.floor(Math.random() * 2 ** 31);
  return queueGraphAndDownload(
    buildPromptGraph(
      prompt,
      width,
      height,
      resolvedSeed,
      referenceImage,
      denoise,
      samplerName,
      scheduler,
      steps,
      teamId
    ),
    onProgress,
    samplerName,
    scheduler,
    prompt,
    width,
    height,
    referenceImage,
    denoise,
    steps,
    teamId
  );
}

async function queueGraphAndDownload(
  graph: Record<string, unknown>,
  onProgress?: (msg: string) => void,
  samplerName: string = ZIMAGE_SAMPLER,
  scheduler: string = ZIMAGE_SCHEDULER,
  prompt?: string,
  width?: number,
  height?: number,
  referenceImage?: string,
  denoise?: number,
  steps?: number,
  teamId?: string
): Promise<{ data: string; filename?: string; type?: string; subfolder?: string; usage?: any }> {
  const clientId = crypto.randomUUID();
  let queueRes = await fetch(`${COMFY_BASE}/prompt`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: clientId,
      prompt: graph,
    }),
  });

  if (!queueRes.ok) {
    const text = await queueRes.text();
    throw new Error(
      `ComfyUI is not reachable (${queueRes.status}). Start it with run_z_image_turbo.bat. ${text}`
    );
  }

  let queued = await queueRes.json();
  if (queued.node_errors && Object.keys(queued.node_errors).length > 0) {
    const errText = JSON.stringify(queued.node_errors);
    if (
      samplerName !== 'euler' &&
      /sampler|scheduler|value not in list/i.test(errText) &&
      prompt != null &&
      width != null &&
      height != null
    ) {
      onProgress?.('Sampler unavailable — falling back to euler/simple...');
      return queueAndWaitForImage(
        prompt,
        width,
        height,
        onProgress,
        referenceImage,
        denoise ?? 1,
        'euler',
        'simple',
        steps ?? ZIMAGE_STEPS,
        undefined,
        teamId
      );
    }
    throw new Error(`ComfyUI rejected the workflow: ${errText}`);
  }

  const promptId: string = queued.prompt_id;
  if (!promptId) throw new Error('ComfyUI did not return a prompt id');

  const started = Date.now();
  while (Date.now() - started < 300000) {
    const histRes = await fetch(`${COMFY_BASE}/history/${promptId}`);
    if (!histRes.ok) {
      await new Promise((r) => setTimeout(r, 500));
      continue;
    }
    const hist = await histRes.json();
    const entry = hist[promptId];
    if (!entry) {
      await new Promise((r) => setTimeout(r, 500));
      continue;
    }

    const status = entry.status?.status_str;
    if (status === 'error') {
      throw new Error(`ComfyUI image generation failed: ${extractComfyError(entry)}`);
    }

    if (entry.status?.completed) {
      const images = entry.outputs?.['9']?.images;
      const img = images?.[0];
      if (!img?.filename) throw new Error('ComfyUI finished without an image');

      onProgress?.('Downloading generated image...');
      const viewUrl = `${COMFY_BASE}/view?filename=${encodeURIComponent(img.filename)}&type=${encodeURIComponent(img.type || 'output')}&subfolder=${encodeURIComponent(img.subfolder || '')}`;
      const imgRes = await fetch(viewUrl);
      if (!imgRes.ok) throw new Error(`Failed to download generated image (${imgRes.status})`);
      const buf = new Uint8Array(await imgRes.arrayBuffer());
      const data = await bytesToBase64(buf);

      return {
        data,
        filename: img.filename,
        type: img.type || 'output',
        subfolder: img.subfolder || '',
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0, count: 1 },
      };
    }

    await new Promise((r) => setTimeout(r, 500));
  }

  throw new Error('Timed out waiting for ComfyUI to generate an image');
}

export { COMFY_BASE, ZIMAGE_STEPS, ZIMAGE_CFG };
