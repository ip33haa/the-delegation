import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';
import mysql, { type Pool, type PoolConnection } from 'mysql2/promise';

const database = process.env.DB_NAME || 'delegation_memory';
if (!/^[a-zA-Z0-9_]+$/.test(database)) {
  throw new Error('DB_NAME may contain only letters, numbers, and underscores');
}

const connection = {
  host: process.env.DB_HOST || '127.0.0.1',
  // 3307 avoids colliding with XAMPP's general-purpose/corrupted 3306 instance.
  port: Number(process.env.DB_PORT || 3307),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
};

let pool: Pool | null = null;

export async function initializeDatabase(): Promise<Pool> {
  const bootstrap = await mysql.createConnection(connection);
  await bootstrap.query(
    `CREATE DATABASE IF NOT EXISTS \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
  );
  await bootstrap.end();

  pool = mysql.createPool({
    ...connection,
    database,
    waitForConnections: true,
    connectionLimit: 8,
    namedPlaceholders: true,
    multipleStatements: true,
    charset: 'utf8mb4',
  });
  const schema = await fs.readFile(path.resolve('server/schema.sql'), 'utf8');
  await pool.query(schema);
  await pool.query(
    "UPDATE generation_jobs SET status = 'failed', error = 'Generation interrupted by server restart' WHERE status IN ('queued', 'running')"
  );
  return pool;
}

export function db(): Pool {
  if (!pool) throw new Error('Database has not been initialized');
  return pool;
}

export async function transaction<T>(work: (connection: PoolConnection) => Promise<T>): Promise<T> {
  const connection = await db().getConnection();
  try {
    await connection.beginTransaction();
    const result = await work(connection);
    await connection.commit();
    return result;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}
