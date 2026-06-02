/**
 * 数字人预设「模型 + 知识库」绑定的有效值 / 显隐解析。
 *
 * 预设有 4 个绑定字段:
 *   - model                provider::id;空=用会话/全局默认
 *   - ku_ids               doc:* / src:* / office:*;空=不挂知识库
 *   - allow_model_override 默认 true;false=锁定为预设 model
 *   - allow_kb_override    默认 true;false=锁定为预设 ku_ids
 *
 * 实时页 / 生成页据此预填 + 显隐 + 取有效值。
 */

type Bind =
  | {
      model?: string;
      ku_ids?: string[];
      allow_model_override?: boolean;
      allow_kb_override?: boolean;
    }
  | null
  | undefined;

/** 锁定且有预设模型时强制用预设模型,否则取会话值 → 预设值 → 空。 */
export function effectiveModel(preset: Bind, sessionModel: string): string {
  const allow = preset?.allow_model_override ?? true;
  if (!allow && preset?.model) return preset.model;
  return sessionModel || preset?.model || '';
}

/** 锁定且有预设知识源时强制用预设;否则会话有值用会话,否则退到预设。 */
export function effectiveKuIds(preset: Bind, sessionKuIds: string[]): string[] {
  const allow = preset?.allow_kb_override ?? true;
  if (!allow && (preset?.ku_ids?.length ?? 0) > 0) return preset!.ku_ids!;
  return sessionKuIds.length ? sessionKuIds : preset?.ku_ids ?? [];
}

/** 允许覆盖,或没有预设模型可锁,才显示模型选择器。 */
export function showModelPicker(preset: Bind): boolean {
  return (preset?.allow_model_override ?? true) || !preset?.model;
}

/** 允许覆盖,或没有预设知识源可锁,才显示知识库选择器。 */
export function showKbPicker(preset: Bind): boolean {
  return (preset?.allow_kb_override ?? true) || !preset?.ku_ids?.length;
}
