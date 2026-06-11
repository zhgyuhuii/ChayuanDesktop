/**
 * FeedbackDialog — 聊天气泡式意见反馈对话框（察元超级智能体）。
 *
 * - 左侧客服气泡 + 右侧用户气泡，对话线程来自 listMyFeedback()。
 * - 红包卡片：grant.serial 自动激活 + 点击展开领取详情。
 * - 离线草稿：submitFeedback 抛 err.offline===true 时存草稿，提示用户联网后自动重发。
 * - 自动重试：onOpen 时先 retryFeedbackDrafts() 再刷新列表。
 */

import * as React from 'react';
import {
  listMyFeedback,
  retryFeedbackDrafts,
  submitFeedback,
  uploadFeedbackAttachment,
  type FeedbackItem,
  type FeedbackAttachment,
} from '@chayuan/api';
import {
  Button,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@chayuan/ui';
import { Paperclip, Send, X, Gift, Copy, Check, ImageIcon, FileIcon } from 'lucide-react';
import { notifyInfo, reportError } from '../../store/errorDialog';
import { useLicenseStore } from '../license/licenseStore';

export interface FeedbackDialogProps {
  open: boolean;
  onClose: () => void;
}

// ── 红包卡片 ─────────────────────────────────────────────────────────────────

interface GrantCardProps {
  item: FeedbackItem;
}

const GrantCard: React.FC<GrantCardProps> = ({ item }) => {
  const [revealed, setRevealed] = React.useState(false);
  const [copied, setCopied] = React.useState(false);
  const grant = item.grant;
  if (!grant) return null;

  const valueLabel =
    grant.kind === 'count' ? `${grant.value} 次` : `${grant.value} 天`;
  const moduleLabel = grant.module;

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(grant.serial);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* 静默 */
    }
  };

  return (
    <div className="mt-2">
      {!revealed ? (
        <button
          type="button"
          onClick={() => setRevealed(true)}
          className="flex items-center gap-2 rounded-xl border border-red-200 bg-gradient-to-r from-red-500 to-red-600 px-4 py-2.5 text-sm font-medium text-white shadow-sm transition-opacity hover:opacity-90 active:opacity-80"
        >
          <Gift className="h-4 w-4 shrink-0" />
          <span>🧧 来自察元的奖励，点击领取</span>
        </button>
      ) : (
        <div className="rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm dark:border-red-900/40 dark:bg-red-950/30">
          <p className="font-medium text-red-700 dark:text-red-400">
            已为你充值 {valueLabel}（{moduleLabel}）· 已自动到账
          </p>
          <div className="mt-2 flex items-center gap-2">
            <code className="flex-1 truncate rounded bg-white/70 px-2 py-1 font-mono text-xs text-red-800 dark:bg-black/20 dark:text-red-300">
              {grant.serial}
            </code>
            <button
              type="button"
              onClick={() => void onCopy()}
              className="flex shrink-0 items-center gap-1 text-xs text-red-600 hover:text-red-800 dark:text-red-400"
            >
              {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
              {copied ? '已复制' : '复制序列号'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

// ── 附件预览 ─────────────────────────────────────────────────────────────────

const AttachmentChip: React.FC<{ att: FeedbackAttachment }> = ({ att }) => {
  const isImage = att.kind === 'image';
  return (
    <a
      href={att.url}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex max-w-[160px] items-center gap-1.5 truncate rounded-lg border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-2)] px-2 py-1 text-xs text-[var(--cy-text-secondary)] hover:text-[var(--cy-text-primary)]"
    >
      {isImage ? <ImageIcon className="h-3.5 w-3.5 shrink-0" /> : <FileIcon className="h-3.5 w-3.5 shrink-0" />}
      <span className="truncate">{att.name}</span>
    </a>
  );
};

// ── 状态标签 ─────────────────────────────────────────────────────────────────

const StatusChip: React.FC<{ status: string }> = ({ status }) => {
  const label =
    status === 'pending'
      ? '待处理'
      : status === 'processing'
        ? '处理中'
        : status === 'done' || status === 'replied'
          ? '已回复'
          : status;
  const cls =
    status === 'done' || status === 'replied'
      ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400'
      : 'bg-[var(--cy-surface-2)] text-[var(--cy-text-tertiary)]';
  return (
    <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${cls}`}>
      {label}
    </span>
  );
};

// ── 聊天气泡 ─────────────────────────────────────────────────────────────────

interface UserBubbleProps {
  content: string;
  attachments?: FeedbackAttachment[];
  pending?: boolean;
  createdAt?: string;
}

const UserBubble: React.FC<UserBubbleProps> = ({ content, attachments, pending, createdAt }) => (
  <div className="flex flex-col items-end gap-1">
    <div className="max-w-[80%] rounded-2xl rounded-tr-sm bg-[var(--cy-brand-500,#3b82f6)] px-4 py-2.5 text-sm leading-relaxed text-white shadow-sm">
      <p className="whitespace-pre-wrap break-words">{content}</p>
      {attachments && attachments.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {attachments.map((a, i) => (
            <AttachmentChip key={i} att={a} />
          ))}
        </div>
      )}
    </div>
    <span className="text-[10px] text-[var(--cy-text-tertiary)]">
      {pending ? '发送中…' : createdAt ? formatTime(createdAt) : ''}
    </span>
  </div>
);

interface ServiceBubbleProps {
  reply?: string;
  status: string;
  grant: FeedbackItem['grant'];
  item: FeedbackItem;
}

const ServiceBubble: React.FC<ServiceBubbleProps> = ({ reply, status, grant, item }) => (
  <div className="flex flex-col items-start gap-1">
    <div className="flex items-center gap-2">
      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[var(--cy-brand-100,#dbeafe)] text-[10px] font-bold text-[var(--cy-brand-600)]">
        察
      </div>
      <span className="text-xs font-medium text-[var(--cy-text-secondary)]">察元客服</span>
    </div>
    <div className="ml-9 max-w-[80%]">
      {reply ? (
        <div className="rounded-2xl rounded-tl-sm bg-[var(--cy-surface-2)] px-4 py-2.5 text-sm leading-relaxed text-[var(--cy-text-primary)] shadow-sm">
          <p className="whitespace-pre-wrap break-words">{reply}</p>
          {item.repliedAt && (
            <span className="mt-1 block text-[10px] text-[var(--cy-text-tertiary)]">
              {formatTime(item.repliedAt)}
            </span>
          )}
        </div>
      ) : (
        <StatusChip status={status} />
      )}
      {grant && <GrantCard item={item} />}
    </div>
  </div>
);

// ── 待发气泡（乐观更新） ──────────────────────────────────────────────────────

interface PendingBubble {
  id: string;
  content: string;
  attachments: FeedbackAttachment[];
}

// ── 待上传附件 ───────────────────────────────────────────────────────────────

interface PendingAttachment {
  localId: string;
  file: File;
  progress: 'uploading' | 'done' | 'error';
  result?: FeedbackAttachment;
  error?: string;
}

// ── 工具函数 ─────────────────────────────────────────────────────────────────

function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString('zh-CN', {
      month: 'numeric',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return '';
  }
}

function getAppVersion(): string {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const v = (globalThis as any).__APP_VERSION__;
    if (typeof v === 'string' && v) return v;
  } catch {
    /* 静默 */
  }
  return '';
}

// ── 主组件 ───────────────────────────────────────────────────────────────────

export const FeedbackDialog: React.FC<FeedbackDialogProps> = ({ open, onClose }) => {
  const [items, setItems] = React.useState<FeedbackItem[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [text, setText] = React.useState('');
  const [sending, setSending] = React.useState(false);
  const [pendingBubbles, setPendingBubbles] = React.useState<PendingBubble[]>([]);
  const [pendingAtts, setPendingAtts] = React.useState<PendingAttachment[]>([]);
  const [offlineNote, setOfflineNote] = React.useState(false);
  const threadRef = React.useRef<HTMLDivElement>(null);
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const appVersion = getAppVersion();

  // 激活序列号（复用 licenseStore.activateSerial）
  const activateSerial = useLicenseStore((s) => s.activateSerial);

  // 静默激活所有红包 grant
  const autoClaimGrants = React.useCallback(
    async (feedbackItems: FeedbackItem[]) => {
      for (const item of feedbackItems) {
        if (!item.grant?.serial) continue;
        try {
          await activateSerial('desktop', item.grant.serial);
        } catch {
          // 已激活或激活失败：静默忽略，用户仍能看到序列号手动复制
        }
      }
    },
    [activateSerial],
  );

  const loadItems = React.useCallback(async () => {
    setLoading(true);
    try {
      const data = await listMyFeedback();
      setItems(data);
      void autoClaimGrants(data);
    } catch {
      /* 静默 */
    } finally {
      setLoading(false);
    }
  }, [autoClaimGrants]);

  // 打开时：重试草稿 → 刷新列表
  React.useEffect(() => {
    if (!open) return;
    let alive = true;
    void (async () => {
      try {
        await retryFeedbackDrafts();
      } catch {
        /* 静默 */
      }
      if (alive) await loadItems();
    })();
    return () => {
      alive = false;
    };
  }, [open, loadItems]);

  // 关闭时清理临时状态
  React.useEffect(() => {
    if (!open) {
      setPendingBubbles([]);
      setPendingAtts([]);
      setOfflineNote(false);
      setText('');
    }
  }, [open]);

  // 新内容到达时自动滚到底部
  React.useEffect(() => {
    const el = threadRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  }, [items, pendingBubbles]);

  // ── 附件上传 ──────────────────────────────────────────────────────────────

  const onFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (!files.length) return;
    // 重置 input，允许重复选同一文件
    e.target.value = '';

    for (const file of files) {
      const localId = `att_${Date.now()}_${Math.random().toString(36).slice(2)}`;
      const entry: PendingAttachment = { localId, file, progress: 'uploading' };
      setPendingAtts((prev) => [...prev, entry]);
      try {
        const result = await uploadFeedbackAttachment(file, file.name, file.type || 'application/octet-stream');
        setPendingAtts((prev) =>
          prev.map((a) => (a.localId === localId ? { ...a, progress: 'done', result } : a)),
        );
      } catch (err) {
        setPendingAtts((prev) =>
          prev.map((a) =>
            a.localId === localId
              ? { ...a, progress: 'error', error: (err as Error).message }
              : a,
          ),
        );
      }
    }
  };

  const removeAtt = (localId: string) => {
    setPendingAtts((prev) => prev.filter((a) => a.localId !== localId));
  };

  // ── 发送 ──────────────────────────────────────────────────────────────────

  const onSend = async () => {
    const content = text.trim();
    if (!content || sending) return;
    const uploadedAtts = pendingAtts
      .filter((a) => a.progress === 'done' && a.result)
      .map((a) => a.result!);

    // 乐观气泡
    const bubbleId = `bubble_${Date.now()}`;
    const bubble: PendingBubble = { id: bubbleId, content, attachments: uploadedAtts };
    setPendingBubbles((prev) => [...prev, bubble]);
    setText('');
    setPendingAtts([]);
    setSending(true);
    setOfflineNote(false);

    try {
      await submitFeedback({ content, attachments: uploadedAtts });
      // 提交成功：移除乐观气泡，刷新
      setPendingBubbles((prev) => prev.filter((b) => b.id !== bubbleId));
      await loadItems();
    } catch (err: unknown) {
      const isOffline = (err as Error & { offline?: boolean }).offline === true;
      if (isOffline) {
        setOfflineNote(true);
        notifyInfo('已存草稿', '联网后将自动重发');
      } else {
        // 非离线错误：移除乐观气泡，显示错误，恢复文本
        setPendingBubbles((prev) => prev.filter((b) => b.id !== bubbleId));
        reportError(err, '反馈发送失败');
        setText(content);
      }
    } finally {
      setSending(false);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void onSend();
    }
  };

  const canSend = text.trim().length > 0 && !sending;

  // ── 渲染 ──────────────────────────────────────────────────────────────────

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        className="flex max-h-[85vh] max-w-lg flex-col gap-0 overflow-hidden p-0"
        aria-describedby="feedback-subtitle"
      >
        {/* 头部 */}
        <DialogHeader className="shrink-0 border-b border-[var(--cy-border-subtle)] px-5 py-4">
          <div className="flex items-center justify-between">
            <DialogTitle className="text-base font-semibold">意见及反馈</DialogTitle>
          </div>
          <DialogDescription id="feedback-subtitle" className="mt-0.5 text-xs text-[var(--cy-text-tertiary)]">
            软件「察元超级智能体」{appVersion ? `· 版本 ${appVersion}` : ''}
          </DialogDescription>
        </DialogHeader>

        {/* 对话线程 */}
        <div
          ref={threadRef}
          className="flex-1 overflow-y-auto px-4 py-4"
          style={{ minHeight: 0 }}
        >
          {loading && items.length === 0 && (
            <p className="text-center text-sm text-[var(--cy-text-tertiary)]">加载中…</p>
          )}

          {!loading && items.length === 0 && pendingBubbles.length === 0 && (
            <div className="flex flex-col items-center gap-2 py-10 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[var(--cy-brand-50)]">
                <Gift className="h-6 w-6 text-[var(--cy-brand-500,#3b82f6)]" />
              </div>
              <p className="text-sm font-medium text-[var(--cy-text-secondary)]">还没有反馈记录</p>
              <p className="text-xs text-[var(--cy-text-tertiary)]">
                遇到问题或有建议？告诉我们，每一条都会认真查看。
              </p>
            </div>
          )}

          <div className="flex flex-col gap-5">
            {items.map((item) => (
              <div key={item.id} className="flex flex-col gap-3">
                {/* 用户气泡 */}
                <UserBubble
                  content={item.content}
                  attachments={item.attachments}
                  createdAt={item.createdAt}
                />
                {/* 客服气泡 */}
                <ServiceBubble
                  reply={item.reply}
                  status={item.status}
                  grant={item.grant}
                  item={item}
                />
              </div>
            ))}

            {/* 乐观气泡 */}
            {pendingBubbles.map((b) => (
              <UserBubble key={b.id} content={b.content} attachments={b.attachments} pending />
            ))}
          </div>

          {/* 离线草稿提示 */}
          {offlineNote && (
            <div className="mt-3 rounded-xl bg-amber-50 px-4 py-2.5 text-xs text-amber-700 dark:bg-amber-950/30 dark:text-amber-400">
              已存草稿，联网后自动重发
            </div>
          )}
        </div>

        {/* 输入区 */}
        <div className="shrink-0 border-t border-[var(--cy-border-subtle)] bg-[var(--cy-surface-1)] px-4 py-3">
          {/* 待上传附件预览 */}
          {pendingAtts.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-2">
              {pendingAtts.map((att) => (
                <div
                  key={att.localId}
                  className="flex max-w-[160px] items-center gap-1.5 truncate rounded-lg border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-2)] px-2 py-1 text-xs"
                >
                  {att.file.type.startsWith('image/') ? (
                    <ImageIcon className="h-3.5 w-3.5 shrink-0 text-[var(--cy-text-tertiary)]" />
                  ) : (
                    <FileIcon className="h-3.5 w-3.5 shrink-0 text-[var(--cy-text-tertiary)]" />
                  )}
                  <span
                    className={`flex-1 truncate ${att.progress === 'error' ? 'text-red-500' : 'text-[var(--cy-text-secondary)]'}`}
                  >
                    {att.progress === 'uploading' ? '上传中…' : att.progress === 'error' ? '失败' : att.file.name}
                  </span>
                  <button
                    type="button"
                    className="shrink-0 text-[var(--cy-text-tertiary)] hover:text-[var(--cy-text-primary)]"
                    onClick={() => removeAtt(att.localId)}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="flex items-end gap-2">
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder="描述问题或建议…（Enter 发送，Shift+Enter 换行）"
              rows={2}
              className="flex-1 resize-none rounded-xl border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-2)] px-3 py-2 text-sm text-[var(--cy-text-primary)] placeholder:text-[var(--cy-text-tertiary)] focus:outline-none focus:ring-2 focus:ring-[var(--cy-brand-400)]"
            />
            <div className="flex flex-col gap-1">
              {/* 附件按钮 */}
              <button
                type="button"
                className="flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-2)] text-[var(--cy-text-tertiary)] transition-colors hover:bg-[var(--cy-surface-3)] hover:text-[var(--cy-text-primary)]"
                onClick={() => fileInputRef.current?.click()}
                title="添加附件"
              >
                <Paperclip className="h-4 w-4" />
              </button>
              {/* 发送按钮 */}
              <Button
                size="icon"
                className="h-8 w-8"
                onClick={() => void onSend()}
                disabled={!canSend}
                title="发送（Enter）"
              >
                <Send className="h-4 w-4" />
              </Button>
            </div>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            accept="image/*,.pdf,.txt,.doc,.docx,.zip"
            onChange={(e) => void onFileChange(e)}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
};
