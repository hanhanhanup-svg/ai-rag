import {
  forwardRef, useCallback, useEffect, useId, useImperativeHandle, useLayoutEffect,
  useRef, useState, type CSSProperties, type KeyboardEvent, type SelectHTMLAttributes,
} from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown, Search } from 'lucide-react';

type OptionItem = { index: number; value: string; label: string; group: string; groupKey: string; disabled: boolean };
type PopupPosition = { left: number; top: number; width: number; maxHeight: number; side: 'top' | 'bottom' };
const normalize = (value: string) => value.trim().toLocaleLowerCase();
const focusableSelector = 'button:not(:disabled),input:not(:disabled),textarea:not(:disabled),select:not(:disabled),a[href],[tabindex]';

/** Keeps a real select as the form/event bridge while presenting an accessible, searchable listbox. */
export const SelectControl = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function SelectControl(props, forwardedRef) {
  const { children, className = '', style, onChange, onInvalid, onFocus, autoFocus, tabIndex, ...nativeProps } = props;
  const nativeRef = useRef<HTMLSelectElement>(null);
  const wrapperRef = useRef<HTMLSpanElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const composingRef = useRef(false);
  const typeaheadRef = useRef({ text: '', at: 0 });
  const snapshotRef = useRef('');
  const generatedId = useId().replace(/:/g, '');
  const listId = `xc-select-list-${generatedId}`;
  const validationId = `xc-select-error-${generatedId}`;
  const [options, setOptions] = useState<OptionItem[]>([]);
  const [selectedIndexes, setSelectedIndexes] = useState<number[]>([]);
  const [accessibleName, setAccessibleName] = useState('选择内容');
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(-1);
  const [invalid, setInvalid] = useState(false);
  const [portalHost, setPortalHost] = useState<Element | null>(null);
  const [dark, setDark] = useState(false);
  const [position, setPosition] = useState<PopupPosition>({ left: 0, top: 0, width: 240, maxHeight: 320, side: 'bottom' });
  const searchable = options.length > 6;
  const filtered = options.filter(option => !query || normalize(`${option.label} ${option.group}`).includes(normalize(query)));
  const enabled = filtered.filter(option => !option.disabled);
  const selected = options.filter(option => selectedIndexes.includes(option.index));
  const displayedValue = selected.map(option => option.label).join('、') || '请选择';

  useImperativeHandle(forwardedRef, () => nativeRef.current!, []);

  const syncFromNative = useCallback(() => {
    const select = nativeRef.current;
    if (!select) return;
    const groups = Array.from(select.querySelectorAll('optgroup'));
    const nextOptions = Array.from(select.options).map((option, index) => {
      const group = option.parentElement instanceof HTMLOptGroupElement ? option.parentElement : null;
      return { index, value: option.value, label: option.label || option.textContent || '', group: group?.label || '', groupKey: group ? `group-${groups.indexOf(group)}` : '', disabled: option.disabled || Boolean(group?.disabled) };
    });
    const nextSelected = Array.from(select.options).flatMap((option, index) => option.selected ? [index] : []);
    const labels = Array.from(select.labels || []).map(label => {
      const copy = label.cloneNode(true) as HTMLElement;
      copy.querySelectorAll('.xc-select, input, select, textarea, button').forEach(node => node.remove());
      return copy.textContent?.trim() || '';
    }).filter(Boolean).join(' ');
    const name = select.getAttribute('aria-label') || labels || select.title || '选择内容';
    const snapshot = JSON.stringify([nextOptions, nextSelected, name]);
    if (snapshot !== snapshotRef.current) {
      snapshotRef.current = snapshot;
      setOptions(nextOptions); setSelectedIndexes(nextSelected); setAccessibleName(name);
    }
    if (select.validity.valid) setInvalid(false);
  }, []);

  // React has committed option/value changes before this effect; DOM parsing also supports optgroups and fragments.
  useLayoutEffect(syncFromNative);
  useEffect(() => {
    const select = nativeRef.current;
    if (!select) return;
    const observer = new MutationObserver(syncFromNative);
    observer.observe(select, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['disabled', 'label', 'value', 'selected'] });
    return () => observer.disconnect();
  }, [syncFromNative]);
  useEffect(() => {
    const form = nativeRef.current?.form;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const reset = () => { setOpen(false); setQuery(''); setInvalid(false); timer = setTimeout(syncFromNative, 0); };
    form?.addEventListener('reset', reset);
    return () => { form?.removeEventListener('reset', reset); if (timer) clearTimeout(timer); };
  }, [nativeProps.form, syncFromNative]);
  useEffect(() => { if (autoFocus) triggerRef.current?.focus(); }, [autoFocus]);
  useEffect(() => { if (nativeProps.disabled) setOpen(false); }, [nativeProps.disabled]);

  const close = useCallback((restoreFocus = false) => {
    setOpen(false); setQuery(''); composingRef.current = false;
    if (restoreFocus) triggerRef.current?.focus({ preventScroll: true });
  }, []);
  const show = (initialQuery = '') => {
    if (nativeProps.disabled) return;
    syncFromNative();
    setPortalHost(triggerRef.current?.closest('.e-modal') || document.body);
    setDark(Boolean(triggerRef.current?.closest('.e-graph-scene, [data-controls-theme="dark"]')));
    setQuery(initialQuery);
    setActiveIndex(selected.find(option => !option.disabled)?.index ?? options.find(option => !option.disabled)?.index ?? -1);
    setOpen(true);
  };

  const updatePosition = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const viewport = window.visualViewport;
    const viewportLeft = viewport?.offsetLeft || 0;
    const viewportTop = viewport?.offsetTop || 0;
    const viewportWidth = viewport?.width || document.documentElement.clientWidth;
    const viewportHeight = viewport?.height || window.innerHeight;
    const margin = 12; const gap = 7;
    const width = Math.min(Math.max(rect.width, 240), viewportWidth - margin * 2);
    const below = viewportTop + viewportHeight - rect.bottom - margin - gap;
    const above = rect.top - viewportTop - margin - gap;
    const side = below < 250 && above > below ? 'top' : 'bottom';
    const maxHeight = Math.max(60, Math.min(360, side === 'top' ? above : below, viewportHeight - margin * 2));
    const height = Math.min(popupRef.current?.getBoundingClientRect().height || maxHeight, maxHeight);
    const left = Math.max(viewportLeft + margin, Math.min(rect.left, viewportLeft + viewportWidth - width - margin));
    const desiredTop = side === 'top' ? rect.top - height - gap : rect.bottom + gap;
    const top = Math.max(viewportTop + margin, Math.min(desiredTop, viewportTop + viewportHeight - height - margin));
    setPosition(previous => previous.left === left && previous.top === top && previous.width === width && previous.maxHeight === maxHeight && previous.side === side ? previous : { left, top, width, maxHeight, side });
  }, []);

  useLayoutEffect(() => {
    if (!open) return;
    updatePosition();
    const frame = requestAnimationFrame(() => { updatePosition(); if (searchable) searchRef.current?.focus({ preventScroll: true }); });
    return () => cancelAnimationFrame(frame);
  }, [open, searchable, updatePosition]);
  useEffect(() => {
    if (!open) return;
    let frame = 0;
    const positionLater = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(updatePosition); };
    const outside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!wrapperRef.current?.contains(target) && !popupRef.current?.contains(target)) close();
    };
    const observer = new ResizeObserver(positionLater);
    if (triggerRef.current) observer.observe(triggerRef.current);
    if (popupRef.current) observer.observe(popupRef.current);
    document.addEventListener('pointerdown', outside, true);
    window.addEventListener('resize', positionLater);
    window.addEventListener('scroll', positionLater, true);
    window.visualViewport?.addEventListener('resize', positionLater);
    window.visualViewport?.addEventListener('scroll', positionLater);
    return () => {
      cancelAnimationFrame(frame); observer.disconnect(); document.removeEventListener('pointerdown', outside, true);
      window.removeEventListener('resize', positionLater); window.removeEventListener('scroll', positionLater, true);
      window.visualViewport?.removeEventListener('resize', positionLater); window.visualViewport?.removeEventListener('scroll', positionLater);
    };
  }, [open, close, updatePosition]);
  useEffect(() => {
    if (open && !enabled.some(option => option.index === activeIndex)) setActiveIndex(enabled[0]?.index ?? -1);
  }, [open, query, options, activeIndex]);
  useEffect(() => {
    if (open && activeIndex >= 0) popupRef.current?.querySelector<HTMLElement>(`[data-option-index="${activeIndex}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [open, activeIndex]);

  const choose = (item: OptionItem) => {
    const select = nativeRef.current;
    if (!select || select.disabled || item.disabled) return;
    const nativeOption = select.options[item.index];
    if (!nativeOption) return;
    if (select.multiple) nativeOption.selected = !nativeOption.selected;
    else select.selectedIndex = item.index;
    // Dispatch through the real DOM select so existing React ChangeEvents and FormData keep their native shape.
    select.dispatchEvent(new Event('input', { bubbles: true }));
    select.dispatchEvent(new Event('change', { bubbles: true }));
    syncFromNative(); queueMicrotask(syncFromNative);
    if (!select.multiple) close(true);
    else setActiveIndex(item.index);
  };
  const focusAfterTrigger = (backward: boolean) => {
    const trigger = triggerRef.current;
    if (!trigger) return false;
    const modal = trigger.closest('.e-modal');
    const scope = modal || document;
    const candidates = Array.from(scope.querySelectorAll<HTMLElement>(focusableSelector)).filter(element => element.tabIndex >= 0 && element.getClientRects().length > 0 && !element.closest('[aria-hidden="true"], [inert]') && !popupRef.current?.contains(element));
    const index = candidates.indexOf(trigger);
    let next = index + (backward ? -1 : 1);
    if (modal && candidates.length) next = (next + candidates.length) % candidates.length;
    if (index >= 0 && candidates[next]) { candidates[next].focus(); return true; }
    trigger.focus(); return false;
  };
  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229 || composingRef.current) return;
    if (event.key === 'Escape' && open) { event.preventDefault(); event.stopPropagation(); close(true); return; }
    if (event.key === 'Tab' && open) {
      close(); if (focusAfterTrigger(event.shiftKey)) { event.preventDefault(); event.stopPropagation(); } return;
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!open) { show(); return; }
      const current = enabled.findIndex(option => option.index === activeIndex);
      const next = current < 0 ? (event.key === 'ArrowDown' ? 0 : enabled.length - 1) : (current + (event.key === 'ArrowDown' ? 1 : -1) + enabled.length) % enabled.length;
      setActiveIndex(enabled[next]?.index ?? -1); return;
    }
    if ((event.key === 'Home' || event.key === 'End') && open && event.target !== searchRef.current) {
      event.preventDefault(); setActiveIndex(event.key === 'Home' ? enabled[0]?.index ?? -1 : enabled[enabled.length - 1]?.index ?? -1); return;
    }
    if (event.key === 'Enter' || (event.key === ' ' && event.target !== searchRef.current)) {
      event.preventDefault();
      if (!open) show(); else { const option = enabled.find(item => item.index === activeIndex); if (option) choose(option); }
      return;
    }
    if (event.target !== searchRef.current && event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault();
      if (searchable) { if (!open) show(event.key); else { setQuery(value => value + event.key); searchRef.current?.focus(); } }
      else {
        const now = Date.now(); const text = now - typeaheadRef.current.at < 800 ? typeaheadRef.current.text + event.key : event.key;
        typeaheadRef.current = { text, at: now };
        const option = options.find(item => !item.disabled && normalize(item.label).startsWith(normalize(text)));
        if (!open) show(); if (option) setActiveIndex(option.index);
      }
    }
  };
  const error = invalid || props['aria-invalid'] === true || props['aria-invalid'] === 'true';
  const describedBy = [props['aria-describedby'], invalid ? validationId : ''].filter(Boolean).join(' ') || undefined;
  const activeId = activeIndex >= 0 ? `${listId}-option-${activeIndex}` : undefined;
  const popupStyle: CSSProperties = { position: 'fixed', left: position.left, top: position.top, width: position.width, maxHeight: position.maxHeight, zIndex: 1200 };

  return <span ref={wrapperRef} className={`xc-select ${className}`.trim()} style={style} data-state={open ? 'open' : 'closed'} data-disabled={Boolean(props.disabled)} data-invalid={error} data-multiple={Boolean(props.multiple)}>
    <select {...nativeProps} ref={nativeRef} className="xc-select-native" tabIndex={-1} aria-hidden="true" autoFocus={false}
      onFocus={event => { onFocus?.(event); triggerRef.current?.focus({ preventScroll: true }); }}
      onClick={event => { props.onClick?.(event); event.preventDefault(); triggerRef.current?.focus({ preventScroll: true }); }}
      onChange={event => { onChange?.(event); syncFromNative(); }}
      onInvalid={event => { onInvalid?.(event); event.preventDefault(); setInvalid(true); triggerRef.current?.focus(); }}>
      {children}
    </select>
    <button ref={triggerRef} type="button" className="xc-select-trigger" role="combobox" disabled={props.disabled} tabIndex={tabIndex}
      aria-label={props['aria-labelledby'] ? undefined : accessibleName} aria-labelledby={props['aria-labelledby']} aria-describedby={describedBy}
      aria-invalid={error || undefined} aria-required={props.required || undefined} aria-haspopup="listbox" aria-expanded={open} aria-controls={open ? listId : undefined}
      aria-activedescendant={open && !searchable ? activeId : undefined} title={props.title || displayedValue}
      onClick={event => { event.preventDefault(); if (open) close(); else show(); }} onKeyDown={onKeyDown}>
      <span className="xc-select-value" data-placeholder={!selected.length || (selected.length === 1 && selected[0].value === '')}>{displayedValue}</span>
      <span className="xc-select-indicator" aria-hidden="true"><ChevronDown size={17}/></span>
    </button>
    {invalid && <span id={validationId} className="xc-select-validation" role="alert">请选择一项内容</span>}
    {open && portalHost && createPortal(<div ref={popupRef} className="xc-select-popover" style={popupStyle} data-side={position.side} data-theme={dark ? 'dark' : 'light'} onKeyDown={onKeyDown}>
      {searchable && <div className="xc-select-search-wrap"><Search size={16} aria-hidden="true"/><input ref={searchRef} className="xc-select-search" type="search" value={query} placeholder="输入关键词筛选…" autoComplete="off" spellCheck={false}
        role="combobox" aria-label={`筛选${accessibleName}`} aria-expanded="true" aria-controls={listId} aria-activedescendant={activeId}
        onCompositionStart={() => { composingRef.current = true; }} onCompositionEnd={() => { composingRef.current = false; }}
        onChange={event => setQuery(event.target.value)}/></div>}
      <div id={listId} className="xc-select-list" role="listbox" aria-label={accessibleName} aria-multiselectable={props.multiple || undefined}>
        {filtered.map((option, index) => <div className="xc-select-option-wrap" key={`${option.index}-${option.value}`} role="presentation">
          {option.group && (index === 0 || filtered[index - 1].groupKey !== option.groupKey) && <div className="xc-select-group-label">{option.group}</div>}
          <button id={`${listId}-option-${option.index}`} type="button" className="xc-select-option" role="option" tabIndex={-1}
            aria-selected={selectedIndexes.includes(option.index)} aria-disabled={option.disabled || undefined}
            data-option-index={option.index} data-selected={selectedIndexes.includes(option.index)} data-active={activeIndex === option.index} data-disabled={option.disabled}
            onMouseDown={event => event.preventDefault()} onMouseEnter={() => { if (!option.disabled) setActiveIndex(option.index); }} onClick={() => choose(option)}>
            <span className="xc-select-option-label">{option.label || '（空选项）'}</span>{selectedIndexes.includes(option.index) && <Check size={16} aria-hidden="true"/>}
          </button>
        </div>)}
        {!filtered.length && <div className="xc-select-empty" role="status">没有匹配的选项<span>请尝试其他关键词</span></div>}
      </div>
      <div className="xc-select-footer"><span>{query ? `${filtered.length} / ${options.length} 项` : `共 ${options.length} 项`}{props.multiple ? ` · 已选 ${selected.length} 项` : ''}</span><span className="xc-select-footer-hint">↑↓ 选择 · Enter 确认</span></div>
    </div>, portalHost)}
  </span>;
});

