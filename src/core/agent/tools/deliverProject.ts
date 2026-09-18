import { AgentActionContext } from '../ToolRegistry';
import { useCoreStore } from '../../../integration/store/coreStore';
import { getActiveAgentSet } from '../../../integration/store/teamStore';
import { buildFinalImagePrompt } from '../buildFinalImagePrompt';
import { buildManhwaCharacterPrompt } from '../../manhwa/comfyScenePrompt';

function clean(value: unknown): string {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function removeScriptText(prompt: string, values: string[]): string {
  return values.reduce((result, value) => {
    if (!value) return result;
    const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return result.replace(new RegExp(escaped, 'gi'), '');
  }, prompt).replace(/\s{2,}/g, ' ').trim();
}

function arrayArg(value: unknown): any[] {
  let current = value;
  for (let attempt = 0; attempt < 2 && typeof current === 'string'; attempt++) {
    try {
      current = JSON.parse(current);
    } catch {
      return [];
    }
  }
  return Array.isArray(current) ? current : [];
}

function labelled(section: string, label: string): string {
  const match = section.match(new RegExp(`${label}\\s*:\\s*([^\\n]+)`, 'i'));
  return clean(match?.[1]);
}

function panelSection(text: string, number: number): string {
  const pattern = new RegExp(
    `(?:<\\s*Panel\\s+${number}\\s*>|#{0,4}\\s*Panel\\s+${number}\\b)([\\s\\S]*?)(?=<\\s*Panel\\s+${number + 1}\\s*>|#{0,4}\\s*Panel\\s+${number + 1}\\b|$)`,
    'i'
  );
  return String(text.match(pattern)?.[1] || '').trim();
}

function fallbackManhwaArgs(store: ReturnType<typeof useCoreStore.getState>) {
  const latestOutput = (agentId: number) =>
    [...store.tasks].reverse().find(
      (task) => Number(task.assignedAgentId) === agentId && task.output,
    )?.output || '';
  const characterWork = latestOutput(3);
  const scriptWork = latestOutput(4);
  const storyboardWork = latestOutput(5);
  const brief = clean(store.userBrief);
  const characterDescription =
    clean(characterWork).slice(0, 900) ||
    'Young adult male protagonist with short dark-brown hair, expressive brown eyes, lean build, practical earth-tone travel clothes, and a small cross-body satchel';

  const panels = Array.from({ length: 6 }, (_, index) => {
    const number = index + 1;
    const storyboard = panelSection(storyboardWork, number);
    const script = panelSection(scriptWork, number);
    const visual =
      labelled(storyboard, 'Text-free visual prompt') ||
      labelled(storyboard, 'Visual') ||
      labelled(script, 'Visual') ||
      storyboard ||
      script ||
      `The protagonist advances through beat ${number} of this scene: ${brief}`;
    const shot = labelled(storyboard, 'Framing') || labelled(storyboard, 'Shot') || 'Portrait cinematic medium shot';
    const dialogue = labelled(script, 'Dialogue') || labelled(script, 'Speech');
    const dialogueMatch = dialogue.match(/^([^:]{1,40}):\s*(.+)$/);
    const balloonPosition =
      labelled(storyboard, 'Balloon placement') ||
      labelled(storyboard, 'Balloon position') ||
      'upper safe area';
    const caption = labelled(script, 'Caption');
    const sfx = labelled(script, 'SFX');
    return {
      number,
      visual,
      shot,
      characterIds: ['mc'],
      balloons: dialogue && !/^none$/i.test(dialogue)
        ? [{
            speaker: dialogueMatch?.[1] || 'MC',
            text: dialogueMatch?.[2] || dialogue,
            position: balloonPosition,
          }]
        : [],
      captions: caption && !/^none$/i.test(caption) ? [caption] : [],
      sfx: sfx && !/^none$/i.test(sfx) ? [sfx] : [],
      imagePrompt: visual,
    };
  });

  return {
    chapterTitle: 'Chapter 1: The Otherworld Marketplace',
    premise: brief,
    endHook: 'The protagonist discovers that his impossible purchasing power can reshape this fantasy world.',
    characters: [{
      id: 'mc',
      name: 'Main Character',
      visualDescription: characterDescription,
      referencePrompt: buildManhwaCharacterPrompt('Main Character', characterDescription),
    }],
    panels,
  };
}

function manhwaMarkdown(project: NonNullable<ReturnType<typeof useCoreStore.getState>['manhwaProject']>): string {
  const lines = [
    `# ${project.chapterTitle}`,
    '',
    project.premise,
    '',
    '## Character continuity',
    ...project.characters.flatMap((character) => [
      `### ${character.name}`,
      character.visualDescription,
      `- **Nano Banana reference:** ${character.referencePrompt}`,
      '',
    ]),
    '## Panel script',
  ];

  for (const panel of project.panels) {
    lines.push(
      '',
      `### Panel ${panel.number}`,
      `- **Visual:** ${panel.visual}`,
      `- **Shot:** ${panel.shot}`,
      `- **Characters:** ${panel.characterIds.length ? panel.characterIds.join(', ') : 'None'}`,
      '- **Speech balloons:**',
      ...(panel.balloons.length
        ? panel.balloons.map(
            (balloon, index) =>
              `  ${index + 1}. ${balloon.speaker}: “${balloon.text}” — ${balloon.position}`
          )
        : ['  - None']),
      `- **Captions:** ${panel.captions.length ? panel.captions.join(' / ') : 'None'}`,
      `- **SFX:** ${panel.sfx.length ? panel.sfx.join(' / ') : 'None'}`,
      `- **Nano Banana prompt:** ${panel.imagePrompt}`,
    );
  }

  lines.push('', '## End hook', project.endHook);
  return lines.join('\n');
}

function deliverManhwa(agent: AgentActionContext, args: any): boolean {
  const store = useCoreStore.getState();
  const fallback = fallbackManhwaArgs(store);
  const rawCharacters = arrayArg(args?.characters);
  const resolvedCharacters = rawCharacters.length ? rawCharacters : fallback.characters;

  if (resolvedCharacters.length === 0) {
    agent.appendHistory({
      role: 'user',
      content: '[SYSTEM] Manhwa delivery rejected: provide a chapter title and at least one locked character bible entry.',
      metadata: { internal: true },
    });
    return false;
  }

  const existingProject = store.manhwaProject;
  const existingCharacters = new Map(
    (existingProject?.characters || []).map((character) => [character.id, character])
  );
  const incomingCharacters = resolvedCharacters.map((raw: any, index: number) => {
    const fallbackId = `character_${index + 1}`;
    const id = clean(raw?.id).toLowerCase().replace(/[^a-z0-9_-]+/g, '_') || fallbackId;
    const name = clean(raw?.name) || `Character ${index + 1}`;
    const visualDescription = clean(raw?.visualDescription);
    const referencePrompt = buildManhwaCharacterPrompt(name, visualDescription);
    const existing = existingCharacters.get(id);
    return {
      ...existing,
      id,
      name,
      visualDescription,
      referencePrompt,
      generationStatus: existing?.generationStatus || 'idle' as const,
      locked: existing?.locked || false,
    };
  });
  const incomingIds = new Set(incomingCharacters.map((character) => character.id));
  const characters = [
    ...Array.from(existingCharacters.values()).filter((character) => !incomingIds.has(character.id)),
    ...incomingCharacters,
  ];

  const project = {
    chapterTitle: existingProject?.chapterTitle || clean(args.chapterTitle) || fallback.chapterTitle,
    premise: existingProject?.premise || clean(args.premise) || fallback.premise,
    endHook: clean(args.endHook) || fallback.endHook,
    characters,
    panels: existingProject?.panels || [],
  };

  store.setManhwaProject(project);
  store.setFinalAssetType('text');
  store.setFinalOutput(manhwaMarkdown(project));
  store.setManhwaContinuityContext('');
  store.setPhase('done');
  store.setFinalOutputOpen(true);
  return true;
}

export function deliverProject(agent: AgentActionContext, args: { output?: string; [key: string]: any }): boolean {
  const store = useCoreStore.getState();
  const activeTeam = getActiveAgentSet();
  const isImage = activeTeam?.outputType === 'image';
  const output = activeTeam?.id === 'manhwa-studio'
    ? '__structured_manhwa__'
    : isImage
    ? buildFinalImagePrompt(args.output)
    : (args.output || '').trim();

  if (!output) {
    agent.appendHistory({
      role: 'user',
      content: '[SYSTEM] deliver_project was rejected: output is empty. Call deliver_project again with the complete final deliverable grounded in the user brief.',
      metadata: { internal: true },
    });
    return false;
  }

  // VALIDATION: Only the lead agent can deliver.
  if (agent.data.index !== activeTeam.leadAgent.index) {
    agent.appendHistory({
      role: 'user',
      content: '[SYSTEM] deliver_project was rejected: only the lead agent may deliver the final project.',
      metadata: { internal: true },
    });
    return false;
  }

  if (store.phase !== 'working') return false;

  // Prevent early delivery while scheduled, active, or review-held work remains.
  const pendingTasks = store.tasks.filter(t => t.status !== 'done');
  if (pendingTasks.length > 0) {
    const names = pendingTasks.map(t => t.title).join(', ');
    agent.appendHistory({
      role: 'user',
      content: `[SYSTEM] You cannot deliver the project yet. There are pending tasks: ${names}. All subagents must finish their work first.`,
      metadata: { internal: true }
    });
    return false;
  }

  if (activeTeam?.id === 'manhwa-studio') {
    const delivered = deliverManhwa(agent, args);
    if (!delivered) return false;
    store.addLogEntry({ agentIndex: agent.data.index, action: 'delivered character bible for scene-by-scene panel workflow', taskId: undefined });
    return true;
  }

  const isMultimodal = activeTeam.outputType !== 'text';

  if (isMultimodal) {
    store.setIsGeneratingAsset(true);
    store.setFinalOutput(output);
    if (activeTeam.outputType === 'image') {
      store.setFinalAssetType('image');
      store.setFinalOutputOpen(true);
    }
  } else {
    store.setFinalOutput(output);
    store.setPhase('done');
  }

  // Mark remaining active tasks for this agent as done
  store.tasks.filter(t => t.assignedAgentId === agent.data.index && t.status === 'in_progress')
    .forEach(t => store.updateTaskStatus(t.id, 'done'));

  store.addLogEntry({ agentIndex: agent.data.index, action: 'delivered final project results', taskId: undefined });

  return true;
}
