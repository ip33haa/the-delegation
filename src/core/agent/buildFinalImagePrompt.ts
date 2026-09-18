import { useCoreStore } from '../../integration/store/coreStore';
import { getActiveAgentSet } from '../../integration/store/teamStore';
import { getAllAgents } from '../../data/agents';
import {
  buildNanoBananaPrompt,
  buildReferenceNotes,
  stripSdTagSpam,
  type NanoBananaInput,
} from './nanoBananaPrompt';

const INVENTED_OBJECT =
  /\b(motorcycle|bike|car|truck|helmet|guardrail|sword|gun|robot|dragon|castle|spaceship|laptop|phone|coffee|umbrella|bouquet|crowd|dog|cat|horse)\b/i;

const LOCATION_HINT =
  /\b(at|in|on|inside|outside|near|beside|against|background|setting|beach|studio|street|room|forest|mountain|city|sky|water|shore|horizon)\b/i;

const COMPOSITION_HINT =
  /\b(camera|lens|aperture|f\/\d|mm\b|bokeh|framing|composition|shot|angle|close-?up|medium shot|full body|wide angle|eye level|low angle|high angle|depth of field|shallow|portrait|bust)\b/i;

const STYLE_HINT =
  /\b(lighting|light|sunset|golden hour|softbox|rim light|mood|atmosphere|tone|color grade|film grain|backlit|volumetric|specular|diffused|cinematic|photoreal|warm|cool|contrast|material|texture|matte|glossy)\b/i;

function cleanLine(text: string): string {
  return text
    .replace(/^[\s*•\-–—]+/, '')
    .replace(/\s+/g, ' ')
    .replace(/[.]+$/g, '')
    .trim();
}

function isModifierOnly(text: string, brief: string): boolean {
  const lower = text.toLowerCase();
  const briefLower = brief.toLowerCase();
  if (text.length > 280) return false;
  if (INVENTED_OBJECT.test(text) && !INVENTED_OBJECT.test(brief)) return false;
  const briefTokens = briefLower.split(/\W+/).filter((t) => t.length > 3);
  const overlap = briefTokens.filter((t) => lower.includes(t)).length;
  if (briefTokens.length >= 4 && overlap < Math.min(2, briefTokens.length)) {
    return COMPOSITION_HINT.test(text) || STYLE_HINT.test(text);
  }
  return true;
}

function mergeUnique(parts: string[]): string {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of parts) {
    const cleaned = cleanLine(stripSdTagSpam(part));
    if (!cleaned) continue;
    const key = cleaned.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(cleaned);
  }
  return out.join(' ');
}

function splitSceneOutput(output: string, brief: string): Pick<NanoBananaInput, 'subjectAction' | 'location'> {
  const cleaned = cleanLine(stripSdTagSpam(output));
  if (!cleaned || cleaned.toLowerCase() === brief.toLowerCase()) {
    return {};
  }
  if (LOCATION_HINT.test(cleaned)) {
    const parts = cleaned.split(/(?<=[.!?])\s+/);
    if (parts.length >= 2) {
      return {
        subjectAction: parts[0],
        location: parts.slice(1).join(' '),
      };
    }
    return { location: cleaned };
  }
  return { subjectAction: cleaned };
}

function agentNameForTask(assignedAgentId: number): string {
  const team = getActiveAgentSet();
  if (!team) return '';
  const agents = getAllAgents(team);
  return agents.find((a) => a.index === assignedAgentId)?.name || '';
}

function mapDeliveredFallback(raw: string, brief: string): Partial<NanoBananaInput> {
  const cleaned = cleanLine(stripSdTagSpam(raw));
  if (!cleaned || cleaned.toLowerCase() === brief.toLowerCase()) return {};
  if (!isModifierOnly(cleaned, brief)) return {};

  const parts: Partial<NanoBananaInput> = {};
  if (COMPOSITION_HINT.test(cleaned)) parts.composition = cleaned;
  else if (STYLE_HINT.test(cleaned)) parts.style = cleaned;
  else if (LOCATION_HINT.test(cleaned)) parts.location = cleaned;
  else parts.subjectAction = cleaned;
  return parts;
}

/**
 * Build the text sent to local Z-Image Turbo (Qwen text encoder).
 * Maps teammate outputs into Nano Banana formula slots, then assembles prose.
 */
export function buildFinalImagePrompt(rawOutput?: string | null): string {
  const store = useCoreStore.getState();
  const brief = (store.userBrief || '').trim();
  const delivered = (rawOutput || '').trim();
  const activeTeam = getActiveAgentSet();
  const isSocialCreative = activeTeam?.id === 'social-creative-studio';
  const isBannerCreative = activeTeam?.id === 'website-banner-studio';
  const isLogoCreative = activeTeam?.id === 'logo-design-studio';

  if (isSocialCreative || isBannerCreative || isLogoCreative) {
    const cleanBrief = cleanLine(stripSdTagSpam(brief));
    const cleanDelivered = cleanLine(stripSdTagSpam(delivered));
    const parts: string[] = [];
    if (
      cleanBrief &&
      !cleanDelivered.toLowerCase().includes(cleanBrief.toLowerCase())
    ) {
      parts.push(cleanBrief);
    }
    if (cleanDelivered) parts.push(cleanDelivered);
    if (parts.length === 0 && cleanBrief) parts.push(cleanBrief);

    const combined = parts.join('. ');
    if (!/\b(1:1|3:4|4:5|9:16|16:9|aspect ratio|square|portrait|wide)\b/i.test(combined)) {
      parts.push(
        isLogoCreative || isSocialCreative
          ? isLogoCreative
            ? 'Square 1:1 logo composition centered on a clean solid background'
            : 'Square 1:1 social media composition with mobile-safe margins'
          : 'Wide 16:9 website hero banner with responsive crop-safe composition and generous text-safe negative space'
      );
    }

    const referenceNotes = buildReferenceNotes(store.referenceImages.length);
    if (referenceNotes) parts.push(referenceNotes);
    parts.push(
      isLogoCreative
        ? 'Flat vector-like logo design with crisp geometry, legible wordmark, balanced lockup, and no unintended text'
        : 'Polished commercial design with crisp visual hierarchy, intentional spacing, legible typography, and no unintended text'
    );

    let result = parts
      .filter(Boolean)
      .map((part) => (/[.!?]$/.test(part) ? part : `${part}.`))
      .join(' ');
    if (result.length > 1800) {
      result = result.slice(0, 1800).replace(/\s+\S*$/, '');
      if (!/[.!?]$/.test(result)) result += '.';
    }
    return result;
  }

  const slots: NanoBananaInput = {
    brief,
    referenceNotes: buildReferenceNotes(store.referenceImages.length),
  };

  const compositionParts: string[] = [];
  const styleParts: string[] = [];

  for (const task of store.tasks) {
    if (task.status !== 'done') continue;
    const output = (task.output || '').trim();
    if (!output || !isModifierOnly(output, brief)) continue;

    const agentName = agentNameForTask(task.assignedAgentId);
    const cleaned = cleanLine(stripSdTagSpam(output));

    switch (agentName) {
      case 'Scene Designer': {
        const split = splitSceneOutput(cleaned, brief);
        if (split.subjectAction) slots.subjectAction = mergeUnique([slots.subjectAction || '', split.subjectAction]);
        if (split.location) slots.location = mergeUnique([slots.location || '', split.location]);
        break;
      }
      case 'Lighting Stylist':
        if (COMPOSITION_HINT.test(cleaned)) compositionParts.push(cleaned);
        if (STYLE_HINT.test(cleaned)) styleParts.push(cleaned);
        if (!COMPOSITION_HINT.test(cleaned) && !STYLE_HINT.test(cleaned)) styleParts.push(cleaned);
        break;
      case 'Developer':
      case 'Designer':
        compositionParts.push(cleaned);
        break;
      case 'Copywriter':
        styleParts.push(cleaned);
        break;
      default:
        if (COMPOSITION_HINT.test(cleaned)) compositionParts.push(cleaned);
        else if (STYLE_HINT.test(cleaned)) styleParts.push(cleaned);
        else if (LOCATION_HINT.test(cleaned)) {
          slots.location = mergeUnique([slots.location || '', cleaned]);
        }
        break;
    }
  }

  if (delivered) {
    const fallback = mapDeliveredFallback(delivered, brief);
    if (fallback.subjectAction) {
      slots.subjectAction = mergeUnique([slots.subjectAction || '', fallback.subjectAction]);
    }
    if (fallback.location) slots.location = mergeUnique([slots.location || '', fallback.location]);
    if (fallback.composition) compositionParts.push(fallback.composition);
    if (fallback.style) styleParts.push(fallback.style);
  }

  if (compositionParts.length) {
    slots.composition = mergeUnique(compositionParts);
  }
  if (styleParts.length) {
    slots.style = mergeUnique(styleParts);
  }

  if (!brief) {
    const deliveredSafe =
      delivered && !INVENTED_OBJECT.test(delivered) ? stripSdTagSpam(delivered) : '';
    return buildNanoBananaPrompt({
      brief: deliveredSafe || 'A striking image',
      referenceNotes: slots.referenceNotes,
    });
  }

  return buildNanoBananaPrompt(slots);
}
