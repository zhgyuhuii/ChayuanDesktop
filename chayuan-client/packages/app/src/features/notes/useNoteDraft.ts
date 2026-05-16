/**
 * 笔记草稿持久化 — localStorage,debounce 500ms。
 *
 * 用法:
 *   const draft = useNoteDraft('chayuan:note-draft:new');
 *   useEffect(() => draft.save(title, content), [title, content]);
 *   const initial = draft.load();
 *   draft.clear() 保存成功后调用
 */
import * as React from 'react';

export interface NoteDraftPayload {
  title: string;
  content: any; // Tiptap JSON
  savedAt: string;
}

export interface UseNoteDraftResult {
  load: () => NoteDraftPayload | null;
  save: (title: string, content: any) => void;
  clear: () => void;
}

export function useNoteDraft(key = 'chayuan:note-draft:new'): UseNoteDraftResult {
  const debounceRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = React.useCallback((): NoteDraftPayload | null => {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return null;
      return JSON.parse(raw) as NoteDraftPayload;
    } catch {
      return null;
    }
  }, [key]);

  const save = React.useCallback(
    (title: string, content: any) => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        try {
          localStorage.setItem(
            key,
            JSON.stringify({ title, content, savedAt: new Date().toISOString() }),
          );
        } catch {
          /* quota / privacy 模式;静默忽略 */
        }
      }, 500);
    },
    [key],
  );

  const clear = React.useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    try {
      localStorage.removeItem(key);
    } catch {
      /* ignore */
    }
  }, [key]);

  React.useEffect(
    () => () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    },
    [],
  );

  return { load, save, clear };
}
