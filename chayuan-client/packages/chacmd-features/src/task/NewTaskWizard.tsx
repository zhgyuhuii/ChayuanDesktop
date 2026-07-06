import * as React from 'react';
import { type TaskDraft, parseNlDraft, validateDraft } from './newTaskModel';

const InferredBadge: React.FC = () => (
  <span
    style={{
      marginLeft: 6,
      fontSize: 10,
      color: '#f59e0b',
      border: '1px solid #f59e0b',
      borderRadius: 4,
      padding: '0 4px',
    }}
  >
    推断
  </span>
);

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: 8,
  background: 'rgba(255,255,255,0.04)',
  border: '1px solid rgba(148,163,184,0.3)',
  borderRadius: 8,
  color: '#e5e7eb',
  fontSize: 13,
};

/**
 * 新建任务向导（§6.16）：仅 goal 必填，NL 草稿原地渲染成带"推断"标记的表单；
 * "创建智能体"与"派活"分离（本组件只建任务 + 选/建 agent，派活是后续动作）。
 */
export const NewTaskWizard: React.FC<{
  agents: string[];
  onCreate: (draft: TaskDraft, agent: string) => void;
}> = ({ agents, onCreate }) => {
  const [draft, setDraft] = React.useState<TaskDraft>(() => parseNlDraft(''));
  const [agent, setAgent] = React.useState<string>(agents[0] ?? '__new__');
  const errors = validateDraft(draft);

  const onGoal = (goal: string) => {
    // 重新推断：goal 变则同步刷新推断字段（用户已手改的字段保留由 inferred 标记体现）
    setDraft((prev) => {
      const next = parseNlDraft(goal);
      return {
        ...next,
        name: prev.inferred.name ? next.name : prev.name,
        code: prev.inferred.code ? next.code : prev.code,
        workdir: prev.inferred.workdir ? next.workdir : prev.workdir,
        inferred: prev.inferred,
      };
    });
  };

  const edit = (field: 'name' | 'code' | 'workdir', value: string) =>
    setDraft((p) => ({ ...p, [field]: value, inferred: { ...p.inferred, [field]: false } }));

  const field = (label: string, key: 'name' | 'code' | 'workdir') => (
    <label style={{ display: 'block', marginBottom: 10 }}>
      <div style={{ color: '#94a3b8', fontSize: 12, marginBottom: 4 }}>
        {label}
        {draft.inferred[key] ? <InferredBadge /> : null}
      </div>
      <input style={inputStyle} value={draft[key]} onChange={(e) => edit(key, e.target.value)} />
    </label>
  );

  return (
    <div data-testid="new-task-wizard" style={{ maxWidth: 480, padding: 20, color: '#e5e7eb' }}>
      <h2 style={{ fontSize: 18, marginBottom: 16 }}>新建任务</h2>
      <label style={{ display: 'block', marginBottom: 10 }}>
        <div style={{ color: '#94a3b8', fontSize: 12, marginBottom: 4 }}>目标 goal（必填）</div>
        <textarea
          style={{ ...inputStyle, minHeight: 72, resize: 'vertical' }}
          value={draft.goal}
          onChange={(e) => onGoal(e.target.value)}
          placeholder="用一句话说明要做什么，其余字段自动推断…"
        />
      </label>
      {field('任务名称', 'name')}
      {field('任务代号 code', 'code')}
      {field('工作目录', 'workdir')}
      <label style={{ display: 'block', marginBottom: 16 }}>
        <div style={{ color: '#94a3b8', fontSize: 12, marginBottom: 4 }}>智能体（选现有或新建）</div>
        <select style={inputStyle} value={agent} onChange={(e) => setAgent(e.target.value)}>
          {agents.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
          <option value="__new__">＋ 创建新智能体</option>
        </select>
      </label>
      <button
        type="button"
        disabled={errors.length > 0}
        onClick={() => onCreate(draft, agent)}
        style={{
          padding: '10px 16px',
          borderRadius: 8,
          border: 'none',
          background: errors.length ? 'rgba(148,163,184,0.2)' : '#3b82f6',
          color: errors.length ? '#64748b' : '#fff',
          cursor: errors.length ? 'not-allowed' : 'pointer',
        }}
      >
        创建任务
      </button>
      {errors.length ? (
        <div style={{ color: '#ef4444', fontSize: 12, marginTop: 8 }}>{errors[0]?.message}</div>
      ) : null}
    </div>
  );
};
