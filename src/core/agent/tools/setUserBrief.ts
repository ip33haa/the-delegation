import { AgentActionContext } from '../ToolRegistry';
import { useCoreStore } from '../../../integration/store/coreStore';

export function setUserBrief(agent: AgentActionContext, args: { brief: string }): boolean {
  const store = useCoreStore.getState();
  let brief = (args.brief || '').trim();

  // VALIDATION: Only Lead Agent (index 1) can set the brief
  if (agent.data.index !== 1) {
    console.warn(`[ToolRegistry] Agent ${agent.data.name} attempted set_user_brief, but is not the Lead Agent.`);
    return false;
  }

  if (store.phase !== 'idle') return false;

  if (!brief) {
    const history = store.agentHistories[agent.data.index] || [];
    const lastUser = [...history].reverse().find((m) => m.role === 'user' && (m.content || '').trim());
    brief = (lastUser?.content || '').trim();
  }

  if (!brief) {
    agent.appendHistory({
      role: 'user',
      content: '[SYSTEM] set_user_brief failed: brief is empty. Ask the user what image they want, then call set_user_brief with their exact request.',
      metadata: { internal: true },
    });
    return false;
  }

  store.startProject(brief);
  store.addLogEntry({ agentIndex: agent.data.index, action: 'defined project brief', taskId: undefined });

  return true;
}
