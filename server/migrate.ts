import { initializeDatabase } from './db.js';

const pool = await initializeDatabase();
console.log('[memory-api] MySQL schema is ready');
await pool.end();
