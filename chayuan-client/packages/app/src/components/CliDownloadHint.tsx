/**
 * 命令行下载指引 —— 在模型下载 UI 里给出等价的 wget / CLI 下载命令。
 *
 * 场景:应用内「下载模型」偶尔会卡住(海外/网络不稳、hf 大文件 Xet 后端不走
 * 镜像等),此时命令行直连更稳。这里按用户选中的 source / model_id / 文件名 /
 * revision 实时拼出可复制的命令,作为兜底。
 *
 * 命令按来源区分:
 *   - huggingface:wget 直连(国内 hf-mirror.com,海外换 huggingface.co)
 *   - modelscope :wget 直连 modelscope.cn(国内稳),整仓给 modelscope CLI
 */
import { copyText } from '@chayuan/platform-shared';
import { Check, Copy, Terminal } from 'lucide-react';
import * as React from 'react';

export interface CliDownloadHintProps {
  /** 'modelscope' | 'huggingface'(宽松 string,兼容后端来的原始值) */
  source: string;
  /** owner/name */
  modelId: string;
  /** 具体文件名(单文件下载);留空 = 整仓 */
  file?: string | null;
  /** 分支 / revision;留空 = 默认(HF main / MS master) */
  revision?: string | null;
  className?: string;
}

function buildCommand(
  source: string,
  modelId: string,
  file?: string | null,
  revision?: string | null,
): { primary: string; note: string } {
  const id = modelId.trim();
  const rev = (revision || '').trim();
  const f = (file || '').trim();
  const name = id.split('/').pop() || id;
  const base = f.split('/').pop() || f;

  if (source === 'huggingface') {
    const branch = rev || 'main';
    if (f) {
      return {
        primary: `wget -c "https://hf-mirror.com/${id}/resolve/${branch}/${f}" -O ${base}`,
        note: '国内用 hf-mirror.com;海外服务器把域名换成 huggingface.co 更快、更稳。',
      };
    }
    return {
      primary: `HF_ENDPOINT=https://hf-mirror.com huggingface-cli download ${id} --local-dir ./${name}`,
      note: '整仓下载。国内用 hf-mirror.com,海外换 huggingface.co。需先 pip install -U "huggingface_hub[cli]"。',
    };
  }

  // modelscope
  const branch = rev || 'master';
  if (f) {
    return {
      primary: `wget -c "https://modelscope.cn/models/${id}/resolve/${branch}/${f}" -O ${base}`,
      note: `或用 CLI:pip install -U modelscope && modelscope download --model ${id} ${f} --local_dir ./${name}`,
    };
  }
  return {
    primary: `pip install -U modelscope && modelscope download --model ${id} --local_dir ./${name}`,
    note: 'ModelScope 整仓下载(国内直连,稳定)。下完把目录放进模型目录,再用「扫描挂载」识别。',
  };
}

export const CliDownloadHint: React.FC<CliDownloadHintProps> = ({
  source,
  modelId,
  file,
  revision,
  className,
}) => {
  const [copied, setCopied] = React.useState(false);
  if (!modelId.trim()) return null;
  const { primary, note } = buildCommand(source, modelId, file, revision);

  const onCopy = async () => {
    const ok = await copyText(primary);
    if (ok) {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    }
  };

  return (
    <details className={className}>
      <summary className="flex cursor-pointer select-none items-center gap-1.5 text-xs text-[var(--cy-text-secondary)] hover:text-[var(--cy-text-primary)]">
        <Terminal className="h-3.5 w-3.5" />
        用命令行下载(应用内下载卡住时用)
      </summary>
      <div className="mt-2 space-y-1.5">
        <div className="relative">
          <pre className="max-w-full overflow-x-auto rounded-md bg-[var(--cy-surface-elev1)] p-2 pr-9 text-[11px] leading-relaxed text-[var(--cy-text-primary)]">
            <code className="break-all">{primary}</code>
          </pre>
          <button
            type="button"
            onClick={() => void onCopy()}
            title="复制命令"
            className="absolute right-1.5 top-1.5 rounded p-1 text-[var(--cy-text-tertiary)] transition-colors hover:bg-[var(--cy-surface-base)] hover:text-[var(--cy-text-primary)]"
          >
            {copied ? (
              <Check className="h-3.5 w-3.5 text-emerald-500" />
            ) : (
              <Copy className="h-3.5 w-3.5" />
            )}
          </button>
        </div>
        <div className="text-[10px] leading-relaxed text-[var(--cy-text-tertiary)]">{note}</div>
      </div>
    </details>
  );
};
