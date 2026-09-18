
import React, { useState } from 'react';
import { getAgentSet, getAllAgents, getAllCharacters } from '../data/agents';
import { useUiStore } from '../integration/store/uiStore';
import InfoModal from './InfoModal';

import { MessageCircleQuestion, MessageSquareWarning, PartyPopper, Siren, Loader2 } from 'lucide-react';
import { Task, useCoreStore } from '../integration/store/coreStore';
import { useTeamStore, useActiveTeam } from '../integration/store/teamStore';
import { USER_COLOR, USER_COLOR_LIGHT, USER_COLOR_SOFT } from '../theme/brand';
import { useSceneManager } from '../simulation/SceneContext';



interface AlertBubbleProps {
  icon: React.ReactNode;
  position: { x: number; y: number };
  visible: boolean;
  color?: string;
  onClick?: () => void;
}

const AlertBubble: React.FC<AlertBubbleProps> = ({ icon, position, visible, color = '#facc15', onClick }) => {
  if (!visible) return null;

  return (
    <div
      className={`absolute z-20 ${onClick ? 'pointer-events-auto cursor-pointer' : 'pointer-events-none'}`}
      style={{
        left: position.x,
        top: position.y,
        transform: 'translate(-50%, -100%) translateY(-10px)'
      }}
      onClick={(e) => {
        if (onClick) {
          e.stopPropagation();
          onClick();
        }
      }}
    >
      <div
        className={`bg-darkDelegation/90 backdrop-blur-md p-1.5 rounded-full border border-white/10 shadow-xl flex items-center justify-center hover:scale-110 active:scale-95 transition-transform ${onClick ? 'hover:border-white/30' : ''}`}
        style={{ color }}
      >
        {icon}
      </div>
    </div>
  );
};

type PhaseLabel = { text: string; className: string };
type ActionBubble = { text: string; tone: 'working' | 'question' | 'queued' | 'done' };

function getAgentActionBubble(
  agentIndex: number,
  leadAgentIndex: number,
  tasks: Task[],
  phase: string,
  activeOperation: { agentIndex: number; label: string } | null,
  checkIn?: string,
): ActionBubble | null {
  if (activeOperation?.agentIndex === agentIndex) {
    return { text: activeOperation.label, tone: 'working' };
  }
  const active = tasks.find((task) => task.assignedAgentId === agentIndex && task.status === 'in_progress');
  if (active) return { text: `Working on: ${active.title}`, tone: 'working' };
  const review = tasks.find((task) => task.assignedAgentId === agentIndex && task.status === 'on_hold');
  if (review) return { text: `Could you review: ${review.title}?`, tone: 'question' };
  const queued = tasks.find((task) => task.assignedAgentId === agentIndex && task.status === 'scheduled');
  if (queued) return { text: `Next up: ${queued.title}`, tone: 'queued' };
  if (checkIn) return { text: checkIn, tone: 'question' };
  const completed = [...tasks].reverse().find(
    (task) => task.assignedAgentId === agentIndex && task.status === 'done',
  );
  if (completed) return { text: `Done: ${completed.title}. Any changes?`, tone: 'done' };
  if (agentIndex === leadAgentIndex && phase === 'done') {
    return { text: 'The project is ready. Want to review it together?', tone: 'question' };
  }
  if (agentIndex === leadAgentIndex && phase === 'working') {
    return { text: 'Anything you want the team to prioritize?', tone: 'question' };
  }
  if (agentIndex === leadAgentIndex && phase === 'idle') {
    return { text: 'What should we work on together?', tone: 'question' };
  }
  return null;
}

function getAgentPhaseLabel(
  agentIndex: number,
  leadAgentIndex: number,
  tasks: Task[],
  phase: string,
  isGeneratingAsset: boolean,
  fallback: string,
): PhaseLabel {
  if (isGeneratingAsset && agentIndex === leadAgentIndex) {
    return { text: 'Delivering...', className: 'text-indigo-400 animate-pulse' };
  }
  if (agentIndex === leadAgentIndex && phase === 'done') {
    return { text: 'Project Ready!', className: 'text-yellow-400' };
  }
  const holdTask = tasks.find(
    t => t.assignedAgentId === agentIndex && t.status === 'on_hold',
  );
  if (holdTask && phase !== 'done') {
    return { text: 'Approval Needed', className: 'text-[#7EACEA]' };
  }
  const activeTask = tasks.find(
    t => t.assignedAgentId === agentIndex && t.status === 'in_progress',
  );
  if (activeTask) {
    return { text: 'Working', className: 'text-emerald-400' };
  }
  return { text: fallback, className: 'text-white/70' };
}

const UIOverlay: React.FC = () => {
  const {
    selectedNpcIndex,
    selectedPosition,
    hoveredNpcIndex,
    hoveredPoiLabel,
    hoverPosition,
    npcScreenPositions,
    agentCheckIns,
    setSelectedNpc,
    setAgentCheckIn,
  } = useUiStore();
  const [isHelpOpen, setHelpOpen] = useState(false);
  const {
    tasks,
    phase,
    isGeneratingAsset,
    activeOperation,
  } = useCoreStore();
  const scene = useSceneManager();
  const system = useActiveTeam();
  const npcAgents = getAllAgents(system);
  const allPossibleAgents = getAllCharacters(system);

  const selectedAgent = selectedNpcIndex != null ? allPossibleAgents.find(a => a.index === selectedNpcIndex) as any ?? null : null;
  const hoveredAgent = hoveredNpcIndex != null ? allPossibleAgents.find(a => a.index === hoveredNpcIndex) as any ?? null : null;
  const openWorkmateChat = (agentIndex: number) => {
    setSelectedNpc(agentIndex);
    scene?.startChat(agentIndex);
  };


  return (
    <div className="absolute inset-0 pointer-events-none z-10 overflow-hidden select-none">
      {/* Persistent workmate action bubbles */}
      {npcAgents.map((agent) => {
        const pos = npcScreenPositions[agent.index];
        const action = getAgentActionBubble(
          agent.index,
          system.leadAgent.index,
          tasks,
          phase,
          activeOperation,
          agentCheckIns[agent.index],
        );
        if (!pos || !action || selectedNpcIndex === agent.index) return null;
        const toneClass = {
          working: 'border-violet-200 bg-violet-50 text-violet-900',
          question: 'border-amber-200 bg-amber-50 text-amber-900',
          queued: 'border-zinc-200 bg-white text-zinc-600',
          done: 'border-emerald-200 bg-emerald-50 text-emerald-900',
        }[action.tone];
        return (
          <button
            key={`action-${agent.index}`}
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              setAgentCheckIn(agent.index, null);
              openWorkmateChat(agent.index);
            }}
            className={`pointer-events-auto absolute z-20 flex max-w-[220px] items-start gap-2 rounded-2xl rounded-bl-sm border px-3 py-2 text-left shadow-lg backdrop-blur-md transition hover:-translate-y-0.5 ${toneClass}`}
            style={{ left: pos.x, top: pos.y, transform: 'translate(-50%, -100%) translateY(-14px)' }}
            title={`Talk to ${agent.name}`}
          >
            {action.tone === 'working'
              ? <Loader2 size={12} className="mt-0.5 shrink-0 animate-spin" />
              : <MessageCircleQuestion size={12} className="mt-0.5 shrink-0" />}
            <span className="line-clamp-2 text-[10px] font-bold leading-snug">{action.text}</span>
          </button>
        );
      })}

      {/* 1. Parallel Alert Bubbles System */}
      {npcAgents.map((agent) => {
        const pos = npcScreenPositions[agent.index];
        if (!pos) return null;
        if (getAgentActionBubble(
          agent.index,
          system.leadAgent.index,
          tasks,
          phase,
          activeOperation,
          agentCheckIns[agent.index],
        )) return null;

        // Condition: Alert disappears when hovered
        const isCurrentlyHovered = hoveredNpcIndex === agent.index || selectedNpcIndex === agent.index;
        if (isCurrentlyHovered) return null;

        let alertIcon: React.ReactNode = null;
        let alertColor = '#facc15'; // Default yellow

        // Check specific conditions
        // - Lead Agent (index 1) idle: siren
        if (agent.index === system.leadAgent.index && isGeneratingAsset) {
          alertIcon = <Loader2 size={18} className="animate-spin" />;
          alertColor = '#818cf8'; // Indigo-400
        }
        else if (agent.index === system.leadAgent.index && phase === 'idle') {
          alertIcon = <Siren size={18} />;
          alertColor = '#ffffff'; // White for siren
        }
        // - Lead Agent (index 1) project finished: party-popper
        else if (agent.index === system.leadAgent.index && phase === 'done') {
          alertIcon = <PartyPopper size={18} />;
          alertColor = '#facc15'; // Yellow
        }
        // - Any agent waiting for USER approval (target 0): message-square-warning
        else {
          const pendingTask = tasks.find(t => 
            t.status === 'on_hold' && 
            t.assignedAgentId === agent.index
          );
          if (pendingTask) {
            alertIcon = <MessageSquareWarning size={18} />;
            alertColor = USER_COLOR;
          }
        }

        if (!alertIcon) return null;

        return (
          <AlertBubble
            key={`alert-${agent.index}`}
            icon={alertIcon}
            position={pos}
            visible={true}
            color={alertColor}
            onClick={() => openWorkmateChat(agent.index)}
          />
        );
      })}

      {/* 2. Selection/Hover/Project Ready Bubble (Detailed) */}
      {(() => {
        // Priority 1: Selected Agent
        if (selectedAgent && selectedPosition) {
          const isLeadAgentProjectReady = selectedAgent.index === system.leadAgent.index && phase === 'done';
          const label = getAgentPhaseLabel(selectedAgent.index, system.leadAgent.index, tasks, phase, isGeneratingAsset, '');

          return (
            <div
              className="absolute z-25 pointer-events-none transition-all duration-75 ease-out"
              style={{
                left: selectedPosition.x,
                top: selectedPosition.y,
                transform: 'translate(-50%, -100%) translateY(-10px)'
              }}
            >
              <div className="bg-darkDelegation/90 backdrop-blur-md px-3 py-1.5 rounded-full border border-white/10 shadow-xl flex items-center gap-2 whitespace-nowrap animate-in fade-in zoom-in-95 duration-200">
                <div
                  className="w-2 h-2 rounded-full shrink-0"
                  style={{ backgroundColor: selectedAgent.color }}
                />
                <div className="flex items-center gap-1.5">
                  {selectedAgent.index === system.user.index ? (

                    <span className="text-[10px] font-black uppercase tracking-widest text-white">{selectedAgent.name} (You)</span>
                  ) : isLeadAgentProjectReady ? (
                    <span className={`text-[10px] font-black uppercase tracking-widest ${label.className}`}>
                      {label.text}
                    </span>
                  ) : (
                    <>
                      <span className="text-[10px] font-black uppercase tracking-widest text-white">
                        {selectedAgent.name}
                      </span>
                      {label.text && (
                        <>
                          <span className="text-[10px] font-medium uppercase tracking-widest text-white/40">·</span>
                          <span className={`text-[10px] font-bold uppercase tracking-widest ${label.className}`}>
                            {label.text}
                          </span>
                        </>
                      )}
                    </>
                  )}
                </div>
              </div>
            </div>
          );
        }

        // Priority 2: Hovered Agent with dynamic phase label (only if not selected)
        if (hoveredAgent && hoverPosition && hoveredNpcIndex !== selectedNpcIndex) {
          const isLeadAgentProjectReady = hoveredAgent.index === system.leadAgent.index && phase === 'done';
          const label = getAgentPhaseLabel(hoveredAgent.index, system.leadAgent.index, tasks, phase, isGeneratingAsset, '');

          return (
            <div
              className="absolute z-25 pointer-events-none transition-all duration-75 ease-out"
              style={{
                left: hoverPosition.x,
                top: hoverPosition.y,
                transform: 'translate(-50%, -100%) translateY(-10px)'
              }}
            >
              <div className="bg-darkDelegation/90 backdrop-blur-md px-3 py-1.5 rounded-full border border-white/10 shadow-xl flex items-center gap-2 whitespace-nowrap animate-in fade-in zoom-in-95 duration-200">
                <div
                  className="w-2 h-2 rounded-full shrink-0"
                  style={{ backgroundColor: hoveredAgent.color }}
                />
                <div className="flex items-center gap-1.5">
                  {hoveredAgent.index === system.user.index ? (

                    <span className="text-[10px] font-black uppercase tracking-widest text-white">{hoveredAgent.name} (You)</span>
                  ) : isLeadAgentProjectReady ? (
                    <span className={`text-[10px] font-black uppercase tracking-widest ${label.className}`}>
                      {label.text}
                    </span>
                  ) : (
                    <>
                      <span className="text-[10px] font-black uppercase tracking-widest text-white">
                        {hoveredAgent.name}
                      </span>
                      {label.text && (
                        <>
                          <span className="text-[10px] font-medium uppercase tracking-widest text-white/40">·</span>
                          <span className={`text-[10px] font-bold uppercase tracking-widest ${label.className}`}>
                            {label.text}
                          </span>
                        </>
                      )}
                    </>
                  )}
                </div>
              </div>
            </div>
          );
        }

        return null;
      })()}

      {/* POI Hover Bubble */}
      {hoveredPoiLabel && hoverPosition && (
        <div
          className="absolute z-10 pointer-events-none transition-all duration-75 ease-out"
          style={{
            left: hoverPosition.x,
            top: hoverPosition.y,
            transform: 'translate(-50%, -100%) translateY(-10px)'
          }}
        >
          <div className="bg-darkDelegation/90 backdrop-blur-md px-3 py-1.5 rounded-full border border-white/10 shadow-xl flex items-center gap-2 whitespace-nowrap animate-in fade-in zoom-in-95 duration-200">
            <span className="text-[10px] font-black uppercase tracking-widest text-white">{hoveredPoiLabel}</span>
          </div>
        </div>
      )}

      {/* Help Modal */}
      {isHelpOpen && <InfoModal onClose={() => setHelpOpen(false)} />}
    </div>
  );
};

export default UIOverlay;
