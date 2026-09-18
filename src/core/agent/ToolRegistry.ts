import { LLMMessage } from '../llm/types';
import { setUserBrief } from './tools/setUserBrief';
import { proposeTask } from './tools/proposeTask';
import { completeTask } from './tools/completeTask';
import { deliverProject } from './tools/deliverProject';
import { getActiveAgentSet } from '../../integration/store/teamStore';

export interface ToolCall {
  name: string;
  args: any;
}

/**
 * Interface that decuples the ToolRegistry from the 3D Simulation (AgentHost).
 * This allows the tool logic to be tested and used independently of the simulation.
 */
export interface AgentActionContext {
  data: { index: number; name: string, subagents?: any[], humanInTheLoop?: boolean };
  setState: (state: 'idle' | 'moving' | 'working' | 'on_hold' | 'talking') => void;
  appendHistory: (message: LLMMessage) => void;
}

export class ToolRegistry {
  /**
   * Processes a tool call by dispatching it to the appropriate tool handler.
   */
  public static process(agent: AgentActionContext, toolCall: ToolCall): boolean {
    const { name, args } = toolCall;

    switch (name) {
      case 'set_user_brief':
        return setUserBrief(agent, args);
      case 'propose_task':
        return proposeTask(agent, args);
      case 'complete_task':
        return completeTask(agent, args);
      case 'deliver_project':
        return deliverProject(agent, args);
      default:
        console.warn(`[ToolRegistry] Unknown tool: ${name}`);
        return false;
    }
  }

  public static getDefinitions(agentIndex: number, phase: string, subagentsCount: number = 0): any[] {
    const isLead = agentIndex === 1;
    const isManager = subagentsCount > 0;
    const tools: any[] = [];

    // 1. Idle Phase: Only Lead can set the brief
    if (phase === 'idle') {
      if (isLead) {
        tools.push({
          type: 'function',
          function: {
            name: 'set_user_brief',
            description: 'Start project with brief.',
            parameters: {
              type: 'object',
              properties: { brief: { type: 'string' } },
              required: ['brief']
            }
          }
        });
      }
      return tools;
    }

    // 2. Working Phase: Common tools for everyone
    if (phase === 'working') {
      if (isLead || isManager) {
        tools.push({
          type: 'function',
          function: {
            name: 'propose_task',
            description: 'Assign task to agent.',
            parameters: {
              type: 'object',
              properties: {
                title: { type: 'string' },
                description: { type: 'string' },
                agentId: { type: 'integer', description: 'Agent index' },
                requiresApproval: { type: 'boolean' }
              },
              required: ['title', 'description', 'agentId']
            }
          }
        });
      }

      tools.push(
        {
          type: 'function',
          function: {
            name: 'complete_task',
            description: 'Finish task. Output must be raw content, no introductions or credit for the work.',
            parameters: {
              type: 'object',
              properties: {
                taskId: { type: 'string' },
                output: { type: 'string', description: 'Task result in Markdown (e.g. code blocks, text, or research).' }
              },
              required: ['taskId', 'output']
            }
          }
        },
      );

      if (isLead) {
        const isManhwa = getActiveAgentSet()?.id === 'manhwa-studio';
        tools.push({
          type: 'function',
          function: {
            name: 'deliver_project',
            description: isManhwa
              ? 'Deliver the locked character bible and exactly six production-ready manhwa panels.'
              : 'Final delivery of the full project results.',
            parameters: isManhwa ? {
              type: 'object',
              properties: {
                chapterTitle: { type: 'string' },
                premise: { type: 'string' },
                endHook: { type: 'string' },
                characters: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      id: {
                        type: 'string',
                        description: 'Short stable lowercase ID used by panel characterIds, for example mc or guild_clerk.'
                      },
                      name: { type: 'string' },
                      visualDescription: {
                        type: 'string',
                        description: 'Locked face, hair, age, build, wardrobe, palette, and accessories.'
                      },
                      referencePrompt: {
                        type: 'string',
                        description: 'Text-free neutral full-body manhwa character turnaround/reference-sheet prompt.'
                      }
                    },
                    required: ['id', 'name', 'visualDescription', 'referencePrompt']
                  }
                },
                panels: {
                  type: 'array',
                  minItems: 6,
                  maxItems: 6,
                  items: {
                    type: 'object',
                    properties: {
                      number: { type: 'integer' },
                      visual: { type: 'string' },
                      shot: { type: 'string' },
                      characterIds: {
                        type: 'array',
                        items: { type: 'string' },
                        description: 'Only IDs declared in characters.'
                      },
                      balloons: {
                        type: 'array',
                        items: {
                          type: 'object',
                          properties: {
                            speaker: { type: 'string' },
                            text: { type: 'string' },
                            position: { type: 'string' }
                          },
                          required: ['speaker', 'text', 'position']
                        }
                      },
                      captions: { type: 'array', items: { type: 'string' } },
                      sfx: { type: 'array', items: { type: 'string' } },
                      imagePrompt: {
                        type: 'string',
                        description: 'One portrait manhwa panel prompt with empty balloons and absolutely no rendered text.'
                      }
                    },
                    required: [
                      'number',
                      'visual',
                      'shot',
                      'characterIds',
                      'balloons',
                      'captions',
                      'sfx',
                      'imagePrompt'
                    ]
                  }
                }
              },
              required: ['chapterTitle', 'premise', 'endHook', 'characters', 'panels']
            } : {
              type: 'object',
              properties: { 
                output: { 
                  type: 'string', 
                  description: 'Full project document in Markdown. NO attribution needed.' 
                } 
              },
              required: ['output']
            }
          }
        });
      }
    }

    return tools;
  }
}
