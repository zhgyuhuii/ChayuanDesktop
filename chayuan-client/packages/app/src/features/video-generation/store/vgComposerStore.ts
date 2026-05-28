/**
 * 视频生成专用 composer store(scope='video-generation')。
 *
 * 跟 chat 全局 store(scope='__global__')完全隔离:
 *   - draft 输入框文本不会跟 chat 互相覆盖
 *   - 模型选择各自记忆,vg 选了 sherpa-onnx-tts 不会影响 chat 选的 deepseek-v4
 *   - 附件 / KB 选中等所有字段都独立持久化到 localStorage 'cy.composer.video-generation' key
 *
 * 用法(在 VgChatPage R3.6):
 *   <ComposerScopedContext.Provider value={vgComposerStore}>
 *     <ChatComposer ... />
 *     <ConversationView ... />
 *   </ComposerScopedContext.Provider>
 *
 * 注意:不要跟 ../store/vgComposer.ts 混 — 那个是 N4 阶段写的视频生成
 * 业务参数 store(VideoParams 字段),本文件是 ChatComposer 复用所需的
 * scope 实例。
 */
import { createComposerStore } from '../../../store/composer';

export const vgComposerStore: ReturnType<typeof createComposerStore> =
  createComposerStore('video-generation');
