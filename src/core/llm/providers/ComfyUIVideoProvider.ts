import {
  assertComfyReachable,
  freeComfyMemory,
  unloadOllamaModels,
  COMFY_BASE,
} from './ComfyUIImageProvider';

/** Wan 2.2 TI2V-5B — keep filenames in sync with ComfyUI model folders. */
const WAN_UNET = 'wan2.2_ti2v_5B_fp16.safetensors';
const WAN_CLIP = 'umt5_xxl_fp8_e4m3fn_scaled.safetensors';
const WAN_VAE = 'wan2.2_vae.safetensors';

const DEFAULT_FPS = 16;
const DEFAULT_FRAMES = 49; // ~3s at 16fps — safe for 8GB

export interface GenerateVideoOptions {
  aspectRatio?: string;
  durationSeconds?: number;
  resolution?: string;
  referenceImages?: string[];
}

function dimsForVideo(aspectRatio?: string, resolution?: string): { width: number; height: number } {
  const res = (resolution || '480p').toLowerCase();
  const short = res === '720p' || res === '1080p' || res === '4k' ? 720 : 480;
  const [aw, ah] = (aspectRatio || '16:9').split(':').map(Number);
  const ratio = aw && ah ? aw / ah : 16 / 9;
  let width = short;
  let height = short;
  if (ratio >= 1) {
    height = short;
    width = Math.round((short * ratio) / 16) * 16;
  } else {
    width = short;
    height = Math.round(short / ratio / 16) * 16;
  }
  // Cap pixels for 8GB
  if (width * height > 720 * 480) {
    const scale = Math.sqrt((720 * 480) / (width * height));
    width = Math.round((width * scale) / 16) * 16;
    height = Math.round((height * scale) / 16) * 16;
  }
  return { width: Math.max(256, width), height: Math.max(256, height) };
}

function framesForDuration(seconds?: number): number {
  const s = Math.max(2, Math.min(5, seconds || 4));
  // 4n+1 frame count common for Wan
  const raw = Math.round(s * DEFAULT_FPS);
  return Math.max(17, Math.floor((raw - 1) / 4) * 4 + 1);
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

async function uploadImage(source: string): Promise<string> {
  const match = source.match(/^data:(image\/[a-z0-9.+-]+);base64,(.+)$/i);
  const mime = match?.[1] || 'image/png';
  const raw = match?.[2] || source;
  const binary = atob(raw);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const extension = mime.includes('jpeg') ? 'jpg' : mime.split('/')[1] || 'png';
  const filename = `delegation-video-ref-${crypto.randomUUID()}.${extension}`;
  const form = new FormData();
  form.append('image', new Blob([bytes], { type: mime }), filename);
  form.append('type', 'input');
  form.append('overwrite', 'true');
  const response = await fetch(`${COMFY_BASE}/upload/image`, { method: 'POST', body: form });
  if (!response.ok) throw new Error(`ComfyUI could not upload video reference (${response.status})`);
  const uploaded = await response.json();
  const name = String(uploaded.name || filename);
  const subfolder = String(uploaded.subfolder || '').replace(/\\/g, '/').replace(/^\/|\/$/g, '');
  return subfolder ? `${subfolder}/${name}` : name;
}

/**
 * Wan 2.2 TI2V-5B API graph (text-to-video, optional image start frame).
 * Requires models documented in docs/LOCAL_SETUP.md.
 */
function buildWanVideoGraph(
  prompt: string,
  width: number,
  height: number,
  length: number,
  seed: number,
  startImage?: string
): Record<string, unknown> {
  const graph: Record<string, any> = {
    '50': {
      class_type: 'UNETLoader',
      inputs: { unet_name: WAN_UNET, weight_dtype: 'default' },
    },
    '51': {
      class_type: 'CLIPLoader',
      inputs: { clip_name: WAN_CLIP, type: 'wan', device: 'default' },
    },
    '52': {
      class_type: 'VAELoader',
      inputs: { vae_name: WAN_VAE },
    },
    '53': {
      class_type: 'CLIPTextEncode',
      inputs: { clip: ['51', 0], text: prompt },
    },
    '54': {
      class_type: 'CLIPTextEncode',
      inputs: {
        clip: ['51', 0],
        text: 'low quality, blurry, jitter, warped faces, text, watermark',
      },
    },
    '55': {
      class_type: 'Wan22ImageToVideoLatent',
      inputs: {
        vae: ['52', 0],
        width,
        height,
        length,
        batch_size: 1,
      },
    },
    '56': {
      class_type: 'KSampler',
      inputs: {
        model: ['50', 0],
        positive: ['53', 0],
        negative: ['54', 0],
        latent_image: ['55', 0],
        seed,
        steps: 20,
        cfg: 3.5,
        sampler_name: 'uni_pc',
        scheduler: 'simple',
        denoise: 1,
      },
    },
    '57': {
      class_type: 'VAEDecode',
      inputs: { samples: ['56', 0], vae: ['52', 0] },
    },
    '58': {
      class_type: 'CreateVideo',
      inputs: { images: ['57', 0], fps: DEFAULT_FPS },
    },
    '59': {
      class_type: 'SaveVideo',
      inputs: {
        video: ['58', 0],
        filename_prefix: 'delegation-wan',
        format: 'auto',
        codec: 'auto',
      },
    },
  };

  if (startImage) {
    graph['60'] = {
      class_type: 'LoadImage',
      inputs: { image: startImage },
    };
    graph['55'].inputs.start_image = ['60', 0];
  }

  return graph;
}

async function bytesToBase64(bytes: Uint8Array): Promise<string> {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/**
 * Generate a short local video via ComfyUI Wan 2.2 TI2V-5B.
 * Returns a data URL or Comfy view URL playable in the Final Output modal.
 */
export async function generateVideo(
  prompt: string,
  _modelName?: string,
  onProgress?: (msg: string) => void,
  options: GenerateVideoOptions = {}
): Promise<{ videoUrl: string; data?: string; usage?: any }> {
  const { width, height } = dimsForVideo(options.aspectRatio, options.resolution);
  const length = framesForDuration(options.durationSeconds);
  onProgress?.(
    `Freeing GPU, then generating Wan 2.2 TI2V ${width}×${height}, ${length} frames (~${Math.round(length / DEFAULT_FPS)}s)...`
  );

  await assertComfyReachable();
  await unloadOllamaModels();
  await freeComfyMemory();

  const startImage = options.referenceImages?.[0]
    ? await uploadImage(options.referenceImages[0])
    : undefined;

  const seed = Math.floor(Math.random() * 2 ** 31);
  const graph = buildWanVideoGraph(prompt, width, height, length, seed, startImage);

  const clientId = crypto.randomUUID();
  const queueRes = await fetch(`${COMFY_BASE}/prompt`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: clientId, prompt: graph }),
  });

  if (!queueRes.ok) {
    const text = await queueRes.text();
    throw new Error(
      `ComfyUI video queue failed (${queueRes.status}). Install Wan 2.2 TI2V-5B weights (see docs/LOCAL_SETUP.md). ${text}`
    );
  }

  const queued = await queueRes.json();
  if (queued.node_errors && Object.keys(queued.node_errors).length > 0) {
    throw new Error(
      `ComfyUI rejected the Wan video workflow: ${JSON.stringify(queued.node_errors)}. Download Wan 2.2 TI2V-5B, UMT5, and wan2.2_vae into ComfyUI models folders.`
    );
  }

  const promptId: string = queued.prompt_id;
  if (!promptId) throw new Error('ComfyUI did not return a prompt id for video');

  const started = Date.now();
  while (Date.now() - started < 900000) {
    const histRes = await fetch(`${COMFY_BASE}/history/${promptId}`);
    if (!histRes.ok) {
      await new Promise((r) => setTimeout(r, 1000));
      continue;
    }
    const hist = await histRes.json();
    const entry = hist[promptId];
    if (!entry) {
      await new Promise((r) => setTimeout(r, 1000));
      continue;
    }

    if (entry.status?.status_str === 'error') {
      throw new Error(`ComfyUI video generation failed: ${extractComfyError(entry)}`);
    }

    if (entry.status?.completed) {
      // SaveVideo / CreateVideo output shapes vary by Comfy version.
      const outputs = entry.outputs || {};
      let file: { filename: string; subfolder?: string; type?: string } | undefined;
      for (const nodeId of Object.keys(outputs)) {
        const out = outputs[nodeId];
        const videos = out?.videos || out?.gifs || out?.images;
        if (videos?.[0]?.filename) {
          file = videos[0];
          break;
        }
      }
      if (!file?.filename) {
        throw new Error('ComfyUI finished without a video file. Check Wan model install and SaveVideo node support.');
      }

      onProgress?.('Downloading generated video...');
      const viewUrl = `${COMFY_BASE}/view?filename=${encodeURIComponent(file.filename)}&type=${encodeURIComponent(file.type || 'output')}&subfolder=${encodeURIComponent(file.subfolder || '')}`;
      const fileRes = await fetch(viewUrl);
      if (!fileRes.ok) {
        // Fall back to proxied URL for <video src>
        return {
          videoUrl: viewUrl,
          usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0, duration: length / DEFAULT_FPS },
        };
      }
      const buf = new Uint8Array(await fileRes.arrayBuffer());
      const b64 = await bytesToBase64(buf);
      const mime = file.filename.endsWith('.webm') ? 'video/webm' : 'video/mp4';
      const dataUrl = `data:${mime};base64,${b64}`;
      return {
        videoUrl: dataUrl,
        data: dataUrl,
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0, duration: length / DEFAULT_FPS },
      };
    }

    onProgress?.(`Wan video rendering… ${Math.round((Date.now() - started) / 1000)}s`);
    await new Promise((r) => setTimeout(r, 1500));
  }

  throw new Error('Timed out waiting for ComfyUI Wan video generation');
}
