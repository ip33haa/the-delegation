import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';

test('schema contains every durable memory domain', async () => {
  const schema = await fs.readFile(new URL('./schema.sql', import.meta.url), 'utf8');
  for (const table of [
    'projects',
    'tasks',
    'task_revisions',
    'conversations',
    'messages',
    'stories',
    'manhwa_characters',
    'manhwa_chapters',
    'manhwa_panels',
    'manhwa_panel_content',
    'assets',
    'generation_jobs',
  ]) {
    assert.match(schema, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}\\b`));
  }
});

test('MySQL migration and transactional project recovery', { skip: process.env.RUN_MYSQL_TESTS !== 'true' }, async () => {
  const { initializeDatabase, transaction } = await import('./db.js');
  const pool = await initializeDatabase();
  const id = crypto.randomUUID();
  await transaction(async (connection) => {
    await connection.execute(
      'INSERT INTO projects (id, team_id, title, phase, snapshot) VALUES (?, ?, ?, ?, ?)',
      [id, 'test-team', 'Recovery test', 'working', JSON.stringify({ core: { tasks: [] } })]
    );
  });
  const [rows] = await pool.execute('SELECT title, phase FROM projects WHERE id=?', [id]);
  assert.deepEqual((rows as any[])[0], { title: 'Recovery test', phase: 'working' });
  await pool.execute('DELETE FROM projects WHERE id=?', [id]);
  await pool.end();
});
