import * as React from 'react';
import { Settings2, RotateCcw } from 'lucide-react';
import {
  Button,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
  Input,
} from '@chayuan/ui';
import { useComposerStore } from '../../store/composer';

/**
 * 高级参数面板。
 *
 * 设计：
 * - DropdownMenu 作为 popover 容器；内部表单控件用 stopPropagation 防误关。
 * - 字段全部可空；空 = 后端默认值（temperature=0.3 / max_tokens=null / prompt='default'）。
 * - 只在用户主动展开时挂载（DropdownMenuContent 默认 portal + lazy）。
 */
export const AdvancedParams: React.FC = () => {
  const { temperature, maxTokens, promptName, topK, scoreThreshold, setAdvanced, resetAdvanced } =
    useComposerStore();
  const dirty = temperature !== undefined || maxTokens !== undefined || promptName !== undefined || topK !== undefined || scoreThreshold !== undefined;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant={dirty ? 'default' : 'outline'}
          size="sm"
          className={cn('h-7 gap-1.5 rounded-full px-2.5 text-xs')}
          aria-label="高级参数"
        >
          <Settings2 className="h-3.5 w-3.5" />
          高级
          {dirty && <span className="rounded-full bg-primary-foreground/20 px-1.5 text-[10px]">·</span>}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="w-72 p-3"
        onClick={(e) => e.stopPropagation()}
      >
        <Field label="Temperature" hint="0–1；高 = 更发散；空 = 后端默认 0.3">
          <Slider
            value={temperature ?? 0.3}
            min={0}
            max={1}
            step={0.05}
            onChange={(v) => setAdvanced({ temperature: v })}
          />
          <span className="text-xs tabular-nums text-muted-foreground">{temperature?.toFixed(2) ?? '默认'}</span>
        </Field>
        <Field label="Max tokens" hint="单次回复最多 token；空 = 模型默认">
          <Input
            type="number"
            placeholder="默认"
            value={maxTokens ?? ''}
            onChange={(e) => setAdvanced({ maxTokens: e.target.value ? Number.parseInt(e.target.value, 10) : undefined })}
            className="h-8 text-xs"
            min={1}
          />
        </Field>
        <Field label="Prompt 模板" hint="后端 Langfuse / 内置 prompt 名">
          <Input
            placeholder="default"
            value={promptName ?? ''}
            onChange={(e) => setAdvanced({ promptName: e.target.value || undefined })}
            className="h-8 text-xs"
          />
        </Field>
        <Field label="KB top_k" hint="知识库检索条数；空 = 默认 5">
          <Input
            type="number"
            placeholder="5"
            value={topK ?? ''}
            onChange={(e) => setAdvanced({ topK: e.target.value ? Number.parseInt(e.target.value, 10) : undefined })}
            className="h-8 text-xs"
            min={1}
            max={50}
          />
        </Field>
        <Field label="Score 阈值" hint="只接受 score ≥ 阈值的检索结果；空 = 默认 2.0">
          <Input
            type="number"
            placeholder="2.0"
            value={scoreThreshold ?? ''}
            onChange={(e) => setAdvanced({ scoreThreshold: e.target.value ? Number.parseFloat(e.target.value) : undefined })}
            className="h-8 text-xs"
            step={0.1}
            min={0}
          />
        </Field>
        {dirty && (
          <Button variant="ghost" size="sm" className="mt-2 h-7 w-full gap-1 text-xs" onClick={resetAdvanced}>
            <RotateCcw className="h-3 w-3" />
            重置为默认
          </Button>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

const Field: React.FC<{ label: string; hint?: string; children: React.ReactNode }> = ({ label, hint, children }) => (
  <div className="mb-2 space-y-1">
    <div className="flex items-center justify-between text-xs">
      <span className="font-medium">{label}</span>
    </div>
    <div className="flex items-center gap-2">{children}</div>
    {hint && <p className="text-[10px] text-muted-foreground">{hint}</p>}
  </div>
);

const Slider: React.FC<{ value: number; min: number; max: number; step: number; onChange: (v: number) => void }> = ({
  value,
  min,
  max,
  step,
  onChange,
}) => (
  <input
    type="range"
    className="flex-1 accent-[var(--color-primary)]"
    value={value}
    min={min}
    max={max}
    step={step}
    onChange={(e) => onChange(Number.parseFloat(e.target.value))}
  />
);
