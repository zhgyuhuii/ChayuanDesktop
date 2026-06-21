export * from './client';
export * from './admin';
export * from './infraConfig';
export * from './configSchema';
export * from './vectorStore';
export * from './roles';
export * from './errors';
export * from './auth-store';
export * from './endpoints';
export * from './marketplace';
export * from './imageModels';
export * from './modelPlatform';
export * from './modelHub';
export * from './providers';
export * from './uploadProgress';
export * from './knowledge-source';
export * from './kbUniverse';
export * from './kbResults';
export * from './kbHybridSearch';
export * from './dataMounts';
export * from './annotation';
export * from './remoteSync';
export * from './runtime';
export * from './externalAgents';
export * from './aiPlatform';
export * from './home';
export * from './videoGeneration';
export * from './digitalHuman';
export * from './aiVideo';
export * from './fixtures/skills';
export * from './localRuntime';
export * from './diagnose';
export * from './license';
export * from './feedback';
export {
  modality,
  type OcrResult,
  type OcrSidecarStatus,
  type TranscribeResult,
  type AsrDiagBackend,
  type AsrDiagResult,
  type AsrDiagSidecar,
  type CallLogEntry,
  type CallLogResult,
  type TranscribeFileResult,
  type TranscribeFileSegment,
} from './modality';
// 类型化层（codegen 后才会有真实内容；当前留接口）
export type { ApiBody, ApiResponse, ApiPaths } from './typed';
