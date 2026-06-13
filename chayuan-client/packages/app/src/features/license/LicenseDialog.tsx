/**
 * 授权窗口。spec 的「弹窗：公众号/收款二维码 + 序列号输入 + 确定」。
 *
 * - 购买链接从后端 `GET /api/v1/license/buy-url` 取（后端把本机指纹直接拼进 URL，
 *   前端不经手 mid）。
 * - 二维码本地生成（编码后端给的购买链接），手机扫码到在线购买页。
 * - 序列号手输 → store.activateSerial（B1，后端验签）。
 */

import { type LicenseGrant, type PayChannels, licenseBuyUrl, licenseFingerprint } from "@chayuan/api";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Input,
  SegmentedTabs,
} from "@chayuan/ui";
import { Check, CheckCircle2, ChevronDown, ChevronUp, Copy, Fingerprint, Gift, KeyRound } from "lucide-react";
import QRCode from "qrcode";
import * as React from "react";
import { FOLLOW_QR_URL } from "../../lib/brandAssets";
import { useLicenseStore } from "./licenseStore";
import { useQueryClient } from "@tanstack/react-query";
import { USER_AGREEMENT_BODY, USER_AGREEMENT_TITLE } from "./userAgreement";

export interface LicenseDialogProps {
  app: string;
  open: boolean;
  onOpenChange(open: boolean): void;
}

export function LicenseDialog({ app, open, onOpenChange }: LicenseDialogProps): React.ReactElement {
  const store = useLicenseStore();
  const qc = useQueryClient();
  const [qr, setQr] = React.useState<string>("");
  const [buyUrl, setBuyUrl] = React.useState<string>("");
  const [channels, setChannels] = React.useState<PayChannels | null>(null);
  const [serial, setSerial] = React.useState("");
  const [fingerprint, setFingerprint] = React.useState("");
  const [fpCopied, setFpCopied] = React.useState(false);
  const [qrTab, setQrTab] = React.useState<"buy" | "share">("buy");
  const shareUrl = buyUrl ? new URL(buyUrl).origin + "/share?mid=" + fingerprint : "";
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);
  const [agreeOpen, setAgreeOpen] = React.useState(false);
  const [followOpen, setFollowOpen] = React.useState(false);

  /** 激活成功后的权益信息 */
  const [successExpireAt, setSuccessExpireAt] = React.useState<string | null>(null);
  const [successGrant, setSuccessGrant] = React.useState<LicenseGrant | null>(null);
  const [showSuccess, setShowSuccess] = React.useState(false);

  // 取购买链接 + 支持的支付渠道（后端拼 指纹 + app）→ 生成离线二维码。
  React.useEffect(() => {
    if (!open) return;
    let alive = true;
    licenseBuyUrl(app)
      .then((r) => {
        if (!alive) return;
        setBuyUrl(r.url);
        setChannels(r.channels ?? null);
      })
      .catch(() => {
        if (alive) setBuyUrl("");
      });
    return () => {
      alive = false;
    };
  }, [open, app]);

  React.useEffect(() => {
    if (!open) return;
    let alive = true;
    licenseFingerprint()
      .then((r) => { if (alive) setFingerprint(r.fingerprint); })
      .catch(() => { if (alive) setFingerprint(""); });
    return () => { alive = false; };
  }, [open]);

  // 关窗时重置成功态
  React.useEffect(() => {
    if (!open) {
      setShowSuccess(false);
      setSuccessExpireAt(null);
      setSuccessGrant(null);
    }
  }, [open]);

  const onCopyFp = async () => {
    if (!fingerprint) return;
    try {
      await navigator.clipboard.writeText(fingerprint);
      setFpCopied(true);
      setTimeout(() => setFpCopied(false), 2000);
    } catch {
      // 剪贴板不可用时静默
    }
  };

  const scanText = channelScanText(channels);

  React.useEffect(() => {
    const url = qrTab === "buy" ? buyUrl : shareUrl;
    if (!url) {
      setQr("");
      return;
    }
    QRCode.toDataURL(url, { margin: 1, width: 220 })
      .then(setQr)
      .catch(() => setQr(""));
  }, [buyUrl, shareUrl, qrTab]);

  // fn 返回 null = 无操作（如用户取消选文件），不报错、不关窗。
  async function run(
    fn: () => Promise<{ licensed: boolean; expireAt?: string; reason?: string; grant?: LicenseGrant } | null>,
  ): Promise<void> {
    setBusy(true);
    setErr(null);
    try {
      const s = await fn();
      if (!s) return;
      if (s.licensed) {
        // 激活成功 → 展示权益态，用户点「完成」再关窗
        setSuccessExpireAt(s.expireAt ?? null);
        setSuccessGrant(s.grant ?? null);
        setShowSuccess(true);
        // 激活成功 → 刷新底部权益条(EntitlementsLine 读 ['license.statuses'],有 60s 缓存)
        void qc.invalidateQueries({ queryKey: ['license.statuses'] });
      } else {
        setErr(reasonText(s.reason));
      }
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const onConfirmSerial = () => run(() => store.activateSerial(app, serial.trim()));

  // ── 成功态 ────────────────────────────────────────────────────────────────
  if (showSuccess) {
    const expireLabel = successExpireAt ? formatExpireAt(successExpireAt) : null;
    const grantLabel = successGrant ? formatGrant(successGrant) : null;
    return (
      <>
        <Dialog open={open} onOpenChange={onOpenChange}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>授权激活成功</DialogTitle>
            </DialogHeader>
            <div className="flex flex-col items-center gap-4 py-4">
              <div className="flex size-16 items-center justify-center rounded-full bg-green-100 dark:bg-green-900/40">
                <CheckCircle2 className="size-9 text-green-600 dark:text-green-400" />
              </div>
              <div className="space-y-1 text-center">
                <p className="text-base font-semibold text-foreground">激活成功，授权已生效</p>
                {grantLabel ? (
                  <p className="text-sm text-muted-foreground">本次授权：{grantLabel}</p>
                ) : expireLabel ? (
                  <p className="text-sm text-muted-foreground">授权有效期至 {expireLabel}</p>
                ) : (
                  <p className="text-sm text-muted-foreground">请尽情使用本产品功能</p>
                )}
              </div>
            </div>
            <Button className="w-full" onClick={() => onOpenChange(false)}>
              完成
            </Button>
          </DialogContent>
        </Dialog>
        {/* 协议弹窗（不受成功态影响，保留可访问性） */}
        <Dialog open={agreeOpen} onOpenChange={setAgreeOpen}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>{USER_AGREEMENT_TITLE}</DialogTitle>
            </DialogHeader>
            <div className="max-h-[60vh] overflow-y-auto whitespace-pre-wrap text-sm text-foreground">
              {USER_AGREEMENT_BODY}
            </div>
          </DialogContent>
        </Dialog>
      </>
    );
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>激活授权</DialogTitle>
            <DialogDescription>
              {qrTab === "share"
                ? "用微信「扫一扫」此码打开分享页，分享给好友/朋友圈即可领取使用次数。"
                : "手机扫码购买后，把序列号填入下方激活。"}
            </DialogDescription>
          </DialogHeader>
          <SegmentedTabs
            value={qrTab}
            onChange={(v) => setQrTab(v as "buy" | "share")}
            items={[
              { value: "buy", label: "扫码购买" },
              { value: "share", label: "分享获取使用次数" },
            ]}
          />

          {/* 单列布局 */}
          <div className="flex flex-col gap-3">
            <div className="flex flex-col items-center gap-3 py-2">
              {/* 二维码白底直接居中，去重卡片 */}
              <div className="inline-block rounded-xl bg-white p-2">
                {qr ? (
                  <img src={qr} alt="购买二维码" width={150} height={150} />
                ) : (
                  <div className="h-[150px] w-[150px] animate-pulse rounded bg-muted" />
                )}
              </div>

              {/* buy 态：支付渠道 logo */}
              {qrTab === "buy" && channels && (channels.wechat || channels.alipay) ? (
                <div className="flex items-center gap-3">
                  <span className="text-xs text-muted-foreground">{scanText}</span>
                  {channels.wechat ? <WeChatLogo /> : null}
                  {channels.alipay ? <AlipayLogo /> : null}
                </div>
              ) : null}

              {/* buy 态：开发不易 · 开源承诺 */}
              {qrTab === "buy" ? (
                <p className="px-3 text-center text-xs leading-relaxed text-muted-foreground">
                  独立团队，认真做产品。当支持够团队吃饭，全部功能即免费开源、回馈所有人。谢谢你成为其中一份力量。
                </p>
              ) : null}

              {/* share 态：分享提示 */}
              {qrTab === "share" ? (
                <div className="flex items-center gap-1.5">
                  <Gift size={16} className="text-primary" />
                  <span className="text-sm font-medium text-primary">
                    分享给好友 / 朋友圈，免费领使用次数
                  </span>
                </div>
              ) : null}

              {/* buy 态：手机打开购买页链接 */}
              {qrTab === "buy" && buyUrl ? (
                <a
                  className="text-xs text-muted-foreground underline"
                  href={buyUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  或在手机中打开购买页
                </a>
              ) : null}

              {/* 指纹信息条（删掉下方长提示） */}
              {fingerprint ? (
                <div className="w-full">
                  <div className="flex items-center gap-2 rounded-lg border bg-muted/40 px-3 py-2 text-xs">
                    <Fingerprint className="size-4 shrink-0 text-muted-foreground" />
                    <span className="text-muted-foreground">本机指纹</span>
                    <code className="flex-1 truncate font-mono text-foreground">{fingerprint}</code>
                    <button
                      type="button"
                      className="flex shrink-0 items-center gap-1 text-muted-foreground hover:text-primary"
                      onClick={() => void onCopyFp()}
                    >
                      {fpCopied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
                      <span>{fpCopied ? "已复制" : "复制"}</span>
                    </button>
                  </div>
                </div>
              ) : null}
            </div>

            {/* 分隔线 */}
            <div className="flex items-center gap-3 text-xs text-muted-foreground">
              <div className="h-px flex-1 bg-border" />
              <span>或手动输入序列号</span>
              <div className="h-px flex-1 bg-border" />
            </div>

            <div className="flex flex-col gap-2">
              <label className="flex items-center gap-1.5 text-sm font-medium" htmlFor="lic-serial">
                <KeyRound className="size-4" />
                序列号
              </label>
              <div className="flex gap-2">
                <Input
                  id="lic-serial"
                  value={serial}
                  onChange={(e) => setSerial(e.target.value)}
                  placeholder="XXXXX-XXXXX-XXXXX-XXXXX-XXXX"
                  autoComplete="off"
                />
                <Button onClick={onConfirmSerial} disabled={busy || serial.trim().length === 0}>
                  确定
                </Button>
              </div>
              {err ? <p className="text-sm text-destructive">{err}</p> : null}
            </div>

            {/* 公众号折叠区（默认收起） */}
            <div className="rounded-lg border bg-muted/30">
              <button
                type="button"
                className="flex w-full items-center justify-between px-3 py-2 text-xs text-muted-foreground hover:text-foreground"
                onClick={() => setFollowOpen((v) => !v)}
              >
                <span>关注「智灵鸟科技」公众号查询序列号</span>
                {followOpen ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
              </button>
              {followOpen ? (
                <div className="flex flex-col items-center gap-2 pb-3">
                  <img
                    src={FOLLOW_QR_URL}
                    alt="智灵鸟科技公众号"
                    className="size-24 rounded bg-white p-1"
                  />
                  <p className="text-center text-xs text-muted-foreground">
                    购买后如未记录序列号，可凭本机指纹查询
                  </p>
                </div>
              ) : null}
            </div>

            {/* 用户协议小字 */}
            <div className="text-center text-xs text-muted-foreground">
              购买即视为同意{" "}
              <button
                type="button"
                className="text-primary hover:underline"
                onClick={() => setAgreeOpen(true)}
              >
                《{USER_AGREEMENT_TITLE}》
              </button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* 本地用户协议 Dialog */}
      <Dialog open={agreeOpen} onOpenChange={setAgreeOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{USER_AGREEMENT_TITLE}</DialogTitle>
          </DialogHeader>
          <div className="max-h-[60vh] overflow-y-auto whitespace-pre-wrap text-sm text-foreground">
            {USER_AGREEMENT_BODY}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** 格式化 ISO 到期时间为可读形式。 */
function formatExpireAt(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString("zh-CN", { year: "numeric", month: "long", day: "numeric" });
  } catch {
    return iso;
  }
}

/** 格式化权益摘要为一行文案，如「视频生成、数字人 · 续期30天」或「视频生成 · 50次」。 */
function formatGrant(grant: LicenseGrant): string {
  const MODULE_LABELS: Record<string, string> = {
    video: "视频生成",
    avatar: "数字人",
    chat: "AI对话",
    note: "AI笔记",
    kb: "知识库",
    ocr: "图转文",
    asr: "音转文",
  };
  const modNames = grant.modules.map((m) => MODULE_LABELS[m] ?? m).join("、");
  const valueStr =
    grant.kind === "count" ? `${grant.value}次` : `续期${grant.value}天`;
  return `${modNames} · ${valueStr}`;
}

/** 按支持的渠道给扫码提示文案。 */
function channelScanText(ch: PayChannels | null): string {
  if (!ch) return "扫码购买";
  if (ch.wechat && ch.alipay) return "微信 / 支付宝 扫码购买";
  if (ch.wechat) return "微信扫码购买";
  if (ch.alipay) return "支付宝扫码购买";
  return "扫码购买";
}

/** 微信官方 logo(brand 路径 + 官方绿)。 */
function WeChatLogo(): React.ReactElement {
  return (
    <svg
      viewBox="0 0 576 512"
      width={22}
      height={22}
      aria-label="微信支付"
      role="img"
      style={{ color: "#07c160" }}
    >
      <path
        fill="currentColor"
        d="M385.2 167.6c6.4 0 12.6 .3 18.8 1.1C387.4 90.3 303.3 32 207.7 32 100.5 32 13 104.8 13 197.4c0 53.4 29.3 97.5 78.2 131.6l-19.6 58.8 68.6-34.3c24.5 4.9 44.1 9.8 68.6 9.8 6.1 0 12.1-.3 18.1-.8-3.8-13.1-6.1-26.8-6.1-41.1 0-85.6 73.8-155.8 165.4-155.8zm-104.5-52.9c14.7 0 24.5 9.8 24.5 24.5 0 14.7-9.8 24.5-24.5 24.5-14.7 0-29.4-9.8-29.4-24.5 0-14.7 14.7-24.5 29.4-24.5zm-147 49c-14.7 0-29.4-9.8-29.4-24.5 0-14.7 14.7-24.5 29.4-24.5 14.7 0 24.5 9.8 24.5 24.5 0 14.7-9.8 24.5-24.5 24.5zM563 319.4c0-77.9-77.9-141.3-165.4-141.3-92.7 0-165.4 63.4-165.4 141.3S305 460.7 397.6 460.7c19.6 0 39.2-4.9 58.8-9.8l53.9 29.4-14.7-48.9c39.1-29.4 67.4-68.6 67.4-112.7zm-219.3-24.5c-9.8 0-19.6-9.8-19.6-19.6 0-9.8 9.8-19.6 19.6-19.6 14.7 0 24.5 9.8 24.5 19.6 0 9.8-9.8 19.6-24.5 19.6zm98 0c-9.8 0-19.6-9.8-19.6-19.6 0-9.8 9.8-19.6 19.6-19.6 14.7 0 24.5 9.8 24.5 19.6 0 9.8-9.8 19.6-24.5 19.6z"
      />
    </svg>
  );
}

/** 支付宝官方 logo(brand 路径 + 官方蓝)。 */
function AlipayLogo(): React.ReactElement {
  return (
    <svg
      viewBox="0 0 448 512"
      width={22}
      height={22}
      aria-label="支付宝"
      role="img"
      style={{ color: "#1677ff" }}
    >
      <path
        fill="currentColor"
        d="M377.74 32H70.26C31.41 32 0 63.41 0 102.26v307.48C0 448.59 31.41 480 70.26 480h307.48c38.52 0 69.76-31.08 70.26-69.6-45.96-25.62-110.59-60.34-171.6-89.81-37.99 46.46-87.71 78.4-139.34 78.4-87.5 0-117.13-76.37-72.62-126.61 9.71-10.95 26.27-21.4 52-27.66 40.23-9.78 104.27 6.27 164.73 26.08 10.91-20.06 20.04-42.07 26.77-65.51H94.32v-18.54h94.42v-33.79H75.16V123.6h113.58V92.26c0-9.96 8.06-18.07 18.07-18.07h41.46v49.41h114.04v18.54H248.27v33.79h93.27c-8.34 33.86-21.07 65.13-37.43 92.61 26.34 9.59 50.13 18.74 67.6 24.74 67.66 23.18 67.83 23.16 84.07 27.74V102.26C448 63.41 416.59 32 377.74 32z"
      />
    </svg>
  );
}

export function reasonText(reason?: string): string {
  switch (reason) {
    case "expired":
      return "授权已过期，请续费。";
    case "rollback":
      return "检测到系统时间被回拨，请联网校时后重试。";
    case "mismatch":
      return "该授权不属于本机器。";
    case "invalid-app":
      return "该授权适用于其他产品，请使用对应产品的授权码。";
    case "signature":
      return "序列号校验失败,请核对是否填写完整、购买时是否填对了本机指纹。";
    case "no-module":
      return "此序列号对应的功能模块未在本机授权表中。请确认桌面已更新到最新版本后重试。";
    case "unknown-key":
      return "序列号密钥版本与本机不匹配,请更新桌面版本。";
    case "used":
      return "该序列号已被使用过。";
    default:
      return "激活失败，请核对序列号或稍后重试。";
  }
}
