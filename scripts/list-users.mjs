import { DatabaseSync } from 'node:sqlite';
const db = new DatabaseSync(new URL('../data/knowledge.sqlite', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'), { readOnly: true });
const rows = db.prepare("SELECT data FROM entities WHERE kind=?").all('user');
for (const row of rows) {
  const u = JSON.parse(row.data);
  console.log(JSON.stringify({ id: u.id, username: u.username, name: u.name, role: u.role, active: u.active, hasPassword: !!u.passwordHash }));
}
db.close();
