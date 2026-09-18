import { ClipboardPlus, Send, X } from 'lucide-react';
import React, { useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { getAgentSet, getAllAgents } from '../data/agents';
import { USER_COLOR, USER_COLOR_LIGHT, USER_COLOR_SOFT } from '../theme/brand';
import { useCoreStore } from '../integration/store/coreStore';
import { useTeamStore, useActiveTeam } from '../integration/store/teamStore';
import { useUiStore } from '../integration/store/uiStore';
import { useSceneManager } from '../simulation/SceneContext';
import { Avatar } from './components/Avatar';
import { AuditModal } from './AuditModal';
import { FileSearch } from 'lucide-react';
import { scheduleProjectSave } from '../core/persistence/coordinator';

const ChatPanel: React.FC = () => {
  const {
    isChatting,
    isThinking,
    selectedNpcIndex,
    setIsTyping,
    setActiveAuditTaskId
  } = useUiStore();
  const scene = useSceneManager();
  const activeTeam = useActiveTeam();
  const agents = getAllAgents(activeTeam);
  const selectedAgentSetId = activeTeam.id;

  const [input, setInput] = useState('');
  const [isAssigning, setIsAssigning] = useState(false);
  const [taskTitle, setTaskTitle] = useState('');
  const [taskDetails, setTaskDetails] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const typingIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const stopTypingTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const agent = selectedNpcIndex !== null ? agents.find(a => a.index === selectedNpcIndex) ?? null : null;

  // Combine store messages with project histories if needed,
  // but unified useCoreStore is the source of truth for history.
  const coreStore = useCoreStore();
  const chatMessages = selectedNpcIndex !== null
    ? (coreStore.agentHistories[selectedNpcIndex] || [])
    : [];


  useEffect(() => {
    return () => {
      if (typingIntervalRef.current) clearInterval(typingIntervalRef.current);
      if (stopTypingTimeoutRef.current) clearTimeout(stopTypingTimeoutRef.current);
    };
  }, []);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [chatMessages, isThinking, isChatting]);

  useEffect(() => {
    // Initial scroll when chat opens
    if (isChatting && scrollRef.current) {
      setTimeout(() => {
        if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
      }, 100);
    }
  }, [isChatting]);

  const simulateTyping = (text: string) => {
    let currentIndex = 0;
    if (typingIntervalRef.current) clearInterval(typingIntervalRef.current);

    setIsTyping(true);

    typingIntervalRef.current = setInterval(() => {
      if (currentIndex < text.length) {
        const char = text[currentIndex];
        setInput((prev) => prev + char);
        currentIndex++;
      } else {
        if (typingIntervalRef.current) clearInterval(typingIntervalRef.current);
        setIsTyping(false);
      }
    }, 20); // 20ms per character for a natural feel
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    e.preventDefault();
    const pastedText = e.clipboardData.getData('text');
    // simulateTyping(pastedText);
    setInput(pastedText);
  };

  const handleSend = async () => {
    if (!input.trim() || isThinking) return;
    if (typingIntervalRef.current) clearInterval(typingIntervalRef.current);
    if (stopTypingTimeoutRef.current) clearTimeout(stopTypingTimeoutRef.current);
    setIsTyping(false);

    const text = input;
    setInput('');
    await scene?.sendMessage(text);
  };

  const assignManualTask = () => {
    if (!agent || !taskTitle.trim() || !taskDetails.trim()) return;
    const store = useCoreStore.getState();
    if (store.phase !== 'working') {
      useCoreStore.setState({
        phase: 'working',
        userBrief: store.userBrief || taskDetails.trim(),
        activeOperation: null,
      });
    }
    const task = useCoreStore.getState().addTask({
      title: taskTitle.trim(),
      description: taskDetails.trim(),
      assignedAgentId: agent.index,
      status: 'scheduled',
      parentTaskId: 'manual',
      requiresUserApproval: false,
    });
    useCoreStore.setState((state) => ({
      agentHistories: {
        ...state.agentHistories,
        [agent.index]: [
          ...(state.agentHistories[agent.index] || []),
          { role: 'user', content: `Manual task: **${task.title}**\n\n${task.description}` },
          { role: 'assistant', content: `Understood. I’ll handle **${task.title}** and post the result to the board.` },
        ],
      },
    }));
    setTaskTitle('');
    setTaskDetails('');
    setIsAssigning(false);
    scheduleProjectSave(true);
  };

  if (!isChatting || !agent) {
    return null;
  }

  return (
    <div className="flex flex-col h-full bg-white relative overflow-hidden shrink-0 pointer-events-auto">
      {/* Messages */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto p-1 space-y-6 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:display-none"
      >
        {chatMessages.filter(msg => !msg.metadata?.internal).map((msg, i) => (
          <div
            key={i}
            className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'}`}
          >
            <div className={`flex items-start gap-4 ${msg.role === 'user' ? 'flex-row-reverse' : 'flex-row'} max-w-[90%]`}>
              {/* Avatar / Icon */}
              <div className="shrink-0 mt-1">
                {msg.role === 'assistant' ? (
                  <Avatar type={agent?.index === activeTeam.leadAgent.index ? 'lead' : 'sub'} color={agent?.color} size={32} />
                ) : (
                  <Avatar type="user" color={USER_COLOR} size={32} />
                )}
              </div>

              <div className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
                <div
                  className={`px-4 py-2.5 rounded-[20px] text-[14px] leading-relaxed shadow-sm border ${msg.role === 'user' ? 'rounded-tr-none' : 'rounded-tl-none'
                    }`}
                  style={msg.role === 'user' ? {
                    backgroundColor: USER_COLOR_LIGHT,
                    borderColor: USER_COLOR_SOFT,
                    color: '#27272a' // text-darkDelegation
                  } : {
                    backgroundColor: '#fafafa', // bg-zinc-50
                    borderColor: '#f4f4f5', // border-zinc-100
                    color: '#27272a' // text-darkDelegation
                  }}
                >
                  {msg.role === 'assistant' ? (
                    <div className="markdown-content">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>
                        {msg.content}
                      </ReactMarkdown>

                      {msg.metadata?.reviewTaskId && (
                        <div className="mt-4 p-4 bg-white/50 rounded-2xl border border-zinc-200/50 flex flex-wrap items-center justify-between gap-3 animate-in fade-in slide-in-from-bottom-2 duration-500">
                          <div className="flex items-center gap-2 pr-2">
                            <div
                              className="p-2 rounded-xl flex-shrink-0"
                              style={{ backgroundColor: USER_COLOR_LIGHT, color: USER_COLOR }}
                            >
                              <FileSearch size={18} />
                            </div>
                            <span className="text-[10px] font-black uppercase tracking-widest text-zinc-600">
                              {coreStore.tasks.find(t => t.id === msg.metadata.reviewTaskId)?.status === 'on_hold'
                                ? 'Review Requested'
                                : 'Review Processed'}
                            </span>
                          </div>

                          {coreStore.tasks.find(t => t.id === msg.metadata.reviewTaskId)?.status === 'on_hold' && (
                            <button
                              onClick={() => setActiveAuditTaskId(msg.metadata.reviewTaskId)}
                              className="flex-1 min-w-[120px] px-4 py-2 bg-darkDelegation text-white rounded-xl text-[9px] font-black uppercase tracking-widest hover:bg-black active:scale-95 transition-all shadow-sm whitespace-nowrap"
                            >
                              Review Task
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="whitespace-pre-wrap">{msg.content}</div>
                  )}
                </div>

                <div className={`flex items-center gap-2 mt-2 px-1`}>
                  <span className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">
                    {msg.role === 'user' ? 'You' : (agent?.name?.split(' ')[0] || 'AI')}
                  </span>
                </div>
              </div>
            </div>
          </div>
        ))}

        {isThinking && (
          <div
            className="flex items-start gap-3"
          >
            <div className="w-4 h-4 text-zinc-300 animate-pulse mt-1">
              <svg viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 2L14.85 9.15L22 12L14.85 14.85L12 22L9.15 14.85L2 12L9.15 9.15L12 2Z" />
              </svg>
            </div>
            <div className="bg-zinc-50 px-4 py-3 rounded-2xl rounded-tl-none">
              <div className="flex gap-1">
                <div className="w-1.5 h-1.5 bg-zinc-300 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                <div className="w-1.5 h-1.5 bg-zinc-300 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                <div className="w-1.5 h-1.5 bg-zinc-300 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Input */}
      <div className="p-2 border-t border-zinc-50">
        {isAssigning && agent.index !== activeTeam.leadAgent.index && (
          <div className="mb-2 rounded-2xl border border-violet-200 bg-violet-50 p-3">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-[9px] font-black uppercase tracking-wider text-violet-800">
                Assign to {agent.name}
              </span>
              <button onClick={() => setIsAssigning(false)} className="text-violet-500">
                <X size={14} />
              </button>
            </div>
            <input
              value={taskTitle}
              onChange={(event) => setTaskTitle(event.target.value)}
              placeholder="Task title"
              className="mb-2 w-full rounded-xl border border-violet-200 bg-white px-3 py-2 text-xs outline-none"
            />
            <textarea
              value={taskDetails}
              onChange={(event) => setTaskDetails(event.target.value)}
              placeholder="Describe the result you need"
              rows={3}
              className="w-full resize-none rounded-xl border border-violet-200 bg-white px-3 py-2 text-xs outline-none"
            />
            <button
              onClick={assignManualTask}
              disabled={!taskTitle.trim() || !taskDetails.trim()}
              className="mt-2 w-full rounded-xl bg-violet-600 px-3 py-2 text-[9px] font-black uppercase tracking-wider text-white disabled:opacity-40"
            >
              Add to task board
            </button>
          </div>
        )}
        <div className="relative flex items-center gap-2">
          {agent.index !== activeTeam.leadAgent.index && (
            <button
              onClick={() => setIsAssigning((value) => !value)}
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-violet-200 bg-violet-50 text-violet-700 transition hover:bg-violet-100"
              title={`Assign a task to ${agent.name}`}
            >
              <ClipboardPlus size={16} />
            </button>
          )}
          <div className="flex-1 relative">
            <textarea
              value={input}
              onChange={(e) => {
                const val = e.target.value;
                setInput(val);

                // Show player talking animation while typing
                if (val.length > 0) {
                  setIsTyping(true);
                  if (stopTypingTimeoutRef.current) clearTimeout(stopTypingTimeoutRef.current);
                  stopTypingTimeoutRef.current = setTimeout(() => setIsTyping(false), 1000);
                } else {
                  setIsTyping(false);
                }
              }}
              onPaste={handlePaste}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSend();
                }
              }}
              placeholder="Message (↵ to send)"
              className="w-full bg-white border border-zinc-200 rounded-2xl px-3 py-3 text-sm focus:outline-none focus:ring-2 transition-all resize-none pr-12 [scrollbar-width:none]"
              style={{
                borderColor: input.trim() ? USER_COLOR : undefined,
                boxShadow: input.trim() ? `0 0 0 2px ${USER_COLOR_LIGHT}` : undefined
              }}
            />
          </div>
          <button
            onClick={handleSend}
            disabled={!input.trim() || isThinking}
            style={{ backgroundColor: !input.trim() || isThinking ? undefined : agent.color }}
            className={`h-11 w-11 shrink-0 rounded-2xl flex items-center justify-center font-black text-xs uppercase tracking-widest transition-all active:scale-95 ${!input.trim() || isThinking
              ? 'bg-zinc-100 text-zinc-400 cursor-not-allowed'
              : 'text-white shadow-lg hover:brightness-90'
              }`}
          >
            <Send size={16} strokeWidth={3} />
          </button>
        </div>
        <p className="text-[8px] text-zinc-400 mt-2 text-center font-medium uppercase tracking-wider">
          Shift + ↵ for new line
        </p>
      </div>
    </div>
  );
};

export default ChatPanel;
