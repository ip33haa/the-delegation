import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { LLMMessage, LLMTokenUsage, LLMToolCall, LLMToolDefinition } from '../../core/llm/types';
import { DEFAULT_MODELS, AVAILABLE_MODELS } from '../../core/llm/constants';
import { calculateCost } from '../../core/llm/pricing';
import { useTeamStore } from './teamStore';
import { useUiStore } from './uiStore';

export type TaskStatus = 'scheduled' | 'on_hold' | 'in_progress' | 'done'

export interface TaskRevision {
  output: string
  feedback?: string
  timestamp: number
}

export interface Task {
  id: string
  title: string
  description: string
  assignedAgentId: number
  status: TaskStatus
  parentTaskId?: string
  requiresUserApproval: boolean,
  draftOutput?: string,
  reviewComments?: string,
  output?: string,
  revisions: TaskRevision[]
  createdAt: number
  updatedAt: number
}

export type ManhwaGenerationStatus = 'idle' | 'generating' | 'ready' | 'error'

export interface ManhwaCharacter {
  id: string
  name: string
  visualDescription: string
  referencePrompt: string
  imageContent?: string
  imageAssetId?: string
  imageUrl?: string
  generationStatus: ManhwaGenerationStatus
  generationError?: string
  locked: boolean
}

export interface ManhwaBalloon {
  speaker: string
  text: string
  position: string
}

export interface ManhwaPanel {
  number: number
  visual: string
  shot: string
  characterIds: string[]
  balloons: ManhwaBalloon[]
  captions: string[]
  sfx: string[]
  imagePrompt: string
  imageContent?: string
  imageAssetId?: string
  imageUrl?: string
  generationStatus: ManhwaGenerationStatus
  generationError?: string
}

export interface ManhwaChapterPackage {
  chapterTitle: string
  premise: string
  endHook: string
  characters: ManhwaCharacter[]
  panels: ManhwaPanel[]
}

export interface ActiveOperation {
  agentIndex: number
  stage: 'thinking' | 'generating_prompt' | 'processing_action' | 'generating_image' | 'saving' | 'error'
  label: string
  startedAt: number
}

export interface ActionLogEntry {
  id: string
  timestamp: number
  agentIndex: number
  action: string
  taskId?: string
}

export interface DebugLogEntryBase {
  id: string
  timestamp: number
  agentIndex: number
  agentName: string
  status: 'pending' | 'completed' | 'error'
  taskId?: string
}

export interface RequestDebugLogEntry extends DebugLogEntryBase {
  phase: 'request'
  systemInstruction?: string
  contents: any[]
  systemTools?: any[]
}

export interface ResponseDebugLogEntry extends DebugLogEntryBase {
  phase: 'response'
  content: string | null
  tool_calls?: LLMToolCall[]
  usage?: LLMTokenUsage
  raw?: any
}

export type DebugLogEntry = RequestDebugLogEntry | ResponseDebugLogEntry;

export type ProjectPhase = 'idle' | 'working' | 'done'

interface CoreState {
  // ── Project ──────────────────────────────────────────────────
  userBrief: string
  referenceImages: string[]
  phase: ProjectPhase
  finalOutput: string | null
  availableModels: string[]
  totalTokenUsage: LLMTokenUsage
  agentTokenUsage: Record<number, LLMTokenUsage>
  totalEstimatedCost: number
  agentEstimatedCost: Record<number, number>
  finalAssetType: 'text' | 'image' | 'audio' | 'video'
  finalAssetContent: string | null
  finalAssetId: string | null
  finalAssetUrl: string | null
  isGeneratingAsset: boolean
  assetGenerationError: string | null
  
  // ── Output Review ────────────────────────────────────────────
  isReviewingOutput: boolean
  pendingOutputPrompt: string
  pendingOutputParams: any
  manhwaProject: ManhwaChapterPackage | null
  manhwaContinuityContext: string
  activeOperation: ActiveOperation | null

  // ── Tasks ────────────────────────────────────────────────────
  tasks: Task[]

  // ── Log ──────────────────────────────────────────────────────
  actionLog: ActionLogEntry[]
  debugLog: DebugLogEntry[]

  // ── Conversation histories (Agnostic standard) ───────────────
  agentHistories: Record<number, LLMMessage[]>
  agentSummaries: Record<number, string>
  boardroomHistories: Record<string, LLMMessage[]>

  // ── UI ───────────────────────────────────────────────────────
  isKanbanOpen: boolean
  viewMode: 'simulation' | 'design';
  isLogOpen: boolean
  isFinalOutputOpen: boolean;
  logFilterAgentIndex: number | null;
  isResizing: boolean;

  // ── Actions — Project —————————————————————————————————────────
  setUserBrief: (brief: string) => void;
  addReferenceImage: (base64: string) => void;
  removeReferenceImage: (index: number) => void;
  clearReferenceImages: () => void;
  setPhase: (phase: ProjectPhase) => void;
  startProject: (brief: string) => void;
  setFinalOutput: (output: string) => void;
  setFinalAsset: (type: 'image' | 'audio' | 'video', content: string) => void;
  setFinalAssetRecord: (assetId: string, assetUrl: string) => void;
  setFinalAssetType: (type: 'text' | 'image' | 'audio' | 'video') => void;
  setIsGeneratingAsset: (isGenerating: boolean) => void;
  setAssetGenerationError: (error: string | null) => void;
  setReviewingOutput: (val: boolean) => void;
  setPendingOutputPrompt: (prompt: string) => void;
  setPendingOutputParams: (params: any) => void;
  setManhwaProject: (project: ManhwaChapterPackage | null) => void;
  setManhwaContinuityContext: (context: string) => void;
  setActiveOperation: (operation: Omit<ActiveOperation, 'startedAt'> | null) => void;
  updateManhwaCharacter: (characterId: string, patch: Partial<ManhwaCharacter>) => void;
  updateManhwaPanel: (panelNumber: number, patch: Partial<ManhwaPanel>) => void;

  // ── Actions — Tasks ───────────────────────────────────────────
  addTask: (task: Omit<Task, 'id' | 'revisions' | 'createdAt' | 'updatedAt'>) => Task;
  removeTask: (taskId: string) => void;
  updateTaskStatus: (taskId: string, status: TaskStatus) => void;
  submitTaskForReview: (taskId: string, draftOutput?: string) => void;
  setTaskOutput: (taskId: string, output: string) => void;
  approveTask: (taskId: string) => void;
  rejectTask: (taskId: string, comments: string) => void;

  // ── Actions — Log ─────────────────────────────────────────────
  addLogEntry: (entry: Omit<ActionLogEntry, 'id' | 'timestamp'>) => void;
  addRequestLog: (entry: Omit<RequestDebugLogEntry, 'id' | 'timestamp' | 'phase' | 'status'>) => void;
  addResponseLog: (entry: Omit<ResponseDebugLogEntry, 'id' | 'timestamp' | 'phase' | 'status'>) => void;

  // ── Actions — History ───────────────────────────────────────
  appendAgentHistory: (agentIndex: number, role: 'user' | 'assistant', parts: any[]) => void;
  setAgentSummary: (agentIndex: number, summary: string) => void;
  appendBoardroomHistory: (taskId: string, role: 'user' | 'assistant', parts: any[]) => void;
  clearAllHistories: () => void;

  // ── Actions — UI ──────────────────────────────────────────────
  setKanbanOpen: (open: boolean) => void;
  setLogOpen: (open: boolean, filterAgent?: number | null) => void;
  setFinalOutputOpen: (open: boolean) => void;
  setIsResizing: (isResizing: boolean) => void;
  resetProject: () => void;
  setViewMode: (mode: 'simulation' | 'design') => void;

  // ── Simulation Sync ──────────────────────────────────────────
  setAgentHistory: (agentIndex: number, history: LLMMessage[]) => void;
}

const uid = () => `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`

export const useCoreStore = create<CoreState>()(
  persist(
    (set) => ({
      userBrief: '',
      referenceImages: [],
      phase: 'idle',
      finalOutput: null,
      availableModels: [...AVAILABLE_MODELS.text],
      totalTokenUsage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      agentTokenUsage: {},
      totalEstimatedCost: 0,
      agentEstimatedCost: {},
      finalAssetType: 'text',
      finalAssetContent: null,
      finalAssetId: null,
      finalAssetUrl: null,
      isGeneratingAsset: false,
      assetGenerationError: null,
      isReviewingOutput: false,
      pendingOutputPrompt: '',
      pendingOutputParams: {},
      manhwaProject: null,
      manhwaContinuityContext: '',
      activeOperation: null,
      tasks: [],
      actionLog: [],
      debugLog: [],
      agentHistories: {},
      agentSummaries: {},
      boardroomHistories: {},
      isKanbanOpen: true,
      isLogOpen: true,
      isFinalOutputOpen: false,
      logFilterAgentIndex: null,
      isResizing: false,
      viewMode: 'simulation',

      setViewMode: (viewMode) => set({ viewMode }),

      resetProject: () => set({
        userBrief: '',
        phase: 'idle',
        finalOutput: null,
        tasks: [],
        actionLog: [],
        debugLog: [],
        agentHistories: {},
        agentSummaries: {},
        boardroomHistories: {},
        isFinalOutputOpen: false,
        totalTokenUsage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        agentTokenUsage: {},
        totalEstimatedCost: 0,
        agentEstimatedCost: {},
        finalAssetType: 'text',
        finalAssetContent: null,
        finalAssetId: null,
        finalAssetUrl: null,
        isGeneratingAsset: false,
        assetGenerationError: null,
        isReviewingOutput: false,
        pendingOutputPrompt: '',
        pendingOutputParams: {},
        manhwaProject: null,
        manhwaContinuityContext: '',
        activeOperation: null,
        referenceImages: [],
      }),

      setUserBrief: (brief) => set({ userBrief: brief }),
      addReferenceImage: (base64) => set((s) => ({ 
        referenceImages: [...s.referenceImages, base64].slice(0, 3) 
      })),
      removeReferenceImage: (index) => set((s) => ({ 
        referenceImages: s.referenceImages.filter((_, i) => i !== index) 
      })),
      clearReferenceImages: () => set({ referenceImages: [] }),
      setPhase: (phase) => set({ phase }),
      startProject: (brief) => set({
        userBrief: brief,
        phase: 'working',
        finalAssetType: 'text',
        finalAssetContent: null,
        finalAssetId: null,
        finalAssetUrl: null,
        manhwaProject: null,
        manhwaContinuityContext: '',
        activeOperation: null,
      }),
      setFinalOutput: (output) => set({ finalOutput: output }),
      setFinalAsset: (type, content) => set({
        finalAssetType: type,
        finalAssetContent: content,
        finalAssetId: null,
        finalAssetUrl: null,
        isGeneratingAsset: false,
        assetGenerationError: null,
      }),
      setFinalAssetRecord: (finalAssetId, finalAssetUrl) => set({ finalAssetId, finalAssetUrl }),
      setFinalAssetType: (type) => set({ finalAssetType: type }),
      setIsGeneratingAsset: (isGenerating) => set({ isGeneratingAsset: isGenerating }),
      setAssetGenerationError: (error) => set({ assetGenerationError: error }),
      setReviewingOutput: (val) => set({ isReviewingOutput: val }),
      setPendingOutputPrompt: (prompt) => set({ pendingOutputPrompt: prompt }),
      setPendingOutputParams: (params) => set({ pendingOutputParams: params }),
      setManhwaProject: (manhwaProject) => set({ manhwaProject }),
      setManhwaContinuityContext: (manhwaContinuityContext) => set({ manhwaContinuityContext }),
      setActiveOperation: (operation) => set({
        activeOperation: operation ? { ...operation, startedAt: Date.now() } : null,
      }),
      updateManhwaCharacter: (characterId, patch) =>
        set((s) => ({
          manhwaProject: s.manhwaProject
            ? {
                ...s.manhwaProject,
                characters: s.manhwaProject.characters.map((character) =>
                  character.id === characterId ? { ...character, ...patch, id: character.id } : character
                ),
              }
            : null,
        })),
      updateManhwaPanel: (panelNumber, patch) =>
        set((s) => ({
          manhwaProject: s.manhwaProject
            ? {
                ...s.manhwaProject,
                panels: s.manhwaProject.panels.map((panel) =>
                  panel.number === panelNumber ? { ...panel, ...patch, number: panel.number } : panel
                ),
              }
            : null,
        })),

      addTask: (task) => {
        const newTask: Task = {
          ...task,
          id: `task_${uid()}`,
          revisions: [],
          createdAt: Date.now(),
          updatedAt: Date.now(),
        }
        set((s) => ({ tasks: [...s.tasks, newTask] }))
        return newTask
      },

      removeTask: (taskId) =>
        set((s) => {
          const newTasks = s.tasks.filter((t) => t.id !== taskId);

          // Logic to check if removing this task finishes the project
          const hasRemainingTasks = newTasks.some(t => t.status !== 'done');
          const isWorking = s.phase === 'working';

          let nextPhase = s.phase;
          if (isWorking && !hasRemainingTasks) {
            nextPhase = 'done';
          }

          return {
            tasks: newTasks,
            phase: nextPhase,
          };
        }),

      updateTaskStatus: (taskId, status) =>
        set((s) => {
          const task = s.tasks.find((t) => t.id === taskId);
          if (!task) return {};

          // Safety check: Cannot move back to 'in_progress' or 'on_hold' if already 'done'
          if (task.status === 'done' && (status === 'in_progress' || status === 'on_hold')) {
            return {};
          }

          const newTasks = s.tasks.map((t) =>
            t.id === taskId ? { ...t, status, updatedAt: Date.now() } : t
          );

          return {
            tasks: newTasks,
          };
        }),

      submitTaskForReview: (taskId, draftOutput) =>
        set((s) => ({
          tasks: s.tasks.map((t) =>
            t.id === taskId ? { 
              ...t, 
              status: 'on_hold', 
              draftOutput,
              updatedAt: Date.now() 
            } : t
          ),
        })),

      approveTask: (taskId) => {
        set((s) => {
          const task = s.tasks.find(t => t.id === taskId);
          if (task) useUiStore.getState().setAgentStatus(task.assignedAgentId, 'idle');
          
          return {
            tasks: s.tasks.map((t) =>
              t.id === taskId ? { 
                ...t, 
                status: 'done', 
                output: t.draftOutput || t.output,
                revisions: t.draftOutput 
                  ? [...t.revisions, { output: t.draftOutput, timestamp: Date.now() }] 
                  : t.revisions,
                draftOutput: undefined,
                updatedAt: Date.now() 
              } : t
            ),
          };
        });
      },

      rejectTask: (taskId, comments) => {
        set((s) => {
          const task = s.tasks.find(t => t.id === taskId);
          if (!task) return {};

          useUiStore.getState().setAgentStatus(task.assignedAgentId, 'idle');
          
          const history = s.agentHistories[task.assignedAgentId] || [];
          const updatedHistory = [
            ...history,
            {
              role: 'user' as 'user',
              content: `Rejected. Reason: ${comments}`,
            }
          ];

          return {
            tasks: s.tasks.map((t) =>
              t.id === taskId ? { 
                ...t, 
                status: 'scheduled', 
                reviewComments: comments,
                revisions: t.draftOutput 
                  ? [...t.revisions, { output: t.draftOutput, feedback: comments, timestamp: Date.now() }] 
                  : t.revisions,
                draftOutput: undefined,
                updatedAt: Date.now() 
              } : t
            ),
            agentHistories: {
              ...s.agentHistories,
              [task.assignedAgentId]: updatedHistory
            }
          };
        });
      },

      setTaskOutput: (taskId, output) =>
        set((s) => ({
          tasks: s.tasks.map((t) =>
            t.id === taskId ? { ...t, output, updatedAt: Date.now() } : t
          ),
        })),

      addLogEntry: (entry) =>
        set((s) => ({
          actionLog: [
            ...s.actionLog,
            { ...entry, id: `log_${uid()}`, timestamp: Date.now() },
          ],
        })),
      
      addRequestLog: (entry) =>
        set((s) => {
          const newEntry: DebugLogEntry = { 
            ...entry, 
            id: `debug_${uid()}`, 
            timestamp: Date.now(),
            phase: 'request',
            status: 'completed'
          };
          const updated = [...s.debugLog, newEntry];
          return { debugLog: updated.length > 30 ? updated.slice(-30) : updated };
        }),

      addResponseLog: (entry) =>
        set((s) => {
          const newEntry: DebugLogEntry = { 
            ...entry, 
            id: `debug_${uid()}`, 
            timestamp: Date.now(),
            phase: 'response',
            status: 'completed'
          };
          const updated = [...s.debugLog, newEntry];
          
          // Update token usage and estimated cost
          let nextTotalUsage = s.totalTokenUsage;
          let nextAgentUsage = { ...s.agentTokenUsage };
          let nextTotalCost = s.totalEstimatedCost;
          let nextAgentCost = { ...s.agentEstimatedCost };

          if (entry.usage) {
            const modelName = entry.raw?.model || useUiStore.getState().llmConfig.model;
            // For multimodal outputs, we might need to pass the duration/count if available in raw
            const durationOrCount = entry.raw?.duration || entry.raw?.count;
            const callCost = calculateCost(entry.usage.promptTokens, entry.usage.completionTokens, modelName, durationOrCount);
            
            nextTotalCost += callCost;
            nextAgentCost[entry.agentIndex] = (s.agentEstimatedCost[entry.agentIndex] || 0) + callCost;

            nextTotalUsage = {
              promptTokens: s.totalTokenUsage.promptTokens + entry.usage.promptTokens,
              completionTokens: s.totalTokenUsage.completionTokens + entry.usage.completionTokens,
              totalTokens: s.totalTokenUsage.totalTokens + entry.usage.totalTokens
            };
            
            const currentAgentUsage = s.agentTokenUsage[entry.agentIndex] || { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
            nextAgentUsage[entry.agentIndex] = {
              promptTokens: currentAgentUsage.promptTokens + entry.usage.promptTokens,
              completionTokens: currentAgentUsage.completionTokens + entry.usage.completionTokens,
              totalTokens: currentAgentUsage.totalTokens + entry.usage.totalTokens
            };
          }

          return { 
            debugLog: updated.length > 30 ? updated.slice(-30) : updated,
            totalTokenUsage: nextTotalUsage,
            agentTokenUsage: nextAgentUsage,
            totalEstimatedCost: nextTotalCost,
            agentEstimatedCost: nextAgentCost
          };
        }),

      appendAgentHistory: (agentIndex, role, parts) =>
        set((s) => ({
          agentHistories: {
            ...s.agentHistories,
            [agentIndex]: [
              ...(s.agentHistories[agentIndex] ?? []),
              {
                role,
                content: Array.isArray(parts) ? parts.map(p => typeof p === 'string' ? p : JSON.stringify(p)).join(' ') : String(parts),
              },
            ],
          },
        })),

      setAgentSummary: (agentIndex, summary) =>
        set((s) => ({
          agentSummaries: {
            ...s.agentSummaries,
            [agentIndex]: summary
          }
        })),

      appendBoardroomHistory: (taskId, role, parts) =>
        set((s) => ({
          boardroomHistories: {
            ...s.boardroomHistories,
            [taskId]: [
              ...(s.boardroomHistories[taskId] ?? []),
              {
                role,
                content: Array.isArray(parts) ? parts.map(p => typeof p === 'string' ? p : JSON.stringify(p)).join(' ') : String(parts),
              },
            ],
          },
        })),

      clearAllHistories: () => set({ agentHistories: {}, boardroomHistories: {} }),

      setKanbanOpen: (open) => set({ isKanbanOpen: open }),
      setLogOpen: (open, filterAgent = null) =>
        set({ isLogOpen: open, logFilterAgentIndex: filterAgent ?? null }),
      setFinalOutputOpen: (open) => set({ isFinalOutputOpen: open }),
      setIsResizing: (resizing) => set({ isResizing: resizing }),

      setAgentHistory: (agentIndex, history) => set((s) => ({
        agentHistories: { ...s.agentHistories, [agentIndex]: history }
      })),
    }),
    {
      name: 'delegation-project',
      storage: createJSONStorage(() => sessionStorage),
      partialize: (state) => ({
        userBrief: state.userBrief,
        phase: state.phase,
        tasks: state.tasks,
        finalOutput: state.finalOutput,
        finalAssetType: state.finalAssetType,
        // Skip huge image blobs — keep prompt text in finalOutput instead.
        finalAssetContent:
          state.finalAssetType === 'image' || (state.finalAssetContent?.length ?? 0) > 400_000
            ? null
            : state.finalAssetContent,
        finalAssetId: state.finalAssetId,
        finalAssetUrl: state.finalAssetUrl,
        isGeneratingAsset: state.isGeneratingAsset,
        assetGenerationError: state.assetGenerationError,
        isReviewingOutput: state.isReviewingOutput,
        pendingOutputPrompt: state.pendingOutputPrompt,
        pendingOutputParams: state.pendingOutputParams,
        manhwaProject: state.manhwaProject
          ? {
              ...state.manhwaProject,
              characters: state.manhwaProject.characters.map((character) => ({
                ...character,
                imageContent: undefined,
                locked: false,
                generationStatus: 'idle' as const,
                generationError: undefined,
              })),
              panels: state.manhwaProject.panels.map((panel) => ({
                ...panel,
                imageContent: undefined,
                generationStatus: 'idle' as const,
                generationError: undefined,
              })),
            }
          : null,
        manhwaContinuityContext: state.manhwaContinuityContext,
        isFinalOutputOpen: state.isFinalOutputOpen,
        agentHistories: state.agentHistories,
        actionLog: state.actionLog.slice(-80),
      }),
    }
  )
)

let teamStoreHydrated = false;
useTeamStore.persist.onFinishHydration(() => {
  teamStoreHydrated = true;
});

// Reset project only when the user actually switches teams (not on store rehydrate).
useTeamStore.subscribe((state, prevState) => {
  if (!teamStoreHydrated) return;
  if (state.selectedAgentSetId !== prevState.selectedAgentSetId) {
    useCoreStore.getState().resetProject();
  }
});

