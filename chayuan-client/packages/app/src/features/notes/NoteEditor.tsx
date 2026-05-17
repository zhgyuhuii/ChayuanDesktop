/**
 * Tiptap 富文本笔记编辑器主组件。
 *
 * 功能:
 *   - StarterKit + Image + Link + Placeholder
 *   - 标题 + 工具栏(B/I/U/H1/H2/列表/引用/代码)+ 麦克风(实时 ASR 插入)+ 保存按钮
 *   - localStorage 草稿持久化(useNoteDraft)
 *   - Ctrl/Cmd+S 触发保存弹窗
 */
import * as React from 'react';
import { useEditor, EditorContent, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Image from '@tiptap/extension-image';
import Link from '@tiptap/extension-link';
import Placeholder from '@tiptap/extension-placeholder';
import {
  Bold, Code, FileAudio, Heading1, Heading2, Image as ImageIcon, Italic, Link as LinkIcon,
  List, ListOrdered, Loader2, Mic, MicOff, Quote, Save, Strikethrough,
} from 'lucide-react';
import { Button, cn } from '@chayuan/ui';
import { modality } from '@chayuan/api';
import { getPlatform } from '@chayuan/platform-shared';
import { useMicRecorder } from '../composer/useMicRecorder';
import { useNoteDraft } from './useNoteDraft';
import { SaveNoteDialog } from './SaveNoteDialog';
import { AsrVolatileMark } from './AsrVolatileMark';
import { convertEditorChinese, type ChineseScript } from './chineseScript';
import { notifyInfo, notifySuccess, reportError } from '../../store/errorDialog';

const defaultTitle = () => {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `AI 笔记 ${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

export interface NoteEditorProps {
  /** 保存成功后回调(M4 用 — 跳转到 KB 详情) */
  onSaved?(kbName: string): void;
  /** localStorage 草稿 key(默认 chayuan:note-draft:new)*/
  draftKey?: string;
}

export const NoteEditor: React.FC<NoteEditorProps> = ({ onSaved, draftKey }) => {
  const draft = useNoteDraft(draftKey);
  const initial = React.useMemo(() => draft.load(), [draft]);
  const [title, setTitle] = React.useState(() => initial?.title ?? defaultTitle());
  const [saveOpen, setSaveOpen] = React.useState(false);
  const defaultKb = React.useMemo(() => {
    try { return localStorage.getItem('chayuan:notes:last-kb') ?? undefined; }
    catch { return undefined; }
  }, []);

  const editor = useEditor({
    extensions: [
      // Tiptap v3 起 StarterKit 自带 Link;关掉它用下面自己 configure 的版本,
      // 否则 "Duplicate extension names found: ['link']" 警告 + 配置可能被前者覆盖
      StarterKit.configure({ link: false }),
      Image.configure({ inline: false }),
      Link.configure({ openOnClick: false }),
      Placeholder.configure({
        placeholder: '开始写笔记…(支持 Markdown 快捷键;点麦克风可实时语音录入)',
      }),
      // ASR 实时校准:volatile 文字带这个 mark,灰色斜体显示,下次 chunk 来时
      // delete + 重新 insert 当前 hypothesis 的新 volatile
      AsrVolatileMark,
    ],
    content: initial?.content ?? '',
    onUpdate({ editor }) {
      draft.save(title, editor.getJSON());
    },
  });

  // 找编辑器里所有 asrVolatile mark 覆盖的连续文本 range(可能多段,取
  // [最左, 最右])。volatile 永远是末尾的灰色斜体那段。
  const findVolatileRange = React.useCallback((): { from: number; to: number } | null => {
    if (!editor) return null;
    const markType = editor.schema.marks.asrVolatile;
    if (!markType) return null;
    let from: number | null = null;
    let to: number | null = null;
    editor.state.doc.descendants((node, pos) => {
      if (node.isText && node.marks.some((m) => m.type === markType)) {
        if (from === null) from = pos;
        to = pos + node.nodeSize;
      }
    });
    if (from === null || to === null) return null;
    return { from, to };
  }, [editor]);

  // 删除 volatile 占位(chunk 间 replace 用)
  const removeVolatileRange = React.useCallback(() => {
    const range = findVolatileRange();
    if (range && editor) editor.chain().deleteRange(range).run();
  }, [editor, findVolatileRange]);

  // stop 时不要直接删 volatile — 用户说的话都识别出来了,即便没二次确认也应该
  // 留在笔记里。把 asrVolatile mark 移除(灰色斜体变正常黑字),保留文字。
  const commitVolatileAsStable = React.useCallback(() => {
    const range = findVolatileRange();
    if (!range || !editor) return;
    editor
      .chain()
      .setTextSelection(range)
      .unsetMark('asrVolatile')
      .setTextSelection(range.to)
      .run();
  }, [editor, findVolatileRange]);

  // 标题变化也写草稿
  React.useEffect(() => {
    if (editor) draft.save(title, editor.getJSON());
  }, [title, editor, draft]);

  // ASR — partialCount 用来检测"录完一段一字未入" → 给用户明确提示
  const partialCountRef = React.useRef(0);
  const mic = useMicRecorder({
    sliceMs: 2500,
    // 默认 zh — whisper 在 language="" / auto 下,短/嘈杂片段会被误判为西语/葡语
    // 等,返回 `[Spanish]` 这种语言名 marker(不是用户实际说的话)。中文用户主
    // 场景下,显式提示 zh 大幅减少误判 + 提升识别率。后续若要支持英文/混合,
    // 加 UI 切换器即可。
    language: 'zh',
    onPartial: (text) => {
      if (!text || !editor) return;
      partialCountRef.current += 1;
      // commit stable_increment(LocalAgreement-2 二次确认的字符)— 黑色固化
      // 先删 volatile 占位避免新文字插到 volatile 后面;commit 后 volatile 由
      // onVolatile 重新插入(顺序:onPartial 先 → onVolatile 后,在 useMicRecorder
      // flushBuffered 里保证)
      removeVolatileRange();
      // 防换行:whisper 偶尔输出 \n,Tiptap insertContent 会解析成 hardBreak
      editor.chain().focus().insertContent(text.replace(/\r?\n+/g, ' ')).run();
    },
    onVolatile: (volatileText) => {
      if (!editor) return;
      removeVolatileRange();
      if (!volatileText) return;
      // 末尾插新 volatile 带 asrVolatile mark(灰色斜体)。
      // 防换行同 onPartial。
      editor.chain()
        .focus()
        .insertContent({
          type: 'text',
          text: volatileText.replace(/\r?\n+/g, ' '),
          marks: [{ type: 'asrVolatile' }],
        })
        .run();
    },
    onFinal: (full) => {
      // ⭐ stop 时残留的 volatile(灰色斜体)直接转黑色保留 — 用户说的话已经识别
      // 出来,即便没二次 LocalAgreement 确认也不该被吞掉
      commitVolatileAsStable();
      if (partialCountRef.current === 0 && !full) {
        // 实时调诊断端点 — 4 层后端逐个 probe,展示具体哪一层不通
        void (async () => {
          let body = '所有 chunk 转写都返回空字符串。常见原因:后端 ASR 后端不可用 / 麦克风没真实录音 / 没说够 1-2 秒。';
          try {
            const d = await modality.asrDiag();
            const lines: string[] = [];
            // sidecar
            if (d.sidecar.state === 'ready' && !d.sidecar.reachable) {
              lines.push(
                `❌ Sidecar 假 ready @ ${d.sidecar.endpoint}` +
                  ` (probe: ${d.sidecar.probe_error || 'HTTP ' + d.sidecar.http_status})`,
              );
            } else if (d.sidecar.reachable) {
              lines.push(`✅ Sidecar 实时可达 @ ${d.sidecar.endpoint}`);
            } else {
              lines.push(`— Sidecar: ${d.sidecar.state}${d.sidecar.last_error ? ' / ' + d.sidecar.last_error : ''}`);
            }
            lines.push(`${d.faster_whisper.installed ? '✅' : '❌'} faster-whisper`);
            lines.push(`${d.openai_whisper.installed ? '✅' : '❌'} openai-whisper`);
            lines.push(`${d.openai_api.configured ? '✅' : '❌'} OpenAI API`);
            lines.push(`默认 ASR 模型: ${d.default_model}`);
            lines.push('');
            lines.push(d.recommend);
            body = lines.join('\n');
          } catch (err) {
            console.warn('[mic] asrDiag failed:', err);
          }
          notifyInfo('未识别到语音文字', body, 20000);
        })();
      }
      partialCountRef.current = 0;
    },
    onError: (err) => reportError(err, '录音失败'),
  });

  // 简体 / 繁体切换 — 把整个 editor 文档过一遍 opencc-js,setContent 重建。
  // 默认 'cn'(笔记主诉求简体);后端 ASR sidecar 有时返繁体,用户点 简 修正。
  // setContent 会重置 cursor;能接受。volatile mark 内的文字也会被转换,体验自然。
  const [chineseScript, setChineseScript] = React.useState<ChineseScript>('cn');
  const applyChineseScript = React.useCallback((target: ChineseScript) => {
    if (!editor) return;
    if (target === chineseScript) return;
    const json = editor.getJSON();
    const converted = convertEditorChinese(json, target);
    editor.commands.setContent(converted as Parameters<typeof editor.commands.setContent>[0], {
      emitUpdate: true,
    });
    setChineseScript(target);
  }, [editor, chineseScript]);

  // 上传语音文件转写
  const [uploadingFile, setUploadingFile] = React.useState(false);
  const onUploadAudio = React.useCallback(async () => {
    if (!editor || uploadingFile) return;
    let file: File | null = null;
    try {
      const picked = await getPlatform().fs.pickFiles({
        multiple: false,
        accept: 'audio/*',
      });
      if (!picked.length) return;
      file = picked[0] as File;
    } catch (e) {
      reportError(e, '选择文件失败');
      return;
    }
    setUploadingFile(true);
    try {
      const r = await modality.transcribeFile(file, { language: 'zh' });
      if (!r.text) {
        const detail = r.diagnostics || '后端未返回任何文本。检查:① ASR 服务是否就绪;② 音频是否包含可识别语音;③ 设置 → 本地模型服务 → 调用日志';
        notifyInfo('未识别到语音文字', detail, 15000);
        return;
      }
      // 关键:Tiptap insertContent(string) 把 string 当 HTML 解析,'\n' 不被
      // 识别为换行 → 多段文字会挤成一坨,甚至 '<','>' 等字符被当 tag 吃掉。
      // 改用 **ProseMirror JSON nodes**,每行一个 paragraph,Tiptap 直接构造
      // 文档结构,无 HTML 解析、无字符吞噬。
      const lines: string[] = [];
      if (r.speaker_diarization_available && r.segments.length > 1) {
        const speakerLabels = new Map<string, string>();
        let next = 0;
        for (const s of r.segments) {
          if (!speakerLabels.has(s.speaker)) {
            speakerLabels.set(s.speaker, String.fromCharCode(65 + next));
            next += 1;
          }
        }
        for (const s of r.segments) {
          const label = speakerLabels.get(s.speaker) ?? '?';
          lines.push(`Speaker ${label}:${s.text.replace(/\r?\n+/g, ' ')}`);
        }
      } else {
        lines.push(r.text.replace(/\r?\n+/g, ' '));
      }
      // 把每行包成 paragraph node 数组,一次性 insert
      const nodes = lines
        .filter((l) => l.length > 0)
        .map((line) => ({
          type: 'paragraph' as const,
          content: [{ type: 'text' as const, text: line }],
        }));
      console.debug(
        `[upload-asr] ${lines.length} lines, total ${r.text.length} chars,` +
          ` diarization=${r.speaker_diarization_available}`,
      );
      if (nodes.length > 0) {
        editor.chain().focus('end').insertContent(nodes).run();
      }
      const meta = r.speaker_diarization_available
        ? `共 ${r.segments.length} 段,识别到 ${new Set(r.segments.map((s) => s.speaker)).size} 个说话人`
        : `共 ${r.text.length} 字`;
      notifySuccess('录音转写完成', meta, 4000);
    } catch (e) {
      reportError(e, '上传录音转写失败');
    } finally {
      setUploadingFile(false);
    }
  }, [editor, uploadingFile]);

  // Ctrl/Cmd+S 触发保存
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        setSaveOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (!editor) return null;

  return (
    <div className="flex h-full flex-col bg-[var(--cy-surface-base)]">
      <header className="flex flex-wrap items-center gap-2 border-b border-[var(--cy-border-subtle)] px-4 py-2">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={defaultTitle()}
          className="flex-1 min-w-[200px] border-0 bg-transparent text-base font-semibold focus:outline-none"
        />
        <div
          className="inline-flex h-8 items-center rounded-md border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-1)] p-0.5 text-xs"
          role="group"
          aria-label="简体繁体切换"
        >
          <button
            type="button"
            onClick={() => applyChineseScript('cn')}
            className={cn(
              'flex h-7 items-center justify-center rounded px-2 transition',
              chineseScript === 'cn'
                ? 'bg-[var(--cy-brand-500)] text-white shadow-sm'
                : 'text-[var(--cy-text-secondary)] hover:text-[var(--cy-text-primary)]',
            )}
            title="把整个笔记转为简体(含正在录的语音文字)"
            aria-pressed={chineseScript === 'cn'}
          >
            简
          </button>
          <button
            type="button"
            onClick={() => applyChineseScript('tw')}
            className={cn(
              'flex h-7 items-center justify-center rounded px-2 transition',
              chineseScript === 'tw'
                ? 'bg-[var(--cy-brand-500)] text-white shadow-sm'
                : 'text-[var(--cy-text-secondary)] hover:text-[var(--cy-text-primary)]',
            )}
            title="把整个笔记转为繁体(台湾标准)"
            aria-pressed={chineseScript === 'tw'}
          >
            繁
          </button>
        </div>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => (mic.recording ? mic.stop() : void mic.start())}
          className={cn('h-8 text-xs', mic.recording && 'bg-red-500/15 text-red-600')}
          title={mic.recording ? `录音中 · ${mic.elapsed}s — 点击停止` : '语音录入'}
        >
          {mic.recording ? (
            <><MicOff className="h-3.5 w-3.5 animate-pulse" /> {mic.elapsed}s</>
          ) : (
            <><Mic className="h-3.5 w-3.5" /> 语音</>
          )}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => void onUploadAudio()}
          disabled={uploadingFile || mic.recording}
          className="h-8 text-xs"
          title="上传录音文件 — 整段转写为文字插入笔记。说话人区分(diarization)暂未启用,所有内容归一个说话人"
        >
          {uploadingFile ? (
            <><Loader2 className="h-3.5 w-3.5 animate-spin" /> 转写中…</>
          ) : (
            <><FileAudio className="h-3.5 w-3.5" /> 上传录音</>
          )}
        </Button>
        <Button size="sm" onClick={() => setSaveOpen(true)} className="h-8 text-xs">
          <Save className="h-3.5 w-3.5" /> 保存到知识中心
        </Button>
      </header>

      <Toolbar editor={editor} />

      <div className="flex-1 overflow-y-auto px-8 py-6">
        <div className="mx-auto max-w-3xl">
          <EditorContent
            editor={editor}
            className="prose prose-sm dark:prose-invert max-w-none min-h-[60vh] focus:outline-none [&_.is-editor-empty]:before:content-[attr(data-placeholder)] [&_.is-editor-empty]:before:text-[var(--cy-text-tertiary)] [&_.is-editor-empty]:before:float-left [&_.is-editor-empty]:before:h-0 [&_.is-editor-empty]:before:pointer-events-none [&_*:focus]:outline-none"
          />
        </div>
      </div>

      <SaveNoteDialog
        open={saveOpen}
        title={title}
        content={editor.getJSON()}
        defaultKbName={defaultKb}
        onClose={() => setSaveOpen(false)}
        onSaved={(kbName) => {
          draft.clear();
          setSaveOpen(false);
          onSaved?.(kbName);
        }}
      />
    </div>
  );
};

const ToolBtn: React.FC<{
  onClick(): void; active?: boolean; title: string; children: React.ReactNode;
}> = ({ onClick, active, title, children }) => (
  <button
    type="button"
    onClick={onClick}
    title={title}
    className={cn(
      'inline-flex h-7 w-7 items-center justify-center rounded text-[var(--cy-text-secondary)] transition',
      'hover:bg-[var(--cy-surface-1)] hover:text-[var(--cy-text-primary)]',
      active && 'bg-[var(--cy-brand-500)]/15 text-[var(--cy-brand-700)]',
    )}
  >
    {children}
  </button>
);

const Toolbar: React.FC<{ editor: Editor }> = ({ editor }) => (
  <div className="flex flex-wrap items-center gap-0.5 border-b border-[var(--cy-border-subtle)] bg-[var(--cy-surface-1)] px-4 py-1">
    <ToolBtn onClick={() => editor.chain().focus().toggleBold().run()}
             active={editor.isActive('bold')} title="加粗 Ctrl+B"><Bold className="h-3.5 w-3.5" /></ToolBtn>
    <ToolBtn onClick={() => editor.chain().focus().toggleItalic().run()}
             active={editor.isActive('italic')} title="斜体"><Italic className="h-3.5 w-3.5" /></ToolBtn>
    <ToolBtn onClick={() => editor.chain().focus().toggleStrike().run()}
             active={editor.isActive('strike')} title="删除线"><Strikethrough className="h-3.5 w-3.5" /></ToolBtn>
    <span className="mx-1 h-4 w-px bg-[var(--cy-border-subtle)]" />
    <ToolBtn onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
             active={editor.isActive('heading', { level: 1 })} title="标题 1"><Heading1 className="h-3.5 w-3.5" /></ToolBtn>
    <ToolBtn onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
             active={editor.isActive('heading', { level: 2 })} title="标题 2"><Heading2 className="h-3.5 w-3.5" /></ToolBtn>
    <span className="mx-1 h-4 w-px bg-[var(--cy-border-subtle)]" />
    <ToolBtn onClick={() => editor.chain().focus().toggleBulletList().run()}
             active={editor.isActive('bulletList')} title="无序列表"><List className="h-3.5 w-3.5" /></ToolBtn>
    <ToolBtn onClick={() => editor.chain().focus().toggleOrderedList().run()}
             active={editor.isActive('orderedList')} title="有序列表"><ListOrdered className="h-3.5 w-3.5" /></ToolBtn>
    <ToolBtn onClick={() => editor.chain().focus().toggleBlockquote().run()}
             active={editor.isActive('blockquote')} title="引用"><Quote className="h-3.5 w-3.5" /></ToolBtn>
    <ToolBtn onClick={() => editor.chain().focus().toggleCodeBlock().run()}
             active={editor.isActive('codeBlock')} title="代码块"><Code className="h-3.5 w-3.5" /></ToolBtn>
    <span className="mx-1 h-4 w-px bg-[var(--cy-border-subtle)]" />
    <ToolBtn
      onClick={() => {
        const href = prompt('链接地址(https://…)') ?? '';
        if (!href) return;
        editor.chain().focus().setLink({ href }).run();
      }}
      active={editor.isActive('link')}
      title="插入链接"><LinkIcon className="h-3.5 w-3.5" /></ToolBtn>
    <ToolBtn
      onClick={() => {
        const src = prompt('图片 URL') ?? '';
        if (!src) return;
        editor.chain().focus().setImage({ src }).run();
      }}
      title="插入图片"><ImageIcon className="h-3.5 w-3.5" /></ToolBtn>
  </div>
);
