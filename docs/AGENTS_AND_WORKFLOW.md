# Agents and workflow

## Project lifecycle

```
User chats with Lead (idle)
        │
        ▼
 set_user_brief  →  phase = working
        │
        ▼
 Lead spark() → propose_task × N (one per teammate)
        │
        ▼
 Workers executeTask → complete_task (specialty output)
        │
        ▼
 All tasks Done → Lead concludeProject → deliver_project
        │
        ▼
 Image teams → Gemini when keyed, otherwise ComfyUI → PNG modal
 Text teams → rendered Markdown + download
```

## Predefined teams (`src/data/agents.ts`)

| Id | Name | Output | Notes (this fork) |
|---|---|---|---|
| `manhwa-studio` | Manhwa Studio | **text** | Chapter Editor + story / continuity / script / storyboard specialists |
| `developer-studio` | Developer Studio | **text** | React / Node.js / Tailwind + shadcn / Vite + QA |
| `social-creative-studio` | Social Creative Studio | **image** | Strategy / copy / mobile-first visual design |
| `website-banner-studio` | Website Banner Studio | **image** | Brand / UX copy / responsive layout / visual style |

These are the only predefined teams. Legacy predefined/customized teams are
removed from persisted selection during hydration.

## Developer Studio

`developer-studio` creates a Markdown implementation package focused on React
with TypeScript, Node.js, Tailwind CSS, shadcn/ui, and Vite.

| Agent | Specialty |
|---|---|
| Technical Lead | Architecture, synthesis, acceptance criteria, final package |
| React Architect | Components, hooks, state, routing, accessibility, TypeScript |
| Node.js Engineer | APIs, schemas, validation, data, auth, errors, security |
| Tailwind & shadcn Engineer | Tokens, responsive UI, components, variants, states |
| Vite & QA Engineer | Vite config, env, tests, performance, build, deployment |

The final package includes requirements, architecture/data flow, API contracts,
file/component plan, UI system, key snippets, setup, testing, security,
accessibility, performance, deployment, risks, and next steps.

## Creative Studios

`social-creative-studio` creates platform-ready social artwork. Its workers
cover platform/audience strategy, exact short on-image copy, and mobile-first
visual composition. It defaults to **1:1** when no platform or ratio is given.

`website-banner-studio` creates responsive website hero/banner artwork. Its
workers cover brand/value proposition, UX copy, crop-safe layout, and visual
finish. It defaults to **16:9** with intentional text-safe negative space.

Both teams generate a final image. When `GEMINI_API_KEY` is available they use
`gemini-3.1-flash-image`; otherwise they use local `z-image-turbo` through
ComfyUI. Workers must produce different specialty slices; the lead sees all
completed work and synthesizes one final prompt.

## Manhwa Studio

`manhwa-studio` creates one production-ready Markdown chapter package. It is
genre-neutral and uses `qwen3.8` for stronger long-form structure and tool use.

| Agent | Responsibility |
|---|---|
| Chapter Editor | Assigns work, reconciles continuity, and delivers the final package |
| Story Architect | Chapter objective, dramatic beats, climax, emotional turn, end hook |
| Character & World Designer | Character/location bible, visual identifiers, wardrobe, props, world rules |
| Scriptwriter | Visible action, balloon-ready dialogue, captions, internal monologue, SFX |
| Storyboard Director | Vertical-scroll pacing, framing, transitions, spacing, panel image prompts |

Useful brief details include premise, genre, tone, audience/rating, main
characters, setting, chapter goal, visual style, and desired panel count. When
panel count is omitted, the team targets **18–30 panels**.

The final package contains chapter metadata, continuity sheets, a beat sheet,
and a numbered vertical-scroll script. Every panel includes:

- **Visual / Action**
- **Shot / Framing**
- **Dialogue / Caption / SFX**
- **Image Prompt** with stable character and location identifiers

The final modal renders the Markdown and offers **Download Markdown**.

## Tools (API surface for the LLM)

### `set_user_brief`

```json
{ "brief": "user request text" }
```

If `brief` is empty, the tool falls back to the last user chat message.

### `propose_task`

```json
{
  "title": "string",
  "description": "string",
  "agentId": 2,
  "requiresApproval": false
}
```

- `agentId` is resolved to a **real worker** (never stuck on missing ids; lead is avoided when workers exist).  
- Round-robin unused workers when the model picks a bad id.

### `complete_task`

```json
{ "taskId": "task_…", "output": "non-empty specialty text" }
```

Empty output is rejected. Image teams skip human review.

### `deliver_project`

```json
{ "output": "final deliverable grounded in the brief" }
```

Only the lead may deliver, and every scheduled/in-progress/review task must be
done first. For creative image teams, `buildFinalImagePrompt`:

1. Start with exact `userBrief`  
2. Preserve the lead's synthesized strategy, quoted copy, composition, and style  
3. Add the appropriate default ratio and a commercial-quality finish  

## How to use the UI

1. Select one of the four teams.  
2. Click the lead in the 3D office and open chat.  
3. Describe the story, product feature, social post, or website banner you need.  
4. Watch **Kanban** and **Technical** log: brief → tasks → completes → deliver.  
5. Text teams return rendered/downloadable Markdown; creative teams return PNG + **PROMPT USED**.  

Always start a **new project** after changing models or fixing a stuck board.

## Prompt fidelity rules

Documented in `PromptBuilder` / `buildFinalImagePrompt`:

- The user brief is authoritative.
- Developer output stays within the requested scope and preferred stack.
- Creative teams do not invent logos, legal/regulated claims, prices,
  testimonials, products, or offers absent from the brief.
- Manhwa output preserves names, appearance, wardrobe, powers, relationships,
  timeline, tone, and rating across panels.

## Text models (chat)

Resolved by `resolveTextModel()` in `constants.ts`:

| Name contains | Resolves to |
|---|---|
| `qwen` | `qwen3.8` |
| `deepseek` | `deepseek-r1` |
| `llama` | `llama3.2` |
| else | `DEFAULT_MODELS.text` (`llama3.2`) |

## Image models

Creative teams use **`gemini-3.1-flash-image`** when a Gemini API key is set.
Without a key they fall back to **`z-image-turbo`**; ComfyUI weights are listed
in [LOCAL_SETUP.md](./LOCAL_SETUP.md).
