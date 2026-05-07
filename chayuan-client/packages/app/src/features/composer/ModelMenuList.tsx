/**
 * 共享的"分组折叠 + 搜索"模型菜单。
 *
 * 同时被 Composer 顶行 Pill(ComposerModelPill) 和 ChatPage 顶栏(ModelPicker)使用。
 *
 * 行为:
 *   - 按 platform_name 分组,每组一个可点击的标题(logo + 名 + count + 折叠 ▶/▼)
 *   - 默认仅展开"当前选中模型所在的组";其它组初始折叠 → 下拉栏目不再无限拉长
 *   - 标题状态记到 localStorage('cy.modelPicker.collapsed.v1') 跨会话保留,
 *     新厂商首次出现时按"默认折叠"对待(避免一次性又把列表撑开)
 *   - 顶部一行筛选输入,实时缩窄分组与项;命中时自动展开命中组
 *   - 只展示对话模型:后端标注 `model_type='llm'` 的模型;旧后端未标注类型时兼容放行
 *
 * 性能:
 *   - 分组与过滤在 useMemo 里 O(n);n 通常 < 200 没必要 windowing
 *   - localStorage 写入 throttle 到下一帧,避免快速点击连发同步写
 */

import type { RawModelItem } from '@chayuan/api';
import { cn } from '@chayuan/ui';
import { Check, ChevronDown, ChevronRight, Search, TriangleAlert } from 'lucide-react';
import * as React from 'react';

/** 对话框模型选择只允许 LLM;未标注类型的旧数据兼容放行。 */
function isChatModel(model: RawModelItem): boolean {
  const modelType = (model.model_type ?? '').trim().toLowerCase();
  return modelType === '' || modelType === 'llm';
}

const STORAGE_KEY = 'cy.modelPicker.override.v2';

interface PlatformGroup {
  /** 用作分组 key + 内部识别(同 platform_name) */
  platform: string;
  /** 82 题:展示给用户的友好名(如"深度求索 DeepSeek");无则等于 platform */
  displayName: string;
  items: RawModelItem[];
}

function groupByPlatform(list: ReadonlyArray<RawModelItem>): PlatformGroup[] {
  const map = new Map<string, { displayName: string; items: RawModelItem[] }>();
  for (const m of list) {
    const key = m.platform_name || '其它';
    const display = m.platform_display_name || m.platform_name || '其它';
    const entry = map.get(key) ?? { displayName: display, items: [] };
    // 同一分组内 display_name 应一致,但兜底:取最先出现的非空值
    if (!entry.displayName && display) entry.displayName = display;
    entry.items.push(m);
    map.set(key, entry);
  }
  return Array.from(map.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([platform, { displayName, items }]) => ({
      platform,
      displayName: displayName || platform,
      items: items.slice().sort((a, b) => a.id.localeCompare(b.id)),
    }));
}

/**
 * 用 Map<platform, boolean> 显式记录"用户的覆盖选择"——
 * true=用户主动展开,false=用户主动折叠,缺省=按默认规则(只有当前模型所在组展开)。
 *
 * 之前用 Set<collapsedPlatform> 记"被折叠的"是错的:对非默认展开的组(=非当前模型组),
 * 用户点一下"展开",代码 next.delete(platform) 把它移出 collapsed,但默认规则仍判它折叠
 * → 永远展不开。Map 三态语义化解这个问题。
 */
function readOverrideLS(): Map<string, boolean> {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
    if (!raw) return new Map();
    const obj = JSON.parse(raw) as unknown;
    if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
      const m = new Map<string, boolean>();
      for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
        if (typeof v === 'boolean') m.set(k, v);
      }
      return m;
    }
  } catch {
    /* ignore */
  }
  return new Map();
}

function writeOverrideLS(m: Map<string, boolean>): void {
  try {
    const obj: Record<string, boolean> = {};
    for (const [k, v] of m) obj[k] = v;
    globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(obj));
  } catch {
    /* ignore */
  }
}

const Logo: React.FC<{ src?: string; name: string; size?: 'sm' | 'md' }> = ({
  src,
  name,
  size = 'sm',
}) => {
  const [errored, setErrored] = React.useState(false);
  const dims = size === 'md' ? 'h-4 w-4' : 'h-3.5 w-3.5';
  if (src && !errored) {
    return (
      <img
        src={src}
        alt={name}
        className={cn(dims, 'flex-shrink-0 rounded-sm object-contain')}
        loading="lazy"
        onError={() => setErrored(true)}
      />
    );
  }
  return (
    <span
      className={cn(
        dims,
        'flex flex-shrink-0 items-center justify-center rounded-sm bg-[var(--cy-brand-50)] text-[9px] font-bold text-[var(--cy-brand-600)]',
      )}
    >
      {name.slice(0, 1).toUpperCase()}
    </span>
  );
};

export interface ModelMenuListProps {
  models: ReadonlyArray<RawModelItem>;
  currentId: string;
  /**
   * 81 题:当前选中模型所属 platform_name(可选)。
   *
   * 跨平台同名模型(如 deepseek 与 baidu-qianfan 都有 deepseek-v4-flash)时,
   * 仅靠 currentId 匹配会让两个 entry 同时高亮"✓ 已选";传入 currentPlatform
   * 后,只有 (id, platform_name) 都匹配的那一个才被标选中。
   *
   * undefined 时退回旧行为(只匹配 id)— 兼容老调用方。
   */
  currentPlatform?: string;
  onPick(model: RawModelItem): void;
  resolveLogo(platform?: string, modelId?: string): string | undefined;
  /** 空列表占位文案;不传用默认 */
  emptyLabel?: string;
  /** dropdown 容器最大高度(默认 384px) */
  maxHeight?: number;
}

/**
 * 81 题:用复合键 (id, platform_name) 判断模型是否被选中。
 * 仅给 platform_name 时严格匹配;否则退回单 id 匹配(老调用方兼容)。
 */
function isSelectedModel(
  m: { id: string; platform_name?: string },
  currentId: string,
  currentPlatform?: string,
): boolean {
  if (m.id !== currentId) return false;
  if (!currentPlatform) return true; // 没传 platform → 旧行为
  return m.platform_name === currentPlatform;
}

export const ModelMenuList: React.FC<ModelMenuListProps> = ({
  models,
  currentId,
  currentPlatform,
  onPick,
  resolveLogo,
  emptyLabel = '暂无可用模型',
  maxHeight = 384,
}) => {
  const [keyword, setKeyword] = React.useState('');
  const [override, setOverride] = React.useState<Map<string, boolean>>(() => readOverrideLS());
  const inputRef = React.useRef<HTMLInputElement | null>(null);

  // 自动 focus 搜索框 — 提升键盘玩家效率
  React.useEffect(() => {
    const t = setTimeout(() => inputRef.current?.focus(), 30);
    return () => clearTimeout(t);
  }, []);

  const allGroups = React.useMemo(() => {
    const filtered = models.filter(isChatModel);
    return groupByPlatform(filtered);
  }, [models]);

  /** 当前选中模型所在的 platform — 默认展开它(81 题:优先用 props 传入的精确 platform) */
  const expandedPlatform = React.useMemo(() => {
    if (currentPlatform) return currentPlatform;
    // 没传 → 退回找第一个 id 匹配的(旧行为)
    const cur = models.find((m) => m.id === currentId);
    return cur?.platform_name || '其它';
  }, [models, currentId, currentPlatform]);

  /** 关键字过滤后的可见组(也用于决定哪些组要因匹配自动展开) */
  const visibleGroups = React.useMemo(() => {
    const q = keyword.trim().toLowerCase();
    if (!q) return allGroups;
    return allGroups
      .map((g) => {
        // 82 题:搜索同时命中 pid 和 display_name(用户搜"深度求索"也能找到)
        const matchPlatform =
          g.platform.toLowerCase().includes(q) ||
          g.displayName.toLowerCase().includes(q);
        const items = matchPlatform
          ? g.items
          : g.items.filter((m) => m.id.toLowerCase().includes(q));
        return { ...g, items, _matchedByPlatform: matchPlatform };
      })
      .filter((g) => g.items.length > 0);
  }, [allGroups, keyword]);

  /**
   * 决定某组是否展开:
   *   - 有关键字时强制展开命中组
   *   - 用户显式选过 → 用 override.get(platform)(true=展开 / false=折叠)
   *   - 否则默认仅展开当前模型所在的那一组
   */
  const isExpanded = React.useCallback(
    (platform: string): boolean => {
      if (keyword.trim()) return true;
      const ov = override.get(platform);
      if (typeof ov === 'boolean') return ov;
      return platform === expandedPlatform;
    },
    [keyword, override, expandedPlatform],
  );

  const toggleGroup = (platform: string) => {
    // 拍一下当前是否展开,然后写入 override 的反值
    const nowExpanded = isExpanded(platform);
    setOverride((prev) => {
      const next = new Map(prev);
      next.set(platform, !nowExpanded);
      writeOverrideLS(next);
      return next;
    });
  };

  const totalShown = visibleGroups.reduce((s, g) => s + g.items.length, 0);

  return (
    <div className="flex flex-col" style={{ maxHeight }}>
      {/* 搜索栏 */}
      <div className="sticky top-0 z-[1] flex-shrink-0 border-b border-[var(--cy-border-subtle)] bg-[var(--cy-surface-base)] p-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--cy-text-tertiary)]" />
          <input
            ref={inputRef}
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder="搜索模型 / 厂商"
            className="h-7 w-full rounded-md border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-1)] pl-7 pr-2 text-xs text-[var(--cy-text-primary)] placeholder:text-[var(--cy-text-tertiary)] focus-visible:border-[var(--cy-brand-400)] focus-visible:outline-none"
            // 让 Radix 不要把方向键吞掉(否则方向键不能在输入框里左右)
            onKeyDown={(e) => e.stopPropagation()}
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-1">
        {allGroups.length === 0 && (
          <p className="px-3 py-6 text-center text-xs text-[var(--cy-text-tertiary)]">
            {emptyLabel}
          </p>
        )}
        {allGroups.length > 0 && totalShown === 0 && (
          <p className="px-3 py-6 text-center text-xs text-[var(--cy-text-tertiary)]">
            没有匹配的模型
          </p>
        )}
        {visibleGroups.map((g) => {
          const expanded = isExpanded(g.platform);
          const platformLogo = resolveLogo(g.platform);
          return (
            <div key={g.platform} className="mb-0.5">
              <button
                type="button"
                onClick={() => toggleGroup(g.platform)}
                className="group flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-[11px] font-semibold uppercase tracking-wider text-[var(--cy-text-tertiary)] hover:bg-[var(--cy-surface-1)]"
                aria-expanded={expanded}
              >
                {expanded ? (
                  <ChevronDown className="h-3 w-3 flex-shrink-0 opacity-70" />
                ) : (
                  <ChevronRight className="h-3 w-3 flex-shrink-0 opacity-70" />
                )}
                <Logo src={platformLogo} name={g.displayName} size="md" />
                <span
                  className="min-w-0 flex-1 truncate normal-case text-[var(--cy-text-secondary)]"
                  title={g.platform}    /* hover 显示 pid 用于调试 */
                >
                  {/* 82 题:显示中英文友好名(深度求索 DeepSeek)而非裸 pid (deepseek) */}
                  {g.displayName}
                </span>
                <span className="text-[10px] font-normal opacity-60">{g.items.length}</span>
              </button>
              {expanded && (
                <ul className="space-y-0.5 pl-1">
                  {g.items.map((m) => {
                    const logo = resolveLogo(m.platform_name, m.id);
                    // 81 题:用 (id, platform_name) 复合键判选中,
                    // 避免跨平台同名 model 同时高亮
                    const active = isSelectedModel(m, currentId, currentPlatform);
                    const disabled = m.available === false;
                    return (
                      <li key={`${m.platform_name ?? ''}::${m.id}`}>
                        <button
                          type="button"
                          disabled={disabled}
                          title={disabled ? m.reason || '模型检查不可用' : undefined}
                          onClick={() => {
                            if (disabled) return;
                            onPick(m);
                          }}
                          className={cn(
                            'flex w-full items-center gap-2 rounded-md px-2 py-1.5 pl-7 text-left text-sm transition-colors',
                            disabled
                              ? 'cursor-not-allowed text-[var(--cy-text-tertiary)] opacity-55'
                              : active
                              ? 'bg-[var(--cy-brand-50)] text-[var(--cy-brand-700)]'
                              : 'text-[var(--cy-text-primary)] hover:bg-[var(--cy-surface-1)]',
                          )}
                        >
                          <Logo src={logo} name={m.platform_name ?? m.id} />
                          <span className="min-w-0 flex-1 truncate font-medium">{m.id}</span>
                          {disabled && (
                            <TriangleAlert className="h-3.5 w-3.5 flex-shrink-0 text-amber-500" />
                          )}
                          {active && <Check className="h-3.5 w-3.5 flex-shrink-0 opacity-80" />}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
