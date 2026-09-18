
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { AGENTIC_SETS, AgenticSystem, DEFAULT_AGENTIC_SET_ID, getAgentSet } from '../../data/agents';
import { resolveImageOutputModel } from '../../core/llm/constants';

export type AgentSet = AgenticSystem;

interface TeamState {
  selectedAgentSetId: string;
  customSystems: AgenticSystem[];

  saveCustomSystem: (system: AgenticSystem) => void;
  deleteCustomSystem: (id: string) => void;
  updateActiveSystem: (changes: Partial<AgenticSystem>) => void;
  updateSystem: (id: string, changes: Partial<AgenticSystem>) => void;
  setActiveTeam: (id: string) => void;
}

export const useTeamStore = create<TeamState>()(
  persist(
    (set) => ({
      selectedAgentSetId: DEFAULT_AGENTIC_SET_ID,
      customSystems: [],

      saveCustomSystem: (system) =>
        set((s) => ({
          customSystems: s.customSystems.some((cs) => cs.id === system.id)
            ? s.customSystems.map((cs) => (cs.id === system.id ? system : cs))
            : [...s.customSystems, system],
        })),

      deleteCustomSystem: (id) =>
        set((s) => ({
          customSystems: s.customSystems.filter((cs) => cs.id !== id),
          selectedAgentSetId: s.selectedAgentSetId === id ? DEFAULT_AGENTIC_SET_ID : s.selectedAgentSetId,
        })),

      updateActiveSystem: (changes) => set((s) => {
        const currentSystem = getAgentSet(s.selectedAgentSetId, s.customSystems);
        const updatedSystem = { ...currentSystem, ...changes };
        return {
          customSystems: s.customSystems.some((cs) => cs.id === updatedSystem.id)
            ? s.customSystems.map((cs) => (cs.id === updatedSystem.id ? updatedSystem : cs))
            : [...s.customSystems, updatedSystem],
        };
      }),

      updateSystem: (id, changes) => set((s) => {
        const system = getAgentSet(id, s.customSystems);
        const updatedSystem = { ...system, ...changes };
        return {
          customSystems: s.customSystems.some((cs) => cs.id === id)
            ? s.customSystems.map((cs) => (cs.id === id ? updatedSystem : cs))
            : [...s.customSystems, updatedSystem],
        };
      }),

      setActiveTeam: (id) => set({
        selectedAgentSetId: id,
      }),
    }),
    {
      name: 'team-storage',
      storage: createJSONStorage(() => localStorage),
      merge: (persisted, current) => {
        const saved = (persisted || {}) as Partial<TeamState>;
        const allowedTeamIds = new Set([
          'manhwa-studio',
          'developer-studio',
          'social-creative-studio',
          'website-banner-studio',
          'logo-design-studio',
          'video-studio',
        ]);
        const customSystems = (saved.customSystems || [])
          .filter((system) => allowedTeamIds.has(system.id))
          .map((system) => {
          if (system.id === 'manhwa-studio') {
            const builtIn = AGENTIC_SETS.find((candidate) => candidate.id === system.id)!;
            const builtInWorkers = new Map(
              (builtIn.leadAgent.subagents || []).map((agent) => [agent.id, agent])
            );
            return {
              ...system,
              outputType: builtIn.outputType,
              outputModel: builtIn.outputModel,
              panelImageModel: builtIn.panelImageModel,
              outputAutoApprove: builtIn.outputAutoApprove,
              leadAgent: {
                ...system.leadAgent,
                model: builtIn.leadAgent.model,
                subagents: (system.leadAgent.subagents || builtIn.leadAgent.subagents || []).map((agent) => ({
                  ...agent,
                  model: builtInWorkers.get(agent.id)?.model || builtIn.outputModel,
                })),
              },
            };
          }
          if (system.outputType !== 'image') return system;
          return {
            ...system,
            outputType: 'image' as const,
            outputModel: resolveImageOutputModel(system.id),
            outputAutoApprove: true,
          };
        });
        const selectedAgentSetId =
          saved.selectedAgentSetId && allowedTeamIds.has(saved.selectedAgentSetId)
            ? saved.selectedAgentSetId
            : DEFAULT_AGENTIC_SET_ID;
        return {
          ...current,
          ...saved,
          customSystems,
          selectedAgentSetId,
        };
      },
    }
  )
);

/** Returns the currently active AgentSet. Safe to call from service/non-React contexts. */
export function getActiveAgentSet(): AgentSet {
  const { selectedAgentSetId, customSystems } = useTeamStore.getState();
  return getAgentSet(selectedAgentSetId, customSystems);
}

/** React hook for accessing the currently active team. */
export function useActiveTeam(): AgentSet {
  const { selectedAgentSetId, customSystems } = useTeamStore();
  return getAgentSet(selectedAgentSetId, customSystems);
}
