import 'dotenv/config';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import express from 'express';
import multer from 'multer';
import { db, initializeDatabase, transaction } from './db.js';

const app = express();
const port = Number(process.env.API_PORT || 3001);
const uploadDir = path.resolve(process.env.UPLOAD_DIR || 'server/data/assets');
await fs.mkdir(uploadDir, { recursive: true });

app.use(express.json({ limit: '12mb' }));

const allowedMime = new Set(['image/png', 'image/jpeg', 'image/webp', 'audio/mpeg', 'video/mp4']);
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024, files: 1 },
  fileFilter: (_request, file, callback) => {
    if (allowedMime.has(file.mimetype)) callback(null, true);
    else callback(new Error(`Unsupported asset type: ${file.mimetype}`));
  },
});

function json(value: unknown): string {
  return JSON.stringify(value ?? null);
}

function parsed<T>(value: T | string): T {
  if (typeof value !== 'string') return value;
  return JSON.parse(value) as T;
}

function safeProjectSnapshot(snapshot: any) {
  const core = { ...(snapshot?.core || {}) };
  core.isGeneratingAsset = false;
  core.isReviewingOutput = Boolean(core.isReviewingOutput);
  core.tasks = Array.isArray(core.tasks)
    ? core.tasks.map((task: any) => ({
        ...task,
        status: task.status === 'in_progress' ? 'scheduled' : task.status,
      }))
    : [];
  if (core.finalAssetContent?.length > 400_000) core.finalAssetContent = null;
  if (core.manhwaProject) {
    core.manhwaProject = {
      ...core.manhwaProject,
      characters: (core.manhwaProject.characters || []).map((character: any) => ({
        ...character,
        imageContent: undefined,
        generationStatus: character.generationStatus === 'generating' ? 'idle' : character.generationStatus,
      })),
      panels: (core.manhwaProject.panels || []).map((panel: any) => ({
        ...panel,
        imageContent: undefined,
        generationStatus: panel.generationStatus === 'generating' ? 'idle' : panel.generationStatus,
      })),
    };
  }
  return { ...snapshot, core };
}

async function saveNormalizedProject(connection: any, projectId: string, snapshot: any, storyId: string | null) {
  const core = snapshot.core || {};
  await connection.query('DELETE FROM task_revisions WHERE task_id IN (SELECT id FROM tasks WHERE project_id = ?)', [projectId]);
  await connection.query('DELETE FROM tasks WHERE project_id = ?', [projectId]);
  for (const task of core.tasks || []) {
    await connection.execute(
      `INSERT INTO tasks
       (id, project_id, parent_task_id, title, description, assigned_agent_id, status, requires_approval, draft_output, review_comments, output, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        task.id, projectId, task.parentTaskId || null, task.title, task.description || null,
        Number(task.assignedAgentId), task.status === 'in_progress' ? 'scheduled' : task.status,
        Boolean(task.requiresUserApproval), task.draftOutput || null, task.reviewComments || null,
        task.output || null, Number(task.createdAt || Date.now()), Number(task.updatedAt || Date.now()),
      ]
    );
    for (const [index, revision] of (task.revisions || []).entries()) {
      await connection.execute(
        'INSERT INTO task_revisions (task_id, revision_number, output, feedback, created_at) VALUES (?, ?, ?, ?, ?)',
        [task.id, index + 1, revision.output, revision.feedback || null, Number(revision.timestamp || Date.now())]
      );
    }
  }

  await connection.query('DELETE FROM conversations WHERE project_id = ?', [projectId]);
  const conversations = [
    ...Object.entries(core.agentHistories || {}).map(([key, messages]) => ({
      scope: 'agent', key, messages, summary: core.agentSummaries?.[key] || null,
    })),
    ...Object.entries(core.boardroomHistories || {}).map(([key, messages]) => ({
      scope: 'task', key, messages, summary: null,
    })),
  ];
  for (const conversation of conversations as any[]) {
    const conversationId = crypto.randomUUID();
    await connection.execute(
      'INSERT INTO conversations (id, project_id, scope, scope_key, summary) VALUES (?, ?, ?, ?, ?)',
      [conversationId, projectId, conversation.scope, conversation.key, conversation.summary]
    );
    for (const [index, message] of (conversation.messages as any[]).entries()) {
      await connection.execute(
        `INSERT INTO messages
         (conversation_id, sequence_number, role, content, name, tool_calls, metadata)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          conversationId, index, message.role, message.content || null, message.name || null,
          message.tool_calls ? json(message.tool_calls) : null,
          message.metadata ? json(message.metadata) : null,
        ]
      );
    }
  }

  const manhwa = core.manhwaProject;
  if (!manhwa || !storyId) return;
  await connection.execute(
    `INSERT INTO manhwa_chapters (project_id, story_id, chapter_number, title, premise, end_hook, continuity)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE title=VALUES(title), premise=VALUES(premise), end_hook=VALUES(end_hook), continuity=VALUES(continuity)`,
    [
      projectId, storyId, Number(snapshot.chapterNumber || 1), manhwa.chapterTitle,
      manhwa.premise || null, manhwa.endHook || null, json(snapshot.continuity || {}),
    ]
  );
  for (const [index, character] of (manhwa.characters || []).entries()) {
    await connection.execute(
      `INSERT INTO manhwa_characters
       (id, story_id, name, visual_description, reference_prompt, relationships, world_state, reference_asset_id, locked, display_order)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE name=VALUES(name), visual_description=VALUES(visual_description),
       reference_prompt=VALUES(reference_prompt), relationships=VALUES(relationships),
       world_state=VALUES(world_state), reference_asset_id=COALESCE(VALUES(reference_asset_id), reference_asset_id),
       locked=VALUES(locked), display_order=VALUES(display_order)`,
      [
        character.id, storyId, character.name, character.visualDescription, character.referencePrompt,
        json(character.relationships || {}), json(character.worldState || {}),
        character.imageAssetId || null, Boolean(character.locked), index,
      ]
    );
  }

  await connection.query('DELETE FROM manhwa_panel_content WHERE panel_id IN (SELECT id FROM manhwa_panels WHERE project_id = ?)', [projectId]);
  await connection.query('DELETE FROM manhwa_panels WHERE project_id = ?', [projectId]);
  for (const panel of manhwa.panels || []) {
    const [result] = await connection.execute(
      `INSERT INTO manhwa_panels
       (project_id, panel_number, visual, shot, image_prompt, character_ids, image_asset_id)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        projectId, Number(panel.number), panel.visual, panel.shot, panel.imagePrompt,
        json(panel.characterIds || []), panel.imageAssetId || null,
      ]
    );
    const panelId = (result as any).insertId;
    const content = [
      ...(panel.balloons || []).map((item: any) => ({ type: 'balloon', speaker: item.speaker, text: item.text, placement: item.position })),
      ...(panel.captions || []).map((text: string) => ({ type: 'caption', text })),
      ...(panel.sfx || []).map((text: string) => ({ type: 'sfx', text })),
    ];
    for (const [index, item] of content.entries()) {
      await connection.execute(
        'INSERT INTO manhwa_panel_content (panel_id, content_type, sequence_number, speaker, content, placement) VALUES (?, ?, ?, ?, ?, ?)',
        [panelId, item.type, index, item.speaker || null, item.text, item.placement || null]
      );
    }
  }
}

app.get('/api/health', async (_request, response) => {
  await db().query('SELECT 1');
  response.json({ ok: true, database: process.env.DB_NAME || 'delegation_memory' });
});

app.get('/api/projects', async (request, response) => {
  const includeArchived = request.query.archived === 'true';
  const [rows] = await db().execute(
    `SELECT id, team_id AS teamId, story_id AS storyId, title, brief, phase, archived,
            created_at AS createdAt, updated_at AS updatedAt
     FROM projects WHERE archived = ? ORDER BY updated_at DESC`,
    [includeArchived]
  );
  response.json(rows);
});

app.post('/api/projects', async (request, response) => {
  const id = crypto.randomUUID();
  const teamId = String(request.body.teamId || 'manhwa-studio');
  const isManhwa = teamId === 'manhwa-studio';
  const storyId = request.body.storyId || (isManhwa ? crypto.randomUUID() : null);
  const title = String(request.body.title || request.body.brief || 'Untitled project').slice(0, 255);
  const snapshot = safeProjectSnapshot(request.body.snapshot || {});
  await transaction(async (connection) => {
    if (storyId) {
      await connection.execute(
        'INSERT IGNORE INTO stories (id, title) VALUES (?, ?)',
        [storyId, String(request.body.storyTitle || title).slice(0, 255)]
      );
    }
    await connection.execute(
      'INSERT INTO projects (id, team_id, story_id, title, brief, phase, snapshot) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [id, teamId, storyId, title, snapshot.core?.userBrief || request.body.brief || null, snapshot.core?.phase || 'idle', json(snapshot)]
    );
    await saveNormalizedProject(connection, id, snapshot, storyId);
  });
  response.status(201).json({ id, storyId });
});

app.get('/api/projects/:id', async (request, response) => {
  const [rows] = await db().execute(
    'SELECT id, team_id AS teamId, story_id AS storyId, title, snapshot, created_at AS createdAt, updated_at AS updatedAt FROM projects WHERE id = ?',
    [request.params.id]
  );
  const project = (rows as any[])[0];
  if (!project) return response.status(404).json({ error: 'Project not found' });
  project.snapshot = parsed(project.snapshot);
  response.json(project);
});

app.put('/api/projects/:id', async (request, response) => {
  const snapshot = safeProjectSnapshot(request.body.snapshot || {});
  const teamId = String(request.body.teamId || snapshot.team?.selectedAgentSetId || 'manhwa-studio');
  await transaction(async (connection) => {
    const [rows] = await connection.execute('SELECT story_id FROM projects WHERE id = ? FOR UPDATE', [request.params.id]);
    const current = (rows as any[])[0];
    if (!current) throw Object.assign(new Error('Project not found'), { status: 404 });
    if (request.body.team) {
      await connection.execute(
        'INSERT INTO teams (id, snapshot) VALUES (?, ?) ON DUPLICATE KEY UPDATE snapshot=VALUES(snapshot)',
        [teamId, json(request.body.team)]
      );
    }
    await connection.execute(
      `UPDATE projects SET team_id=?, title=?, brief=?, phase=?, snapshot=? WHERE id=?`,
      [
        teamId, String(request.body.title || snapshot.core?.userBrief || 'Untitled project').slice(0, 255),
        snapshot.core?.userBrief || null, snapshot.core?.phase || 'idle', json(snapshot), request.params.id,
      ]
    );
    await saveNormalizedProject(connection, request.params.id, snapshot, current.story_id);
  });
  response.json({ ok: true });
});

app.patch('/api/projects/:id', async (request, response) => {
  if (typeof request.body.title === 'string') {
    await db().execute('UPDATE projects SET title=? WHERE id=?', [request.body.title.slice(0, 255), request.params.id]);
  }
  if (typeof request.body.archived === 'boolean') {
    await db().execute('UPDATE projects SET archived=? WHERE id=?', [request.body.archived, request.params.id]);
  }
  response.json({ ok: true });
});

app.delete('/api/projects/:id', async (request, response) => {
  const [rows] = await db().execute('SELECT storage_path FROM assets WHERE project_id=?', [request.params.id]);
  await db().execute('DELETE FROM projects WHERE id=?', [request.params.id]);
  await Promise.allSettled((rows as any[]).map((row) => fs.unlink(row.storage_path)));
  response.status(204).end();
});

app.post('/api/assets', upload.single('file'), async (request, response) => {
  if (!request.file) return response.status(400).json({ error: 'Asset file is required' });
  const projectId = String(request.body.projectId || '');
  const [projects] = await db().execute('SELECT id FROM projects WHERE id=?', [projectId]);
  if (!(projects as any[]).length) return response.status(404).json({ error: 'Project not found' });
  const id = crypto.randomUUID();
  const extension = request.file.mimetype === 'image/jpeg' ? 'jpg' : request.file.mimetype.split('/')[1].replace('mpeg', 'mp3');
  const storagePath = path.join(uploadDir, `${id}.${extension}`);
  await fs.writeFile(storagePath, request.file.buffer, { flag: 'wx' });
  const checksum = crypto.createHash('sha256').update(request.file.buffer).digest('hex');
  try {
    await db().execute(
      `INSERT INTO assets
       (id, project_id, asset_role, media_type, mime_type, storage_path, byte_size, checksum, prompt, generation_params, provider, model, supersedes_asset_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id, projectId, request.body.role || 'generated', request.file.mimetype.split('/')[0],
        request.file.mimetype, storagePath, request.file.size, checksum, request.body.prompt || null,
        request.body.params || null, request.body.provider || null, request.body.model || null,
        request.body.supersedesAssetId || null,
      ]
    );
  } catch (error) {
    await fs.unlink(storagePath).catch(() => undefined);
    throw error;
  }
  response.status(201).json({ id, url: `/api/assets/${id}/content` });
});

app.get('/api/assets/:id/content', async (request, response) => {
  const [rows] = await db().execute('SELECT storage_path, mime_type FROM assets WHERE id=?', [request.params.id]);
  const asset = (rows as any[])[0];
  if (!asset) return response.status(404).json({ error: 'Asset not found' });
  response.type(asset.mime_type).sendFile(path.resolve(asset.storage_path));
});

app.post('/api/generation-jobs', async (request, response) => {
  const id = crypto.randomUUID();
  await db().execute(
    `INSERT INTO generation_jobs (id, project_id, asset_role, prompt, parameters, provider, model, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'running')`,
    [id, request.body.projectId, request.body.role, request.body.prompt, json(request.body.parameters), request.body.provider || null, request.body.model || null]
  );
  response.status(201).json({ id });
});

app.patch('/api/generation-jobs/:id', async (request, response) => {
  await db().execute(
    'UPDATE generation_jobs SET status=?, error=?, asset_id=? WHERE id=?',
    [request.body.status, request.body.error || null, request.body.assetId || null, request.params.id]
  );
  response.json({ ok: true });
});

app.get('/api/stories/:id/memory', async (request, response) => {
  const [storyRows] = await db().execute('SELECT title, continuity_summary AS continuitySummary FROM stories WHERE id=?', [request.params.id]);
  const story = (storyRows as any[])[0];
  if (!story) return response.status(404).json({ error: 'Story not found' });
  const [characters] = await db().execute(
    'SELECT id, name, visual_description AS visualDescription, relationships, world_state AS worldState, reference_asset_id AS imageAssetId FROM manhwa_characters WHERE story_id=? ORDER BY display_order',
    [request.params.id]
  );
  const [chapters] = await db().execute(
    `SELECT project_id AS projectId, chapter_number AS chapterNumber, title, premise, end_hook AS endHook
     FROM manhwa_chapters WHERE story_id=? ORDER BY chapter_number DESC LIMIT 3`,
    [request.params.id]
  );
  response.json({ ...story, characters, recentChapters: chapters });
});

app.use((error: any, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
  if (error.status === 404) {
    console.warn('[memory-api]', error.message);
  } else {
    console.error('[memory-api]', error);
  }
  response.status(error.status || 500).json({ error: error.message || 'Internal server error' });
});

try {
  await initializeDatabase();
  app.listen(port, '127.0.0.1', () => {
    console.log(`[memory-api] http://127.0.0.1:${port} (MySQL ready)`);
  });
} catch (error) {
  console.error('[memory-api] startup failed:', error);
  process.exitCode = 1;
}
