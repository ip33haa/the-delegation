/**
 * Nano Banana–style prompt utilities for local Z-Image Turbo.
 * Enforces Subject → Action → Location → Composition → Style as prose, not SD tag soup.
 */

export type ImageStyle = 'photo' | 'anime' | 'illustration' | 'generic';

export interface NanoBananaInput {
  brief: string;
  subjectAction?: string;
  location?: string;
  composition?: string;
  style?: string;
  referenceNotes?: string;
}

const SD_TAG_PATTERNS: RegExp[] = [
  /\b8k\b/gi,
  /\b4k\b/gi,
  /\b16k\b/gi,
  /\bmasterpiece\b/gi,
  /\bbest quality\b/gi,
  /\bhigh quality\b/gi,
  /\bultra[- ]?detailed\b/gi,
  /\bultra[- ]?realistic\b/gi,
  /\bhyper[- ]?realistic\b/gi,
  /\btrending on artstation\b/gi,
  /\bartstation\b/gi,
  /\bwallpaper\b/gi,
  /\bunreal engine\b/gi,
  /\boctane render\b/gi,
  /\bray tracing\b/gi,
  /\b(no blur|no artifacts|no watermark|no text|negative prompt)[^.]*/gi,
  /\([^)]*:\d+\.?\d*\)/g,
  /\[[^\]]*:\d+\.?\d*\]/g,
];

const ANIME_HINT = /\b(anime|manga|manhwa|webtoon|illustration|2d|cel[- ]?shad|cartoon|toon|rpg game)\b/i;
const PHOTO_HINT = /\b(photo|photograph|photoreal|realistic|cinematic|portrait|editorial|fashion|film|nude)\b/i;
const ILLUSTRATION_HINT = /\b(digital art|concept art|watercolor|painting|sketch|drawn)\b/i;

const SKIN_TEXTURE_HINT =
  /\b(skin texture|visible pores|not airbrushed|not waxy|natural skin|pores|matte skin)\b/i;

const PERSON_HINT =
  /\b(person|people|man|woman|boy|girl|child|adult|model|subject|face|skin|portrait|headshot|selfie|nude|fashion)\b/i;

const PHOTO_PERSON_QUALITY =
  'Photorealistic with visible skin texture and pores, not airbrushed or waxy';

const PHOTO_SCENE_QUALITY =
  'Photorealistic with physically plausible light, true-to-life materials, fine surface texture, and natural color';

const ANIME_QUALITY =
  'Clean linework, expressive eyes, rich color, soft cel shading, cinematic lighting, and polished illustration finish';

const ILLUSTRATION_QUALITY =
  'Polished illustration with coherent anatomy, rich color, and professional composition';

const GENERIC_QUALITY =
  'Highly detailed with natural proportions, sharp focus, and professional composition';

const SHORT_PROMPT_FALLBACK =
  'A striking scene with natural lighting, sharp focus, and professional composition';

function cleanLine(text: string): string {
  return text
    .replace(/^[\s*•\-–—]+/, '')
    .replace(/\s+/g, ' ')
    .replace(/[.]+$/g, '')
    .trim();
}

function ensurePeriod(text: string): string {
  const t = cleanLine(text);
  if (!t) return '';
  return /[.!?]$/.test(t) ? t : `${t}.`;
}

function normalizeForCompare(text: string): string {
  return cleanLine(text).toLowerCase();
}

function isDuplicate(candidate: string, ...existing: string[]): boolean {
  const key = normalizeForCompare(candidate);
  if (!key || key.length < 12) return false;
  return existing.some((e) => {
    const ek = normalizeForCompare(e);
    return ek === key || ek.includes(key) || key.includes(ek);
  });
}

/** Remove SD-era tag spam that hurts Qwen / Z-Image text encoding. */
export function stripSdTagSpam(text: string): string {
  let out = text || '';
  for (const pattern of SD_TAG_PATTERNS) {
    out = out.replace(pattern, ' ');
  }
  return out
    .replace(/\s*,\s*,+/g, ', ')
    .replace(/,\s*\./g, '.')
    .replace(/\s{2,}/g, ' ')
    .replace(/\.\s*\./g, '.')
    .trim();
}

export function detectStyle(text: string): ImageStyle {
  const blob = (text || '').toLowerCase();
  if (ANIME_HINT.test(blob)) return 'anime';
  if (ILLUSTRATION_HINT.test(blob)) return 'illustration';
  if (PHOTO_HINT.test(blob) || /\bbeach\b|\bportrait\b|\bfashion\b/.test(blob)) return 'photo';
  return 'generic';
}

export function getQualityClose(style: ImageStyle, subject = ''): string {
  switch (style) {
    case 'anime':
      return ANIME_QUALITY;
    case 'illustration':
      return ILLUSTRATION_QUALITY;
    case 'photo':
      return PERSON_HINT.test(subject) ? PHOTO_PERSON_QUALITY : PHOTO_SCENE_QUALITY;
    default:
      return GENERIC_QUALITY;
  }
}

/** Positive-framing realism line for photo prompts missing skin/texture language. */
export function photoRealismSuffix(prompt: string): string {
  if (detectStyle(prompt) !== 'photo') return '';
  if (!PERSON_HINT.test(prompt)) return '';
  if (SKIN_TEXTURE_HINT.test(prompt)) return '';
  return PHOTO_PERSON_QUALITY;
}

/** Text-only stand-in for reference images until ComfyUI img2img is wired. */
export function buildReferenceNotes(count: number): string {
  if (count <= 0) return '';
  if (count === 1) {
    return 'Match the person and likeness from reference image 1';
  }
  if (count === 2) {
    return 'Match the person and likeness from reference image 1; use reference image 2 for background tone and palette';
  }
  return 'Match the person and likeness from reference image 1; use reference images 2 and 3 for style, palette, and composition cues';
}

/**
 * Assemble 4–6 prose sentences in Nano Banana formula order.
 */
export function buildNanoBananaPrompt(input: NanoBananaInput): string {
  const style = detectStyle(
    [input.brief, input.style, input.composition, input.subjectAction].filter(Boolean).join(' ')
  );

  const brief = stripSdTagSpam(cleanLine(input.brief));
  const sentences: string[] = [];

  if (brief) {
    sentences.push(ensurePeriod(brief));
  }

  const subjectAction = input.subjectAction
    ? stripSdTagSpam(cleanLine(input.subjectAction))
    : '';
  if (subjectAction && !isDuplicate(subjectAction, brief)) {
    sentences.push(ensurePeriod(subjectAction));
  }

  const location = input.location ? stripSdTagSpam(cleanLine(input.location)) : '';
  if (location && !isDuplicate(location, brief, subjectAction)) {
    sentences.push(ensurePeriod(location));
  }

  const composition = input.composition ? stripSdTagSpam(cleanLine(input.composition)) : '';
  if (composition && !isDuplicate(composition, brief, subjectAction, location)) {
    sentences.push(ensurePeriod(composition));
  }

  const styleText = input.style ? stripSdTagSpam(cleanLine(input.style)) : '';
  if (
    styleText &&
    !isDuplicate(styleText, brief, subjectAction, location, composition)
  ) {
    sentences.push(ensurePeriod(styleText));
  }

  const ref = input.referenceNotes?.trim();
  if (ref && !isDuplicate(ref, ...sentences)) {
    sentences.push(ensurePeriod(ref));
  }

  const quality = getQualityClose(style, input.brief);
  if (!isDuplicate(quality, ...sentences)) {
    sentences.push(ensurePeriod(quality));
  }

  // Keep 4–6 substantive sentences when possible; always include brief + quality.
  const trimmed = sentences.filter(Boolean).slice(0, 6);
  let result = trimmed.join(' ');

  if (result.length > 1800) {
    result = result.slice(0, 1800).replace(/\s+\S*$/, '');
    if (!/[.!?]$/.test(result)) result += '.';
  }

  return result || `${SHORT_PROMPT_FALLBACK}. ${GENERIC_QUALITY}.`;
}

export { SHORT_PROMPT_FALLBACK };
