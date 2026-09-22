/**
 * Reset the first admin password so local seeding scripts can authenticate.
 * Stop the API writer before running.
 * Usage: node scripts/reset-admin-password.mjs 'NewPassword123!'
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createStore } from '../server/database.mjs';
import { passwordHash } from '../server/security.mjs';

const password = process.argv[2] || 'WangYangming2026!';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = path.resolve(root, process.env.DATA_DIR || './data');
const store = createStore(dataDir);
try {
  const admin = store.list('user').find(u => u.role === 'admin' && u.active) || store.list('user')[0];
  if (!admin) throw new Error('No user found');
  const passwordHashValue = await passwordHash(password);
  store.put('user', { ...admin, passwordHash: passwordHashValue, updatedAt: new Date().toISOString() });
  store.db.prepare('DELETE FROM sessions WHERE user_id=?').run(admin.id);
  console.log(JSON.stringify({ ok: true, username: admin.username, passwordSet: true }, null, 2));
} finally {
  store.close();
}
