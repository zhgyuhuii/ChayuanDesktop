import { type ProviderCatalogEntry, getClientConfig } from '@chayuan/api';
import { Dialog, DialogContent, DialogTitle, cn } from '@chayuan/ui';
import { Boxes, CheckCircle2, ChevronRight, Plus, Settings } from 'lucide-react';
import * as React from 'react';

export interface VendorHeroStripProps {
  vendors: ProviderCatalogEntry[];
  selectedVendor: string;
  onSelectVendor(value: string): void;
  onAddVendor(): void;
  onOpenSettings(vendor: ProviderCatalogEntry): void;
}

const VISIBLE_VENDOR_COUNT = 8;

function logoUrl(logo: string): string | undefined {
  if (!logo) return undefined;
  const base = (getClientConfig().baseURL || '').replace(/\/api\/?$/, '').replace(/\/$/, '');
  return `${base}/img/model_logos/${logo}`;
}

export const VendorHeroStrip: React.FC<VendorHeroStripProps> = ({
  vendors,
  selectedVendor,
  onSelectVendor,
  onAddVendor,
  onOpenSettings,
}) => {
  const [open, setOpen] = React.useState(false);
  const visible = vendors.slice(0, VISIBLE_VENDOR_COUNT);
  const rest = vendors.slice(VISIBLE_VENDOR_COUNT);

  return (
    <section className="rounded-3xl border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-base)] p-4 shadow-[var(--cy-shadow-sm)]">
      <div className="mb-3 flex items-center gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-2xl bg-[var(--cy-brand-50)] text-[var(--cy-brand-700)]">
          <Boxes className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold text-[var(--cy-text-primary)]">模型厂商</h2>
          <p className="text-xs text-[var(--cy-text-tertiary)]">
            先选厂商快速收窄模型范围，也可以通过“更多”浏览全部厂商。
          </p>
        </div>
        <button
          type="button"
          onClick={onAddVendor}
          className="inline-flex h-8 items-center gap-1.5 rounded-full border border-[var(--cy-border-subtle)] px-3 text-xs text-[var(--cy-text-secondary)] transition-colors hover:bg-[var(--cy-surface-2)] hover:text-[var(--cy-text-primary)]"
        >
          <Plus className="h-3.5 w-3.5" />
          添加厂商
        </button>
      </div>

      <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(9, minmax(0, 1fr))' }}>
        {visible.map((v) => (
          <VendorMiniCard
            key={v.pid}
            vendor={v}
            active={selectedVendor === v.pid}
            onClick={() => onSelectVendor(v.pid)}
            onOpenSettings={() => onOpenSettings(v)}
          />
        ))}
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="group flex min-h-[112px] flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-[var(--cy-border-subtle)] bg-[var(--cy-surface-1)] text-xs text-[var(--cy-text-secondary)] transition-all hover:border-[var(--cy-brand-300)] hover:bg-[var(--cy-brand-50)] hover:text-[var(--cy-brand-700)]"
        >
          <ChevronRight className="h-5 w-5 transition-transform group-hover:translate-x-0.5" />
          更多
          <span className="text-[10px] text-[var(--cy-text-tertiary)]">{rest.length} 家</span>
        </button>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          className={cn(
            'max-w-6xl max-h-[82vh] overflow-hidden p-0 gap-0',
          )}
        >
          <div className="flex items-center gap-3 border-b border-[var(--cy-border-subtle)] px-5 py-4 pr-12">
            <div>
              <DialogTitle className="text-base font-semibold text-[var(--cy-text-primary)]">
                全部模型厂商
              </DialogTitle>
              <p className="text-xs text-[var(--cy-text-tertiary)]">
                共 {vendors.length} 家，点击卡片即可筛选模型列表。
              </p>
            </div>
          </div>
          <div className="max-h-[66vh] overflow-y-auto p-5">
            <div className="grid grid-cols-4 gap-3">
              {vendors.map((v) => (
                <VendorFullCard
                  key={v.pid}
                  vendor={v}
                  active={selectedVendor === v.pid}
                  onClick={() => {
                    // 用户期望: 在"更多"对话框点厂商卡片直接弹配置, 而不仅是切筛选
                    onSelectVendor(v.pid);
                    setOpen(false);
                    // 短延迟,等"更多"对话框完全关掉再弹配置(防 Radix portal 抖动)
                    setTimeout(() => onOpenSettings(v), 60);
                  }}
                  onOpenSettings={() => onOpenSettings(v)}
                />
              ))}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </section>
  );
};

const VendorMiniCard: React.FC<{
  vendor: ProviderCatalogEntry;
  active: boolean;
  onClick(): void;
  onOpenSettings(): void;
}> = ({ vendor, active, onClick, onOpenSettings }) => {
  // 修 react hydration 错: 不能 button 嵌 button。外层改 div role=button,
  // 键盘 Enter/Space 触发 onClick;内层 cog 仍是真 button (绝对定位独立栈)
  const handleKey = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onClick();
    }
  };
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={handleKey}
      className={cn(
        'group relative flex min-h-[112px] cursor-pointer flex-col rounded-2xl border p-3 text-left transition-all',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--cy-brand-500)]',
        active
          ? 'border-[var(--cy-brand-400)] bg-[var(--cy-brand-50)] shadow-[var(--cy-shadow-sm)]'
          : 'border-[var(--cy-border-subtle)] bg-[var(--cy-surface-1)] hover:border-[var(--cy-brand-300)] hover:bg-[var(--cy-surface-base)]',
      )}
    >
      <div className="flex items-start gap-2">
        <VendorLogo vendor={vendor} />
        {vendor.configured && vendor.enabled && (
          <span
            className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-1.5 py-0.5 text-[9px] font-medium text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-200"
            title="已配置并启用"
            data-testid={`vendor-status-${vendor.pid}`}
          >
            <CheckCircle2 className="h-2.5 w-2.5" />
            已启用
          </span>
        )}
      </div>
      <p className="mt-2 truncate text-xs font-semibold text-[var(--cy-text-primary)]">
        {vendor.display_name}
      </p>
      <p className="mt-1 line-clamp-2 text-[10px] text-[var(--cy-text-tertiary)]">
        {vendor.description || vendor.platform_type}
      </p>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onOpenSettings();
        }}
        className="absolute right-2 top-2 hidden h-6 w-6 items-center justify-center rounded-full bg-[var(--cy-surface-base)] text-[var(--cy-text-tertiary)] shadow-sm group-hover:flex"
        title="配置厂商"
      >
        <Settings className="h-3 w-3" />
      </button>
    </div>
  );
};

const VendorFullCard: React.FC<{
  vendor: ProviderCatalogEntry;
  active: boolean;
  onClick(): void;
  onOpenSettings(): void;
}> = ({ vendor, active, onClick, onOpenSettings }) => {
  // 同 VendorMiniCard:外层 div role=button 防嵌套 button hydration 错
  const handleKey = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onClick();
    }
  };
  return (
  <div
    role="button"
    tabIndex={0}
    onClick={onClick}
    onKeyDown={handleKey}
    className={cn(
      'group relative min-h-[128px] cursor-pointer rounded-2xl border p-4 text-left transition-all hover:-translate-y-0.5 hover:shadow-[var(--cy-shadow-md)]',
      'focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--cy-brand-500)]',
      active
        ? 'border-[var(--cy-brand-400)] bg-[var(--cy-brand-50)]'
        : 'border-[var(--cy-border-subtle)] bg-[var(--cy-surface-1)]',
    )}
  >
    <div className="flex items-start gap-3">
      <VendorLogo vendor={vendor} size="lg" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <p className="truncate text-sm font-semibold text-[var(--cy-text-primary)]">
            {vendor.display_name}
          </p>
          {vendor.configured && vendor.enabled && (
            <CheckCircle2
              className="h-3.5 w-3.5 shrink-0 text-emerald-500"
              aria-label="已配置并启用"
            />
          )}
        </div>
        <div className="mt-1 flex flex-wrap gap-1">
          {(vendor.tags ?? []).slice(0, 3).map((tag) => (
            <span
              key={tag}
              className="rounded-full bg-[var(--cy-surface-base)] px-1.5 py-0.5 text-[9px] text-[var(--cy-text-tertiary)]"
            >
              {tag}
            </span>
          ))}
        </div>
      </div>
    </div>
    <p className="mt-3 line-clamp-2 text-xs text-[var(--cy-text-tertiary)]">
      {vendor.description || vendor.default_api_base || vendor.platform_type}
    </p>
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onOpenSettings();
      }}
      className="absolute bottom-3 right-3 rounded-full px-2 py-1 text-[10px] text-[var(--cy-text-tertiary)] hover:bg-[var(--cy-surface-base)] hover:text-[var(--cy-text-primary)]"
    >
      配置
    </button>
  </div>
  );
};

const VendorLogo: React.FC<{ vendor: ProviderCatalogEntry; size?: 'md' | 'lg' }> = ({
  vendor,
  size = 'md',
}) => {
  const url = logoUrl(vendor.logo);
  const box = size === 'lg' ? 'h-11 w-11' : 'h-9 w-9';
  if (url) {
    return (
      <img src={url} alt={vendor.display_name} className={cn(box, 'rounded-xl object-contain')} />
    );
  }
  return (
    <div
      className={cn(
        box,
        'flex items-center justify-center rounded-xl text-sm font-semibold text-white',
      )}
      style={{ background: vendor.color || '#6366f1' }}
    >
      {vendor.display_name.slice(0, 1).toUpperCase()}
    </div>
  );
};
