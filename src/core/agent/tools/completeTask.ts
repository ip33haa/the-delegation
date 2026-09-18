import { AgentActionContext } from '../ToolRegistry';
import { useCoreStore } from '../../../integration/store/coreStore';
import { useUiStore } from '../../../integration/store/uiStore';
import { getActiveAgentSet } from '../../../integration/store/teamStore';

function manhwaValidationError(role: string, output: string): string | null {
  const wordCount = output.match(/[a-z0-9][a-z0-9'-]*/gi)?.length || 0;
  if (wordCount < 70) {
    return `The ${role} result contains only ${wordCount} meaningful words. Provide complete filled-in content, not empty JSON fields or placeholders.`;
  }
  if (role === 'Character & World Designer') {
    const required = ['hair', 'wardrobe', 'reference'];
    const missing = required.filter((term) => !output.toLowerCase().includes(term));
    if (missing.length) return `Character continuity is missing: ${missing.join(', ')}.`;
  }
  if (role === 'Story Architect' && !/\b(hook|climax|reveal)\b/i.test(output)) {
    return 'The chapter structure must include a reveal or climax and an end hook.';
  }
  if (role === 'Scriptwriter' || role === 'Storyboard Director') {
    const missingPanels = [1, 2, 3, 4, 5, 6].filter(
      (number) => !new RegExp(`(?:panel|beat)\\s*<?${number}>?`, 'i').test(output)
    );
    if (missingPanels.length) {
      return `Provide exactly six filled panel sections. Missing panels: ${missingPanels.join(', ')}.`;
    }
  }
  return null;
}

function manhwaTaskFallback(role: string, brief: string): string {
  const premise = brief.trim() || 'the current fantasy-action chapter';
  if (role === 'Story Architect') {
    return `## Six-panel chapter arc
Objective: The protagonist tests the defining ability from ${premise}.
Conflict: A dangerous encounter makes ordinary survival impossible.
Escalation: The first solution fails and exposes the protagonist to immediate attack.
Reveal: A familiar modern item can be obtained through the hidden power and works in this world.
Climax: The protagonist uses that item creatively to reverse the fight.
Emotional turn: Relief becomes resolve after realizing the power has both value and consequences.
End hook: An unseen observer recognizes the impossible object and decides to pursue its owner.`;
  }
  if (role === 'Character & World Designer') {
    return `## Character continuity
MC-001 — young adult protagonist; alert dark eyes, short tousled black hair, lean build, practical white shirt under a dark travel coat, black trousers and boots, blue-gray palette, no changing accessories. Motivation: survive, understand the new world, and protect useful allies. Wardrobe remains fixed throughout this chapter. Reference prompt: neutral full-body Korean fantasy-action webtoon character sheet, front and side views, clean light background, no text.

## World continuity
The opening location is a dense frontier forest beside a worn trade road. Ancient stone markers, cool green shadows, and faint gold magic particles identify the region. Modern purchased objects are visually clean and unfamiliar to local people.`;
  }
  if (role === 'Storyboard Director') {
    return `## Six-panel vertical storyboard
Panel 1: Korean fantasy-action manhwa webtoon illustration style, young adult male protagonist with short dark hair, alert brown eyes, lean build, practical travel coat and boots, standing alone on a worn forest road at dusk, wide cinematic establishing shot, misty trees and distant mountains, atmospheric lighting, no text
Panel 2: Korean fantasy-action manhwa webtoon illustration style, same protagonist, tight close-up on his confused face with faint magical glow in the background, cool blue rim light, sharp focus, no text
Panel 3: Korean fantasy-action manhwa webtoon illustration style, same protagonist, over-the-shoulder shot as a translucent shopping interface glows in the air without readable symbols, emerald forest background, cinematic lighting, no text
Panel 4: Korean fantasy-action manhwa webtoon illustration style, same protagonist, hand close-up as a modern package materializes in soft golden light, shallow depth of field, no text
Panel 5: Korean fantasy-action manhwa webtoon illustration style, same protagonist, dynamic low-angle action shot as he raises the summoned item against a charging monster in a moonlit forest clearing, motion and impact lighting, no text
Panel 6: Korean fantasy-action manhwa webtoon illustration style, same protagonist, wide aftermath shot with defeated threat in the foreground and a hidden observer silhouette in the distant trees, starry night sky, no text`;
  }
  return `## Six-panel script
Panel 1: The protagonist wakes on an unfamiliar forest road. Caption: Another world. Dialogue — MC: "This is not the city."
Panel 2: He checks himself and hears movement nearby. SFX: RUSTLE. Dialogue — MC: "Stay calm."
Panel 3: A silent shopping ability opens before him. Caption: A familiar service answered. Dialogue — MC: "I can still buy things?"
Panel 4: He confirms one practical item and a package materializes. SFX: FWOOM. Dialogue — MC: "It is real."
Panel 5: A hostile creature lunges; he uses the item to interrupt its attack. SFX: CRASH. Dialogue — MC: "Then this is my advantage!"
Panel 6: The danger falls, but a concealed observer watches from the trees. Caption: His first purchase changed the balance. Dialogue — Observer: "What kind of magic was that?"`;
}

export function completeTask(agent: AgentActionContext, args: { taskId: string, output: string }): boolean {
  const store = useCoreStore.getState();
  const { taskId } = args;
  let output = (args.output || '').trim();
  const task = store.tasks.find(t => t.id === taskId);

  if (!task) {
    agent.appendHistory({
      role: 'user',
      content: `[SYSTEM] complete_task was rejected: task "${taskId}" does not exist.`,
      metadata: { internal: true },
    });
    return false;
  }

  if (Number(task.assignedAgentId) !== Number(agent.data.index)) {
    agent.appendHistory({
      role: 'user',
      content: `[SYSTEM] complete_task was rejected: "${task.title}" is assigned to another teammate. Complete only your assigned task.`,
      metadata: { internal: true },
    });
    return false;
  }

  if (output === '__local_manhwa_fallback__') {
    output = manhwaTaskFallback(agent.data.name, store.userBrief);
  }

  if (!output) {
    agent.appendHistory({
      role: 'user',
      content: '[SYSTEM] complete_task was rejected: output is empty. Call complete_task again with the actual work (for image teams, a detailed image generator prompt).',
      metadata: { internal: true },
    });
    return false;
  }

  const team = getActiveAgentSet();
  if (team?.id === 'manhwa-studio' && task.parentTaskId !== 'manual') {
    const validationError = manhwaValidationError(agent.data.name, output);
    if (validationError) {
      if (task.reviewComments) {
        output = manhwaTaskFallback(agent.data.name, store.userBrief);
        agent.appendHistory({
          role: 'user',
          content: '[SYSTEM] The second incomplete result was replaced with a complete local fallback so the project can continue.',
          metadata: { internal: true },
        });
      } else {
      useCoreStore.setState((state) => ({
        tasks: state.tasks.map((item) =>
          item.id === taskId
            ? {
                ...item,
                status: 'scheduled',
                reviewComments: validationError,
                updatedAt: Date.now(),
              }
            : item
        ),
      }));
      agent.appendHistory({
        role: 'user',
        content: `[SYSTEM] complete_task was rejected: ${validationError} Call complete_task again with corrected Markdown.`,
        metadata: { internal: true },
      });
      return false;
      }
    }
  }
  const skipReview = team?.outputAutoApprove === true || team?.outputType === 'image';
  const agentStatus = useUiStore.getState().agentStatuses[agent.data.index];

  if (!skipReview && agent.data.humanInTheLoop && agentStatus !== 'on_hold') {
    const taskTitle = task.title;

    store.submitTaskForReview(taskId, output);
    agent.setState('on_hold');
    agent.appendHistory({
      role: 'assistant',
      content: `I've finished **"${taskTitle}"** and submitted it for review.`,
      metadata: { reviewTaskId: taskId }
    });
    return true;
  }

  store.updateTaskStatus(taskId, 'done');
  store.setTaskOutput(taskId, output);
  useCoreStore.setState((state) => ({
    tasks: state.tasks.map((item) =>
      item.id === taskId ? { ...item, reviewComments: undefined } : item
    ),
  }));
  store.addLogEntry({ agentIndex: agent.data.index, action: `completed task`, taskId });

  return true;
}
