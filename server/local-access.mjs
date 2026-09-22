import { now, uid } from './database.mjs';
import { requireValue } from './security.mjs';

const loopbackHosts = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);
const loopbackPeers = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
export const accountUsers = store => store.list('user').filter(user => !user.localOnly);

// This reversible development mode keeps a stable actor for document ownership and audit.
// It never creates a password or an authenticated browser session.
export function createLocalAccess(store, createDefaultBase) {
  const mode = process.env.AUTH_MODE || 'password';
  requireValue(['password', 'local'].includes(mode), 500, 'AUTH_MODE_INVALID', 'AUTH_MODE 只能设置为 password 或 local。');
  const existing = store.list('user').filter(user => user.localOnly);
  if (mode !== 'local') {
    for (const user of existing) {
      if (user.active) store.put('user', { ...user, active: false });
      store.db.prepare('DELETE FROM sessions WHERE user_id=?').run(user.id);
    }
    return { enabled: false, user: null, assertRequest() {} };
  }
  requireValue(loopbackHosts.has(process.env.API_HOST || '127.0.0.1'), 500, 'LOCAL_ACCESS_BIND_REQUIRED', '临时免登录仅允许监听本机地址。');
  const previous = existing[0];
  const user = { ...(previous || { id: uid('user_'), username: '__local_workspace__', createdAt: now() }), name: '本地工作空间', department: '本地使用', role: 'admin', active: true, passwordHash: null, localOnly: true };
  store.transaction(() => {
    store.put('user', user);
    if (!store.list('base').length) createDefaultBase(user);
    if (!previous?.active) store.audit(user, 'auth.local_enabled', { message: '已启用本机临时免登录工作空间' });
  });
  return {
    enabled: true,
    user: { ...user, authMode: 'local' },
    assertRequest(req) {
      let hostname = '';
      try { hostname = new URL('http://' + req.headers.host).hostname; } catch {}
      const forwarded = ['forwarded', 'x-forwarded-for', 'x-forwarded-host', 'x-real-ip'].some(name => req.headers[name]);
      requireValue(loopbackPeers.has(req.socket.remoteAddress) && loopbackHosts.has(hostname) && !forwarded, 403, 'LOCAL_ACCESS_ONLY', '临时免登录仅支持本机直接访问，请使用 localhost 地址。');
      if (req.headers.origin) {
        let originHost = '';
        try { originHost = new URL(req.headers.origin).hostname; } catch {}
        requireValue(loopbackHosts.has(originHost), 403, 'LOCAL_ACCESS_ONLY', '临时免登录仅支持本机页面。');
      }
    },
  };
}
