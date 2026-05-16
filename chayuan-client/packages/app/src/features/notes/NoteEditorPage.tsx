/**
 * 笔记编辑器全屏页 — 路由 /notes/new 的承载组件。
 */
import * as React from 'react';
import { NoteEditor } from './NoteEditor';

export const NoteEditorPage: React.FC = () => {
  const onSaved = (kbName: string) => {
    // 保存成功后跳到对应 doc KB 详情。kuId 形如 'doc:<kbName>'
    try {
      window.location.hash = `#/kb/${encodeURIComponent('doc:' + kbName)}`;
    } catch {
      /* ignore */
    }
  };
  return (
    <div className="h-full">
      <NoteEditor onSaved={onSaved} draftKey="chayuan:note-draft:new" />
    </div>
  );
};
