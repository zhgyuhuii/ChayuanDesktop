/**
 * 新建任务向导数据模型（§6.16，纯逻辑）。
 * 仅 goal 必填；NL 草稿原地推断出 name/code/workdir 并打"推断"标记（供 UI 高亮可改）。
 */

export interface TaskDraft {
  name: string;
  code: string;
  goal: string;
  workdir: string;
  /** 各字段是否为系统推断（true=可疑可改；false=用户直给）。 */
  inferred: { name: boolean; code: boolean; goal: boolean; workdir: boolean };
}

export interface DraftError {
  field: keyof Omit<TaskDraft, 'inferred'>;
  message: string;
}

/** slug：保留 [a-z0-9]，其余转连字符；空则回退 'task'。 */
function slugify(text: string): string {
  const s = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return s || 'task';
}

function deriveName(goal: string): string {
  const firstLine = goal.split('\n')[0]?.trim() ?? '';
  // 取前 24 字作任务名（NL 草稿常是一句话）
  return firstLine.slice(0, 24) || '未命名任务';
}

export function parseNlDraft(text: string): TaskDraft {
  const goal = text.trim();
  const name = deriveName(goal);
  const code = slugify(goal);
  return {
    name,
    code,
    goal,
    workdir: `/workspace/${code}`,
    inferred: { name: true, code: true, goal: false, workdir: true },
  };
}

export function validateDraft(draft: TaskDraft): DraftError[] {
  const errors: DraftError[] = [];
  if (!draft.goal.trim()) {
    errors.push({ field: 'goal', message: '目标（goal）为必填' });
  }
  return errors;
}

export { slugify };
