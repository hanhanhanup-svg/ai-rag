import crypto from 'node:crypto';
import { promisify } from 'node:util';
const scrypt=promisify(crypto.scrypt);
export function failure(status,code,message){return Object.assign(new Error(message),{status,code});}
export function requireValue(condition,status,code,message){if(!condition)throw failure(status,code,message);}
export async function passwordHash(password){validatePassword(password);const salt=crypto.randomBytes(16).toString('hex');const hash=await scrypt(password,salt,64,{N:16384,r:8,p:1});return `${salt}:${hash.toString('hex')}`;}
export async function verifyPassword(password,encoded){if(typeof password!=='string'||password.length>200||!encoded)return false;const [salt,hash]=encoded.split(':');const actual=await scrypt(password,salt,64,{N:16384,r:8,p:1});const expected=Buffer.from(hash,'hex');return actual.length===expected.length&&crypto.timingSafeEqual(actual,expected);}
export function validatePassword(password){requireValue(typeof password==='string'&&password.length>=12&&password.length<=200&&/[a-zA-Z]/.test(password)&&/\d/.test(password),400,'WEAK_PASSWORD','密码至少 12 位，须同时包含字母和数字。');}
export function safeUser(user){if(!user)return null;const {passwordHash,...safe}=user;return safe;}
export function isAdmin(user){return user?.role==='admin';}
export function canEdit(user){return user?.role==='admin'||user?.role==='editor';}
export function canBase(user,base){if(!base||!user)return false;return isAdmin(user)||base.ownerId===user.id||base.members?.includes(user.id)||base.visibility==='company'||(base.visibility==='department'&&!!user.department&&base.department===user.department);}
export function canDocument(user,document,store,{write=false}={}){
  if(!document||document.deletedAt||!canBase(user,store.get('base',document.baseId)))return false;
  if(document.learning||store.get('base',document.baseId)?.systemKind==='feedback_learning'){
    if(!feedbackLearningAccess(store,user,document))return false;
    if(!write&&document.status==='published'&&!feedbackLearningReferencesCurrent(store,document))return false;
  }
  if(isAdmin(user))return true;
  const base=store.get('base',document.baseId);
  const sourceUnavailable=document.source?.accessState==='withdrawn'||(document.source?.freshUntil&&Date.parse(document.source.freshUntil)<=Date.now());
  if(sourceUnavailable&&!(canEdit(user)&&(document.ownerId===user.id||base.ownerId===user.id)))return false;
  if(document.sensitivity==='confidential'&&document.ownerId!==user.id&&base.ownerId!==user.id&&!base.members?.includes(user.id))return false;
  if(write)return canEdit(user)&&(document.ownerId===user.id||base.ownerId===user.id);
  return document.status==='published'||document.ownerId===user.id||(canEdit(user)&&base.ownerId===user.id);
}
export function isRetrievable(doc){const time=Date.now();return !doc.deletedAt&&doc.source?.accessState!=='withdrawn'&&(!doc.source?.freshUntil||Date.parse(doc.source.freshUntil)>time)&&doc.status==='published'&&(!doc.effectiveAt||Date.parse(doc.effectiveAt)<=time)&&(!doc.expiresAt||Date.parse(doc.expiresAt)>time);}
export function sessionHash(token){return crypto.createHash('sha256').update(token).digest('hex');}
export function authenticate(req,store){const cookie=req.headers.cookie?.split(';').map(v=>v.trim()).find(v=>v.startsWith('xrag_session='));if(!cookie)return null;const token=cookie.slice(13);const session=store.db.prepare('SELECT user_id,expires_at FROM sessions WHERE token_hash=?').get(sessionHash(token));if(!session||session.expires_at<Date.now())return null;const user=store.get('user',session.user_id);return user?.active?user:null;}
export function issueSession(res,user,store){const token=crypto.randomBytes(32).toString('base64url');store.db.prepare('INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)').run(sessionHash(token),user.id,Date.now()+8*60*60*1000);res.setHeader('Set-Cookie',`xrag_session=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=28800${process.env.COOKIE_SECURE==='true'?'; Secure':''}`);}
export function clearSession(req,res,store){const cookie=req.headers.cookie?.split(';').map(v=>v.trim()).find(v=>v.startsWith('xrag_session='));if(cookie)store.db.prepare('DELETE FROM sessions WHERE token_hash=?').run(sessionHash(cookie.slice(13)));res.setHeader('Set-Cookie',`xrag_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${process.env.COOKIE_SECURE==='true'?'; Secure':''}`);}
export function validateOrigin(req){if(['GET','HEAD','OPTIONS'].includes(req.method))return;let origin;try{origin=new URL(req.headers.origin).origin;}catch{throw failure(403,'ORIGIN_REQUIRED','写入操作必须来自本系统页面。');}const allowed=(process.env.ALLOWED_ORIGINS||'http://localhost:5173,http://127.0.0.1:5173,http://localhost:8787,http://127.0.0.1:8787').split(',').map(s=>s.trim());requireValue(allowed.includes(origin),403,'ORIGIN_DENIED','页面来源不被允许，请使用已配置的系统地址。');}
export function limiter(){const windows=new Map();return function(key,limit=60,period=60000){const t=Date.now();let w=windows.get(key);if(!w||w.until<t){w={n:0,until:t+period};windows.set(key,w);}w.n++;if(windows.size>10000)for(const [k,v]of windows)if(v.until<t)windows.delete(k);requireValue(w.n<=limit,429,'RATE_LIMIT','操作过于频繁，请稍后重试。');};}
export function cleanString(value,max=300){return typeof value==='string'?value.trim().slice(0,max):'';}
export function validateDates(effectiveAt,expiresAt){for(const value of [effectiveAt,expiresAt])requireValue(!value||Number.isFinite(Date.parse(value)),400,'INVALID_DATE','日期格式不正确。');requireValue(!effectiveAt||!expiresAt||Date.parse(expiresAt)>Date.parse(effectiveAt),400,'INVALID_DATE_RANGE','失效日期须晚于生效日期。');}

// Feedback learning keeps its original access boundary even inside the shared system base.
export function feedbackLearningFingerprint(feedback) {
  return crypto.createHash('sha256').update(JSON.stringify([feedback.id, feedback.userId, feedback.documentId || null, feedback.messageId || null, feedback.question || '', feedback.comment || '', feedback.resolution || ''])).digest('hex');
}
export function learningSourceFingerprint(document, chunks) {
  return crypto.createHash('sha256').update(JSON.stringify([document.id, document.version, document.contentRevision || 1, document.sha256, document.source?.sourceRevision, document.source?.permissionMappingVersion, chunks])).digest('hex');
}
export function feedbackLearningAccess(store, user, document) {
  const learning = document?.learning;
  if (!user || learning?.schemaVersion !== 1 || !learning.feedbackId || !Array.isArray(learning.sourceSnapshots)) return false;
  const feedback = store.get('feedback', learning.feedbackId);
  if (!feedback || feedback.userId !== learning.sourceUserId || (feedback.documentId || null) !== learning.sourceDocumentId) return false;
  if (!learning.sourceDocumentId && !isAdmin(user) && user.id !== learning.sourceUserId) return false;
  if (learning.sourceDocumentId && !learning.sourceSnapshots.some(ref => ref.documentId === learning.sourceDocumentId)) return false;
  return learning.sourceSnapshots.every(ref => {
    const source = store.get('document', ref.documentId);
    return source && !source.learning && store.get('base', source.baseId)?.systemKind !== 'feedback_learning' && canDocument(user, source, store);
  });
}
export function feedbackLearningContentCurrent(store, document) {
  const learning = document?.learning, feedback = learning && store.get('feedback', learning.feedbackId);
  if (!feedback || learning.feedbackFingerprint !== feedbackLearningFingerprint(feedback)) return false;
  const resolution = String(feedback.resolution || '').trim(), confirmed = String(learning.confirmedConclusion || '').trim();
  if (learning.hasResolution !== !!confirmed || resolution && (learning.conclusionSource !== 'feedback_resolution' || confirmed !== resolution)) return false;
  if (confirmed && !['feedback_resolution', 'learning_confirmation'].includes(learning.conclusionSource)) return false;
  if (document.status === 'published' && !learning.hasResolution) return false;
  return learning.chunksFingerprint === crypto.createHash('sha256').update(JSON.stringify(store.chunks(document.id))).digest('hex');
}

export function feedbackLearningReferencesCurrent(store, document) {
  if (!feedbackLearningContentCurrent(store, document)) return false;
  const learning = document.learning;
  if (store.get('feedbackLearning', learning.feedbackId)?.documentId !== document.id) return false;
  return learning.sourceSnapshots.every(ref => {
    const source = store.get('document', ref.documentId);
    return source && isRetrievable(source) && source.version === ref.version
      && learningSourceFingerprint(source, store.chunks(source.id)) === ref.contentFingerprint;
  });
}