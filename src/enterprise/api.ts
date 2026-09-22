import { useCallback, useEffect, useRef, useState } from 'react';

export class ApiError extends Error { constructor(message: string, public status: number, public code = '') { super(message); this.name = 'ApiError'; } }
export function errorMessage(error: unknown) { return error instanceof Error ? error.message : '操作未完成，请稍后重试。'; }
export async function api<T = Record<string, unknown>>(path: string, options: RequestInit = {}): Promise<T> {
  let response: Response;
  try { response = await fetch(path.startsWith('/api/') || path === '/ready.json' ? path : `/api${path.startsWith('/') ? path : `/${path}`}`, { credentials: 'same-origin', ...options, headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...options.headers } }); }
  catch (error) { if (error instanceof Error && error.name === 'AbortError') throw error; throw new ApiError('暂时无法连接服务，请检查服务是否运行后重试。', 0); }
  const contentType = response.headers.get('content-type') || '';
  const body = contentType.includes('application/json') ? await response.json() : null;
  if (!response.ok) { if (response.status === 401 && !path.includes('/auth/') && path !== '/setup') window.dispatchEvent(new Event('enterprise:unauthorized')); throw new ApiError(body?.error?.message || `请求未完成（${response.status}）`, response.status, body?.error?.code || ''); }
  if (!body && response.status !== 204) throw new ApiError('服务返回了无法识别的内容，请确认后台服务已启动。', response.status);
  return body as T;
}
export function useResource<T>(path: string | null) {
  const [state, setState] = useState<{path: string | null; data: T | null; error: string; loading: boolean}>({path, data: null, error: '', loading: Boolean(path)}); const [revision, setRevision] = useState(0); const requestId = useRef(0);
  const reload = useCallback(() => setRevision(n => n + 1), []);
  useEffect(() => { const id = ++requestId.current; if (!path) { setState({path, data: null, error: '', loading: false}); return; } const controller = new AbortController(); setState(old => ({path, data: old.path === path ? old.data : null, error: '', loading: true})); api<T>(path, { signal: controller.signal }).then(value => { if (id === requestId.current) setState({path, data: value, error: '', loading: false}); }).catch(e => { if (!controller.signal.aborted && id === requestId.current) setState({path, data: null, error: errorMessage(e), loading: false}); }); return () => controller.abort(); }, [path, revision]);
  return state.path === path ? { data: state.data, error: state.error, loading: state.loading, reload } : { data: null, error: '', loading: Boolean(path), reload };
}
export function formatDate(value?: string | number | null) { if (!value) return '—'; const date = new Date(value); return Number.isNaN(date.valueOf()) ? '—' : date.toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }); }
export function formatBytes(size = 0) { return size >= 1048576 ? `${(size / 1048576).toFixed(1)} MB` : size >= 1024 ? `${(size / 1024).toFixed(1)} KB` : `${size} B`; }
export function fileBase64(file: File): Promise<string> { return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(',')[1]); reader.onerror = () => reject(new Error(`无法读取 ${file.name}`)); reader.readAsDataURL(file); }); }
