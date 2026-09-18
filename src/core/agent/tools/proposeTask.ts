import { AgentActionContext } from '../ToolRegistry';
import { useCoreStore } from '../../../integration/store/coreStore';
import { getActiveAgentSet } from '../../../integration/store/teamStore';
import { getAllAgents } from '../../../data/agents';

function workerIds(): number[] {
  const team = getActiveAgentSet();
  const agents = team ? getAllAgents(team) : [];
  return agents.map((a) => a.index).filter((i) => i !== 1);
}

function resolveAssignee(rawId: unknown): number {
  const team = getActiveAgentSet();
  const agents = team ? getAllAgents(team) : [];
  const workers = workerIds();
  const names = agents.filter((a) => a.index !== 1);

  if (workers.length === 0) return 1;

  if (typeof rawId === 'string' && Number.isNaN(Number(rawId))) {
    const byName = names.find(
      (a) => a.name.toLowerCase() === rawId.toLowerCase().trim()
    );
    if (byName) return byName.index;
  }

  const n = Number(rawId);
  if (Number.isInteger(n) && workers.includes(n)) return n;

  const used = useCoreStore.getState().tasks.map((t) => t.assignedAgentId);
  const unused = workers.filter((id) => !used.includes(id));
  return (unused[0] ?? workers[used.length % workers.length]);
}

export function proposeTask(agent: AgentActionContext, args: { title: string, description: string, agentId: number, requiresApproval?: boolean }): boolean {
  const store = useCoreStore.getState();
  const { title, description, requiresApproval } = args;
  const finalAgentId = resolveAssignee(args.agentId);

  const newTask = store.addTask({
    title: title || 'Untitled task',
    description: description || title || 'Complete assigned work.',
    assignedAgentId: finalAgentId,
    status: 'scheduled',
    requiresUserApproval: requiresApproval || false
  });

  store.addLogEntry({ agentIndex: agent.data.index, action: `proposed task: "${title}"`, taskId: newTask.id });

  return true;
}
