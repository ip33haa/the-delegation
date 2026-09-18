import { USER_COLOR } from '../theme/brand';
import { DEFAULT_MODELS, resolveTextModel, resolveImageOutputModel, resolveVideoOutputModel, IMAGE_TEAM_TEXT_MODEL, MANHWA_TEXT_MODEL } from '../core/llm/constants';

export const USER_ID = 'user';
export const USER_NAME = 'User';
export const MAX_AGENTS = 5;
export { USER_COLOR };
export const DEFAULT_AGENTIC_SET_ID = 'manhwa-studio';
export interface AgentNode {
  id: string;
  index: number;
  name: string;
  description: string;
  color: string;
  model: string;
  humanInTheLoop?: boolean;
  position?: { x: number; y: number };
  subagents?: AgentNode[];
}

export type OutputType = 'text' | 'image' | 'music' | 'video';
export interface AgenticSystem {
  id: string;
  teamName: string;
  teamType: string;
  teamDescription: string;
  color: string;
  outputType: OutputType;
  outputModel: string;
  panelImageModel?: string;
  outputAutoApprove?: boolean;
  user: {
    index: number;
    model: string;
    position?: { x: number; y: number };
  };
  leadAgent: AgentNode;
}

export const AGENTIC_SETS: AgenticSystem[] = [
  {
    id: 'manhwa-studio',
    teamName: 'Manhwa Studio',
    teamType: 'Story Production',
    teamDescription:
      'A complete vertical-scroll manhwa writing room for story structure, character continuity, dialogue, storyboards, and Nano Banana panel prompts for ComfyUI.',
    color: '#8B5CF6',
    outputType: 'text',
    outputModel: MANHWA_TEXT_MODEL,
    outputAutoApprove: true,
    user: { index: 0, model: 'Human', position: { x: 0, y: 0 } },
    leadAgent: {
      id: 'manhwa-chapter-editor',
      index: 1,
      name: 'Chapter Editor',
      description:
        'Leads the manhwa room, protects tone and continuity, and synthesizes all specialist work into one production-ready Markdown chapter package.',
      color: '#8B5CF6',
      model: MANHWA_TEXT_MODEL,
      humanInTheLoop: false,
      position: { x: 0, y: 130 },
      subagents: [
        {
          id: 'manhwa-story-architect',
          index: 2,
          name: 'Story Architect',
          description:
            'Designs the chapter objective, dramatic conflict, beat progression, reveal, climax, emotional turn, and end hook without writing the final panel script.',
          color: '#A78BFA',
          model: MANHWA_TEXT_MODEL,
          humanInTheLoop: false,
          position: { x: -450, y: 280 },
        },
        {
          id: 'manhwa-character-world-designer',
          index: 3,
          name: 'Character & World Designer',
          description:
            'Creates compact character and location continuity sheets with stable visual identifiers, relationships, motivations, wardrobe, props, and world rules.',
          color: '#C084FC',
          model: MANHWA_TEXT_MODEL,
          humanInTheLoop: false,
          position: { x: -150, y: 280 },
        },
        {
          id: 'manhwa-scriptwriter',
          index: 4,
          name: 'Scriptwriter',
          description:
            'Writes scene action, natural dialogue, captions, internal monologue, and sound effects while preserving the requested genre, tone, and rating.',
          color: '#E879F9',
          model: MANHWA_TEXT_MODEL,
          humanInTheLoop: false,
          position: { x: 150, y: 280 },
        },
        {
          id: 'manhwa-storyboard-director',
          index: 5,
          name: 'Storyboard Director',
          description:
            'Plans vertical-scroll pacing, panel composition, camera language, transitions, reveal spacing, and concise generation-ready visual prompts.',
          color: '#F0ABFC',
          model: MANHWA_TEXT_MODEL,
          humanInTheLoop: false,
          position: { x: 450, y: 280 },
        },
      ],
    },
  },
  {
    id: 'developer-studio',
    teamName: 'Developer Studio',
    teamType: 'Software Engineering',
    teamDescription:
      'A full-stack product team focused on React, Node.js, Tailwind CSS, shadcn/ui, and Vite.',
    color: '#0EA5E9',
    outputType: 'text',
    outputModel: DEFAULT_MODELS.text,
    outputAutoApprove: true,
    user: { index: 0, model: 'Human', position: { x: 0, y: 0 } },
    leadAgent: {
      id: 'developer-technical-lead',
      index: 1,
      name: 'Technical Lead',
      description:
        'Turns product requirements into a coherent implementation package and reconciles frontend, backend, design-system, build, testing, and deployment decisions.',
      color: '#0EA5E9',
      model: IMAGE_TEAM_TEXT_MODEL,
      humanInTheLoop: false,
      position: { x: 0, y: 130 },
      subagents: [
        {
          id: 'developer-react-architect',
          index: 2,
          name: 'React Architect',
          description:
            'Designs React component architecture, hooks, state, routing, accessibility, data flow, and TypeScript interfaces.',
          color: '#38BDF8',
          model: IMAGE_TEAM_TEXT_MODEL,
          humanInTheLoop: false,
          position: { x: -450, y: 280 },
        },
        {
          id: 'developer-node-engineer',
          index: 3,
          name: 'Node.js Engineer',
          description:
            'Designs Node.js services, APIs, validation, persistence, authentication, security boundaries, and error handling.',
          color: '#22C55E',
          model: IMAGE_TEAM_TEXT_MODEL,
          humanInTheLoop: false,
          position: { x: -150, y: 280 },
        },
        {
          id: 'developer-ui-engineer',
          index: 4,
          name: 'Tailwind & shadcn Engineer',
          description:
            'Defines responsive Tailwind CSS layout, shadcn/ui components, design tokens, interaction states, accessibility, and reusable UI patterns.',
          color: '#A855F7',
          model: IMAGE_TEAM_TEXT_MODEL,
          humanInTheLoop: false,
          position: { x: 150, y: 280 },
        },
        {
          id: 'developer-vite-qa-engineer',
          index: 5,
          name: 'Vite & QA Engineer',
          description:
            'Owns Vite configuration, environment handling, performance, tests, linting, build validation, deployment, and implementation risks.',
          color: '#F59E0B',
          model: IMAGE_TEAM_TEXT_MODEL,
          humanInTheLoop: false,
          position: { x: 450, y: 280 },
        },
      ],
    },
  },
  {
    id: 'social-creative-studio',
    teamName: 'Social Creative Studio',
    teamType: 'Social Media Creative',
    teamDescription:
      'Creates platform-ready social media artwork with campaign strategy, concise copy, composition, and brand-safe visual direction.',
    color: '#EC4899',
    outputType: 'image',
    outputModel: DEFAULT_MODELS.image,
    outputAutoApprove: true,
    user: { index: 0, model: 'Human', position: { x: 0, y: 0 } },
    leadAgent: {
      id: 'social-creative-director',
      index: 1,
      name: 'Social Creative Director',
      description:
        'Synthesizes platform strategy, campaign copy, layout, and visual style into one generation-ready social media creative.',
      color: '#EC4899',
      model: IMAGE_TEAM_TEXT_MODEL,
      humanInTheLoop: false,
      position: { x: 0, y: 130 },
      subagents: [
        {
          id: 'social-content-strategist',
          index: 2,
          name: 'Social Strategist',
          description:
            'Defines platform, audience, objective, content angle, format, safe zones, and conversion intent from the brief.',
          color: '#F472B6',
          model: IMAGE_TEAM_TEXT_MODEL,
          humanInTheLoop: false,
          position: { x: -300, y: 280 },
        },
        {
          id: 'social-copywriter',
          index: 3,
          name: 'Social Copywriter',
          description:
            'Writes one short on-image headline, optional supporting line, CTA, and an accompanying post caption without clutter.',
          color: '#FB7185',
          model: IMAGE_TEAM_TEXT_MODEL,
          humanInTheLoop: false,
          position: { x: 0, y: 280 },
        },
        {
          id: 'social-visual-designer',
          index: 4,
          name: 'Social Visual Designer',
          description:
            'Defines scroll-stopping composition, subject placement, typography hierarchy, color, lighting, brand cues, and mobile readability.',
          color: '#C084FC',
          model: IMAGE_TEAM_TEXT_MODEL,
          humanInTheLoop: false,
          position: { x: 300, y: 280 },
        },
      ],
    },
  },
  {
    id: 'website-banner-studio',
    teamName: 'Website Banner Studio',
    teamType: 'Web Creative',
    teamDescription:
      'Creates responsive website hero and campaign banner artwork with conversion-focused copy, composition, brand direction, and UI-safe negative space.',
    color: '#14B8A6',
    outputType: 'image',
    outputModel: DEFAULT_MODELS.image,
    outputAutoApprove: true,
    user: { index: 0, model: 'Human', position: { x: 0, y: 0 } },
    leadAgent: {
      id: 'banner-creative-director',
      index: 1,
      name: 'Banner Creative Director',
      description:
        'Synthesizes brand strategy, conversion copy, responsive layout, and visual styling into one generation-ready website banner.',
      color: '#14B8A6',
      model: IMAGE_TEAM_TEXT_MODEL,
      humanInTheLoop: false,
      position: { x: 0, y: 130 },
      subagents: [
        {
          id: 'banner-brand-strategist',
          index: 2,
          name: 'Brand Strategist',
          description:
            'Defines audience, value proposition, brand personality, campaign objective, credibility cues, and visual constraints.',
          color: '#2DD4BF',
          model: IMAGE_TEAM_TEXT_MODEL,
          humanInTheLoop: false,
          position: { x: -450, y: 280 },
        },
        {
          id: 'banner-ux-copywriter',
          index: 3,
          name: 'UX Copywriter',
          description:
            'Writes a concise hero headline, supporting line, and CTA suited to the user intent and available banner space.',
          color: '#34D399',
          model: IMAGE_TEAM_TEXT_MODEL,
          humanInTheLoop: false,
          position: { x: -150, y: 280 },
        },
        {
          id: 'banner-layout-designer',
          index: 4,
          name: 'Banner Layout Designer',
          description:
            'Plans responsive subject placement, text-safe negative space, focal hierarchy, crop behavior, grid alignment, and CTA zone.',
          color: '#60A5FA',
          model: IMAGE_TEAM_TEXT_MODEL,
          humanInTheLoop: false,
          position: { x: 150, y: 280 },
        },
        {
          id: 'banner-visual-stylist',
          index: 5,
          name: 'Banner Visual Stylist',
          description:
            'Defines imagery, art direction, palette, lighting, materials, depth, brand consistency, and polished web-ready finish.',
          color: '#818CF8',
          model: IMAGE_TEAM_TEXT_MODEL,
          humanInTheLoop: false,
          position: { x: 450, y: 280 },
        },
      ],
    },
  },
  {
    id: 'logo-design-studio',
    teamName: 'Logo Design Studio',
    teamType: 'Brand Identity',
    teamDescription:
      'Designs brand-ready logo concepts with identity strategy, mark symbolism, typography lockup, and a generation-ready square logo prompt.',
    color: '#F59E0B',
    outputType: 'image',
    outputModel: DEFAULT_MODELS.image,
    outputAutoApprove: true,
    user: { index: 0, model: 'Human', position: { x: 0, y: 0 } },
    leadAgent: {
      id: 'logo-creative-director',
      index: 1,
      name: 'Logo Creative Director',
      description:
        'Synthesizes brand strategy, mark concept, and typography into one clean generation-ready logo prompt.',
      color: '#F59E0B',
      model: IMAGE_TEAM_TEXT_MODEL,
      humanInTheLoop: false,
      position: { x: 0, y: 130 },
      subagents: [
        {
          id: 'logo-brand-identity-strategist',
          index: 2,
          name: 'Brand Identity Strategist',
          description:
            'Defines brand personality, audience, values, competitive positioning, and non-negotiable visual constraints from the brief.',
          color: '#FBBF24',
          model: IMAGE_TEAM_TEXT_MODEL,
          humanInTheLoop: false,
          position: { x: -300, y: 280 },
        },
        {
          id: 'logo-mark-designer',
          index: 3,
          name: 'Mark Designer',
          description:
            'Designs the symbol or icon concept: shape language, metaphor, silhouette clarity, and scalability at small sizes.',
          color: '#F97316',
          model: IMAGE_TEAM_TEXT_MODEL,
          humanInTheLoop: false,
          position: { x: 0, y: 280 },
        },
        {
          id: 'logo-typography-designer',
          index: 4,
          name: 'Typography Designer',
          description:
            'Defines wordmark letterforms, type style, letter spacing, mark-to-type lockup, and exact brand-name lettering.',
          color: '#EA580C',
          model: IMAGE_TEAM_TEXT_MODEL,
          humanInTheLoop: false,
          position: { x: 300, y: 280 },
        },
      ],
    },
  },
  {
    id: 'video-studio',
    teamName: 'Video Studio',
    teamType: 'Motion Creative',
    teamDescription:
      'Creates short motion clips with concept direction, camera/motion design, and shot listing — Veo when keyed, otherwise local Wan 2.2 TI2V-5B via ComfyUI.',
    color: '#EF4444',
    outputType: 'video',
    outputModel: DEFAULT_MODELS.video,
    outputAutoApprove: true,
    user: { index: 0, model: 'Human', position: { x: 0, y: 0 } },
    leadAgent: {
      id: 'video-creative-director',
      index: 1,
      name: 'Video Creative Director',
      description:
        'Synthesizes concept, motion, and shot list into one generation-ready video prompt with camera moves and duration cues.',
      color: '#EF4444',
      model: IMAGE_TEAM_TEXT_MODEL,
      humanInTheLoop: false,
      position: { x: 0, y: 130 },
      subagents: [
        {
          id: 'video-concept-director',
          index: 2,
          name: 'Concept Director',
          description:
            'Defines story beat, subject, mood, brand fit, and what must remain consistent across the short clip.',
          color: '#F87171',
          model: IMAGE_TEAM_TEXT_MODEL,
          humanInTheLoop: false,
          position: { x: -300, y: 280 },
        },
        {
          id: 'video-motion-designer',
          index: 3,
          name: 'Motion Designer',
          description:
            'Defines camera move, pacing, subject motion, transitions, and physical plausibility for a 3–5 second clip.',
          color: '#FB7185',
          model: IMAGE_TEAM_TEXT_MODEL,
          humanInTheLoop: false,
          position: { x: 0, y: 280 },
        },
        {
          id: 'video-shot-lister',
          index: 4,
          name: 'Shot Lister',
          description:
            'Writes a concise shot list with framing, timing, and on-screen action suitable for text-to-video prompting.',
          color: '#F43F5E',
          model: IMAGE_TEAM_TEXT_MODEL,
          humanInTheLoop: false,
          position: { x: 300, y: 280 },
        },
      ],
    },
  },
];

export function getAgentSet(id: string, customSystems: AgenticSystem[] = []): AgenticSystem {
  const predefined = AGENTIC_SETS.find((s) => s.id === id) || AGENTIC_SETS[0];
  const custom = customSystems.find((s) => s.id === id);
  const system = custom || predefined;
  const remapNode = (node: AgentNode): AgentNode => ({
    ...node,
    model: resolveTextModel(node.model),
    subagents: node.subagents?.map(remapNode),
  });
  const remapped = {
    ...system,
    leadAgent: remapNode(system.leadAgent),
  };
  if (predefined.outputType === 'image' || remapped.outputType === 'image') {
    const applyImageTeamDefaults = (node: AgentNode): AgentNode => ({
      ...node,
      model: IMAGE_TEAM_TEXT_MODEL,
      humanInTheLoop: false,
      subagents: node.subagents?.map(applyImageTeamDefaults),
    });
    return {
      ...remapped,
      outputType: 'image',
      outputModel: resolveImageOutputModel(remapped.id),
      outputAutoApprove: true,
      leadAgent: applyImageTeamDefaults(remapped.leadAgent),
    };
  }
  if (predefined.outputType === 'video' || remapped.outputType === 'video') {
    const applyVideoTeamDefaults = (node: AgentNode): AgentNode => ({
      ...node,
      model: IMAGE_TEAM_TEXT_MODEL,
      humanInTheLoop: false,
      subagents: node.subagents?.map(applyVideoTeamDefaults),
    });
    return {
      ...remapped,
      outputType: 'video',
      outputModel: resolveVideoOutputModel(remapped.id),
      outputAutoApprove: true,
      leadAgent: applyVideoTeamDefaults(remapped.leadAgent),
    };
  }
  return remapped;
}

export function getAllAgents(system: AgenticSystem): AgentNode[] {
  const agents: AgentNode[] = [];
  const traverse = (node: AgentNode) => {
    agents.push(node);
    if (node.subagents) {
      node.subagents.forEach(traverse);
    }
  };
  traverse(system.leadAgent);
  return agents;
}

export function getAllCharacters(system: AgenticSystem): AgentNode[] {
  const userNode: AgentNode = {
    id: USER_ID,
    index: system.user.index,
    name: USER_NAME,
    color: USER_COLOR,
    model: system.user.model,
    description: 'Human user issuing commands.',
  };
  return [userNode, ...getAllAgents(system)];
}
