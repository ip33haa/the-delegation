# Local setup

This guide covers running **The Delegation** on Windows with **Ollama** (chat) and **ComfyUI** (images).

## 1. System requirements

| Component | Recommendation |
|---|---|
| OS | Windows 10/11 |
| Node.js | 20+ |
| GPU | NVIDIA with recent drivers (8GB VRAM tested) |
| RAM | 16GB+ (32GB comfortable if using `qwen3.8`) |
| Disk | Space for Ollama models + ComfyUI Z-Image weights |

## 2. Install the app

```bash
git clone <your-fork-url>
cd the-delegation
npm install
```

## 3. Ollama (agent chat)

1. Install [Ollama](https://ollama.com/) for Windows.
2. Ensure the API responds:

```bash
curl http://127.0.0.1:11434/api/tags
```

3. Pull at least one chat model:

```bash
ollama pull llama3.2          # default in constants (~2GB) — fast, weaker tools
ollama pull llama3.1          # Manhwa Studio (~4.9GB) — stronger long-form writing/tools
ollama pull qwen3.8           # stronger tools / fewer refusals (~17GB)
ollama pull deepseek-r1       # optional
```

### Models used by the app

Configured in `src/core/llm/constants.ts`:

- Default text: `llama3.2` (`DEFAULT_MODELS.text`)
- **Creative image teams** (Social Creative Studio, Website Banner Studio): `qwen3.8` (`IMAGE_TEAM_TEXT_MODEL`) — stronger prompt craft and tool calling
- **Manhwa Studio:** `llama3.1` for stronger story structure and tool output while remaining practical on 8GB VRAM
- **Developer Studio:** `qwen3.8`
- Available: `qwen3.8`, `llama3.1`, `llama3.2`, `deepseek-r1`

For best Nano Banana–style local results, pull qwen before starting an image project:

```bash
ollama pull qwen3.8
```

Agents call Ollama through `OllamaProvider` → `POST /api/chat` with tools.

Dev proxy: browser → `http://localhost:<vite>/ollama/*` → `http://127.0.0.1:11434/*`

## 4. ComfyUI (image generation)

Image teams use ComfyUI + **Z-Image Turbo** (unless a Gemini image model is selected / keyed for creative teams).

### Launch

Example portable launcher:

```bat
ComfyUI_windows_portable\run_z_image_turbo.bat
```

Typical flags: `--lowvram --listen 127.0.0.1 --port 8188`

Confirm:

```bash
curl http://127.0.0.1:8188/system_stats
```

### Model files (Z-Image)

App expects these filenames (see `ComfyUIImageProvider.ts`):

| Role | File | Folder |
|---|---|---|
| UNET | `z_image_turbo_nvfp4.safetensors` | `models/diffusion_models/` |
| CLIP / text encoder | `qwen_3_4b_fp4_mixed.safetensors` | `models/text_encoders/` |
| VAE | `ae.safetensors` | `models/vae/` |

### App → ComfyUI (quality pipeline)

- Label in UI: `z-image-turbo`
- Official Turbo recipe: `res_multistep` / `simple`, **8 steps**, CFG **1**, AuraFlow shift **3**
- **Quality Mode**
  - `turbo` (default): official sampler/scheduler
  - `detail`: `dpmpp_sde` / `ddim_uniform` for richer texture
- **Best-of-2 seeds**: generates two candidates and keeps the sharper one
- **Refine pass** (default on): light second denoise (~0.35) for cleaner finish
- Team canvases: Logo/Social → `1:1`, Banner → `16:9`, else inferred from prompt
- Default pixel budget ~**1024²**; auto-retries near 768² on VRAM OOM
- Prompts: natural language for Qwen (Nano Banana formula). Do **not** raise CFG on Turbo
- Before generate, app unloads Ollama models (`keep_alive: 0`) to free GPU memory

Dev proxy: `/comfyui` → `127.0.0.1:8188`  
Vite strips `Origin` / `Referer` / `Sec-Fetch-*` so ComfyUI’s Host/Origin check does not return **403**.

## 4b. ComfyUI (local video — Wan 2.2 TI2V-5B)

**Video Studio** uses Gemini **Veo** when `GEMINI_API_KEY` is set. Without a key it uses local **Wan 2.2 TI2V-5B** (fits ~8GB with ComfyUI offloading).

### Model files (Wan)

Download into ComfyUI (official Comfy-Org / Wan 2.2 packages):

| Role | File | Folder |
|---|---|---|
| Diffusion | `wan2.2_ti2v_5B_fp16.safetensors` | `models/diffusion_models/` |
| Text encoder | `umt5_xxl_fp8_e4m3fn_scaled.safetensors` | `models/text_encoders/` |
| VAE | `wan2.2_vae.safetensors` | `models/vae/` |

Optional smaller footprint: Q8 GGUF of the 5B model via ComfyUI-GGUF (advanced).

### Local video limits (8GB)

- Resolution: prefer **480p** (720p may work slowly with offload)
- Duration: **~3–5 seconds**
- Keep Ollama unloaded and ComfyUI on `--lowvram`
- First run can take several minutes while models load

App model id: `wan-2.2-ti2v-5b` (see `ComfyUIVideoProvider.ts`).

## 5. Environment variables

Create `.env` in the project root (gitignored):

```env
GEMINI_API_KEY=          # optional — Nano Banana images + Veo video
OPENAI_API_KEY=          # optional — Vite /openai proxy (chat defaults to Ollama)
VITE_COMFYUI_URL=        # optional production override
VITE_OLLAMA_URL=         # optional production override

# Local project memory (server-only; do not use VITE_ prefixes)
DB_HOST=127.0.0.1
DB_PORT=3307
DB_USER=root
DB_PASSWORD=
DB_NAME=delegation_memory
API_PORT=3001
UPLOAD_DIR=server/data/assets
```

Never commit `.env` or paste live keys into git/chat.

**Creative teams:** with `GEMINI_API_KEY` set, Social / Banner / Logo may use Gemini images; Video Studio uses Veo. Without a key they use local ComfyUI (Z-Image / Wan). Restart `npm run dev` after editing `.env`.

## 6. MySQL project memory

This Windows setup uses the MariaDB binaries already included with XAMPP. `npm run dev` starts an isolated Delegation data directory under `%LOCALAPPDATA%\TheDelegation\mariadb-data` on port **3307**, avoiding XAMPP's normal port 3306 and databases.

The memory service creates `DB_NAME` and applies `server/schema.sql` automatically when its user has database-creation permission. You can also run:

```bash
npm run db:migrate
```

Generated files are stored under `UPLOAD_DIR`; MySQL stores their metadata and project relationships. To back up a complete workspace, back up both the database and upload directory:

```bash
mysqldump -u root -p delegation_memory > delegation_memory.sql
mysql -u root -p delegation_memory < delegation_memory.sql
```

Do not expose port 3001 or database port 3307 publicly. Both bind to loopback and the API is reached through Vite's `/api` proxy.

## 7. Run

```bash
npm run dev
```

This starts both Vite and the local memory API. The Projects button shows a green status dot when MySQL is connected; otherwise the app keeps working in browser-only fallback mode.

Open e.g. `http://localhost:3000/the-delegation/`.

### Access from another device (same Wi‑Fi)

`npm run dev` already listens on all interfaces (`--host=0.0.0.0`). Print your LAN URL:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\share-lan-url.ps1
```

Example: `http://10.50.24.23:3000/the-delegation/`

**Tailscale / firewall:** both need admin on Windows. Without admin rights you cannot install Tailscale or open inbound firewall rules. If LAN peers cannot connect, ask IT to allow TCP **3000**, or use a user-space tunnel:

```bash
npx --yes localtunnel --port 3000
```

Append `/the-delegation/` to the printed HTTPS URL. That exposes the app beyond your LAN.

### Checklist before a project

1. Ollama running + model pulled  
2. ComfyUI running on 8188 (image teams)  
3. Hard-refresh browser after config changes  
4. Start a **new** project (don’t reuse a stuck board)

## 8. Production notes

- `base` is `/the-delegation/` in `vite.config.ts`
- In production builds, set `VITE_OLLAMA_URL` and `VITE_COMFYUI_URL` if you are not using the Vite proxies
- Music/video still need a Gemini key via `GeminiProvider`
- GitHub Pages cannot run the Node/MySQL memory API; persistent production hosting needs Node, MySQL, and durable disk.
