# Architecture

## Overview

```
┌─────────────────┐     chat/tools      ┌──────────────┐
│  React UI       │ ──────────────────► │ Ollama       │
│  + Zustand      │                     │ :11434       │
└────────┬────────┘                     └──────────────┘
         │
         │ deliver_project (image)
         ▼
┌─────────────────┐     /prompt         ┌──────────────┐
│ ComfyUIImage    │ ──────────────────► │ ComfyUI      │
│ Provider        │ ◄── history/view ── │ :8188        │
└─────────────────┘                     │ Z-Image Turbo│
                                        └──────────────┘
         │
         ▼
┌─────────────────┐
│ Three.js WebGPU │  ◄── AgentSimulation drives NPC states
│ SceneManager    │
└─────────────────┘
```

## Layering

| Layer | Path | Responsibility |
|---|---|---|
| UI | `src/interface/` | Panels, modals, team editor, chat |
| Integration | `src/integration/store/` | Zustand stores bridging UI ↔ simulation |
| Agent core | `src/core/agent/` | Brain, tools, prompts |
| LLM | `src/core/llm/` | Providers, models, pricing |
| Data | `src/data/agents.ts` | Team / agent definitions |
| Simulation | `src/simulation/` | 3D world, characters, orchestration |

## State (Zustand)

### `coreStore` (`src/integration/store/coreStore.ts`)

Project runtime:

- `phase`: `idle` → `working` → `done`
- `userBrief`, `tasks`, `actionLog`, `debugLog`
- `agentHistories`
- Final asset: `finalOutput`, `finalAssetType`, `finalAssetContent`, `isGeneratingAsset`, `assetGenerationError`

### `teamStore`

Active team id + custom systems. Image teams are forced to:

- `outputType: 'image'`
- `outputModel: z-image-turbo`
- `outputAutoApprove: true`
- `humanInTheLoop: false` on nodes (via `getAgentSet`)

### `uiStore`

Chat selection, thinking flags, agent status map, optional BYOK / LLM config (defaults to local text model).

## Agent runtime

### `AgentSimulation` (`src/simulation/core/AgentSimulation.ts`)

- Creates one `AgentHost` per agent node  
- Heartbeat + store subscriptions:
  - empty board → lead `spark()` (propose tasks)
  - scheduled tasks → `startTaskExecution`
  - all done → lead `concludeProject()` (`deliver_project`)
  - missing worker assignments → ask lead to fill remaining teammates  
- Reassigns tasks away from lead (index `1`) when workers exist  

### `AgentHost` / `AgentBrain`

- `think()` → `OllamaProvider.generateCompletion()` with tools  
- Tool results dispatched by `ToolRegistry`  
- On successful `deliver_project` → `processFinalAsset()` → ComfyUI for images  

### Tools (`src/core/agent/tools/`)

| Tool | Who | Effect |
|---|---|---|
| `set_user_brief` | Lead (idle) | Starts project; stores brief |
| `propose_task` | Lead / managers | Adds scheduled task; assignee clamped to real workers |
| `complete_task` | Assignees | Marks done (image teams skip review; empty output rejected) |
| `deliver_project` | Lead | Opens final modal; triggers image gen |

### Prompts

- `PromptBuilder` — system instructions, role focus, fidelity rules  
- `buildFinalImagePrompt` — **user brief first**; only lighting/camera-style additives; filters invented objects  

## LLM providers

| File | Role |
|---|---|
| `OllamaProvider.ts` | Chat + tools; parses native tool_calls **or** JSON-in-content from small models |
| `ComfyUIImageProvider.ts` | Local Z-Image Turbo graph, poll history, return PNG base64 |
| `GeminiProvider.ts` | Optional music/video (and legacy text/image) |
| `OpenAIProvider.ts` | Optional via `/openai` proxy (not default chat) |

## Vite proxies (`vite.config.ts`)

| Path | Target |
|---|---|
| `/comfyui` | `http://127.0.0.1:8188` (+ strip Origin headers) |
| `/ollama` | `http://127.0.0.1:11434` |
| `/openai` | `https://api.openai.com` (+ inject `OPENAI_API_KEY`) |

## 3D simulation

- `SceneManager` — scene lifecycle, chat send, desk/boardroom POIs  
- `CharacterManager` — GLB instances (`public/models/character.glb`, `office.glb`)  
- `NpcAgentDriver` — idle wander vs busy-with-task  
- Required animation clip names (Idle, Walk, Talk, …) live in character assets  

## Image delivery path

1. Lead calls `deliver_project` with output text  
2. `deliverProject` / `buildFinalImagePrompt` resolve prompt from **brief + safe modifiers**  
3. Modal opens (`isGeneratingAsset`)  
4. `generateLocalImage(prompt)` queues ComfyUI  
5. PNG base64 → `setFinalAsset('image', …)`  
6. Modal shows image + **PROMPT USED** (`finalOutput`)
