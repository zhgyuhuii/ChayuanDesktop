/** 安装档位(对外:轻量/集成/全量)。 */
export type Tier = 'lite' | 'standard' | 'pro';

/** 平台键 = {os}-{arch}(对齐 layout.yaml 矩阵命名)。 */
export type PlatformKey =
  | 'linux-x86_64' | 'linux-arm64'
  | 'mac-x86_64' | 'mac-arm64'
  | 'win-x86_64' | 'win-arm64';

/** 某平台下一个组件的已解析下载资产。 */
export interface PlatformAsset {
  url: string;
  sha256?: string;
  /** 解压策略:'none' | 'tar.gz' | 'zip' | 'tar.xz' 等(由制包/安装侧消费)。 */
  unpack: string;
  sizeBytes?: number;
}

/** 归一化清单里的一个组件(已按平台展开,皮直接消费,不解析 layout.yaml 插值)。 */
export interface ManifestComponent {
  name: string;
  /** 哪些档包含该组件(= layout.yaml 的 release 字段)。 */
  tiers: Tier[];
  /** 解压/落地相对目录。 */
  dest: string;
  /** 可选组件:该平台缺资产时跳过而非报错。 */
  optional?: boolean;
  platforms: Partial<Record<PlatformKey, PlatformAsset>>;
}

export interface InstallerManifest {
  version: string;
  components: ManifestComponent[];
}

/** 选择维度。 */
export interface Selection {
  tier: Tier;
  os: 'linux' | 'mac' | 'win';
  arch: 'x86_64' | 'arm64';
}

/** resolveComponents 的产物:该 (tier,os,arch) 实际要下的一个组件。 */
export interface ResolvedComponent {
  name: string;
  dest: string;
  url: string;
  sha256?: string;
  unpack: string;
  sizeBytes?: number;
}
