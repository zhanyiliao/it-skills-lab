import mysql from 'mysql2/promise';
import { config } from './config.js';
export function createPool(options = {}) {
  return mysql.createPool({ ...config.db, ...options });
}
export async function transaction(pool, work) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const result = await work(connection);
    await connection.commit();
    return result;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally { connection.release(); }
}
export async function one(db, sql, values = []) {
  const [rows] = await db.execute(sql, values);
  return rows[0] ?? null;
}
