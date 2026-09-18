import { buildNanoBananaPrompt } from '../agent/nanoBananaPrompt';
import { prepareZImagePrompt } from '../llm/providers/ComfyUIImageProvider';

interface CharacterLook {
  name: string;
  visualDescription: string;
}

function clean(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function cameraPhrase(shot: string): string {
  const normalized = shot.toLowerCase();
  if (/close/.test(normalized)) return 'Tight close-up shot with shallow depth of field';
  if (/wide|establishing/.test(normalized)) return 'Wide cinematic establishing shot';
  if (/over[- ]shoulder/.test(normalized)) return 'Over-the-shoulder shot';
  if (/low[- ]angle|low angle/.test(normalized)) return 'Dynamic low-angle action shot';
  if (/medium/.test(normalized)) return 'Medium portrait shot';
  return 'Cinematic portrait shot';
}

function appearanceProse(characters: CharacterLook[]): string {
  if (!characters.length) {
    return 'young fantasy protagonist with expressive anime-manhwa eyes, distinct hairstyle, and consistent fantasy travel outfit';
  }

  return characters
    .map((character) =>
      clean(
        character.visualDescription
          .replace(new RegExp(`^${character.name}\\s*[-–—:]\\s*`, 'i'), '')
          .replace(/[.!?]+/g, ', ')
          .replace(/,\s*,+/g, ', '),
      ),
    )
    .join(', ');
}

/** Final Nano Banana / Z-Image prompt for a manhwa panel (copy into ComfyUI). */
export function buildManhwaPanelPrompt(input: {
  shot: string;
  visual: string;
  characters: CharacterLook[];
  previousVisual?: string;
  premise?: string;
}): string {
  const styleAnchor =
    'Korean fantasy-action manhwa webtoon illustration style, anime RPG game quality';
  const subject = appearanceProse(input.characters);
  const action = clean(input.visual.replace(/^(visual|action|scene)\s*:\s*/i, ''));
  const composition = cameraPhrase(input.shot);
  const continuity = input.previousVisual
    ? `Continuing directly after the previous scene where ${clean(input.previousVisual)}, with a clearly different pose, camera angle, and background emphasis`
    : '';
  const environment = input.premise
    ? `Set within a fantasy world inspired by ${clean(input.premise).slice(0, 160)}`
    : '';

  const subjectAction = [action, continuity].filter(Boolean).join('. ');

  const raw = buildNanoBananaPrompt({
    brief: `${styleAnchor}, ${subject}`,
    subjectAction,
    location: environment,
    composition,
    style:
      'Polished line art, rich color, cinematic lighting, detailed environment, atmospheric depth, sharp focus, clean anatomy, no text, no speech bubbles, no watermark',
  });

  return prepareZImagePrompt(raw);
}

/** Final Nano Banana / Z-Image prompt for a character reference sheet. */
export function buildManhwaCharacterPrompt(name: string, visualDescription: string): string {
  const subject = appearanceProse([{ name, visualDescription: visualDescription || name }]);
  const raw = buildNanoBananaPrompt({
    brief: `${subject}, Korean fantasy-action manhwa webtoon illustration style, anime RPG game quality`,
    subjectAction:
      'Neutral full-body character turnaround reference, front three-quarter view, plain uncluttered background, soft even lighting',
    style: 'Polished line art, sharp focus, no text, no labels, no watermark, no speech bubbles',
  });
  return prepareZImagePrompt(raw);
}

/** @deprecated Use buildManhwaPanelPrompt */
export function buildComfyScenePrompt(input: {
  shot: string;
  visual: string;
  characters: CharacterLook[];
  previousVisual?: string;
  premise?: string;
}): string {
  return buildManhwaPanelPrompt(input);
}

/** @deprecated Use buildManhwaCharacterPrompt */
export function buildComfyCharacterPrompt(name: string, visualDescription: string): string {
  return buildManhwaCharacterPrompt(name, visualDescription);
}
