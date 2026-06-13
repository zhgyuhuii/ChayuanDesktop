/**
 * 音色试听共享文案 —— 三处试听入口(VoicePicker / VoiceStep / VgMessageExtras)
 * 统一引用,避免各写一份不一致的示例文本。
 *
 * - VOICE_PREVIEW_TEXT:完整试听句,带产品名,韵律变化能体现音色效果。
 *   注意:VoiceStep 会取前 50 字(后端限制),故主文案控制在 50 字内。
 * - VOICE_PREVIEW_FALLBACK:当上下文已有脚本/消息但内容为空时的短兜底。
 */
export const VOICE_PREVIEW_TEXT =
  '欢迎使用察元 AI 超级智能体。我能帮您处理文档、检索知识、生成创意,让办公更轻松高效。';

export const VOICE_PREVIEW_FALLBACK = '欢迎使用察元 AI 超级智能体。';
