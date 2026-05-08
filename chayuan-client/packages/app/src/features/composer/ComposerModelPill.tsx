/**
 * ComposerModelPill —— Composer 顶行的模型选择器(Pill 样式)。
 *
 * 数据源:GET /v1/models(`@chayuan/api` models.list)。
 * 选中后:写 useComposerStore.setModel(id);ChatPage / KbPage 在
 *        sendMessage 时用 composer.modelId 作为请求 model 字段,因此
 *        这里的选择直接决定下一次对话用哪个模型。
 *
 * 列表组织 / 折叠 / 搜索:统一在 features/composer/ModelMenuList。
 * 顶部 ModelPicker(features/chat/ModelPicker) 也复用同一份。
 */

import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { ChevronDown, Cpu } from 'lucide-react';
import {
  Button,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
  Pill,
} from '@chayuan/ui';
import { models, type RawModelItem } from '@chayuan/api';
import { logEvent, Events } from '@chayuan/observability';
import { useComposerStore, useComposerS } from '../../store/composer';
import { useLogosManifest, useResolveLogo } from '../catalog/useLogos';
import { useTranslation } from '../../i18n';
import { ModelMenuList } from './ModelMenuList';

const Logo: React.FC<{ src?: string; name: string }> = ({ src, name }) => {
  const [errored, setErrored] = React.useState(false);
  if (src && !errored) {
    return (
      <img
        src={src}
        alt={name}
        className="h-3.5 w-3.5 flex-shrink-0 rounded-sm object-contain"
        loading="lazy"
        onError={() => setErrored(true)}
      />
    );
  }
  return (
    <span
      className={cn(
        'h-3.5 w-3.5 flex flex-shrink-0 items-center justify-center rounded-sm',
        'bg-[var(--cy-brand-50)] text-[9px] font-bold text-[var(--cy-brand-600)]',
      )}
    >
      {name.slice(0, 1).toUpperCase()}
    </span>
  );
};

export interface ComposerModelPillProps {
  menuMaxHeight?: number;
  contentClassName?: string;
  side?: 'top' | 'right' | 'bottom' | 'left';
  iconOnly?: boolean;
}

export const ComposerModelPill: React.FC<ComposerModelPillProps> = ({
  menuMaxHeight = 384,
  contentClassName,
  side = 'bottom',
  iconOnly = false,
}) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const modelId = useComposerS((s) => s.modelId);
  const platformName = useComposerS((s) => s.platformName);
  const setModel = useComposerS((s) => s.setModel);
  const [open, setOpen] = React.useState(false);

  // 单机/桌面版关闭 check_access:每个不可达厂商会触发 OpenAI client 4 次重试
  // (~5s),多厂商累加可让下拉打开几十秒看着像"没加载"。改用快速读+按需重试,
  // 真正不可达的模型会在调用时由 chat 路径报错(可定位的明确错误)。
  const { data = [] } = useQuery<RawModelItem[]>({
    queryKey: ['v1.models', { type: 'llm' }],
    queryFn: () => models.list({ type: 'llm' }),
    staleTime: 60_000,
    retry: 0,
  });
  useLogosManifest();
  const resolveLogo = useResolveLogo();

  // 81 题:跨平台同名时,用 (id, platform_name) 复合匹配
  const current = data.find(
    (m) => m.id === modelId && (!platformName || m.platform_name === platformName),
  );

  // 96 题:store 里的 modelId 必须在真实 /v1/models 里才视为有效
  // 不在的(用户决策"凭空出现 claude" → 上次硬编码 default)→ 自动清空 + 默认选第一个
  React.useEffect(() => {
    if (!modelId || data.length === 0) return;
    if (!current) {
      const first = data.find((m) => m.available !== false) ?? data[0];
      if (first) {
        setModel(first.id, first.platform_name);
      }
    }
  }, [modelId, data, current, setModel]);

  const currentLogo = resolveLogo(current?.platform_name, current?.id);
  const currentLabel = current?.id ?? (modelId || '— 未选 —');
  const compact = true || iconOnly;

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Pill
          tone="outline"
          size="sm"
          aria-label={t('chat.modelSelector')}
          title={`当前模型：${currentLabel}`}
          className={cn(
            'shrink-0',
            compact
              ? 'h-8 w-8 justify-center px-0'
              : 'max-[560px]:h-8 max-[560px]:w-8 max-[560px]:justify-center max-[560px]:px-0',
          )}
        >
          <Logo src={currentLogo} name={current?.platform_name ?? current?.id ?? modelId} />
          {!compact && (
            <>
              <span className="max-w-[160px] truncate max-[560px]:hidden">{currentLabel}</span>
              <ChevronDown className="h-3 w-3 opacity-60 max-[560px]:hidden" />
            </>
          )}
        </Pill>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        side={side}
        sideOffset={8}
        collisionPadding={12}
        className={cn('z-[120] w-80 overflow-hidden p-0', contentClassName)}
      >
        <ModelMenuList
          models={data}
          currentId={modelId}
          currentPlatform={platformName}
          resolveLogo={resolveLogo}
          emptyLabel={t('chat.noModelAvailable')}
          emptyAction={
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setOpen(false);
                void navigate({ to: '/marketplace' });
              }}
            >
              <Cpu className="h-3.5 w-3.5" />
              去模型广场
            </Button>
          }
          maxHeight={menuMaxHeight}
          onPick={(m) => {
            if (m.available === false) return;
            // 77 题:传 platform_name 让 server 精确路由
            setModel(m.id, m.platform_name);
            logEvent(Events.ComposerModelChange, {
              metadata: { modelId: m.id, platform: m.platform_name },
            });
            setOpen(false);
          }}
        />
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
