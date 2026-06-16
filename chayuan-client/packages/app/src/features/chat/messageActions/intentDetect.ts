/**
 * 对话产出意图识别:判断用户是否想把助手产出物生成媒体,以及类型 + 提示词。
 * 关键词同步兜底 + 对话模型一次结构化调用主判;LLM 失败/超时回退关键词。
 */
import { aiPlatformChat } from '@chayuan/api';

export type ActionTypeKey = 'tts' | 't2i' | 'image_edit' | 't2v' | 'i2v';
export type IntentType = ActionTypeKey | 'none';

const KW: Array<[RegExp, ActionTypeKey]> = [
  [/合成语音|生成.{0,8}语音|转语音|朗读|读一下|读出来|配音/, 'tts'],
  [/图生视频|让.{0,6}动起来/, 'i2v'],
  [/生成.{0,8}视频|做.{0,6}视频|短视频|宣传片|宣传视频/, 't2v'],
  [/图像编辑|改图|修图|p一下|抠图/, 'image_edit'],
  [/生成.{0,8}图(?!文)|画一[张幅]|配图|做[张个]图|海报|插画/, 't2i'],
];

export function keywordIntent(text: string): ActionTypeKey | null {
  const t = text || '';
  for (const [re, k] of KW) if (re.test(t)) return k;
  return null;
}

export function parseIntentResult(raw: string): { type: IntentType; prompt: string } {
  try {
    const m = (raw || '').match(/\{[\s\S]*\}/);
    if (!m) return { type: 'none', prompt: '' };
    const o = JSON.parse(m[0]) as { type?: unknown; prompt?: unknown };
    const t = String(o.type ?? 'none');
    const type = (['tts', 't2i', 'image_edit', 't2v', 'i2v', 'none'].includes(t) ? t : 'none') as IntentType;
    return { type, prompt: typeof o.prompt === 'string' ? o.prompt : '' };
  } catch {
    return { type: 'none', prompt: '' };
  }
}

export async function detectActionIntent(args: {
  userText: string;
  assistantText: string;
  chatModelId: string | null;
}): Promise<{ type: IntentType; prompt: string }> {
  const kw = keywordIntent(args.userText);
  const kwResult = { type: (kw ?? 'none') as IntentType, prompt: kw ? args.assistantText : '' };
  if (!args.chatModelId) return kwResult;
  try {
    const sys =
      '你判断用户是否想用助手的产出生成一种媒体。只输出 JSON:'
      + '{"type":"tts|t2i|image_edit|t2v|i2v|none","prompt":"用于生成的提示词或文稿"}。'
      + '不是生成媒体则 type=none。tts=语音,t2i=文生图,image_edit=改图,t2v=文生视频,i2v=图生视频。';
    const r = await aiPlatformChat.complete({
      model: args.chatModelId,
      messages: [
        { role: 'system', content: sys },
        { role: 'user', content: `用户:${args.userText}\n助手产出:${(args.assistantText || '').slice(0, 2000)}` },
      ],
      temperature: 0,
      max_tokens: 400,
    });
    const text = r.choices?.[0]?.message?.content ?? '';
    const parsed = parseIntentResult(text);
    if (parsed.type !== 'none') return { type: parsed.type, prompt: parsed.prompt || args.assistantText };
    return kwResult;
  } catch {
    return kwResult;
  }
}
