import * as React from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getPlatform, copyText } from '@chayuan/platform-shared';
import { digitalHuman, type PublishedAvatar } from '@chayuan/api';
import { Link2, ExternalLink, Trash2, MessageSquare, MessageSquareOff, Scissors } from 'lucide-react';
import { reportError, notifySuccess } from '../../store/errorDialog';
import { confirmDialog } from '../../store/confirmDialog';

const ratioLabel = (w: number, h: number): string => (w >= h ? '横版' : w === h ? '方形' : '竖版') + ` ${w}×${h}`;

/** 「在线数字人」tab:已发布的在线数字人,卡片/列表切换,实时在线人数 + 复制/打开/开关/删除。 */
export const OnlineAvatarList: React.FC = () => {
  const qc = useQueryClient();
  const [view, setView] = React.useState<'card' | 'list'>(
    () => (localStorage.getItem('dh.online.view') === 'list' ? 'list' : 'card'),
  );
  const setViewP = (v: 'card' | 'list') => { localStorage.setItem('dh.online.view', v); setView(v); };
  // refetchInterval 让在线人数实时刷新(后端列表项带 viewers)。
  const q = useQuery({ queryKey: ['dh.published'], queryFn: digitalHuman.listPublished, refetchInterval: 4000 });
  // 时间倒序:最新发布的在线数字人始终排第一。
  const items = (q.data?.items ?? []).slice().sort((a, b) => (b.created ?? 0) - (a.created ?? 0));
  const refresh = () => void qc.invalidateQueries({ queryKey: ['dh.published'] });

  const copy = async (url: string) => {
    try {
      await copyText(url);
      notifySuccess('已复制链接', url);
    } catch {
      notifySuccess('链接', url);
    }
  };
  const open = (url: string) => { void getPlatform().shell.openExternal(url); };
  const del = async (it: PublishedAvatar) => {
    const ok = await confirmDialog(`确定下线并删除「${it.name}」?公开链接将立即失效。`);
    if (!ok) return;
    try { await digitalHuman.deletePublished(it.token); } catch (e) { reportError(e as Error, '删除失败'); }
    refresh();
  };
  const toggle = async (it: PublishedAvatar, flags: { enabled?: boolean; chat_enabled?: boolean; matte?: boolean; matte_sim?: number }) => {
    try { await digitalHuman.setPublishedFlags(it.token, flags); } catch (e) { reportError(e as Error, '更新失败'); }
    refresh();
  };

  const tabBtn = (v: 'card' | 'list', label: string) => (
    <button type="button" onClick={() => setViewP(v)}
      className={`h-6 rounded px-2 text-xs ${view === v
        ? 'bg-[var(--cy-ink-700)] text-white'
        : 'text-[var(--cy-text-secondary)] hover:bg-[var(--cy-surface-2)]'}`}>{label}</button>
  );

  const viewers = (n: number) => (
    <span className="inline-flex items-center gap-1 text-xs text-[var(--cy-text-secondary)]">
      <span className="inline-block h-2 w-2 rounded-full bg-emerald-500" />{n} 人在看
    </span>
  );

  const thumb = (it: PublishedAvatar, cls: string) =>
    it.avatar_kind === 'video'
      ? <video src={digitalHuman.avatarFileUrl(it.avatar_ref)} muted className={cls} />
      : <img src={digitalHuman.avatarFileUrl(it.avatar_ref)} alt={it.name} className={cls} />;

  const iconBtn = 'inline-flex h-7 w-7 items-center justify-center rounded-md border border-[var(--cy-border-subtle)] text-[var(--cy-text-secondary)] hover:bg-[var(--cy-surface-2)]';

  return (
    <div className="flex h-full flex-col p-1">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs text-[var(--cy-text-tertiary)]">在线数字人({items.length})</span>
        <div className="flex gap-1">{tabBtn('card', '卡片')}{tabBtn('list', '列表')}</div>
      </div>

      {items.length === 0 ? (
        <div className="flex flex-1 items-center justify-center text-sm text-[var(--cy-text-tertiary)]">
          暂无在线数字人。到「工作台」点右上角「发布在线数字人」即可发布。
        </div>
      ) : view === 'card' ? (
        <div className="flex flex-1 flex-wrap content-start gap-3 overflow-y-auto">
          {items.map((it) => (
            <div key={it.token} className="flex w-60 flex-col gap-2 rounded-lg border border-[var(--cy-border-subtle)] p-2">
              <div className="relative overflow-hidden rounded-md bg-black" style={{ aspectRatio: `${it.video_width} / ${it.video_height}`, maxHeight: 180 }}>
                {thumb(it, 'h-full w-full object-contain')}
                {!it.enabled && (
                  <div className="absolute inset-0 flex items-center justify-center bg-black/60 text-xs text-white">已下线</div>
                )}
              </div>
              <div className="flex items-center justify-between">
                <span className="truncate text-sm font-medium text-[var(--cy-text-primary)]" title={it.name}>{it.name}</span>
                {viewers(it.viewers)}
              </div>
              <div className="text-[11px] text-[var(--cy-text-tertiary)]">{ratioLabel(it.video_width, it.video_height)}</div>
              <div className="flex items-center gap-1.5">
                <button type="button" title="复制链接" className={iconBtn} onClick={() => void copy(it.url)}><Link2 className="h-4 w-4" /></button>
                {false && <button type="button" title="打开公开页" className={iconBtn} onClick={() => open(it.url)}><ExternalLink className="h-4 w-4" /></button>}
                <button type="button" title={it.chat_enabled ? '关闭对话(转纯观看)' : '开启对话'} className={iconBtn}
                  onClick={() => void toggle(it, { chat_enabled: !it.chat_enabled })}>
                  {it.chat_enabled ? <MessageSquare className="h-4 w-4" /> : <MessageSquareOff className="h-4 w-4" />}
                </button>
                <button type="button" title={it.matte ? '关闭抠像' : '开启抠像(去背景纯色,仅留人像)'} className={iconBtn}
                  onClick={() => void toggle(it, { matte: !it.matte })}>
                  <Scissors className={`h-4 w-4 ${it.matte ? 'text-[var(--cy-brand-500)]' : ''}`} />
                </button>
                {it.matte && (
                  <input type="range" min={0.05} max={0.5} step={0.01} key={String(it.matte_sim ?? 0.15)}
                    defaultValue={it.matte_sim ?? 0.15} title="抠图强度(越大抠越狠;抠烂了调小、没抠净调大)"
                    onMouseUp={(e) => void toggle(it, { matte_sim: Number((e.target as HTMLInputElement).value) })}
                    onTouchEnd={(e) => void toggle(it, { matte_sim: Number((e.target as HTMLInputElement).value) })}
                    className="w-16 accent-[var(--cy-brand-500)]" />
                )}
                <button type="button" title="删除" className={`${iconBtn} hover:text-[var(--cy-danger-500)]`} onClick={() => void del(it)}><Trash2 className="h-4 w-4" /></button>
                <label className="ml-auto inline-flex cursor-pointer items-center gap-1 text-[11px] text-[var(--cy-text-secondary)]">
                  <input type="checkbox" checked={it.enabled} onChange={(e) => void toggle(it, { enabled: e.target.checked })} />上线
                </label>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="flex-1 overflow-auto">
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr className="text-left text-[var(--cy-text-tertiary)]">
                <th className="py-1 pr-3 font-normal">名称</th>
                <th className="py-1 pr-3 font-normal">比例</th>
                <th className="py-1 pr-3 font-normal">在线</th>
                <th className="py-1 pr-3 font-normal">上线</th>
                <th className="py-1 pr-3 font-normal">对话</th>
                <th className="py-1 font-normal">操作</th>
              </tr>
            </thead>
            <tbody>
              {items.map((it) => (
                <tr key={it.token} className="border-t border-[var(--cy-border-subtle)] align-middle text-[var(--cy-text-secondary)]">
                  <td className="py-1 pr-3">
                    <div className="flex items-center gap-2">
                      {thumb(it, 'h-8 w-8 rounded object-cover')}
                      <span className="max-w-[160px] truncate" title={it.name}>{it.name}</span>
                    </div>
                  </td>
                  <td className="py-1 pr-3 whitespace-nowrap">{ratioLabel(it.video_width, it.video_height)}</td>
                  <td className="py-1 pr-3 whitespace-nowrap">{viewers(it.viewers)}</td>
                  <td className="py-1 pr-3">
                    <input type="checkbox" checked={it.enabled} onChange={(e) => void toggle(it, { enabled: e.target.checked })} />
                  </td>
                  <td className="py-1 pr-3">
                    <input type="checkbox" checked={it.chat_enabled} onChange={(e) => void toggle(it, { chat_enabled: e.target.checked })} />
                  </td>
                  <td className="py-1">
                    <div className="flex gap-1.5">
                      <button type="button" title="复制链接" className={iconBtn} onClick={() => void copy(it.url)}><Link2 className="h-4 w-4" /></button>
                      {false && <button type="button" title="打开公开页" className={iconBtn} onClick={() => open(it.url)}><ExternalLink className="h-4 w-4" /></button>}
                      <button type="button" title={it.matte ? '关闭抠像' : '开启抠像(去背景纯色,仅留人像)'} className={iconBtn}
                        onClick={() => void toggle(it, { matte: !it.matte })}>
                        <Scissors className={`h-4 w-4 ${it.matte ? 'text-[var(--cy-brand-500)]' : ''}`} />
                      </button>
                      {it.matte && (
                        <input type="range" min={0.05} max={0.5} step={0.01} key={String(it.matte_sim ?? 0.15)}
                          defaultValue={it.matte_sim ?? 0.15} title="抠图强度(越大抠越狠;抠烂了调小、没抠净调大)"
                          onMouseUp={(e) => void toggle(it, { matte_sim: Number((e.target as HTMLInputElement).value) })}
                          onTouchEnd={(e) => void toggle(it, { matte_sim: Number((e.target as HTMLInputElement).value) })}
                          className="w-16 accent-[var(--cy-brand-500)]" />
                      )}
                      <button type="button" title="删除" className={`${iconBtn} hover:text-[var(--cy-danger-500)]`} onClick={() => void del(it)}><Trash2 className="h-4 w-4" /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};
