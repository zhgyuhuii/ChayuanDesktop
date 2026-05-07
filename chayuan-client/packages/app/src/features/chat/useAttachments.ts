/**
 * 附件链路：拖拽 / 选择 / 粘贴 → 按类型分流上传：
 *
 *   - 图片 → POST /v1/files (purpose=vision) → remoteUrl（vision 用 image_urls）
 *   - 其他 → POST /knowledge_base/upload_temp_docs → fileChatId（temp_kb 文件对话）
 *
 * 双端共用 PAL.fs；单文件独立 promise（图片 Promise.all 并发；docs 顺序保 prev_id 链）。
 * remoteUrl 是相对路径（/v1/files/.../content），vision 节点会拼上 baseURL。
 */

import * as React from 'react';
import {
  aiPlatform,
  files as filesApi,
  kb,
  type UploadTempDocsResult,
  getClientConfig,
} from '@chayuan/api';
import { uuid, getPlatform } from '@chayuan/platform-shared';
import { Events, logEvent } from '@chayuan/observability';
import {
  useComposerScopedStore, useComposerS, type AttachmentDraft,
} from '../../store/composer';
import { notifyInfo, reportError } from '../../store/errorDialog';

export function useAttachments(): {
  attachments: AttachmentDraft[];
  pickFiles(opts?: { accept?: string | string[]; multiple?: boolean }): Promise<void>;
  pickImages(): Promise<void>;
  acceptDrop(event: React.DragEvent): Promise<void>;
  remove(id: string): void;
  reset(): void;
} {
  const composer = useComposerScopedStore();
  const attachments = useComposerS((s) => s.attachments);
  const upsert = useComposerS((s) => s.upsertAttachment);
  const removeRef = useComposerS((s) => s.removeAttachment);
  const resetRef = useComposerS((s) => s.resetAttachments);

  const setFileChatId = (id?: string) =>
    composer.setState({ fileChatId: id });

  const upload = React.useCallback(
    async (kind: 'file' | 'image', items: File[]) => {
      const drafts: AttachmentDraft[] = items.map((f) => ({
        id: uuid(),
        name: f.name,
        size: f.size,
        mime: f.type,
        type: kind,
        previewUrl: kind === 'image' ? URL.createObjectURL(f) : undefined,
        status: 'uploading',
      }));
      for (const d of drafts) upsert(d);
      logEvent(Events.ComposerAttachmentAdd, { metadata: { count: items.length, kind } });

      if (kind === 'image') {
        // 上传前先 preflight：没有 image-embedding 模型 → 给用户一个明确引导，
        // 而不是让上传"看似成功 → 后续 RAG / vision 静默无效果"。
        try {
          const pre = await aiPlatform.embeddingsPreflight.check('image');
          if (!pre.ok) {
            const recName = pre.setup?.default?.id ?? 'jina-clip-v1';
            // 把 upload 转成 error 状态 + setup 提示；保留预览，让用户看到自己选的图
            for (const d of drafts) {
              upsert({
                ...d,
                status: 'error',
                error: `未安装图像嵌入模型；建议安装 ${recName}`,
              });
            }
            // 通过事件告诉 Settings 面板"打开 image-embedding 选项卡"
            try {
              window.dispatchEvent(
                new CustomEvent('chayuan:open-settings', {
                  detail: { tab: 'aiPlatform', capability: 'image-embedding' },
                }),
              );
            } catch {
              /* noop */
            }
            notifyInfo(
              '图像未向量化',
              `本地未安装图像嵌入模型；点击"设置 → AI 平台 → 图像嵌入"一键安装 ${recName}。`,
              5000,
            );
            return;
          }
        } catch (err: unknown) {
          // preflight 端点不可用：降级——继续上传（保留旧行为），但提示一次
          reportError(err, '图像嵌入预检失败');
        }
        // 图片走 /v1/files；并发 — vision 不依赖 prev_id 链
        const baseURL = getClientConfig().baseURL.replace(/\/+$/, '');
        await Promise.all(
          drafts.map(async (d, idx) => {
            const f = items[idx]!;
            try {
              const r = await filesApi.upload(f, 'vision');
              // 相对 url 拼成绝对（vision 节点要求公网/绝对）；空 base 时保持相对
              const remoteUrl = baseURL ? `${baseURL}${r.url}` : r.url;
              upsert({ ...d, status: 'ready', remoteUrl });
            } catch (err: unknown) {
              upsert({ ...d, status: 'error', error: err instanceof Error ? err.message : '上传失败' });
            }
          }),
        );
        return;
      }

      // 文档走 temp_kb；顺序累积 prev_id
      let prevId = composer.getState().fileChatId;
      for (let i = 0; i < drafts.length; i++) {
        const d = drafts[i]!;
        const f = items[i]!;
        try {
          const result: UploadTempDocsResult = await kb.uploadTempDocs([f], prevId);
          prevId = result.id || prevId;
          upsert({ ...d, status: 'ready', fileChatId: result.id });
        } catch (err: unknown) {
          upsert({ ...d, status: 'error', error: err instanceof Error ? err.message : '上传失败' });
        }
      }
      if (prevId) setFileChatId(prevId);
    },
    [upsert],
  );

  const pickFiles = React.useCallback(
    async (opts?: { accept?: string | string[]; multiple?: boolean }) => {
      const files = await getPlatform().fs.pickFiles({ multiple: opts?.multiple ?? true, accept: opts?.accept });
      if (files.length) await upload('file', files);
    },
    [upload],
  );

  const pickImages = React.useCallback(async () => {
    const files = await getPlatform().fs.pickFiles({ multiple: true, accept: 'image/*' });
    if (files.length) await upload('image', files);
  }, [upload]);

  const acceptDrop = React.useCallback(
    async (event: React.DragEvent) => {
      event.preventDefault();
      const files = await getPlatform().fs.readDropped(event.nativeEvent);
      if (!files.length) return;
      const images = files.filter((f) => f.type.startsWith('image/'));
      const docs = files.filter((f) => !f.type.startsWith('image/'));
      if (docs.length) await upload('file', docs);
      if (images.length) await upload('image', images);
    },
    [upload],
  );

  const remove = React.useCallback(
    (id: string) => {
      const att = composer.getState().attachments.find((a) => a.id === id);
      if (att?.previewUrl?.startsWith('blob:')) URL.revokeObjectURL(att.previewUrl);
      removeRef(id);
      logEvent(Events.ComposerAttachmentRemove, { metadata: { id } });
    },
    [removeRef],
  );

  const reset = React.useCallback(() => {
    for (const a of composer.getState().attachments) {
      if (a.previewUrl?.startsWith('blob:')) URL.revokeObjectURL(a.previewUrl);
    }
    resetRef();
  }, [resetRef]);

  return { attachments, pickFiles, pickImages, acceptDrop, remove, reset };
}
