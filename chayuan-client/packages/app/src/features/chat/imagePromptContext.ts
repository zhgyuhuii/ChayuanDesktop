/**
 * 文生图/图生图「记住对话上下文」辅助。
 *
 * 图像模型只吃一句 prompt(不吃多轮),所以靠:
 *   1) rewriteImagePrompt:用 chat 模型把「最近几轮 + 当前要求」融合成增强 prompt;
 *   2) findLastAssistantImage:图生图未传图时复用上一张生成图。
 * 纯函数(pickHistoryForRewrite / buildRewriteMessages / findLastAssistantImage)
 * 不依赖 React,便于单测。
 */
import { aiPlatformChat, type ChatMessage as ApiChatMessage } from '@chayuan/api';
import type { ChatMessage } from './useChayuanChat';

const MAX_TURNS = 3;

export interface HistoryTurn {
  role: 'user' | 'assistant';
  content: string;
}

/** 取最近 maxTurns 轮(user/assistant)的纯文本,忽略流式中/空内容。 */
export function pickHistoryForRewrite(
  messages: ChatMessage[],
  maxTurns = MAX_TURNS,
): HistoryTurn[] {
  const done = messages.filter(
    (m) =>
      (m.role === 'user' || m.role === 'assistant') &&
      !m.streaming &&
      typeof m.content === 'string' &&
      m.content.trim().length > 0,
  );
  return done.slice(-maxTurns * 2).map((m) => ({
    role: m.role as 'user' | 'assistant',
    content: m.content.trim(),
  }));
}

/** 组装改写用 chat messages。 */
export function buildRewriteMessages(
  history: HistoryTurn[],
  currentText: string,
  mode: 't2i' | 'image_edit',
): ApiChatMessage[] {
  const kind = mode === 'image_edit' ? '图像编辑' : '文生图';
  const sys =
    `你是${kind}提示词专家。根据对话历史和用户的最新一句,产出一句完整、自洽、可直接` +
    `用于图像生成的提示词。要求:\n` +
    `- 补全历史里被指代的对象/风格/修改意图(用户说"再红一点/加只猫"时要带上前文画的是什么)。\n` +
    `- 只输出最终提示词本身,不要解释、不要引号、不要任何前缀。`;
  const histText = history
    .map((m) => `${m.role === 'user' ? '用户' : '助手'}: ${m.content}`)
    .join('\n');
  const user = `对话历史:\n${histText}\n\n用户最新一句:${currentText}\n\n请输出融合后的完整提示词:`;
  return [
    { role: 'system', content: sys },
    { role: 'user', content: user },
  ];
}

/** 找最近一条 assistant 消息里的生成图(图生图复用上一张)。返回 {url, mime} 或 null。 */
export function findLastAssistantImage(
  messages: ChatMessage[],
): { url: string; mime: string } | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (!m || m.role !== 'assistant' || !m.files) continue;
    for (let j = m.files.length - 1; j >= 0; j--) {
      const f = m.files[j];
      if (f && f.mediaType && f.mediaType.startsWith('image/') && f.url) {
        return { url: f.url, mime: f.mediaType };
      }
    }
  }
  return null;
}

/**
 * 用 chat 模型把历史 + 当前融合成增强 prompt。
 * 无 chatModelId / 无历史 / 调用失败 → 返回 null(调用方回退原 prompt,绝不阻塞生图)。
 */
export async function rewriteImagePrompt(opts: {
  chatModelId: string | null | undefined;
  messages: ChatMessage[];
  currentText: string;
  mode: 't2i' | 'image_edit';
}): Promise<string | null> {
  const { chatModelId, messages, currentText, mode } = opts;
  if (!chatModelId) return null;
  const history = pickHistoryForRewrite(messages);
  if (history.length === 0) return null; // 无历史不改写,省一次调用
  try {
    const resp = await aiPlatformChat.complete({
      model: chatModelId,
      messages: buildRewriteMessages(history, currentText, mode),
      temperature: 0.3,
      max_tokens: 400,
    });
    const out = resp.choices?.[0]?.message?.content?.trim();
    return out && out.length > 0 ? out : null;
  } catch {
    return null;
  }
}
