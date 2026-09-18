import { ManhwaPanel, useCoreStore } from '../../integration/store/coreStore';
import { buildManhwaPanelPrompt } from './comfyScenePrompt';

function clean(value: unknown): string {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

export function latestSpecialistOutput(agentId: number): string {
  const tasks = useCoreStore.getState().tasks;
  return (
    [...tasks].reverse().find(
      (task) => Number(task.assignedAgentId) === agentId && task.output,
    )?.output || ''
  );
}

export function panelSection(text: string, number: number): string {
  const pattern = new RegExp(
    `(?:<\\s*Panel\\s+${number}\\s*>|#{0,4}\\s*Panel\\s+${number}\\b)([\\s\\S]*?)(?=<\\s*Panel\\s+${number + 1}\\s*>|#{0,4}\\s*Panel\\s+${number + 1}\\b|$)`,
    'i',
  );
  return String(text.match(pattern)?.[1] || '').trim();
}

function labelled(section: string, label: string): string {
  const match = section.match(new RegExp(`${label}\\s*:\\s*([^\\n]+)`, 'i'));
  return clean(match?.[1]);
}

function stripImageTextInstructions(text: string): string {
  return clean(
    text
      .replace(/\b(speech|dialogue|balloon|caption|sfx|lettering|watermark)[^.]*\.?/gi, ' ')
      .replace(/\s{2,}/g, ' '),
  );
}

export function nextPanelNumber(): number {
  const panels = useCoreStore.getState().manhwaProject?.panels || [];
  return panels.reduce((max, panel) => Math.max(max, panel.number), 0) + 1;
}

export function batchStartNumber(): number {
  const panels = useCoreStore.getState().manhwaProject?.panels || [];
  if (panels.length === 0) return 1;
  const lastBatchStart = Math.floor((panels.at(-1)!.number - 1) / 6) * 6 + 1;
  const countInBatch = panels.filter((panel) => panel.number >= lastBatchStart).length;
  return countInBatch >= 6 ? lastBatchStart + 6 : lastBatchStart;
}

export function panelsInCurrentBatch(): number {
  const start = batchStartNumber();
  return useCoreStore.getState().manhwaProject?.panels.filter((panel) => panel.number >= start).length || 0;
}

export function allCharactersLocked(): boolean {
  const characters = useCoreStore.getState().manhwaProject?.characters || [];
  return characters.length > 0 && characters.every((character) => character.locked);
}

export function canPlanNextPanel(): boolean {
  if (!allCharactersLocked()) return false;
  if (panelsInCurrentBatch() >= 6) return false;
  const project = useCoreStore.getState().manhwaProject;
  if (!project) return false;
  const next = nextPanelNumber();
  if (project.panels.some((panel) => panel.number === next)) return false;
  if (next === batchStartNumber()) return true;
  const previous = project.panels.find((panel) => panel.number === next - 1);
  return Boolean(previous?.imagePrompt);
}

export function buildSceneImagePrompt(input: {
  panelNumber: number;
  shot: string;
  visual: string;
  characters: { name: string; visualDescription: string }[];
  previousVisual?: string;
  premise?: string;
}): string {
  return buildManhwaPanelPrompt(input);
}

export function planManhwaPanel(panelNumber: number): ManhwaPanel {
  const store = useCoreStore.getState();
  const project = store.manhwaProject;
  if (!project) throw new Error('No Manhwa project is loaded');

  const storyboardWork = latestSpecialistOutput(5);
  const scriptWork = latestSpecialistOutput(4);
  const storyboard = panelSection(storyboardWork, panelNumber);
  const script = panelSection(scriptWork, panelNumber);
  const previousPanel = project.panels
    .filter((panel) => panel.number < panelNumber)
    .sort((a, b) => b.number - a.number)[0];

  const visual =
    labelled(storyboard, 'Text-free visual prompt') ||
    labelled(storyboard, 'Visual') ||
    labelled(storyboard, 'Action') ||
    labelled(script, 'Visual') ||
    stripImageTextInstructions(storyboard) ||
    stripImageTextInstructions(script) ||
    `The protagonist continues the story in a new visible action beat for panel ${panelNumber}. ${clean(store.userBrief).slice(0, 180)}`;

  const shot =
    labelled(storyboard, 'Framing') ||
    labelled(storyboard, 'Shot') ||
    ['Wide establishing shot', 'Medium character shot', 'Close-up reaction', 'Over-shoulder action shot', 'Dynamic low-angle action', 'Wide aftermath shot'][
      (panelNumber - 1) % 6
    ];

  const dialogue = labelled(script, 'Dialogue') || labelled(script, 'Speech');
  const dialogueMatch = dialogue.match(/^([^:]{1,40}):\s*(.+)$/);
  const caption = labelled(script, 'Caption');
  const sfx = labelled(script, 'SFX');

  const defaultCharacterId = project.characters[0]?.id || 'mc';
  const panelCharacters = project.characters.filter(
    (character) => character.id === defaultCharacterId || panelNumber === 1,
  );

  const imagePrompt = buildSceneImagePrompt({
    panelNumber,
    shot,
    visual: stripImageTextInstructions(visual),
    characters: panelCharacters.map((character) => ({
      name: character.name,
      visualDescription: character.visualDescription,
    })),
    previousVisual: previousPanel?.visual,
    premise: project.premise || store.userBrief,
  });

  return {
    number: panelNumber,
    visual: stripImageTextInstructions(visual),
    shot,
    characterIds: [defaultCharacterId],
    balloons: dialogue && !/^none$/i.test(dialogue)
      ? [{
          speaker: dialogueMatch?.[1] || 'MC',
          text: dialogueMatch?.[2] || dialogue,
          position: 'manual placement',
        }]
      : [],
    captions: caption && !/^none$/i.test(caption) ? [caption] : [],
    sfx: sfx && !/^none$/i.test(sfx) ? [sfx] : [],
    imagePrompt,
    generationStatus: 'idle',
  };
}

export function upsertPlannedPanel(panel: ManhwaPanel): void {
  useCoreStore.setState((state) => {
    if (!state.manhwaProject) return state;
    const panels = [
      ...state.manhwaProject.panels.filter((item) => item.number !== panel.number),
      panel,
    ].sort((a, b) => a.number - b.number);
    return {
      manhwaProject: {
        ...state.manhwaProject,
        panels,
      },
    };
  });
}

export function planNextManhwaPanel(): ManhwaPanel {
  if (!canPlanNextPanel()) {
    throw new Error('Lock all characters and finish the previous panel before planning the next scene.');
  }
  const panel = planManhwaPanel(nextPanelNumber());
  upsertPlannedPanel(panel);
  return panel;
}
