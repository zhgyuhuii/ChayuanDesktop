// 桌面授权功能(门控 + 激活窗口 + 编排 + 反应式态)。
export { LicenseGate, type LicenseGateProps } from './LicenseGate';
export { LicenseDialog, type LicenseDialogProps } from './LicenseDialog';
export { useLicenseStore, useIsLicensed } from './licenseStore';
export type { ActivationStatus, ActivationDeps, ActivationSource } from './activation';
export {
  LICENSE_PUBLIC_KEY_HEX,
  ENTITLEMENT_BASE_URL,
  BUY_BASE_URL,
  LICENSE_CONFIGURED,
  publicKeyBytes,
} from './config';
