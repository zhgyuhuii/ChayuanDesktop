import * as React from 'react';
import { DatabaseConfigPage } from '../infra/DatabaseConfigPage';
import { RedisConfigPage } from '../infra/RedisConfigPage';
import { StorageConfigPage } from '../infra/StorageConfigPage';
import { VectorStorePage } from '../config/VectorStorePage';
import { DefaultModelsPage } from '../defaults/DefaultModelsPage';
import { MarketplacePage } from '../../marketplace/MarketplacePage';

// 模型厂商接入 step 复用 AdminPage 中「模型平台」(tab=platforms)所渲染的同一个组件:
// AdminPage 渲染 <MarketplacePage embedded />,这里用同样的 embedded 形态挂载真实组件,
// 不写阉割版。MarketplacePage 的 props 全为可选(有默认值),可独立渲染。
const PlatformsStep: React.FC = () => <MarketplacePage embedded />;

export interface WizardStep {
  key: string;
  title: string;
  required: boolean;
  Comp: React.FC;
  hint?: string;
}

// 配置向导步骤顺序:业务数据库 → Redis → 对象存储 → 向量库 → 模型厂商接入 → 默认模型。
// 每个 step 直接挂载对应的现有配置页组件;组件自带保存按钮并自行加载当前值,
// 向导只负责步骤导航,不拦截/触发保存。
export const WIZARD_STEPS: WizardStep[] = [
  { key: 'db', title: '业务数据库', required: true, Comp: DatabaseConfigPage, hint: '所有数据入库的目标库' },
  { key: 'redis', title: 'Redis 缓存', required: false, Comp: RedisConfigPage },
  { key: 'storage', title: '对象存储', required: false, Comp: StorageConfigPage },
  { key: 'vstore', title: '向量库', required: true, Comp: VectorStorePage },
  { key: 'platforms', title: '模型厂商接入', required: true, Comp: PlatformsStep },
  { key: 'defaults', title: '默认模型', required: true, Comp: DefaultModelsPage },
];
