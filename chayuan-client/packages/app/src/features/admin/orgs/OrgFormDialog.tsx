import * as React from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@chayuan/ui';
import { orgs as orgsApi } from '@chayuan/api';
import { reportError, notifySuccess } from '../../../store/errorDialog';
import { genOrgCode } from './genOrgCode';

// 新建组织:单步双字段表单。编码随名称自动生成(拼音首字母),用户手改过后停止自动覆盖。
// 后端 code 唯一且创建后不可改(update_org 不接受 code),故仅在「新建」时填写。
interface Props {
  open: boolean;
  existingCodes: string[];
  onClose: () => void;
  onCreated: () => void;
}

const INPUT_CLS =
  'h-9 w-full rounded-md border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-1)] px-2 text-sm text-[var(--cy-text-primary)] focus-visible:border-[var(--cy-brand-400)] focus-visible:outline-none';

export const OrgFormDialog: React.FC<Props> = ({ open, existingCodes, onClose, onCreated }) => {
  const [name, setName] = React.useState('');
  const [code, setCode] = React.useState('');
  const [codeDirty, setCodeDirty] = React.useState(false);
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    if (open) { setName(''); setCode(''); setCodeDirty(false); setBusy(false); }
  }, [open]);

  const onNameChange = (v: string) => {
    setName(v);
    if (!codeDirty) setCode(genOrgCode(v, existingCodes));
  };

  const canSubmit = !!name.trim() && !!code.trim() && !busy;

  const submit = async () => {
    const nm = name.trim();
    const cd = code.trim();
    if (!nm || !cd) { reportError(new Error('名称和编码必填'), '无法创建'); return; }
    setBusy(true);
    try {
      await orgsApi.create({ name: nm, code: cd });
      notifySuccess('已创建组织');
      onCreated();
      onClose();
    } catch (e) {
      reportError(e, '创建组织失败');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="!w-[min(460px,calc(100vw-32px))] !max-w-[460px] gap-0 p-0">
        <DialogHeader className="border-b border-[var(--cy-border-subtle)] px-4 py-3">
          <DialogTitle className="text-base font-semibold">新建组织</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-4 px-4 py-4">
          <label className="flex flex-col gap-1">
            <span className="text-sm text-[var(--cy-text-secondary)]">组织/单位名称</span>
            <input
              autoFocus
              type="text"
              value={name}
              placeholder="如:华东研发中心"
              onChange={(e) => onNameChange(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && canSubmit) void submit(); }}
              className={INPUT_CLS}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-sm text-[var(--cy-text-secondary)]">组织编码</span>
            <input
              type="text"
              value={code}
              placeholder="随名称自动生成,可修改"
              onChange={(e) => { setCode(e.target.value); setCodeDirty(true); }}
              onKeyDown={(e) => { if (e.key === 'Enter' && canSubmit) void submit(); }}
              className={INPUT_CLS}
            />
            <span className="text-xs text-[var(--cy-text-secondary)] opacity-60">
              唯一标识,用于系统内部引用,创建后不可修改。
            </span>
          </label>
        </div>
        <DialogFooter className="gap-2 border-t border-[var(--cy-border-subtle)] px-4 py-3">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="rounded-lg border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-base)] px-3 py-1.5 text-sm hover:border-[var(--cy-border-strong)] disabled:opacity-50"
          >
            取消
          </button>
          <button
            type="button"
            disabled={!canSubmit}
            onClick={() => void submit()}
            className="rounded-lg bg-[var(--cy-brand-500)] px-3 py-1.5 text-sm font-medium text-white hover:bg-[var(--cy-brand-600)] disabled:opacity-50"
          >
            {busy ? '创建中…' : '创建'}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
