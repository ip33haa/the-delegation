# Troubleshooting

## Services checklist

| Symptom | Check |
|---|---|
| Chat never starts | `curl http://127.0.0.1:11434/api/tags` — is Ollama up? Is the model pulled? |
| Image modal errors | `curl http://127.0.0.1:8188/system_stats` — is ComfyUI up? |
| App blank / wrong port | Read Vite terminal; try `http://localhost:3000/the-delegation/` or `:3001` |

## ComfyUI `403` — “not reachable (403)”

ComfyUI blocks requests when `Host` and `Origin` disagree (browser Origin is the Vite port; proxied Host becomes `127.0.0.1:8188`).

**Fix in this fork:** Vite `/comfyui` proxy strips `origin`, `referer`, and `sec-fetch-*` headers (`vite.config.ts`). Restart `npm run dev` after changing the config.

## ComfyUI `[Errno 22] Invalid argument (KSampler)`

Windows tqdm progress bars flush stderr through ComfyUI’s logger; that flush can raise `OSError: [Errno 22]` and abort sampling even though the GPU path is fine.

**Fix**

1. Stop the current ComfyUI window.
2. Start again with `ComfyUI_windows_portable\run_z_image_turbo.bat` (sets `TQDM_DISABLE=1`).
3. This install also patches `app/logger.py` (swallow Errno 22 on flush) and disables tqdm on Windows in `comfy/utils.py`.

The app retries transient Errno 22 up to 3 times and frees Comfy memory between attempts.

## Project resets mid-work / page suddenly reloads

**Symptom:** Agents were working, then the UI jumps back to idle / loses the board.

**Common cause (this repo lives on OneDrive):** OneDrive sync touches files every few minutes. Vite logs `vite.config.ts changed, restarting server…` and the browser reloads.

**Fixes in this fork**

- Project state (brief, tasks, phase, agent histories) is saved to **sessionStorage** and resumes after reload
- `AgentSimulation` continues scheduled tasks when `phase === 'working'` after rehydrate
- Vite ignores `docs/`, `*.md`, and `scripts/` for file watching (fewer spurious reloads)

**What you should do**

1. Hard-refresh once after pulling these changes  
2. Prefer keeping the repo **outside OneDrive**, or pause sync on this folder while developing  
3. If Vite still restarts every ~5 min, check the terminal for `vite.config.ts changed` — that is OneDrive, not the app logic  

## Image generated but wrong / random scene

Usually the LLM called `deliver_project` with an **empty** or drifting prompt.

**What to check**

- Final modal **PROMPT USED** — should be 4–6 prose sentences in Nano Banana order (subject, location, camera, style, quality) — no `8k` / `masterpiece` tag spam
- Technical log — `deliver_project` arguments  

**Mitigations already in code**

- `buildFinalImagePrompt` + `nanoBananaPrompt.ts` enforce the formula, strip SD tags, and merge teammate slots by role
- Reference images add text cues in the prompt (pixel match requires future ComfyUI img2img)
- Filters invented objects  
- `set_user_brief` falls back to last user message if brief arg empty  

Start a **new** project after pulling latest changes. Use a **Creative** team and **`qwen3.8`** on Ollama.

## Nano Banana local mode (expectations)

This fork mimics **Google Nano Banana prompting style** on local Z-Image Turbo — not the paid Gemini image API.

| Good prompt (PROMPT USED) | Bad prompt |
|---|---|
| Full sentences, concrete camera/material words | Comma lists: `woman, beach, 8k, masterpiece` |
| Subject locked to your brief | Random motorcycles, crowds, outfits not in brief |
| Ends with photoreal/anime quality close | Negative lists: `no blur, no artifacts` |

**Setup:** select **Social Creative Studio** or **Website Banner Studio**, run `ollama pull qwen3.8`, hard-refresh, and start a new project. With `GEMINI_API_KEY`, images use Gemini; otherwise they use ComfyUI.

**Reference images:** the prompt mentions them; ComfyUI does not yet img2img them — expect style hints only.

## Only the lead works / tasks never leave Creative Director

Small models often set `agentId` to `1` (themselves) or an invalid id.

**Mitigations**

- `proposeTask` assigns workers only when possible  
- Simulation reassigns lead-owned scheduled tasks to workers  
- Heartbeat asks lead to fill missing teammates  

Prefer **`qwen3.8`** for better tool calling if `llama3.2` stalls.

## Agents output nearly identical text

Older behavior: everyone wrote a full image prompt and could see each other’s outputs.

**Mitigations**

- Role FOCUS slices (camera vs framing vs mood)  
- Workers cannot see other agents’ full task outputs  
- Lead still synthesizes at delivery  

## “I cannot create content that is sexual…”

That text is from the **chat model** (Ollama), not ComfyUI.

- Try `qwen3.8`  
- Rephrase as fashion / artistic photography if the model is overly cautious  
- Confirm ComfyUI still receives a real brief in **PROMPT USED**  

## Review modal: “No content produced”

Human-in-the-loop held an empty `complete_task`. Image teams now skip review and reject empty outputs. Close the modal and start a new project.

## OpenAI `429` / no credits

Chat defaults to Ollama. If something still calls OpenAI, remove reliance on `OPENAI_API_KEY` or add billing — this fork’s `AgentBrain` uses `OllamaProvider`.

## Gemini `429` / quota

Expected on free tier. Image path does not need Gemini. Music/video teams still do.

## VRAM thrashing / slow image after chat

Ollama and ComfyUI share the GPU. Before image gen, the app unloads Ollama models. First image after chat can take tens of seconds. Prefer `--lowvram` ComfyUI and smaller chat models if needed.

## Ollama tool calls look like JSON in the message

`llama3.2` often emits tool JSON as `content` instead of `tool_calls`. `OllamaProvider.extractToolCallsFromContent` parses that. Prefer `qwen3.8` when tools keep failing.

## Typecheck

```bash
npm run lint
```

## Reset stuck UI state

1. Close final/review modals  
2. Reset / new project in the app  
3. Hard-refresh the browser  
4. Confirm Ollama + ComfyUI are healthy  

## `isInterleavedBufferAttribute` of null (three.webgpu.js)

Three.js NodeBuilder crashes when a storage `BufferAttribute` has `itemSize > 4` **and** the renderer is on the **WebGL2 fallback** (no WebGPU). Older code used `itemSize` 8 / 16 for agent state and baked mats.

**Fix in this fork:** storage attrs use `itemSize` 4; Engine logs which backend started. Hard-refresh after pull. Prefer Chrome/Edge with WebGPU enabled.

## `WebGLProgram: Shader Error` / Vertex shader is not compiled

Means **WebGPU is unavailable** and the app is on WebGL2. The full character path (storage buffers + compute + baked skinning) does not compile there.

**Fix in this fork:** automatic WebGL mode — CPU movement + bind-pose characters via normal instanced attributes (no `storage()` in shaders). Hard-refresh.

For full GPU animation, enable WebGPU (Chrome/Edge, recent GPU drivers). Check `chrome://gpu` → WebGPU.

## Projects button shows a red memory status

The browser cannot reach the local Node/MySQL memory service.

1. Confirm XAMPP is installed at `C:\xampp`; `scripts/start-memory-db.ps1` starts the isolated database on port 3307.
2. Check `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, and `DB_NAME` in `.env`.
3. Run `npm run db:migrate` to verify credentials and create the schema.
4. Restart `npm run dev`; it must show both `WEB` and `MEMORY` processes.
5. Open `http://localhost:3000/the-delegation/api/health`.

The app remains usable in browser-only mode, but projects will not survive browser storage loss.

## Saved images are missing after restore

MySQL stores asset metadata, while image bytes live in `UPLOAD_DIR` (default `server/data/assets`). Restore both the SQL dump and that directory. Do not move or delete individual files manually.

## A restored task runs twice

Only `scheduled` tasks are executable. The API converts interrupted `in_progress` tasks to `scheduled` once during recovery. If an older browser snapshot is stuck, resume the MySQL project from the Projects library instead of refreshing the stale tab repeatedly.
