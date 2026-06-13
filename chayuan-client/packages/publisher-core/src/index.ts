// packages/publisher-core/src/index.ts
export { parsePackageName, unpackForExt, TIER_VARIANT, type ParsedPackage } from './parse';
export {
  planDetection,
  type ScannedFile, type OnlineVersion, type AdminRelease, type OnlineState,
  type DetectItem, type DetectionPlan,
} from './detect';
export { buildInstallerManifest, type ManifestAsset } from './manifest';
export {
  runPublish,
  type PublishIO, type FinalizeResult, type PublishedAsset, type PublishResult,
} from './publish';
