import { LLMMessage } from '../llm/types';
import { GeminiProvider } from '../llm/providers/GeminiProvider';
import { OllamaProvider } from '../llm/providers/OllamaProvider';
import { DEFAULT_MODELS, GEMINI_IMAGE_MODEL, isImageGenerationModel, isGeminiImageModel, isLocalComfyImageModel, isLocalComfyVideoModel, isGeminiVideoModel, resolveTextModel } from '../llm/constants';
import { generateImage as generateLocalImage, resolveTeamAspectRatio } from '../llm/providers/ComfyUIImageProvider';
import { generateVideo as generateLocalVideo } from '../llm/providers/ComfyUIVideoProvider';
import { useUiStore } from '../../integration/store/uiStore';
import { useCoreStore } from '../../integration/store/coreStore';
import { getActiveAgentSet } from '../../integration/store/teamStore';
import { ToolRegistry } from './ToolRegistry';
import { PromptBuilder } from './PromptBuilder';
import { AgentNode } from '../../data/agents';
import { buildFinalImagePrompt } from './buildFinalImagePrompt';
import {
  beginGenerationJob,
  failGenerationJob,
  persistGeneratedAsset,
} from '../persistence/assets';
import { scheduleProjectSave } from '../persistence/coordinator';

export interface BrainHost {
  data: AgentNode;
  simulation: {
    getAllAgents: () => any[];
    processScheduledTasks: () => void;
    isDisposed?: () => boolean;
  };
  getCurrentTaskId: () => string | null;
}

export interface ThinkOptions {
  isChat?: boolean;
  tools?: any[];
  silent?: boolean;
}

export class AgentBrain {
  private history: LLMMessage[] = [];
  public isThinking: boolean = false;

  constructor(private readonly host: BrainHost) {
    this.refreshFromStore();
  }

  public async think(prompt: string, options: ThinkOptions = {}): Promise<{ text: string, toolCalls: any[] }> {
    if (this.isThinking || this.host.simulation.isDisposed?.()) return { text: '', toolCalls: [] };
    this.isThinking = true;

    try {
      this.refreshFromStore();
      const core = useCoreStore.getState();
      const isLeadSynthesis =
        this.host.data.index === 1 &&
        core.tasks.length > 0 &&
        core.tasks.every((task) => task.status === 'done');
      core.setActiveOperation({
        agentIndex: this.host.data.index,
        stage: isLeadSynthesis ? 'generating_prompt' : 'thinking',
        label: isLeadSynthesis
          ? 'Chapter Editor is synthesizing the final panel package'
          : `${this.host.data.name} is thinking`,
      });
      const llmConfig = useUiStore.getState().llmConfig;
      const provider = new OllamaProvider();
      const model = resolveTextModel(this.host.data.model || llmConfig.model);

      // 1. Manage Message History
      if (!options.isChat) {
        const userMsg: LLMMessage = {
          role: 'user',
          content: prompt,
          metadata: options.silent ? { internal: true } : undefined
        };

        // Reference images stay in the store for the final ComfyUI pass; do not send them to Ollama.
        if (core.referenceImages.length > 0) {
          userMsg.content = `${prompt}\n\n[Note: ${core.referenceImages.length} reference image(s) are attached for final image generation only.]`;
        }

        this.history.push(userMsg);
        this.syncToStore();
      }

      // 2. Prepare context
      // Autonomous prompts already receive the current brief, Kanban, and all
      // approved task outputs through PromptBuilder. Re-sending their full
      // history duplicates thousands of tokens and can stall qwen3.8 on 8GB
      // GPUs (the model is mostly CPU-offloaded). Keep only the latest trigger.
      let messages: LLMMessage[] = options.silent
        ? this.history.slice(-1)
        : this.history.slice(-10);

      // Strip any leftover image payloads so text-only models never see multimodal data.
      messages = messages.map((m) => {
        if (!m.images?.length) return m;
        const { images: _images, ...rest } = m;
        return rest;
      });
      const allAgents = this.host.simulation.getAllAgents();
      const systemPrompt = PromptBuilder.buildSystemPrompt(this.host.data, core.phase, core.userBrief, allAgents);
      const toolDefs = options.tools || ToolRegistry.getDefinitions(this.host.data.index, core.phase, this.host.data.subagents?.length || 0);

      // 3. Log and Execute LLM Call
      core.addRequestLog({
        agentIndex: this.host.data.index,
        agentName: this.host.data.name,
        systemInstruction: systemPrompt,
        contents: messages,
        systemTools: toolDefs,
        taskId: this.host.getCurrentTaskId() || undefined
      });

      const response = await provider.generateCompletion(
        messages,
        toolDefs,
        systemPrompt,
        model
      );
      if (this.host.simulation.isDisposed?.()) return { text: '', toolCalls: [] };

      // 4. Log Response
      core.addResponseLog({
        agentIndex: this.host.data.index,
        agentName: this.host.data.name,
        content: response.content || '',
        tool_calls: response.tool_calls,
        usage: response.usage,
        raw: response.raw,
        taskId: this.host.getCurrentTaskId() || undefined
      });

      // 5. Parse Tool Calls
      const text = response.content || '';
      const toolCalls = response.tool_calls?.map(tc => {
        try {
          const raw = tc.function.arguments;
          const args = typeof raw === 'string' ? (raw.trim() ? JSON.parse(raw) : {}) : (raw || {});
          return { name: tc.function.name, args };
        } catch (e) {
          console.error('[AgentBrain] Failed to parse tool arguments', tc.function.arguments);
          return { name: tc.function.name, args: {} };
        }
      }).filter(Boolean) as any[] || [];

      // 6. Final Message Construction
      const isInternalTrigger = options.silent;
      const hasToolCallsOnly = !text && toolCalls.length > 0;
      const isBrief = toolCalls.some(tc => tc.name === 'set_user_brief');
      const isResolution = false;
      let finalContent = text;
      const isMalformed = response.finishReason === 'MALFORMED_FUNCTION_CALL';

      if (isMalformed) {
        finalContent = 'ERROR: Malformed function call. Please try again.';
        console.warn(`[AgentBrain:${this.host.data.name}] Malformed function call detected.`);
      } else if (hasToolCallsOnly && !isInternalTrigger) {
        finalContent = isBrief
          ? "Project brief set. Let's begin!"
          : 'Working on it...';
      } else if (!text && toolCalls.length === 0 && !isInternalTrigger) {
        finalContent = '...';
      }

      // UI/UX handling for chat auto-closing
      if (options.isChat && (isBrief || isResolution)) {
        setTimeout(() => {
          if (useUiStore.getState().isChatting) useUiStore.getState().setChatting(false);
          useUiStore.getState().setSelectedNpc(null);
        }, 3000);
      }

      const isInternalMessage = isInternalTrigger || (hasToolCallsOnly && isInternalTrigger);
      this.history.push({
        role: 'assistant',
        content: finalContent,
        tool_calls: response.tool_calls,
        metadata: isInternalMessage ? { internal: true } : undefined
      });
      this.syncToStore();

      // 7. Process Actions (Tools)
      if (toolCalls.length > 0) {
        core.setActiveOperation({
          agentIndex: this.host.data.index,
          stage: 'processing_action',
          label: `${this.host.data.name} is processing ${toolCalls.map((call) => call.name).join(', ')}`,
        });
      }
      for (const tc of toolCalls) {
        const handled = ToolRegistry.process(this.host as any, tc);
        if (handled) scheduleProjectSave(true);
        if (tc.name === 'deliver_project' && handled) {
          const activeTeam = getActiveAgentSet();
          if (activeTeam?.id === 'manhwa-studio') {
            useCoreStore.getState().setFinalOutputOpen(true);
            continue;
          }
          const prompt =
            activeTeam?.outputType === 'image'
              ? buildFinalImagePrompt(tc.args?.output)
              : String(tc.args?.output || '').trim();
          if (prompt) useCoreStore.getState().setFinalOutput(prompt);
          await this.handleFinalAssetGeneration(prompt);
        }
      }

      if (useCoreStore.getState().activeOperation?.agentIndex === this.host.data.index) {
        useCoreStore.getState().setActiveOperation(null);
      }
      if (!options.silent) scheduleProjectSave();
      return { text, toolCalls };
    } catch (error) {
      console.error(`[AgentBrain:${this.host.data.name}] Logic error:`, error);
      const errMsg = error instanceof Error ? error.message : String(error);
      if (/gemini/i.test(errMsg) && /quota|429|api key/i.test(errMsg)) {
        useUiStore.getState().setBYOKOpen(true, errMsg);
      }
      useCoreStore.getState().setActiveOperation({
        agentIndex: this.host.data.index,
        stage: 'error',
        label: `${this.host.data.name} stopped: ${errMsg}`,
      });
      throw error;
    } finally {
      this.isThinking = false;
      this.host.simulation.processScheduledTasks();
    }
  }

  /** Autonomous Intent: Start the project strategy. */
  public async spark() {
    const workers = this.host.simulation.getAllAgents()
      .filter((a: any) => a.data.index !== 1);
    const roster = workers
      .map((a: any) => `[${a.data.index}] ${a.data.name}: ${a.data.description}`)
      .join(' | ');
    const activeTeam = getActiveAgentSet();
    const isManhwa = activeTeam?.id === 'manhwa-studio';
    if (isManhwa) {
      const core = useCoreStore.getState();
      if (core.tasks.length === 0) {
        const taskSpecs = [
          {
            role: 'Story Architect',
            title: 'Chapter structure and dramatic beats',
            description: 'Create the compact six-panel dramatic arc, escalation, reveal, climax, and end hook.',
          },
          {
            role: 'Character & World Designer',
            title: 'Character and world continuity bible',
            description: 'Lock recurring character IDs, visual traits, wardrobe, world rules, and text-free reference-sheet prompts.',
          },
          {
            role: 'Scriptwriter',
            title: 'Dialogue and scene script',
            description: 'Write exactly six concise panel beats with separate dialogue, captions, and SFX for manual placement outside the image.',
          },
          {
            role: 'Storyboard Director',
            title: 'Vertical-scroll storyboard and panel prompts',
            description: 'Plan exactly six portrait scenes with framing and text-free visual prompts. No speech balloons or lettering in image prompts.',
          },
        ];
        for (const spec of taskSpecs) {
          const worker = workers.find((candidate: any) => candidate.data.name === spec.role);
          if (!worker) continue;
          const task = core.addTask({
            title: spec.title,
            description: spec.description,
            assignedAgentId: worker.data.index,
            status: 'scheduled',
            requiresUserApproval: false,
          });
          core.addLogEntry({
            agentIndex: this.host.data.index,
            action: `assigned "${spec.title}" to ${spec.role}`,
            taskId: task.id,
          });
        }
      }
      this.host.simulation.processScheduledTasks();
      return { text: '', toolCalls: [] };
    }
    const taskPattern = isManhwa
        ? `Manhwa Studio task titles and owners MUST be:
- Story Architect: "Chapter structure and dramatic beats"
- Character & World Designer: "Character and world continuity bible"
- Scriptwriter: "Dialogue and scene script"
- Storyboard Director: "Vertical-scroll storyboard and panel prompts"
Assign exactly these four tasks—one per teammate.`
      : activeTeam?.id === 'developer-studio'
        ? `Developer Studio task titles and owners MUST be:
- React Architect: "React architecture and frontend data flow"
- Node.js Engineer: "Node.js API, data, and security design"
- Tailwind & shadcn Engineer: "Tailwind and shadcn UI system"
- Vite & QA Engineer: "Vite, testing, performance, and deployment"
Assign exactly these four tasks—one per teammate.`
        : activeTeam?.id === 'social-creative-studio'
          ? `Social Creative Studio task titles and owners MUST be:
- Social Strategist: "Platform, audience, and campaign angle"
- Social Copywriter: "On-image copy and CTA"
- Social Visual Designer: "Composition, typography, and visual style"
Assign exactly these three tasks—one per teammate.`
          : activeTeam?.id === 'website-banner-studio'
            ? `Website Banner Studio task titles and owners MUST be:
- Brand Strategist: "Audience, value proposition, and brand direction"
- UX Copywriter: "Hero headline, support line, and CTA"
- Banner Layout Designer: "Responsive composition and text-safe layout"
- Banner Visual Stylist: "Imagery, palette, lighting, and finish"
Assign exactly these four tasks—one per teammate.`
            : activeTeam?.id === 'logo-design-studio'
              ? `Logo Design Studio task titles and owners MUST be:
- Brand Identity Strategist: "Brand personality, audience, and identity constraints"
- Mark Designer: "Symbol concept and silhouette"
- Typography Designer: "Wordmark, lettering, and lockup"
Assign exactly these three tasks—one per teammate.`
            : activeTeam?.id === 'video-studio'
              ? `Video Studio task titles and owners MUST be:
- Concept Director: "Story beat, subject, and mood"
- Motion Designer: "Camera move, pacing, and subject motion"
- Shot Lister: "Shot list and timing"
Assign exactly these three tasks—one per teammate.`
            : 'Assign one role-specific task to every teammate.';

    return this.think(
      `Start the project. Call propose_task once per teammate. Never assign agentId 1.
Roster: ${roster || 'subagents'}.
Each task title/description MUST match that teammate's specialty and must be different from the others.
${taskPattern}`,
      { silent: true }
    );
  }

  /** Autonomous Intent: Work on a specific task. */
  public async executeTask(taskId: string) {
    const task = useCoreStore.getState().tasks.find((t) => t.id === taskId);
    const role = this.host.data.name;
    const specialty = this.host.data.description;
    const activeTeam = getActiveAgentSet();

    if (task?.parentTaskId === 'manual') {
      return this.think(
        `You are ${role}. A human teammate assigned this task directly to you.
Task ID: ${task.id}
Title: ${task.title}
Instructions: ${task.description}
Use your specialty: ${specialty}.
Complete only this request, provide a useful concrete Markdown result, then call complete_task with this task ID and your result.`,
        { silent: true },
      );
    }

    if (activeTeam?.id === 'manhwa-studio' && task) {
      if (task.reviewComments) {
        useCoreStore.getState().setActiveOperation({
          agentIndex: this.host.data.index,
          stage: 'processing_action',
          label: `${role} is recovering the incomplete task locally`,
        });
        const handled = ToolRegistry.process(this.host as any, {
          name: 'complete_task',
          args: { taskId: task.id, output: '__local_manhwa_fallback__' },
        });
        useCoreStore.getState().setActiveOperation(null);
        if (!handled) throw new Error(`Could not recover incomplete task "${task.title}"`);
        scheduleProjectSave(true);
        return { text: '', toolCalls: [] };
      }
      const roleContract: Record<string, string> = {
        'Story Architect':
          'Produce a compact six-panel chapter arc: objective, conflict, escalation, reveal, action climax, emotional turn, and end hook. Target 100–160 words.',
        'Character & World Designer':
          'Define every recurring character before panel work: assign a short stable ID and lock face, hair, age, build, wardrobe, palette, accessories, motivation, and world role. Include a concise text-free full-body reference-sheet prompt per character. Target 120–200 words.',
        Scriptwriter:
          'Produce exactly six ordered panel beats with visible action and concise balloon-ready dialogue, captions, and SFX. Keep copy outside image prompts. Target 130–220 words.',
        'Storyboard Director':
          'Produce exactly six concise ComfyUI-ready scene prompts as dense comma-separated prose: style, character appearance, action, location, lighting, atmosphere, and camera. No speech balloons or text in the image. Target 140–220 words total.',
      };
      const recoverLocally = () => {
        useCoreStore.getState().setActiveOperation({
          agentIndex: this.host.data.index,
          stage: 'processing_action',
          label: `${role} is completing the task with the local fallback`,
        });
        const handled = ToolRegistry.process(this.host as any, {
          name: 'complete_task',
          args: { taskId: task.id, output: '__local_manhwa_fallback__' },
        });
        useCoreStore.getState().setActiveOperation(null);
        if (!handled) throw new Error(`Could not recover incomplete task "${task.title}"`);
        scheduleProjectSave(true);
        return { text: '', toolCalls: [] };
      };
      try {
        const result = await this.think(
          `You are ${role}. Specialty: ${specialty}.
Do ONLY this task. taskId=${task.id}. Title: ${task.title}. Description: ${task.description}.
User brief: """${useCoreStore.getState().userBrief || ''}""".
${roleContract[role] || 'Produce substantial role-specific Markdown for the manhwa chapter package.'}
Do not write a competing final package and do not perform another teammate's specialty.
Preserve names, appearance, wardrobe, props, locations, timeline, powers, relationships, tone, and rating from the brief.
Write filled-in plain Markdown sentences and lists, never JSON, empty fields, schema templates, or placeholders.
Call complete_task with taskId and the completed Markdown specialty output.`,
          { silent: true },
        );
        const currentTask = useCoreStore.getState().tasks.find((item) => item.id === task.id);
        if (currentTask && currentTask.status !== 'done' && currentTask.status !== 'on_hold') {
          return recoverLocally();
        }
        return result;
      } catch (error) {
        if (/ollama timed out/i.test(error instanceof Error ? error.message : String(error))) {
          return recoverLocally();
        }
        throw error;
      }
    }

    if (activeTeam?.id === 'developer-studio' && task) {
      const roleContract: Record<string, string> = {
        'React Architect':
          'Produce implementation-ready Markdown covering component boundaries, TypeScript interfaces, hooks/state, routing, data flow, loading/error states, accessibility, and key React snippets.',
        'Node.js Engineer':
          'Produce implementation-ready Markdown covering routes, request/response schemas, validation, service boundaries, persistence, auth/security, errors, logging, and key Node.js/TypeScript snippets.',
        'Tailwind & shadcn Engineer':
          'Produce implementation-ready Markdown covering Tailwind tokens, responsive layout, shadcn/ui components, variants, interaction states, accessibility, and reusable UI patterns.',
        'Vite & QA Engineer':
          'Produce implementation-ready Markdown covering Vite config, environment variables, proxy/build/deployment, tests, lint/typecheck commands, performance, edge cases, and risks.',
      };
      return this.think(
        `You are ${role}. Specialty: ${specialty}.
Do ONLY this task. taskId=${task.id}. Title: ${task.title}. Description: ${task.description}.
Product brief: """${useCoreStore.getState().userBrief || ''}""".
${roleContract[role] || 'Produce substantial implementation-ready Markdown for your stack specialty.'}
Use React + TypeScript, Node.js, Tailwind CSS, shadcn/ui, and Vite unless the brief explicitly overrides a choice.
Be concrete about paths, interfaces, schemas, commands, acceptance criteria, and assumptions. Do not claim code was already changed.
Call complete_task with taskId and the completed specialty output.`,
        { silent: true }
      );
    }

    if (
      (activeTeam?.id === 'social-creative-studio' ||
        activeTeam?.id === 'website-banner-studio' ||
        activeTeam?.id === 'logo-design-studio' ||
        activeTeam?.id === 'video-studio') &&
      task
    ) {
      const roleContract: Record<string, string> = {
        'Social Strategist':
          'Define target platform, audience, campaign objective, content angle, aspect ratio, safe zones, and conversion intent.',
        'Social Copywriter':
          'Provide one exact short on-image headline, optional support line, CTA, and brief post-caption direction. Avoid text clutter.',
        'Social Visual Designer':
          'Define mobile-first subject placement, composition, typography hierarchy, palette, lighting, brand cues, and scroll-stopping focal point.',
        'Brand Strategist':
          'Define audience, value proposition, campaign objective, brand personality, credibility cues, and visual constraints.',
        'UX Copywriter':
          'Provide one exact concise hero headline, optional support line, and CTA suited to the banner space.',
        'Banner Layout Designer':
          'Define wide responsive composition, text-safe negative space, focal hierarchy, crop behavior, grid, and CTA zone.',
        'Banner Visual Stylist':
          'Define imagery, palette, lighting, materials, depth, brand consistency, and polished web-ready finish.',
        'Brand Identity Strategist':
          'Define brand personality, audience, values, positioning, palette direction, and non-negotiable identity constraints.',
        'Mark Designer':
          'Define the symbol/icon concept with clear silhouette, simple geometry, memorable metaphor, and small-size readability.',
        'Typography Designer':
          'Define wordmark letterforms, type style, spacing, lockup with the mark, and the exact brand name that must render.',
        'Concept Director':
          'Define story beat, subject continuity, mood, brand fit, and what must stay consistent across a short clip.',
        'Motion Designer':
          'Define camera move, subject motion, pacing, transitions, and physically plausible action for 3–5 seconds.',
        'Shot Lister':
          'Write a concise shot list with framing, timing, and on-screen action suitable for text-to-video prompting.',
      };
      const inventRule =
        activeTeam?.id === 'logo-design-studio'
          ? 'Do invent the logo mark and lockup from the brief. Do not invent alternate brand names, slogans, claims, prices, or testimonials absent from the brief.'
          : activeTeam?.id === 'video-studio'
            ? 'Do invent plausible camera and subject motion from the brief. Do not invent logos, claims, or products absent from the brief.'
          : 'Do not invent logos, claims, prices, testimonials, products, or offers absent from the brief.';
      return this.think(
        `You are ${role}. Specialty: ${specialty}.
Do ONLY this task. taskId=${task.id}. Title: ${task.title}. Description: ${task.description}.
Creative brief: """${useCoreStore.getState().userBrief || ''}""".
${roleContract[role] || 'Produce a concrete 60–120 word specialty note for the final creative.'}
Do not write a competing final ${activeTeam?.id === 'video-studio' ? 'video' : 'image'} prompt. ${inventRule}
Call complete_task with taskId and the completed specialty output.`,
        { silent: true }
      );
    }

    const formulaHint =
      role === 'Scene Designer'
        ? 'Output Subject + Action + Location only (40–70 words, full sentences).'
        : role === 'Lighting Stylist'
          ? 'Output Composition + Lighting + Style + material feel (40–70 words, full sentences).'
          : role === 'Developer' || role === 'Designer'
            ? 'Output Composition + camera/framing only (40–70 words, one prose sentence).'
            : role === 'Copywriter'
              ? 'Output Style + mood + lighting tone only (40–70 words, one prose sentence).'
              : 'Output your role specialty (40–70 words, full sentences).';

    const brief = task
      ? `You are ${role}. Specialty: ${specialty}.
Do ONLY this task. taskId=${task.id}. Title: ${task.title}. Description: ${task.description}.
User brief (keep subject unchanged): """${useCoreStore.getState().userBrief || ''}""".
${formulaHint}
Call complete_task with taskId and your specialty output.
Use Nano Banana prose — NOT comma tags, NOT "8k/masterpiece/ultrarealistic".
Do NOT invent objects, props, vehicles, clothing, or people that are not in the user brief.
If the brief is nude photography, do not add outfits or extra items.`
      : `Proceed with task: ${taskId}. Call complete_task with a non-empty role-specific output.`;
    return this.think(brief, { silent: true });
  }

  /** Autonomous Intent: Finalize and deliver the project results. */
  public async concludeProject() {
    const brief = useCoreStore.getState().userBrief || '';
    const activeTeam = getActiveAgentSet();
    const concludeCreative = async (instruction: string) => {
      try {
        return await this.think(instruction, { silent: true });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.warn('[AgentBrain] Creative lead synthesis failed; using task fallback:', message);
        const core = useCoreStore.getState();
        core.addLogEntry({
          agentIndex: this.host.data.index,
          action: `Lead synthesis fallback used: ${message}`,
          taskId: undefined,
        });
        const taskNotes = core.tasks
          .filter((task) => task.status === 'done' && task.output)
          .map((task) => `${task.title}: ${task.output}`)
          .join('\n');
        const fallbackPrompt = buildFinalImagePrompt(
          [brief, taskNotes].filter(Boolean).join('\n')
        );
        // Clear the error banner set by think() so fallback delivery can finish cleanly.
        core.setActiveOperation({
          agentIndex: this.host.data.index,
          stage: 'processing_action',
          label: `${this.host.data.name} is assembling a local fallback prompt`,
        });
        await this.handleFinalAssetGeneration(fallbackPrompt);
        core.setActiveOperation(null);
        return { text: '', toolCalls: [] };
      }
    };

    if (activeTeam?.id === 'manhwa-studio') {
      const core = useCoreStore.getState();
      core.setActiveOperation({
        agentIndex: this.host.data.index,
        stage: 'processing_action',
        label: 'Chapter Editor is assembling the character bible',
      });
      const handled = ToolRegistry.process(this.host as any, {
        name: 'deliver_project',
        args: {},
      });
      if (!handled) {
        core.setActiveOperation({
          agentIndex: this.host.data.index,
          stage: 'error',
          label: 'Chapter Editor could not assemble the final panel package',
        });
        throw new Error('Manhwa final package assembly was rejected');
      }
      core.setActiveOperation(null);
      scheduleProjectSave(true);
      return { text: '', toolCalls: [] };
    }

    if (activeTeam?.id === 'developer-studio') {
      return this.think(
        `All specialist tasks are complete. Call deliver_project NOW with one implementation-ready GitHub-flavored Markdown package.
Product brief: """${brief}"""

Reconcile teammate work into:
# [Project / Feature Name]
## Requirements and Assumptions
## Architecture and Data Flow
## Routes and Node.js API Contracts
## React Component and File Plan
## Tailwind CSS and shadcn/ui System
## Key TypeScript Implementation Snippets
## Environment and Setup Commands
## Testing and Acceptance Criteria
## Security, Accessibility, and Performance
## Deployment, Risks, and Next Steps

Use React + TypeScript, Node.js, Tailwind CSS, shadcn/ui, and Vite. Include concrete file paths, interfaces, schemas, commands, loading/error states, and justified dependencies. Resolve conflicts between specialists. Do not claim code was already changed or tests were run.`,
        { silent: true }
      );
    }

    if (activeTeam?.id === 'social-creative-studio') {
      return concludeCreative(
        `All specialist tasks are complete. Call deliver_project NOW with ONE natural-language image-generation prompt for the final social media creative.
Creative brief: """${brief}"""
Synthesize the target platform, audience, campaign angle, exact on-image copy, CTA, mobile composition, typography hierarchy, brand palette, subject, setting, lighting, and finish.
Default to a square 1:1 social post when the brief does not specify a platform or ratio.
Quote only the exact short text that should visibly appear in the image. Ask for crisp, correctly spelled typography and no other text. Do not invent logos, claims, prices, testimonials, products, or offers. Use flowing descriptive prose, not comma-tag spam.`,
      );
    }

    if (activeTeam?.id === 'website-banner-studio') {
      return concludeCreative(
        `All specialist tasks are complete. Call deliver_project NOW with ONE natural-language image-generation prompt for the final website banner.
Creative brief: """${brief}"""
Synthesize the audience, value proposition, exact hero copy/CTA, brand direction, visual subject, wide responsive composition, focal hierarchy, palette, lighting, materials, and finish.
Default to a 16:9 website hero banner. Reserve generous text-safe negative space, keep the main subject crop-safe across desktop and mobile, and state where the text/CTA zone belongs.
Quote only exact text that should visibly appear. Ask for crisp, correctly spelled typography and no other text. Do not invent logos, claims, prices, testimonials, products, or offers. Use flowing descriptive prose, not comma-tag spam.`,
      );
    }

    if (activeTeam?.id === 'logo-design-studio') {
      // Skip a second heavy lead LLM call — assemble from specialist notes + brief.
      const core = useCoreStore.getState();
      core.setActiveOperation({
        agentIndex: this.host.data.index,
        stage: 'processing_action',
        label: 'Logo Creative Director is assembling the final logo prompt',
      });
      const taskNotes = core.tasks
        .filter((task) => task.status === 'done' && task.output)
        .map((task) => `${task.title}: ${task.output}`)
        .join('\n');
      const prompt = buildFinalImagePrompt([brief, taskNotes].filter(Boolean).join('\n'));
      const handled = ToolRegistry.process(this.host as any, {
        name: 'deliver_project',
        args: { output: prompt },
      });
      if (handled) {
        core.setFinalOutput(prompt);
        await this.handleFinalAssetGeneration(prompt);
      }
      core.setActiveOperation(null);
      scheduleProjectSave(true);
      return { text: '', toolCalls: [] };
    }

    if (activeTeam?.id === 'video-studio') {
      return concludeCreative(
        `All specialist tasks are complete. Call deliver_project NOW with ONE natural-language video-generation prompt.
Creative brief: """${brief}"""
Synthesize subject, action, camera move, pacing, environment, lighting, and a 3–5 second continuous clip.
Prefer 16:9. Keep motion physically plausible. Use flowing descriptive prose, not comma-tag spam. Do not invent logos, claims, or products absent from the brief.`,
      );
    }

    return this.think(
      `All tasks are complete. Call deliver_project NOW.
Write ONE Nano Banana image prompt (~80–160 words) as flowing prose — NOT comma tags.
Formula order:
1) Subject + Action — start from this exact brief: """${brief}"""
2) Location / context from the brief or Scene Designer notes
3) Composition + camera (lens, angle, depth of field) from teammate notes
4) Style + materiality (lighting temperature, surface textures)
5) Quality finish (photoreal with visible pores not airbrushed / anime linework as appropriate)
FORBIDDEN: "8k", "masterpiece", "ultrarealistic", weighted tags, negative lists.
Do NOT invent objects, props, vehicles, clothing, or people not in the brief.
If the brief is nude photography, do not add outfits or random scene items.`,
      { silent: true }
    );
  }

  private async handleFinalAssetGeneration(prompt: string) {
    const core = useCoreStore.getState();
    const activeTeam = getActiveAgentSet();

    if (!activeTeam) return;

    const resolved =
      activeTeam.outputType === 'image' ? buildFinalImagePrompt(prompt) : (prompt || '').trim();

    // Image teams generate immediately so the user sees a picture, not the prompt.
    if (activeTeam.outputType !== 'image' && activeTeam.outputType !== 'video' && activeTeam.outputAutoApprove === false) {
      core.setPendingOutputPrompt(resolved);
      const defaultParams: any = { model: activeTeam.outputModel };
      if (activeTeam.outputType === 'music') {
        // keep defaults
      }
      core.setPendingOutputParams(defaultParams);
      core.setReviewingOutput(true);
      return;
    }

    if (activeTeam.outputType === 'video' && activeTeam.outputAutoApprove === false) {
      core.setPendingOutputPrompt(resolved);
      core.setPendingOutputParams({
        model: activeTeam.outputModel,
        resolution: '720p',
        aspectRatio: '16:9',
        durationSeconds: 4,
      });
      core.setReviewingOutput(true);
      return;
    }

    // Standard auto-approve flow — image teams get quality defaults.
    const autoParams: any = { model: activeTeam.outputModel };
    if (activeTeam.outputType === 'image') {
      autoParams.qualityMode = 'turbo';
      autoParams.refine = true;
      autoParams.bestOf = 2;
      autoParams.aspectRatio = resolveTeamAspectRatio(activeTeam.id, resolved);
      autoParams.imageSize = '1024';
      autoParams.teamId = activeTeam.id;
    }
    if (activeTeam.outputType === 'video') {
      autoParams.resolution = '720p';
      autoParams.aspectRatio = '16:9';
      autoParams.durationSeconds = 4;
    }
    await this.processFinalAsset(resolved, autoParams);
  }

  public async processFinalAsset(prompt: string, options: any) {
    const core = useCoreStore.getState();
    const activeTeam = getActiveAgentSet();

    if (!activeTeam) return;

    const resolvedPrompt =
      activeTeam.outputType === 'image' || isImageGenerationModel(options?.model || activeTeam.outputModel)
        ? buildFinalImagePrompt(prompt)
        : (prompt || '').trim();

    if (!resolvedPrompt) {
      core.setIsGeneratingAsset(false);
      core.setAssetGenerationError('No image prompt available. Set a brief and deliver again.');
      return;
    }

    core.setIsGeneratingAsset(true);
    core.setAssetGenerationError(null);
    core.setActiveOperation({
      agentIndex: -1,
      stage: 'generating_image',
      label: `Generating final ${activeTeam.outputType} with ${options.model || activeTeam.outputModel}`,
    });
    core.setReviewingOutput(false);
    core.setFinalOutput(resolvedPrompt);

    let generationJobId: string | null = null;
    try {
      const llmConfig = useUiStore.getState().llmConfig;
      const model = options.model || activeTeam.outputModel || llmConfig.model;
      generationJobId = activeTeam.outputType !== 'text'
        ? await beginGenerationJob(
            `final-${activeTeam.outputType}`,
            resolvedPrompt,
            model,
            options || {}
          ).catch(() => null)
        : null;
      const useGeminiImage = isGeminiImageModel(model);
      const useLocalImage =
        isLocalComfyImageModel(model) ||
        (activeTeam.outputType === 'image' && !useGeminiImage);
      if (useGeminiImage && !llmConfig.apiKey) {
        throw new Error('Gemini API key is required for Nano Banana image generation. Add GEMINI_API_KEY to .env');
      }
      const geminiProvider = useGeminiImage && llmConfig.apiKey
        ? new GeminiProvider(llmConfig.apiKey)
        : null;

      core.addLogEntry({
        agentIndex: -1,
        action: `Generating final ${activeTeam.outputType} using ${useGeminiImage ? (isGeminiImageModel(model) ? model : GEMINI_IMAGE_MODEL) : model}...`,
        taskId: undefined
      });

      let assetContent: string = '';
      let usage: any = undefined;

      if (activeTeam.outputType === 'image' || isImageGenerationModel(model)) {
        const imageOpts = {
          ...options,
          aspectRatio: options.aspectRatio || resolveTeamAspectRatio(activeTeam.id, resolvedPrompt),
          imageSize: options.imageSize || '1024',
          qualityMode: options.qualityMode || 'turbo',
          refine: options.refine !== false,
          bestOf: options.bestOf ?? 2,
          teamId: activeTeam.id,
          referenceImages: options.referenceImages || core.referenceImages,
        };
        if (useGeminiImage && geminiProvider) {
          const geminiModel = isGeminiImageModel(model) ? model : GEMINI_IMAGE_MODEL;
          const result = await geminiProvider.generateImage(
            resolvedPrompt,
            geminiModel,
            (msg: string) => console.log(`[System:Image] ${msg}`),
            imageOpts,
            core.referenceImages
          );
          assetContent = result.data || '';
          usage = result.usage;
        } else {
          const result = await generateLocalImage(resolvedPrompt, model, (msg: string) => {
            console.log(`[System:Image] ${msg}`);
          }, imageOpts);
          assetContent = result.data || '';
          usage = result.usage;
        }
      } else if (activeTeam.outputType === 'music') {
        const result = await geminiProvider!.generateAudio(resolvedPrompt, model, (msg: string) => {
          console.log(`[System:Audio] ${msg}`);
        });
        assetContent = result.data || '';
        usage = result.usage;
      } else if (activeTeam.outputType === 'video') {
        if (isLocalComfyVideoModel(model)) {
          const result = await generateLocalVideo(resolvedPrompt, model, (msg: string) => {
            console.log(`[System:Video] ${msg}`);
          }, {
            aspectRatio: options.aspectRatio || '16:9',
            durationSeconds: options.durationSeconds || 4,
            resolution: options.resolution || '480p',
            referenceImages: core.referenceImages,
          });
          assetContent = result.videoUrl || result.data || '';
          usage = result.usage;
        } else {
          if (!llmConfig.apiKey && !isGeminiVideoModel(model)) {
            throw new Error('Gemini API key is required for Veo video. Add GEMINI_API_KEY to .env, or switch to wan-2.2-ti2v-5b for local ComfyUI.');
          }
          const veoProvider = geminiProvider || (llmConfig.apiKey ? new GeminiProvider(llmConfig.apiKey) : null);
          if (!veoProvider) {
            throw new Error('Gemini API key is required for Veo video generation. Add GEMINI_API_KEY to .env');
          }
          const result = await veoProvider.generateVideo(resolvedPrompt, model, (msg: string) => {
            console.log(`[System:Video] ${msg}`);
          }, options, core.referenceImages);
          assetContent = result.videoUrl || '';
          usage = result.usage;
        }
      } else if (activeTeam.outputType === 'text') {
        // For text, the prompt is the final output
        core.setFinalOutput(resolvedPrompt);
        core.setPhase('done');
        core.setFinalOutputOpen(true);
        core.setIsGeneratingAsset(false);
        return;
      }

      core.addResponseLog({
        agentIndex: -1,
        agentName: 'System',
        content: `Final ${activeTeam.outputType} generated successfully.`,
        usage: usage,
        raw: { model, ...usage },
        taskId: undefined
      });

      core.setFinalOutput(resolvedPrompt);
      core.setFinalAsset(activeTeam.outputType === 'music' ? 'audio' : activeTeam.outputType as any, assetContent);
      if (activeTeam.outputType === 'image' && assetContent) {
        const asset = await persistGeneratedAsset({
          jobId: generationJobId,
          role: 'final-image',
          content: assetContent,
          prompt: resolvedPrompt,
          model,
          parameters: options || {},
          supersedesAssetId: core.finalAssetId || undefined,
        }).catch(() => null);
        if (asset) core.setFinalAssetRecord(asset.id, asset.url);
      }
      core.setPhase('done');
      core.setFinalOutputOpen(true);
      core.setActiveOperation(null);
    } catch (error) {
      await failGenerationJob(generationJobId, error);
      console.error('[AgentBrain] Final asset generation failed:', error);
      core.setIsGeneratingAsset(false);
      const errMsg = error instanceof Error ? error.message : String(error);
      core.setAssetGenerationError(errMsg);
      core.setActiveOperation({ agentIndex: -1, stage: 'error', label: errMsg });
      if (!errMsg.toLowerCase().includes('comfyui') && !errMsg.toLowerCase().includes('ollama')) {
        useUiStore.getState().setBYOKOpen(true, errMsg);
      }
      core.addLogEntry({
        agentIndex: 0,
        action: `Error generating final ${activeTeam.outputType}: ${errMsg}`,
        taskId: undefined
      });
    }
  }

  public appendHistory(message: LLMMessage) {
    this.refreshFromStore();
    this.history.push(message);
    this.syncToStore();
  }

  private refreshFromStore() {
    const history = useCoreStore.getState().agentHistories[this.host.data.index];
    if (history) this.history = [...history];
  }

  private syncToStore() {
    useCoreStore.getState().setAgentHistory(this.host.data.index, this.history);
  }
}
