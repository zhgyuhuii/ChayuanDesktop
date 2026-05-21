/**
 * 「手动安装 PyTorch」帮助弹窗。
 *
 * 触发方:LocalRuntimeServicesSection 里 PyTorch 行标题后的「?」帮助图标。
 * 内容:离线 / 内网环境下,从下载 → 解压 → 放置 → 验证的全流程说明。
 * 取代了原先内嵌的「想自己下载 PyTorch?」<details> 折叠区 —— 折叠区只能塞
 * 一两句话,完整步骤放弹窗里更清楚。
 *
 * 动态信息(建议版本 / 官方下载地址 / 放置目录)从 PytorchStatus 取,
 * 跟面板其它地方同一处真源,版本调整时这里自动跟随。
 */

import type { PytorchStatus } from '@chayuan/api';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@chayuan/ui';
import type * as React from 'react';

export interface PytorchHelpDialogProps {
  open: boolean;
  onOpenChange(open: boolean): void;
  /** 面板当前的 PyTorch 状态;用于填建议版本 / 下载地址。null 时退化成通用文案。 */
  status: PytorchStatus | null;
  /** 「放置目录」绝对路径;null 时提示先在面板上看路径。 */
  targetDir: string | null;
}

/** 行内代码片段,统一样式。 */
const Code: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <code className="rounded bg-[var(--cy-surface-base)] px-1 text-[var(--cy-text-primary)] break-all">
    {children}
  </code>
);

/** 一个步骤块:序号圆点 + 标题 + 正文。 */
const Step: React.FC<{ n: number; title: string; children: React.ReactNode }> = ({
  n,
  title,
  children,
}) => (
  <div className="flex gap-2.5">
    <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[var(--cy-accent,#2563eb)] text-[11px] font-semibold text-white">
      {n}
    </span>
    <div className="min-w-0 flex-1 space-y-1">
      <div className="text-sm font-medium text-[var(--cy-text-primary)]">{title}</div>
      <div className="space-y-1 text-[12px] leading-relaxed text-[var(--cy-text-secondary)]">
        {children}
      </div>
    </div>
  </div>
);

export const PytorchHelpDialog: React.FC<PytorchHelpDialogProps> = ({
  open,
  onOpenChange,
  status,
  targetDir,
}) => {
  const torchVer = status?.pinned_torch_version ?? '(见面板「建议版本」)';
  const tvVer = status?.pinned_torchvision_version ?? '(见面板「建议版本」)';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>手动安装 PyTorch(离线 / 内网环境)</DialogTitle>
          <DialogDescription>
            联网环境直接点面板上的「安装」会自动下载。下面这套流程是给离线 /
            内网、或想自己挑版本的用户:把 wheel 下好、解压、放进目录,再扫描验证即可。
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[62vh] space-y-4 overflow-y-auto pr-1">
          <div className="rounded-md border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-1)] p-2.5 text-[12px] text-[var(--cy-text-secondary)]">
            PyTorch 体积大(CPU 版约 250 MB,GPU 版 2–3 GB),没有打进安装包,
            所以需要单独准备。整个过程不要求这台机器联网 —— 让能上网的机器把 wheel 下好,拷过来即可。
          </div>

          <Step n={1} title="下载 wheel 文件">
            <p>
              需要 <strong>两个</strong> wheel:<Code>torch</Code> 和 <Code>torchvision</Code>
              。两者版本必须配套 —— ABI 严格绑定,错配会在 运行时报{' '}
              <Code>torchvision::nms does not exist</Code> 之类的错。
            </p>
            <p>
              建议版本:torch <Code>{torchVer}</Code> · torchvision <Code>{tvVer}</Code>。
            </p>
            <p>挑 wheel 时要对上三项:</p>
            <ul className="list-disc space-y-0.5 pl-4">
              <li>
                Python 版本 —— 本机是 3.12,选文件名带 <Code>cp312</Code> 的。
              </li>
              <li>
                系统 / 架构 —— Windows 选 <Code>win_amd64</Code>,Linux 选 <Code>linux_x86_64</Code>
                ,macOS 选对应 arm64 / x86_64。
              </li>
              <li>
                CPU / GPU —— 没有 NVIDIA 独显就选 CPU 版(文件名带 <Code>+cpu</Code>
                );有独显且驱动够新可选 CUDA 版。
              </li>
            </ul>
            <p>下载地址:</p>
            <ul className="list-disc space-y-0.5 pl-4">
              {status ? (
                <>
                  <li>
                    官方下载页:<Code>{status.download_page}</Code>
                  </li>
                  <li>
                    CPU 版 wheel index:<Code>{status.download_index_cpu}</Code>
                  </li>
                  {status.download_index_cuda ? (
                    <li>
                      GPU(CUDA)版 wheel index:
                      <Code>{status.download_index_cuda}</Code>
                    </li>
                  ) : (
                    <li>
                      GPU 版:在 <Code>https://download.pytorch.org/whl/</Code> 下 按{' '}
                      <Code>cuXXX</Code>(如 <Code>cu124</Code>)进对应目录挑。
                    </li>
                  )}
                </>
              ) : (
                <li>
                  官方 wheel index:<Code>https://download.pytorch.org/whl/</Code>
                  (CPU 版进 <Code>cpu/</Code> 子目录)。
                </li>
              )}
            </ul>
          </Step>

          <Step n={2} title="解压 wheel">
            <p>
              <Code>.whl</Code> 本质是 zip 压缩包。两个 wheel 都要解压:
            </p>
            <ul className="list-disc space-y-0.5 pl-4">
              <li>
                Windows:把后缀 <Code>.whl</Code> 改成 <Code>.zip</Code>,右键解压; 或用{' '}
                <Code>tar -xf 文件名.whl</Code>。
              </li>
              <li>
                命令行通用:<Code>python -m zipfile -e 文件名.whl 目标目录</Code>。
              </li>
            </ul>
            <p>
              解压后会得到 <Code>torch/</Code>、<Code>torchvision/</Code> 等包目录 (以及{' '}
              <Code>*.dist-info</Code>)。把两个 wheel 解压到同一个目录里。
            </p>
          </Step>

          <Step n={3} title="放进「放置目录」">
            <p>
              把解压出来的 <Code>torch/</Code>、<Code>torchvision/</Code> 等目录,
              整体复制到面板的「放置目录」下:
            </p>
            <p>
              {targetDir ? (
                <Code>{targetDir}</Code>
              ) : (
                <span className="text-[var(--cy-text-tertiary)]">
                  路径见面板上「放置目录」一行,旁边有「复制路径」按钮。
                </span>
              )}
            </p>
            <p className="text-[var(--cy-text-tertiary)]">
              注意:让 <Code>torch/</Code> 目录直接位于放置目录下,不要多套一层 文件夹,也不要只放{' '}
              <Code>.dist-info</Code>。
            </p>
            <p>
              另一种做法:如果你在别处已经装好一整套可用的 PyTorch(系统 Python
              环境、之前解压好的目录等),不必搬动 —— 直接用面板的「换位置」按钮 指过去即可。
            </p>
          </Step>

          <Step n={4} title="扫描 / 验证">
            <ul className="list-disc space-y-0.5 pl-4">
              <li>
                放好后点面板的「扫描」按钮 —— 它会识别出{' '}
                <Code>torch x.x.x(CPU/GPU 版)· torchvision x.x.x</Code>。
              </li>
              <li>用「换位置」选目录时会自动校验,不用再单独扫描。</li>
              <li>验证通过的标志:面板状态徽标变绿,并显示 torch 与 torchvision 的版本号。</li>
            </ul>
          </Step>

          <div className="space-y-1 rounded-md border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-1)] p-2.5 text-[12px] text-[var(--cy-text-secondary)]">
            <div className="font-medium text-[var(--cy-text-primary)]">常见问题</div>
            <ul className="list-disc space-y-0.5 pl-4">
              <li>
                报 <Code>torchvision::nms does not exist</Code> —— torch 与 torchvision
                版本不配套,重新下载配套的两个 wheel。
              </li>
              <li>
                扫描不到 —— 确认 <Code>torch/</Code> 目录(不是 <Code>torch-x.x.x.dist-info</Code>
                )直接位于放置目录下。
              </li>
              <li>GPU 版要先有 NVIDIA 显卡 + 足够新的驱动;没有就用 CPU 版。</li>
            </ul>
          </div>
        </div>

        <DialogFooter>
          <Button type="button" size="sm" onClick={() => onOpenChange(false)}>
            知道了
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default PytorchHelpDialog;
