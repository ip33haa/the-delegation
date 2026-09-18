import { memoryApi } from './api';
import { useCoreStore } from '../../integration/store/coreStore';
import { useMemoryStore } from '../../integration/store/memoryStore';
import { useTeamStore } from '../../integration/store/teamStore';
import { useUiStore } from '../../integration/store/uiStore';
import { AGENTIC_SETS } from '../../data/agents';

function canonicalTeamSnapshot(team: any) {
  if (!team) return team;
  const builtIn = AGENTIC_SETS.find((candidate) => candidate.id === 'manhwa-studio')!;
  return {
    ...team,
    customSystems: (team.customSystems || []).map((system: any) => {
      if (system.id !== 'manhwa-studio') return system;
      const workerModels = new Map(
        (builtIn.leadAgent.subagents || []).map((agent) => [agent.id, agent.model])
      );
      return {
        ...system,
        outputModel: builtIn.outputModel,
        panelImageModel: builtIn.panelImageModel,
        leadAgent: {
          ...system.leadAgent,
          model: builtIn.leadAgent.model,
          subagents: (system.leadAgent.subagents || []).map((agent: any) => ({
            ...agent,
            model: workerModels.get(agent.id) || agent.model,
          })),
        },
      };
    }),
  };
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;
let saveInFlight: Promise<void> | null = null;
let creatingProject: Promise<string | null> | null = null;
let subscriptionsStarted = false;

function durableSnapshot() {
  const state = useCoreStore.getState();
  const core = {
    userBrief: state.userBrief,
    referenceImages: [],
    phase: state.phase,
    tasks: state.tasks,
    finalOutput: state.finalOutput,
    finalAssetType: state.finalAssetType,
    finalAssetId: state.finalAssetId,
    finalAssetUrl: state.finalAssetUrl,
    assetGenerationError: state.assetGenerationError,
    isReviewingOutput: state.isReviewingOutput,
    pendingOutputPrompt: state.pendingOutputPrompt,
    pendingOutputParams: state.pendingOutputParams,
    manhwaContinuityContext: state.manhwaContinuityContext,
    isFinalOutputOpen: state.isFinalOutputOpen,
    viewMode: state.viewMode,
    agentHistories: state.agentHistories,
    actionLog: state.actionLog.slice(-80),
    manhwaProject: state.manhwaProject
      ? {
          ...state.manhwaProject,
          characters: state.manhwaProject.characters.map((character) => ({
            ...character,
            imageContent: undefined,
            generationStatus: character.generationStatus === 'generating' ? 'idle' : character.generationStatus,
          })),
          panels: state.manhwaProject.panels.map((panel) => ({
            ...panel,
            imageContent: undefined,
            generationStatus: panel.generationStatus === 'generating' ? 'idle' : panel.generationStatus,
          })),
        }
      : null,
  };
  const teamState = useTeamStore.getState();
  return {
    core,
    team: {
      selectedAgentSetId: teamState.selectedAgentSetId,
      customSystems: teamState.customSystems,
    },
    settings: {
      model: useUiStore.getState().llmConfig.model,
      baseUrl: useUiStore.getState().llmConfig.baseUrl,
      viewMode: core.viewMode,
    },
  };
}

function shouldPersistCoreChange(state: ReturnType<typeof useCoreStore.getState>, previous: ReturnType<typeof useCoreStore.getState>) {
  return (
    state.userBrief !== previous.userBrief ||
    state.phase !== previous.phase ||
    state.tasks !== previous.tasks ||
    state.finalOutput !== previous.finalOutput ||
    state.finalAssetType !== previous.finalAssetType ||
    state.finalAssetId !== previous.finalAssetId ||
    state.finalAssetUrl !== previous.finalAssetUrl ||
    state.manhwaProject !== previous.manhwaProject ||
    state.manhwaContinuityContext !== previous.manhwaContinuityContext ||
    state.agentHistories !== previous.agentHistories ||
    state.actionLog !== previous.actionLog ||
    state.isFinalOutputOpen !== previous.isFinalOutputOpen ||
    state.viewMode !== previous.viewMode
  );
}

function projectTitle(): string {
  const core = useCoreStore.getState();
  return (
    core.manhwaProject?.chapterTitle ||
    core.userBrief.split(/[.!?\n]/)[0].trim().slice(0, 80) ||
    'Untitled project'
  );
}

export async function refreshProjects() {
  const projects = await memoryApi.listProjects();
  useMemoryStore.getState().setProjects(projects);
}

function isMissingProjectError(error: unknown): boolean {
  const status = (error as { status?: number })?.status;
  const message = error instanceof Error ? error.message : String(error);
  return status === 404 || /project not found/i.test(message);
}

async function ensureCurrentProject(): Promise<string | null> {
  const memory = useMemoryStore.getState();
  if (memory.currentProjectId) {
    const known = memory.projects.some((project) => project.id === memory.currentProjectId);
    if (known) return memory.currentProjectId;
    memory.setCurrentProject(null, null);
  }
  const core = useCoreStore.getState();
  if (!core.userBrief && core.tasks.length === 0 && !core.manhwaProject) return null;
  if (creatingProject) return creatingProject;
  creatingProject = (async () => {
    const teamId = useTeamStore.getState().selectedAgentSetId;
    const result = await memoryApi.createProject({
      teamId,
      title: projectTitle(),
      brief: core.userBrief,
      snapshot: durableSnapshot(),
    });
    useMemoryStore.getState().setCurrentProject(result.id, result.storyId);
    await refreshProjects();
    return result.id;
  })().finally(() => {
    creatingProject = null;
  });
  return creatingProject;
}

async function writeCurrentProject(id: string): Promise<void> {
  const team = useTeamStore.getState();
  await memoryApi.saveProject(id, {
    title: projectTitle(),
    teamId: team.selectedAgentSetId,
    team: {
      selectedAgentSetId: team.selectedAgentSetId,
      customSystems: team.customSystems,
    },
    snapshot: durableSnapshot(),
  });
}

export async function saveCurrentProject(): Promise<void> {
  if (useMemoryStore.getState().status !== 'online' || useMemoryStore.getState().hydrating) return;
  if (saveInFlight) await saveInFlight;
  saveInFlight = (async () => {
    let id = await ensureCurrentProject();
    if (!id) return;
    try {
      await writeCurrentProject(id);
    } catch (error) {
      if (!isMissingProjectError(error)) throw error;
      useMemoryStore.getState().setCurrentProject(null, null);
      id = await ensureCurrentProject();
      if (!id) throw error;
      await writeCurrentProject(id);
    }
    await refreshProjects();
  })().catch((error) => {
    if (!isMissingProjectError(error)) {
      useMemoryStore.getState().setStatus('offline', error instanceof Error ? error.message : String(error));
    }
  }).finally(() => {
    saveInFlight = null;
  });
  await saveInFlight;
}

export function scheduleProjectSave(immediate = false) {
  if (saveTimer) clearTimeout(saveTimer);
  if (immediate) {
    void saveCurrentProject();
    return;
  }
  saveTimer = setTimeout(() => void saveCurrentProject(), 900);
}

export async function loadSavedProject(id: string): Promise<void> {
  const memory = useMemoryStore.getState();
  memory.setHydrating(true);
  try {
    const project = await memoryApi.loadProject(id);
    const snapshot = project.snapshot || {};
    if (snapshot.team) useTeamStore.setState(canonicalTeamSnapshot(snapshot.team));
    if (snapshot.settings?.model || snapshot.settings?.baseUrl) {
      useUiStore.getState().setLlmConfig({
        model: snapshot.settings.model,
        baseUrl: snapshot.settings.baseUrl,
      });
    }
    useCoreStore.setState({
      ...snapshot.core,
      isGeneratingAsset: false,
      isResizing: false,
      activeOperation: null,
      tasks: (snapshot.core?.tasks || []).map((task: any) => ({
        ...task,
        status: task.status === 'in_progress' ? 'scheduled' : task.status,
      })),
    });
    useUiStore.setState({ isThinking: false, isTyping: false, isChatting: false });
    memory.setCurrentProject(project.id, project.storyId);
  } finally {
    memory.setHydrating(false);
  }
}

export function startNewProject() {
  useMemoryStore.getState().setCurrentProject(null, null);
  useCoreStore.getState().resetProject();
}

export async function initializeProjectMemory(): Promise<void> {
  const memory = useMemoryStore.getState();
  if (memory.initialized) return;
  try {
    await memoryApi.health();
    memory.setStatus('online');
    await refreshProjects();
    const currentId = useMemoryStore.getState().currentProjectId;
    if (currentId) {
      const exists = useMemoryStore.getState().projects.some((project) => project.id === currentId);
      if (exists) {
        try {
          await loadSavedProject(currentId);
        } catch {
          memory.setCurrentProject(null, null);
        }
      } else {
        memory.setCurrentProject(null, null);
      }
    }
    if (!subscriptionsStarted) {
      subscriptionsStarted = true;
      useCoreStore.subscribe((state, previous) => {
        if (
          previous.userBrief &&
          !state.userBrief &&
          state.phase === 'idle' &&
          useMemoryStore.getState().currentProjectId
        ) {
          useMemoryStore.getState().setCurrentProject(null, null);
          return;
        }
        if (shouldPersistCoreChange(state, previous)) {
          scheduleProjectSave();
        }
      });
      useTeamStore.subscribe(() => scheduleProjectSave());
    }
  } catch (error) {
    memory.setStatus('offline', error instanceof Error ? error.message : String(error));
  } finally {
    memory.setInitialized(true);
  }
}

export async function retryMemoryConnection() {
  useMemoryStore.getState().setInitialized(false);
  useMemoryStore.getState().setStatus('checking');
  await initializeProjectMemory();
}
