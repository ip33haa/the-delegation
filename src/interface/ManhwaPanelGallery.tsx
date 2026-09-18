import { BookOpen, Copy, Lock, Map, Unlock } from 'lucide-react';

import {
  allCharactersLocked,
  canPlanNextPanel,
  nextPanelNumber,
  panelsInCurrentBatch,
  planNextManhwaPanel,
} from '../core/manhwa/panelPlanning';
import { continueManhwaStory } from '../core/manhwa/continuation';
import { ManhwaPanel, useCoreStore } from '../integration/store/coreStore';

async function copyText(text: string, label: string) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    window.prompt(`Copy ${label}:`, text);
  }
}

function scriptFor(panel: ManhwaPanel): string {
  const dialogue = panel.balloons.length
    ? panel.balloons
        .map((balloon, index) => `${index + 1}. ${balloon.speaker}: "${balloon.text}"`)
        .join('\n')
    : 'None';

  return [
    `Panel ${panel.number}`,
    `Scene: ${panel.visual}`,
    `Shot: ${panel.shot}`,
    `Dialogue (add manually):`,
    dialogue,
    `Captions: ${panel.captions.join(' / ') || 'None'}`,
    `SFX: ${panel.sfx.join(' / ') || 'None'}`,
  ].join('\n');
}

export function ManhwaPanelGallery() {
  const { manhwaProject, updateManhwaCharacter } = useCoreStore();
  if (!manhwaProject) return null;

  const sortedPanels = [...manhwaProject.panels].sort((a, b) => a.number - b.number);
  const upcomingPanelNumber = nextPanelNumber();
  const canPlan = canPlanNextPanel();
  const batchCount = panelsInCurrentBatch();

  return (
    <div className="space-y-10">
      <section className="space-y-4">
        <div>
          <p className="text-[10px] font-black uppercase tracking-[0.18em] text-violet-500">Stage 1</p>
          <h3 className="text-xl font-black text-zinc-900">{manhwaProject.chapterTitle}</h3>
          <p className="mt-1 text-xs leading-relaxed text-zinc-500">{manhwaProject.premise}</p>
        </div>

        <div className="rounded-2xl border border-violet-100 bg-violet-50/60 p-4">
          <p className="text-xs font-bold text-violet-900">Review and lock every character first.</p>
          <p className="mt-1 text-[11px] text-violet-600">
            Copy each Nano Banana reference prompt into ComfyUI when you want a character sheet. The app no longer generates images here.
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          {manhwaProject.characters.map((character) => (
            <article key={character.id} className="overflow-hidden rounded-2xl border border-zinc-200 bg-white">
              <div className="space-y-3 p-4">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <h4 className="text-sm font-black text-zinc-900">{character.name}</h4>
                    <p className="text-[9px] font-bold uppercase tracking-wider text-zinc-400">{character.id}</p>
                  </div>
                  {character.locked && (
                    <span className="flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-1 text-[9px] font-black uppercase text-emerald-700">
                      <Lock size={10} /> Locked
                    </span>
                  )}
                </div>

                <p className="text-[11px] leading-relaxed text-zinc-600">{character.visualDescription}</p>

                <div className="rounded-xl border border-dashed border-zinc-200 bg-zinc-50 p-3">
                  <p className="text-[9px] font-black uppercase tracking-wider text-zinc-400">Nano Banana reference prompt</p>
                  <p className="mt-2 text-[11px] leading-relaxed text-zinc-700">{character.referencePrompt}</p>
                </div>

                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={() => copyText(character.referencePrompt, 'character prompt')}
                    className="flex items-center gap-1.5 rounded-xl bg-zinc-900 px-3 py-2 text-[9px] font-black uppercase tracking-wider text-white"
                  >
                    <Copy size={12} /> Copy prompt
                  </button>

                  {!character.locked ? (
                    <button
                      onClick={() => updateManhwaCharacter(character.id, { locked: true })}
                      className="flex items-center gap-1.5 rounded-xl bg-emerald-600 px-3 py-2 text-[9px] font-black uppercase tracking-wider text-white"
                    >
                      <Lock size={12} /> Approve & lock
                    </button>
                  ) : (
                    <button
                      onClick={() => updateManhwaCharacter(character.id, { locked: false })}
                      className="flex items-center gap-1.5 rounded-xl border border-zinc-200 px-3 py-2 text-[9px] font-black uppercase tracking-wider text-zinc-600"
                    >
                      <Unlock size={12} /> Unlock
                    </button>
                  )}
                </div>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="space-y-5">
        <div>
          <p className="text-[10px] font-black uppercase tracking-[0.18em] text-violet-500">Stage 2</p>
          <h3 className="text-lg font-black text-zinc-900">Scene-by-scene panel prompts</h3>
          <p className="mt-1 text-[11px] text-zinc-500">
            Each panel ships a final Nano Banana prompt for ComfyUI. Dialogue stays in the script block for manual placement later.
          </p>
        </div>

        {!allCharactersLocked() && (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-[11px] text-amber-800">
            Lock every character before planning the first panel.
          </div>
        )}

        {sortedPanels.map((panel) => (
          <article key={panel.number} className="overflow-hidden rounded-2xl border border-zinc-200 bg-white">
            <div className="border-b border-zinc-100 px-5 py-4">
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-black text-zinc-900">Panel {panel.number}</h4>
                <span className="text-[9px] font-bold uppercase tracking-wider text-emerald-600">Prompt ready</span>
              </div>
            </div>

            <div className="space-y-4 p-5">
              <div className="rounded-xl bg-zinc-50 p-4 text-[11px] leading-relaxed text-zinc-700">
                <p><span className="font-black">Shot:</span> {panel.shot}</p>
                <p className="mt-2"><span className="font-black">Scene:</span> {panel.visual}</p>
              </div>

              <div className="rounded-xl border border-violet-200 bg-violet-50/50 p-4">
                <p className="text-[9px] font-black uppercase tracking-wider text-violet-600">Nano Banana scene prompt</p>
                <p className="mt-2 text-[11px] leading-relaxed text-zinc-800">{panel.imagePrompt}</p>
              </div>

              <div className="rounded-xl border border-dashed border-zinc-200 bg-white p-4">
                <p className="text-[9px] font-black uppercase tracking-wider text-zinc-400">Manual script</p>
                <pre className="mt-2 whitespace-pre-wrap font-sans text-[11px] leading-relaxed text-zinc-700">
                  {scriptFor(panel)}
                </pre>
              </div>

              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => copyText(panel.imagePrompt, 'panel prompt')}
                  className="flex items-center gap-1.5 rounded-xl bg-violet-600 px-3 py-2 text-[9px] font-black uppercase tracking-wider text-white"
                >
                  <Copy size={12} /> Copy Nano Banana prompt
                </button>
                <button
                  onClick={() => copyText(scriptFor(panel), 'script')}
                  className="rounded-xl border border-zinc-200 px-3 py-2 text-[9px] font-black uppercase tracking-wider text-zinc-600"
                >
                  Copy script
                </button>
              </div>
            </div>
          </article>
        ))}

        {canPlan && (
          <div className="rounded-2xl border border-violet-200 bg-violet-50/70 p-5">
            <p className="text-sm font-black text-violet-900">Ready for panel {upcomingPanelNumber}</p>
            <p className="mt-1 text-[11px] text-violet-700">
              Plan the next scene to build its Nano Banana prompt. Batch progress: {batchCount}/6 panels.
            </p>
            <button
              onClick={() => {
                try {
                  planNextManhwaPanel();
                } catch (error) {
                  window.alert(error instanceof Error ? error.message : String(error));
                }
              }}
              className="mt-4 flex items-center gap-2 rounded-xl bg-violet-700 px-4 py-3 text-[9px] font-black uppercase tracking-wider text-white"
            >
              <Map size={13} /> Plan panel {upcomingPanelNumber}
            </button>
          </div>
        )}

        <div className="rounded-2xl border border-zinc-200 bg-zinc-50 p-4">
          <p className="text-[10px] font-black uppercase tracking-wider text-zinc-400">End hook</p>
          <p className="mt-1 text-xs text-zinc-700">{manhwaProject.endHook}</p>
          <button
            onClick={() => continueManhwaStory().catch((error) => window.alert(error instanceof Error ? error.message : String(error)))}
            disabled={batchCount < 6}
            className="mt-4 flex items-center gap-2 rounded-xl bg-zinc-900 px-4 py-3 text-[9px] font-black uppercase tracking-wider text-white disabled:opacity-40"
          >
            <BookOpen size={13} /> Continue story · next 6 scenes
          </button>
        </div>
      </section>
    </div>
  );
}
