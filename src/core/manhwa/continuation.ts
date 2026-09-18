import { memoryApi } from '../persistence/api';
import { useCoreStore } from '../../integration/store/coreStore';
import { useMemoryStore } from '../../integration/store/memoryStore';

export async function continueManhwaStory(): Promise<void> {
  const core = useCoreStore.getState();
  const project = core.manhwaProject;
  if (!project) throw new Error('No Manhwa story is loaded');

  let databaseMemory: any = null;
  const storyId = useMemoryStore.getState().currentStoryId;
  if (storyId && useMemoryStore.getState().status === 'online') {
    databaseMemory = await memoryApi.storyMemory(storyId).catch(() => null);
  }

  const recentPanels = project.panels.slice(-6).map((panel) => ({
    number: panel.number,
    visual: panel.visual,
    dialogue: panel.balloons.map((balloon) => `${balloon.speaker}: ${balloon.text}`),
  }));
  const continuity = {
    story: databaseMemory?.title || project.chapterTitle,
    lockedCharacters: project.characters.map((character) => ({
      id: character.id,
      name: character.name,
      visual: character.visualDescription,
      locked: character.locked,
    })),
    previousEndHook: project.endHook,
    recentPanels,
    recentChapters: databaseMemory?.recentChapters || [],
    instruction: `Continue directly after panel ${project.panels.at(-1)?.number || 0}. Plan the next six scenes one at a time without retelling prior events or changing locked character designs.`,
  };

  core.setManhwaContinuityContext(JSON.stringify(continuity, null, 2).slice(0, 7000));
  useCoreStore.setState({
    phase: 'working',
    tasks: [],
    finalOutput: null,
    isFinalOutputOpen: false,
    assetGenerationError: null,
  });
}
