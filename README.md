<p align="center">
  <img src="public/images/the-delegation.svg" width="256" alt="The Delegation Logo">
</p>

# The Delegation (Local Fork)

A no-code **3D multi-agent playground** where LLM-powered teammates collaborate in a shared office, then deliver a final asset.

This repository is based on [arturitu/the-delegation](https://github.com/arturitu/the-delegation) with a **local Windows stack**:

| Capability | Provider |
|---|---|
| Agent chat + tools | **Ollama** (`llama3.2` / `qwen3.8` / `deepseek-r1`) |
| Final **image** output | **ComfyUI** + **Z-Image Turbo** (local GPU) |
| Music / video teams | Still Gemini (optional API key) |

> Upstream hosted demo and Gemini BYOK flow: [arturitu.github.io/the-delegation](https://arturitu.github.io/the-delegation/)

---

## Documentation

| Doc | Description |
|---|---|
| [docs/LOCAL_SETUP.md](docs/LOCAL_SETUP.md) | Install Ollama, ComfyUI, env, and run the app |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Code layout, stores, providers, simulation |
| [docs/AGENTS_AND_WORKFLOW.md](docs/AGENTS_AND_WORKFLOW.md) | Teams, tools, kanban lifecycle, image prompts |
| [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md) | Common errors (403, empty prompt, VRAM, refusals) |

---

## Quick start (this fork)

### Prerequisites

- **Node.js** 20+ recommended  
- **Ollama** running on `http://127.0.0.1:11434`  
- **ComfyUI** with Z-Image Turbo on `http://127.0.0.1:8188` (for image teams)  
- NVIDIA GPU recommended (8GB VRAM tested with NVFP4 Z-Image Turbo)

### 1. Install app dependencies

```bash
npm install
```

### 2. Pull an Ollama chat model

```bash
ollama pull llama3.2
# stronger tools / fewer refusals (larger):
ollama pull qwen3.8
```

### 3. Start ComfyUI (image teams)

Use your portable launcher, for example:

```bat
C:\Users\<you>\ComfyUI_install\ComfyUI_windows_portable\run_z_image_turbo.bat
```

Required model files (typical layout):

- `ComfyUI/models/diffusion_models/z_image_turbo_nvfp4.safetensors`
- `ComfyUI/models/text_encoders/qwen_3_4b_fp4_mixed.safetensors`
- `ComfyUI/models/vae/ae.safetensors`

### 4. Optional `.env`

```env
# Only needed for music/video Gemini teams (or legacy BYOK UI)
GEMINI_API_KEY=
# Optional; OpenAI proxy exists but chat defaults to Ollama
OPENAI_API_KEY=
```

`.env` is gitignored. Do not commit keys.

### 5. Run the app

```bash
npm run dev
```

Open the URL Vite prints (often `http://localhost:3000/the-delegation/` or `http://localhost:3001/the-delegation/` if 3000 is busy).

Keep **Ollama** and **ComfyUI** running while you work.

---

## Features (v0.2.0 + local fork)

### Agentic system

- **Team Editor (React Flow):** design multi-agent hierarchies  
- **Predefined teams:** Agency, Visual Lab, Music, Film, Strategy, PR  
- **Image teams** auto-approve and generate a real PNG via ComfyUI  
- **Kanban + technical logs:** task board and raw LLM / tool traces  
- **Role-specialized workers:** distinct outputs per teammate; lead synthesizes delivery  

### Embodied simulation

- **Three.js WebGPU** office with NavMesh pathfinding  
- Characters walk / sit / work / talk based on task state  
- Chat with the lead to set a project brief  

### Local AI stack

- **Chat:** Ollama via Vite proxy `/ollama`  
- **Images:** ComfyUI via Vite proxy `/comfyui` (Origin headers stripped to avoid ComfyUI 403)  
- **Prompt fidelity:** user brief is the core of the final image prompt; avoid invented objects  

---

## Scripts

| Command | Purpose |
|---|---|
| `npm run dev` | Vite dev server on port 3000 (`0.0.0.0`) |
| `npm run build` | Production build |
| `npm run preview` | Preview production build |
| `npm run lint` | `tsc --noEmit` |

---

## Tech stack

- **3D:** Three.js (WebGPU / TSL), three-pathfinding  
- **UI:** React 19, Tailwind CSS 4, React Flow, Zustand  
- **Local LLM:** Ollama HTTP API  
- **Local images:** ComfyUI prompt / history / view API  
- **Optional cloud:** `@google/genai` (music/video), OpenAI proxy in Vite  

---

## Project layout (high level)

```
src/
  core/agent/          # AgentBrain, tools, prompts
  core/llm/            # Providers (Ollama, ComfyUI, Gemini, OpenAI)
  data/agents.ts       # Team definitions
  integration/store/   # Zustand: core, team, UI
  interface/           # React overlays, modals, configurator
  simulation/          # 3D scene, characters, AgentSimulation
public/models/         # office.glb, character.glb, …
```

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for details.

---

## License & IP

Dual licensing (from upstream):

- **Source code (MIT):** logic, shaders, UI  
- **3D models & assets (CC BY-NC 4.0):** office/character models © Arturo Paracuellos ([unboring.net](https://unboring.net)) — personal/educational use; commercial use requires permission  

Upstream project by [Arturo Paracuellos](https://unboring.net). Local Ollama + ComfyUI integration is a fork customization.
