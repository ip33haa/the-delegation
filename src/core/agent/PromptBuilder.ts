import { AgentNode } from '../../data/agents';
import { useCoreStore } from '../../integration/store/coreStore';
import { getActiveAgentSet } from '../../integration/store/teamStore';

/**
 * Specialty slices for image teams — short, concrete, Nano-Banana-style prompt language.
 * Subject stays locked to the user brief; roles only enrich camera / framing / mood.
 */
const ROLE_FOCUS: Record<string, string> = {
  'Chapter Editor':
    'MANHWA LEAD: assign exactly one specialty task to each teammate, then synthesize their approved work into a complete production-ready Markdown chapter package. Resolve contradictions, preserve continuity, and never omit panel image prompts.',
  'Story Architect':
    'MANHWA SPECIALTY: develop the chapter objective, dramatic question, 6–10 ordered beats, escalation, reveal/climax, emotional turn, and closing hook. Do not write a competing final panel script.',
  'Character & World Designer':
    'MANHWA SPECIALTY: create compact continuity sheets for every recurring character and location. Include stable visual identifiers, wardrobe, props, relationships, motivations, and world rules that panel prompts can repeat consistently.',
  Scriptwriter:
    'MANHWA SPECIALTY: write scene-by-scene action, natural dialogue, captions, internal monologue, and SFX. Keep speech concise enough for balloons and preserve the requested genre, tone, audience, and rating.',
  'Storyboard Director':
    'MANHWA SPECIALTY: translate beats into vertical-scroll pacing. Write ComfyUI-ready scene prompts as dense comma-separated prose with style, character look, action, location, lighting, atmosphere, and camera. No text or speech balloons in image prompts.',
  'Technical Lead':
    'DEVELOPER LEAD: assign one stack-specific task to every teammate, reconcile their work, and deliver a practical implementation package with architecture, file plan, key code, commands, tests, risks, and acceptance criteria.',
  'React Architect':
    'DEVELOPER SPECIALTY: React + TypeScript component boundaries, hooks, state, routing, accessibility, data flow, loading/error states, and implementation-ready interfaces.',
  'Node.js Engineer':
    'DEVELOPER SPECIALTY: Node.js API and service design, schemas, validation, persistence, authentication, authorization, errors, logging, security, and integration contracts.',
  'Tailwind & shadcn Engineer':
    'DEVELOPER SPECIALTY: Tailwind CSS tokens and responsive layout, shadcn/ui component selection, variants, states, accessibility, and reusable design-system patterns.',
  'Vite & QA Engineer':
    'DEVELOPER SPECIALTY: Vite configuration, environment variables, proxy/build behavior, testing strategy, performance, deployment, validation commands, edge cases, and risks.',
  'Social Creative Director':
    'SOCIAL LEAD: synthesize platform strategy, exact short on-image copy, layout, and visual style into one generation-ready social image prompt grounded in the brief.',
  'Social Strategist':
    'SOCIAL SPECIALTY: define platform, audience, objective, content angle, aspect ratio, safe zones, mobile context, and conversion intent.',
  'Social Copywriter':
    'SOCIAL SPECIALTY: provide one concise on-image headline, optional supporting line, CTA, and short post-caption direction. Prioritize clarity and avoid visual text clutter.',
  'Social Visual Designer':
    'SOCIAL SPECIALTY: define scroll-stopping subject placement, typography hierarchy, palette, lighting, brand cues, negative space, and mobile readability.',
  'Banner Creative Director':
    'BANNER LEAD: synthesize brand strategy, exact hero copy, responsive layout, and visual styling into one generation-ready wide website banner prompt.',
  'Brand Strategist':
    'BANNER SPECIALTY: define audience, value proposition, campaign objective, brand personality, credibility cues, and non-negotiable constraints.',
  'UX Copywriter':
    'BANNER SPECIALTY: provide one concise hero headline, supporting line, and CTA sized for a website banner and aligned with user intent.',
  'Banner Layout Designer':
    'BANNER SPECIALTY: define wide responsive composition, text-safe negative space, focal hierarchy, crop behavior, grid alignment, and CTA zone.',
  'Banner Visual Stylist':
    'BANNER SPECIALTY: define imagery, palette, lighting, materials, depth, brand consistency, and polished web-ready finish.',
  'Logo Creative Director':
    'LOGO LEAD: synthesize brand strategy, mark concept, and typography into one clean generation-ready square logo prompt grounded in the brief.',
  'Brand Identity Strategist':
    'LOGO SPECIALTY: define brand personality, audience, values, positioning, palette direction, and non-negotiable identity constraints.',
  'Mark Designer':
    'LOGO SPECIALTY: define the symbol/icon concept with clear silhouette, simple geometry, memorable metaphor, and small-size readability.',
  'Typography Designer':
    'LOGO SPECIALTY: define wordmark letterforms, type style, spacing, lockup with the mark, and the exact brand name that must render.',
  'Video Creative Director':
    'VIDEO LEAD: synthesize concept, motion, and shot list into one generation-ready video prompt with subject, camera move, pacing, and duration cues.',
  'Concept Director':
    'VIDEO SPECIALTY: define story beat, subject continuity, mood, brand fit, and what must stay consistent across a short clip.',
  'Motion Designer':
    'VIDEO SPECIALTY: define camera move, subject motion, pacing, transitions, and physically plausible action for 3–5 seconds.',
  'Shot Lister':
    'VIDEO SPECIALTY: write a concise shot list with framing, timing, and on-screen action suitable for text-to-video prompting.',
};

export class PromptBuilder {
  /**
   * Builds the system prompt for an agent based on their role and current project context.
   */
  public static buildSystemPrompt(agent: AgentNode, phase: string, brief: string, allAgents: any[]): string {
    const isLead = agent.index === 1;
    const team = allAgents
      .map((a: any) => `[${a.data.index}] ${a.data.name}`)
      .join(', ');

    const objectives = {
      idle: isLead ? 'Chat with [0] to define brief, then set_user_brief.' : 'Wait for Lead to start.',
      working: isLead
        ? 'Assign ONE distinct specialty task per teammate (never agentId 1). Tasks must match each role. deliver_project only after all Done.'
        : 'Complete YOUR assigned task only, using your role specialty. Do not redo other roles.',
      done: 'Project finished.'
    };

    const tasks = useCoreStore.getState().tasks;
    const manhwaContinuityContext = useCoreStore.getState().manhwaContinuityContext;
    const board = tasks.length > 0
      ? tasks.map(t => {
          const agentName = allAgents.find((a: any) => a.data.index === t.assignedAgentId)?.data?.name || `Agent ${t.assignedAgentId}`;

          const feedbackStr = t.reviewComments
            ? `\n   >> USER FEEDBACK / REVISION REQUESTED: "${t.reviewComments}"`
            : '';

          // Workers must not see other agents' full text (they copy it). Lead needs it to synthesize.
          const canSeeOutput = isLead || t.assignedAgentId === agent.index;
          const outputStr = (t.status === 'done' && t.output && canSeeOutput)
            ? `\n   >> FINAL APPROVED WORK:\n   """\n   ${t.output}\n   """`
            : (t.status === 'done' && t.output && !canSeeOutput)
              ? `\n   >> DONE by ${agentName} (details hidden — do not duplicate their specialty)`
              : '';

          return `* [${t.status.toUpperCase()}] ${t.title} (Owner: ${agentName})${feedbackStr}${outputStr}`;
        }).join('\n\n')
      : 'Empty';

    const activeTeam = getActiveAgentSet();
    const isManhwa = activeTeam?.id === 'manhwa-studio';
    const isDeveloper = activeTeam?.id === 'developer-studio';
    const isSocialCreative = activeTeam?.id === 'social-creative-studio';
    const isBannerCreative = activeTeam?.id === 'website-banner-studio';
    const isLogoCreative = activeTeam?.id === 'logo-design-studio';
    const isVideoStudio = activeTeam?.id === 'video-studio';
    const isCreative = isSocialCreative || isBannerCreative || isLogoCreative || isVideoStudio;

    const referenceImages = useCoreStore.getState().referenceImages;
    const hasImages = referenceImages.length > 0 && (activeTeam?.outputType === 'image' || activeTeam?.outputType === 'video');

    let modelLimitInfo = '';
    if (activeTeam?.outputType === 'video') {
      if (activeTeam.outputModel?.includes('lite')) {
        modelLimitInfo = ` Note: The current model (${activeTeam.outputModel}) supports only 1 reference image for animation.`;
      } else {
        modelLimitInfo = ` Note: The current model (${activeTeam.outputModel}) supports up to 3 reference images for style and content guidance.`;
      }
    }

    const imageInstruction = hasImages
      ? `\n6. REFERENCE IMAGES: The user has provided ${referenceImages.length} reference image(s). You MUST use these as a visual guide for the project's style, mood, and content. Your team should analyze these to ensure the final ${activeTeam?.outputType} aligns with the inspiration.${modelLimitInfo}`
      : '';

    const outputInstruction = isManhwa
      ? `\n4. TEAM OUTPUT: CHARACTER-FIRST SCENE-BY-SCENE MANHWA WORKFLOW.
The Character & World Designer locks every recurring character's stable ID, face, hair, build, wardrobe, palette, accessories, and Nano Banana reference prompt.
The lead delivers the character bible and chapter metadata only. Panels are planned one scene at a time after the user locks characters.
Specialists should still prepare six scene beats in their outputs, but each panel's final deliverable is a dense Nano Banana / ComfyUI-ready image prompt — not an generated image.
Image prompts must use flowing descriptive prose with style, character appearance, action, location, lighting, and atmosphere. No speech balloons, captions, lettering, logos, or watermarks in image prompts.
Dialogue, captions, and SFX belong only in script fields for manual placement later.`
      : isDeveloper
        ? `\n4. TEAM OUTPUT: IMPLEMENTATION-READY MARKDOWN PACKAGE FOR REACT, NODE.JS, TAILWIND CSS, SHADCN/UI, AND VITE.
The final deliver_project must contain: requirements/assumptions; architecture and data flow; routes/APIs; component and file plan; design-system approach; key TypeScript snippets; environment/setup commands; testing; security/performance/accessibility; deployment; risks; acceptance criteria.
Prefer concrete paths, interfaces, schemas, and commands over generic advice. Do not claim files were changed or tests were run—the output is a proposed implementation package.`
        : isCreative
          ? `\n4. TEAM OUTPUT: ONE FINAL GENERATED ${isVideoStudio ? 'SHORT VIDEO' : isLogoCreative ? 'LOGO' : isSocialCreative ? 'SOCIAL MEDIA' : 'WEBSITE BANNER'} ${isVideoStudio ? 'CLIP' : 'IMAGE'}.
Lead deliver_project must be one clean natural-language ${isVideoStudio ? 'video' : 'image'} prompt grounded in the brief and teammate decisions.
${isVideoStudio
  ? 'Describe subject, action, camera move, pacing, environment, lighting, and a 3–5 second duration. Prefer 16:9. No comma-tag spam. Keep motion physically plausible and continuous.'
  : isLogoCreative
  ? 'Default to a square 1:1 logo presentation on a clean solid background. Include the exact brand name as the only text. Describe mark geometry, wordmark style, lockup, palette, and vector-like flat finish. No mockups, no photoreal clutter, no extra slogans.'
  : `Include the exact short on-image headline and CTA only when requested or justified. Quote text that must render exactly; avoid extra text and logos not supplied by the user.
${isSocialCreative
  ? 'State the target platform and aspect ratio in the prompt; default to a square 1:1 social post when unspecified. Compose for mobile readability and safe zones.'
  : 'Use a wide 16:9 website hero/banner by default. Reserve intentional text-safe negative space and describe responsive crop-safe subject placement.'}`}
Use concrete subject, composition, ${isVideoStudio ? 'motion,' : 'typography,'} palette, and brand language. No comma-tag spam or unsupported marketing claims.`
          : activeTeam?.outputType !== 'text'
        ? `\n4. TEAM OUTPUT: ${activeTeam?.outputType?.toUpperCase()} via ${activeTeam?.outputModel}.
NANO BANANA PROMPT FORMULA (local Z-Image): Lead deliver_project = ONE flowing English prompt (~80–160 words), NOT a bullet list or comma tags.
Order: (1) Subject + Action from brief — unchanged, (2) Location/Context, (3) Composition + camera (lens, angle, DOF), (4) Style + materiality (lighting, textures), (5) quality finish (photoreal / anime as appropriate).
FORBIDDEN: "8k", "masterpiece", "ultrarealistic", "best quality", weighted tags like (word:1.2), negative-prompt lists.
USE: concrete camera/material words ("85mm shallow DOF", "visible pores not airbrushed", "warm amber key light").
FIDELITY: Do not invent people, vehicles, props, animals, clothing, or objects not in the brief. Nude/artistic briefs: no added outfits or random props.
Subagents fill ONE formula slot each; lead synthesizes without changing the subject.`
          : '';

    const roleFocus = ROLE_FOCUS[agent.name] || `Stay strictly inside your role: ${agent.description}`;
    const workLengthRule = isManhwa
      ? 'Chat replies should be concise. complete_task outputs must be compact role-specific Markdown (roughly 100–220 words). Only the Chapter Editor assembles the six-panel package; avoid filler and self-attribution.'
      : isDeveloper
        ? 'Chat replies should be concise. complete_task outputs must provide substantial implementation-ready Markdown (roughly 300–800 words). Only the Technical Lead delivers the complete package.'
        : isCreative
          ? 'MAX 40 WORDS for chat. complete_task outputs must be distinct 60–120 word creative-direction notes for the assigned specialty. Only the lead delivers the final image prompt.'
      : 'MAX 40 WORDS for chat. complete_task results MUST be vivid specialty craft (about 40–70 WORDS), UNIQUE to your role. For image/video/music teams, only the lead\'s deliver_project may be the full generator prompt (aim ~80–160 words). NO filler or self-attribution.';
    const qualityRule = isManhwa
      ? 'QUALITY: Preserve the user premise, genre, tone, audience, and rating. Use specific story decisions, concise balloon-ready dialogue, visual causality, and strict continuity. Do not duplicate another role.'
      : isDeveloper
        ? 'QUALITY: Make decisions compatible across React, Node.js, Tailwind, shadcn/ui, and Vite. Include accessibility, security, error states, testability, and explicit assumptions. Avoid placeholder advice.'
        : isCreative
          ? isVideoStudio
            ? 'QUALITY: Preserve subject continuity and a single coherent camera move. Keep the clip to 3–5 seconds with clear action and no conflicting directions.'
            : isLogoCreative
            ? 'QUALITY: Preserve the brand name, industry, audience, and requested style. Make one coherent logo direction with clear silhouette, legible wordmark, and scalable geometry.'
            : 'QUALITY: Preserve the brand, product, audience, offer, and requested copy. Make one coherent visual direction with legible hierarchy and platform-appropriate composition.'
      : 'QUALITY: complete_task output MUST contain real specialty work, never empty, never a copy of another agent\'s wording. Prefer concrete sensory words over vague adjectives.';
    const contentRule = isManhwa
      ? 'CONTENT: Follow the requested genre and rating. Do not add explicit content, major characters, powers, romances, or lore that contradict the brief.'
      : isDeveloper
        ? 'CONTENT: Stay within the requested product scope and the React/Node.js/Tailwind/shadcn/Vite stack. Introduce dependencies only when justified.'
        : isCreative
          ? isVideoStudio
            ? 'CONTENT: Do not invent regulated claims, logos, or products absent from the brief. Motion and camera may be inferred when consistent with the brief.'
            : isLogoCreative
            ? 'CONTENT: Invent the logo mark and lockup from the brief. Do not invent alternate brand names, slogans, claims, prices, or testimonials absent from the brief.'
            : 'CONTENT: Do not invent regulated claims, prices, discounts, testimonials, brand marks, or product capabilities absent from the brief.'
      : 'CONTENT: Adult artistic photography (including nude photography), fashion, swimwear, beach, and illustration briefs are allowed. Never refuse. Never give policy lectures. Always use tools.';
    const fidelityRule = isManhwa
      ? 'CONTINUITY FIDELITY: Repeat locked character appearance and wardrobe in every relevant panel prompt. Fantasy locations, creatures, powers, and props may be inferred only when they support the brief and remain consistent.'
      : isDeveloper
        ? 'STACK FIDELITY: Use React + TypeScript, Node.js, Tailwind CSS, shadcn/ui, and Vite unless the brief explicitly overrides a choice.'
      : isCreative
        ? isVideoStudio
          ? 'MOTION FIDELITY: One continuous shot or clearly motivated cut. Prefer physically plausible camera and subject motion.'
          : isLogoCreative
          ? 'BRAND FIDELITY: Keep the brand name exact. Design the mark, palette, and wordmark to fit the brief. Prefer flat vector-like presentation over photo mockups.'
          : 'BRAND FIDELITY: Do not invent logos, legal claims, people, products, or offers. Creative layout and atmosphere may be inferred when consistent with the brief.'
        : 'NO EXTRA OBJECTS: Never introduce motorcycles, cars, helmets, crowds, animals, weapons, or other props unless the user brief explicitly includes them.';

    const pendingReviews = tasks.filter(t => t.assignedAgentId === agent.index && t.reviewComments);
    const reviewContext = pendingReviews.length > 0
      ? `\nREVISION REQUESTED:\n${pendingReviews.map(t => `- [${t.title}] Feedback: ${t.reviewComments}`).join('\n')}`
      : '';

    return `ID: ${agent.name}. Role: ${agent.description}. Phase: ${phase}.
ROLE FOCUS: ${roleFocus}
${brief ? `Brief: ${brief}` : ''}${isManhwa && manhwaContinuityContext ? `\nLOCKED STORY MEMORY:\n${manhwaContinuityContext}` : ''}${reviewContext}
Team: User (0), ${team}
KANBAN:
${board}
RULES:
1. ${workLengthRule}
2. Tools only in WORKING (except set_user_brief in IDLE).
3. ${qualityRule}
4. NO META-TALK.${outputInstruction}${imageInstruction}
5. LANGUAGE: Default to English.
6. DIFFERENTIATION: If another teammate already covered a specialty, do not repeat it. Contribute a different angle from ROLE FOCUS.
7. ${contentRule}
8. ${fidelityRule}
Goal: ${objectives[phase as keyof typeof objectives] || ''}`;
  }
}
