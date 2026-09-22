import { useEffect, useRef, type ReactNode } from 'react';
import { AlertCircle, CheckCircle2, Inbox, Loader2, X } from 'lucide-react';
import type { DocumentStatus } from './types';

export function PageHeader({ title, description, actions }: { title: string; description?: string; actions?: ReactNode }) { return <div className="e-page-header"><div><h1>{title}</h1>{description && <p>{description}</p>}</div>{actions && <div className="e-actions">{actions}</div>}</div>; }
export function Notice({ children, kind = 'info' }: { children: ReactNode; kind?: 'error' | 'success' | 'info' | 'warning' }) { return <div className={`e-notice ${kind}`} role={kind === 'error' ? 'alert' : 'status'}>{kind === 'success' ? <CheckCircle2 size={17}/> : <AlertCircle size={17}/>}<div>{children}</div></div>; }
export function EmptyState({ title, description, action }: { title: string; description?: string; action?: ReactNode }) { return <div className="e-empty"><Inbox size={36}/><h3>{title}</h3>{description && <p>{description}</p>}{action}</div>; }
export function Loading({ text = '正在加载…' }: { text?: string }) { return <div className="e-loading" role="status"><Loader2 className="e-spin" size={20}/>{text}</div>; }
export const statusLabels: Record<DocumentStatus, string> = { queued: '等待处理', processing: '正在解析', review: '待审核', published: '已发布', rejected: '已退回', failed: '处理失败', archived: '已下架', superseded: '历史版本' };
export function StatusBadge({ status }: { status: DocumentStatus | string }) { return <span className={`e-badge ${status}`}>{statusLabels[status as DocumentStatus] || status}</span>; }
export function Modal({ title, children, onClose, wide = false, busy = false }: { title: string; children: ReactNode; onClose: () => void; wide?: boolean; busy?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose); closeRef.current = onClose;
  const busyRef = useRef(busy); busyRef.current = busy;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const node = ref.current;
    const focusable = () => Array.from(node?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),a[href],[tabindex]') || [])
      .filter(element => element.tabIndex >= 0 && element.getClientRects().length > 0 && getComputedStyle(element).visibility !== 'hidden' && !element.closest('[inert],[aria-hidden="true"]'));
    const items = focusable();
    const initial = items.find(element => element.matches('[autofocus]')) || items.find(element => element.matches('input,textarea,[role="combobox"]')) || items[0];
    initial?.focus();
    const key = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (event.key === 'Escape' && !busyRef.current) { event.preventDefault(); closeRef.current(); return; }
      if (event.key !== 'Tab') return;
      const elements = focusable(); const first = elements[0]; const last = elements[elements.length - 1];
      if (!first) { event.preventDefault(); return; }
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', key);
    return () => { document.body.style.overflow = overflow; document.removeEventListener('keydown', key); if (previous?.isConnected) previous.focus(); };
  }, []);
  return <div className="e-modal-backdrop"><div className={`e-modal ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-label={title} ref={ref}><div className="e-modal-title"><h2>{title}</h2><button className="e-icon-btn" onClick={onClose} disabled={busy} aria-label="关闭"><X size={20}/></button></div>{children}</div></div>;
}
