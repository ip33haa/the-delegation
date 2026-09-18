import { AgentNode, AgenticSystem, getAllAgents } from '../../data/agents';
import { useCoreStore } from '../../integration/store/coreStore';
import { AgentHost } from './AgentHost';
import { useUiStore } from '../../integration/store/uiStore';
import { useMemoryStore } from '../../integration/store/memoryStore';
import { getActiveAgentSet } from '../../integration/store/teamStore';

/**
 * AgentSimulation — Autonomous Service Layer.
 * 
 * DESIGN PRINCIPLE: State-Driven Orchestration.
 * 1. Monitors the Store to trigger autonomous loops.
 * 2. Visuals are reflections of this state.
 * 3. Event-based Resilience: Re-checks for tasks when agents become idle.
 */
export class AgentSimulation {
  private agents: Map<number, AgentHost> = new Map();
  private system: AgenticSystem;
  private unsubs: (() => void)[] = [];
  private heartbeatInterval: any = null;
  private lastSparkTriggerTime: number = 0;
  private lastFillWorkersTime: number = 0;
  private lastIdleCheckInTime = 0;
  private idleCheckInCursor = 0;
  private disposed = false;

  constructor(system: AgenticSystem) {
    this.system = system;
    this.initializeAgents();
    this.startStateMonitoring();
    this.scheduleResumeAfterHydration();
  }

  /** Pick up in-progress work after a Vite reload / page refresh. */
  private scheduleResumeAfterHydration() {
    const resume = () => {
      if (this.disposed || useMemoryStore.getState().hydrating) return;
      const state = useCoreStore.getState();
      if (state.isGeneratingAsset) {
        useCoreStore.getState().setIsGeneratingAsset(false);
        useCoreStore.getState().setAssetGenerationError(
          'Generation was interrupted by a page reload. Close the modal and deliver again if needed.'
        );
      }
      if (state.phase !== 'working') return;
      if (state.tasks.some((task) => task.status === 'in_progress')) {
        useCoreStore.setState((current) => ({
          tasks: current.tasks.map((task) =>
            task.status === 'in_progress' ? { ...task, status: 'scheduled' as const } : task
          ),
        }));
      }
      if (state.tasks.length === 0) {
        this.triggerAutonomousStrategy();
      } else {
        this.processScheduledTasks();
        this.checkProjectCompletion();
      }
    };
    if (useCoreStore.persist.hasHydrated()) resume();
    else useCoreStore.persist.onFinishHydration(resume);
  }

  private startStateMonitoring() {
    // 1. Heartbeat safety net (Periodically check for scheduled tasks and empty boards)
    this.heartbeatInterval = setInterval(() => {
      if (this.disposed || useMemoryStore.getState().hydrating) return;
      const state = useCoreStore.getState();
      if (state.phase === 'working' && state.tasks.length === 0) {
        this.triggerAutonomousStrategy();
      } else if (state.phase === 'working') {
        this.processScheduledTasks();
        this.fillRemainingWorkerTasks();
      }
      this.maybeStartIdleCheckIn();
    }, 5000);

    // 2. Core Store Monitoring
    this.unsubs.push(
      useCoreStore.subscribe((state, prevState) => {
        if (this.disposed || useMemoryStore.getState().hydrating) return;
        // A. Initial Strategy (Spark)
        if (state.phase === 'working' && prevState.phase === 'idle' && state.tasks.length === 0) {
          this.triggerAutonomousStrategy();
        }

        const tasksChanged = state.tasks !== prevState.tasks || state.phase !== prevState.phase;
        if (state.phase === 'working' && tasksChanged) {
          this.processScheduledTasks();
        }

        if (tasksChanged || state.phase !== prevState.phase) {
          this.checkProjectCompletion();
        }
      })
    );

    // 3. UI Store Monitoring (Cleanup)
    this.unsubs.push(
      useUiStore.subscribe((state, prevState) => {
        if (this.disposed || useMemoryStore.getState().hydrating) return;
        if (!state.isChatting && prevState.isChatting) {
          const core = useCoreStore.getState();
          if (core.phase === 'working' && core.tasks.length === 0) this.triggerAutonomousStrategy();
        }
      })
    );
  }

  /** Central method to check for and start available tasks. */
  public processScheduledTasks() {
    if (this.disposed || useMemoryStore.getState().hydrating) return;
    const state = useCoreStore.getState();
    if (state.phase !== 'working') return;

    state.tasks.filter(t => t.status === 'scheduled').forEach(task => {
      const assignedId = Number(task.assignedAgentId);
      let agent = this.getAgent(assignedId);
      const workers = this.getAllAgents().filter((a) => a.data.index !== 1);
      if ((!agent || agent.data.index === 1) && workers.length > 0 && task.status === 'scheduled') {
        const unused = workers.find((w) => !state.tasks.some((x) => x.id !== task.id && x.assignedAgentId === w.data.index));
        const fallback = unused || workers[0];
        useCoreStore.setState((s) => ({
          tasks: s.tasks.map((t) =>
            t.id === task.id ? { ...t, assignedAgentId: fallback.data.index } : t
          ),
        }));
        agent = fallback;
      } else if (!agent) {
        const fallback = this.getAgent(1) || this.getAllAgents()[0];
        if (!fallback) return;
        useCoreStore.setState((s) => ({
          tasks: s.tasks.map((t) =>
            t.id === task.id ? { ...t, assignedAgentId: fallback.data.index } : t
          ),
        }));
        agent = fallback;
      }
      const uiStatus = useUiStore.getState().agentStatuses[agent.data.index];
      const isIdle = agent.state === 'idle' || uiStatus === 'idle' || uiStatus === undefined;

      if (isIdle && !agent.isThinking) {
        this.startTaskExecution(agent.data.index, task.id);
      }
    });
  }

  private maybeStartIdleCheckIn() {
    if (Date.now() - this.lastIdleCheckInTime < 25_000) return;
    const ui = useUiStore.getState();
    if (ui.isChatting || ui.isThinking) return;
    const tasks = useCoreStore.getState().tasks;
    const candidates = this.getAllAgents().filter((agent) => {
      if (agent.isThinking || agent.state !== 'idle') return false;
      return !tasks.some(
        (task) => Number(task.assignedAgentId) === agent.data.index && task.status !== 'done',
      );
    });
    if (!candidates.length) return;
    const agent = candidates[this.idleCheckInCursor % candidates.length];
    this.idleCheckInCursor += 1;
    this.lastIdleCheckInTime = Date.now();
    const roleQuestions: Record<string, string> = {
      'Chapter Editor': 'I’m free right now—should I help shape the next chapter direction?',
      'Story Architect': 'Want me to explore another plot twist, conflict, or chapter hook?',
      'Character & World Designer': 'Should I develop a character, location, power, or continuity detail?',
      Scriptwriter: 'Need me to draft or improve dialogue for a scene?',
      'Storyboard Director': 'Want me to plan a panel composition or action sequence?',
      'React Architect': 'Need help planning a React component or state flow?',
      'Node.js Engineer': 'Should I work through an API, database, or backend concern?',
      'Tailwind & shadcn Engineer': 'Want me to improve a layout or component design?',
      'Vite & QA Engineer': 'Should I investigate a build, test, or performance issue?',
    };
    const question =
      roleQuestions[agent.data.name] ||
      `I’m available—would you like help with ${agent.data.description.replace(/[.!?].*$/, '').toLowerCase()}?`;
    useUiStore.setState({ agentCheckIns: { [agent.data.index]: question } });
  }

  private async fillRemainingWorkerTasks() {
    if (this.disposed || useMemoryStore.getState().hydrating) return;
    if (Date.now() - this.lastFillWorkersTime < 8000) return;
    const workers = this.getAllAgents().filter((a) => a.data.index !== 1);
    if (!workers.length) return;
    const state = useCoreStore.getState();
    if (state.phase !== 'working') return;
    if (state.tasks.some((task) => task.parentTaskId === 'manual')) return;
    const assigned = new Set(state.tasks.map((t) => Number(t.assignedAgentId)));
    const missing = workers.filter((w) => !assigned.has(w.data.index));
    if (!missing.length) return;
    const lead = this.getAgent(1);
    if (!lead || lead.isThinking) return;
    this.lastFillWorkersTime = Date.now();
    const names = missing.map((m) => `[${m.data.index}] ${m.data.name}`).join(', ');
    await lead.think(
      `Call propose_task for remaining teammates only: ${names}. Never assign agentId 1. Each task must match that person's specialty and must differ from existing tasks.`,
      { silent: true }
    );
  }

  private async triggerAutonomousStrategy() {
    if (this.disposed || useMemoryStore.getState().hydrating) return;
    const lead = this.getAgent(1);
    const ui = useUiStore.getState();
    const core = useCoreStore.getState();

    // GUARD: Prevent duplication
    if (!lead || lead.isThinking || core.tasks.length > 0) return;
    if (ui.isChatting && ui.selectedNpcIndex === lead.data.index) return;
    
    if (Date.now() - this.lastSparkTriggerTime < 1000) return;
    this.lastSparkTriggerTime = Date.now();

    await lead.spark();
  }

  private async startTaskExecution(agentIndex: number, taskId: string) {
    if (this.disposed || useMemoryStore.getState().hydrating) return;
    const agent = this.getAgent(agentIndex);
    if (!agent) return;

    useUiStore.getState().setAgentCheckIn(agentIndex, null);
    agent.setTask(taskId); 
    useCoreStore.getState().updateTaskStatus(taskId, 'in_progress');
    
    await new Promise(resolve => setTimeout(resolve, Math.random() * 2000 + 1000));
    if (this.disposed || useMemoryStore.getState().hydrating) return;

    try {
      if (!agent.isThinking) {
        await agent.executeTask(taskId);
      }
    } catch (err) {
      console.error(`[AgentSimulation] Agent ${agentIndex} failed:`, err);
      const failedTask = useCoreStore.getState().tasks.find((task) => task.id === taskId);
      if (
        failedTask?.status === 'in_progress' &&
        failedTask.parentTaskId !== 'manual' &&
        getActiveAgentSet()?.id === 'manhwa-studio'
      ) {
        const message = err instanceof Error ? err.message : String(err);
        useCoreStore.setState((state) => ({
          tasks: state.tasks.map((task) =>
            task.id === taskId
              ? {
                  ...task,
                  status: 'scheduled' as const,
                  reviewComments: `Automatic recovery requested after: ${message}`,
                  updatedAt: Date.now(),
                }
              : task,
          ),
        }));
      }
    } finally {
      // Resilience check: only clear task if not waiting for review or meeting
      if (agent.state !== 'on_hold' && agent.state !== 'talking') {
        agent.setTask(null);
        agent.setState('idle');
      }
      
      // KEY: When finished, check if there are other scheduled tasks waiting
      this.processScheduledTasks();
      
      // AND check if the project is now ready for delivery 
      // (Resilience for 1-agent teams where lead is thinking when the last task finishes)
      this.checkProjectCompletion();
    }
  }

  private async checkProjectCompletion() {
    if (this.disposed || useMemoryStore.getState().hydrating) return;
    const state = useCoreStore.getState();
    const allTasksFinished = state.tasks.length > 0 && state.tasks.every(t => t.status === 'done');
    
    if (state.phase === 'working' && allTasksFinished && !state.isGeneratingAsset) {
      const workers = this.getAllAgents().filter((a) => a.data.index !== 1);
      const assigned = new Set(state.tasks.map((t) => Number(t.assignedAgentId)));
      const hasManualTask = state.tasks.some((task) => task.parentTaskId === 'manual');
      if (!hasManualTask && workers.some((w) => !assigned.has(w.data.index))) {
        this.fillRemainingWorkerTasks();
        return;
      }
      const lead = this.getAgent(this.system.leadAgent.index);
      if (lead && !lead.isThinking) {
        await lead.concludeProject();
      }
    }
  }

  private initializeAgents() {
    const allAgents = getAllAgents(this.system);
    for (const agentData of allAgents) {
      this.agents.set(agentData.index, new AgentHost(agentData, this));
    }
  }

  public getAgent(index: number): AgentHost | undefined {
    return this.agents.get(index);
  }

  public getAllAgents(): AgentHost[] {
    return Array.from(this.agents.values());
  }



  public async handleUserMessage(agentIndex: number, text: string) {
    const agent = this.getAgent(agentIndex);
    if (!agent || !agent.canChat()) return null;
    const response = await agent.think(text, {
      isChat: true,
      tools: agentIndex === this.system.leadAgent.index ? undefined : [],
    });
    return response.text;
  }

  public dispose() {
    this.disposed = true;
    if (this.heartbeatInterval) clearInterval(this.heartbeatInterval);
    this.unsubs.forEach(unsub => unsub());
    this.unsubs = [];
    this.agents.forEach(a => a.dispose());
  }

  public isDisposed() {
    return this.disposed;
  }
}
