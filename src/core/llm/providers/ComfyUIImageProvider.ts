const COMFY_BASE = import.meta.env.DEV
  ? '/comfyui'
  : (import.meta.env.VITE_COMFYUI_URL || 'http://127.0.0.1:8188');

const UNET = 'z_image_turbo_nvfp4.safetensors';
const CLIP = 'qwen_3_4b_fp4_mixed.safetensors';
const VAE = 'ae.safetensors';

function snap8(n: number) {
  return Math.max(8, Math.round(n / 8) * 8);
}

function sizeToMaxEdge(imageSize?: string) {
  if (imageSize === '512') return 512;
  return 768;
}

function dimsFor(aspectRatio?: string, imageSize?: string) {
  const max = sizeToMaxEdge(imageSize);
  const [aw, ah] = (aspectRatio || '1:1').split(':').map(Number);
  const ratio = aw && ah ? aw / ah : 1;
  if (ratio >= 1) {
    return { width: max, height: snap8(max / ratio) };
  }
  return { width: snap8(max * ratio), height: max };
}

function buildPromptGraph(
  prompt: string,
  width: number,
  height: number,
  seed: number
): Record<string, unknown> {
  return {
    '3': {
      class_type: 'KSampler',
      inputs: {
        cfg: 1,
        denoise: 1,
        latent_image: ['13', 0],
        model: ['11', 0],
        negative: ['33', 0],
        positive: ['27', 0],
        sampler_name: 'res_multistep',
        scheduler: 'simple',
        seed,
        steps: 8
      }
    },
    '8': {
      class_type: 'VAEDecode',
      inputs: { samples: ['3', 0], vae: ['29', 0] }
    },
    '9': {
      class_type: 'SaveImage',
      inputs: { filename_prefix: 'delegation-z-image', images: ['8', 0] }
    },
    '11': {
      class_type: 'ModelSamplingAuraFlow',
      inputs: { model: ['28', 0], shift: 3 }
    },
    '13': {
      class_type: 'EmptySD3LatentImage',
      inputs: { batch_size: 1, height, width }
    },
    '27': {
      class_type: 'CLIPTextEncode',
      inputs: { clip: ['30', 0], text: prompt }
    },
    '28': {
      class_type: 'UNETLoader',
      inputs: { unet_name: UNET, weight_dtype: 'default' }
    },
    '29': {
      class_type: 'VAELoader',
      inputs: { vae_name: VAE }
    },
    '30': {
      class_type: 'CLIPLoader',
      inputs: { clip_name: CLIP, device: 'default', type: 'lumina2' }
    },
    '33': {
      class_type: 'ConditioningZeroOut',
      inputs: { conditioning: ['27', 0] }
    }
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

export async function generateImage(
  prompt: string,
  _modelName?: string,
  onProgress?: (msg: string) => void,
  options: { aspectRatio?: string; imageSize?: string } = {}
): Promise<{ data: string; usage?: any }> {
  const { width, height } = dimsFor(options.aspectRatio, options.imageSize);
  onProgress?.(`Generating with local Z-Image Turbo (${width}×${height})...`);

  const clientId = crypto.randomUUID();
  const queueRes = await fetch(`${COMFY_BASE}/prompt`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: clientId,
      prompt: buildPromptGraph(prompt, width, height, Math.floor(Math.random() * 2 ** 31))
    })
  });

  if (!queueRes.ok) {
    const text = await queueRes.text();
    throw new Error(
      `ComfyUI is not reachable (${queueRes.status}). Start it with run_z_image_turbo.bat. ${text}`
    );
  }

  const queued = await queueRes.json();
  if (queued.node_errors && Object.keys(queued.node_errors).length > 0) {
    throw new Error(`ComfyUI rejected the workflow: ${JSON.stringify(queued.node_errors)}`);
  }

  const promptId: string = queued.prompt_id;
  if (!promptId) throw new Error('ComfyUI did not return a prompt id');

  const started = Date.now();
  while (Date.now() - started < 180000) {
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
    if (status === 'error' || entry.status?.completed === false && status === 'error') {
      throw new Error('ComfyUI image generation failed');
    }

    if (entry.status?.completed) {
      const images = entry.outputs?.['9']?.images;
      const img = images?.[0];
      if (!img?.filename) throw new Error('ComfyUI finished without an image');

      const viewUrl = `${COMFY_BASE}/view?filename=${encodeURIComponent(img.filename)}&type=${encodeURIComponent(img.type || 'output')}&subfolder=${encodeURIComponent(img.subfolder || '')}`;
      const imgRes = await fetch(viewUrl);
      if (!imgRes.ok) throw new Error(`Failed to download generated image (${imgRes.status})`);
      const buf = new Uint8Array(await imgRes.arrayBuffer());
      const data = await bytesToBase64(buf);

      return {
        data,
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0, count: 1 }
      };
    }

    await new Promise((r) => setTimeout(r, 500));
  }

  throw new Error('Timed out waiting for ComfyUI to generate an image');
}
