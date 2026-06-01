/**
 * 模型广场(Model Gallery)—— 在线浏览 ModelScope / HuggingFace 上的可下载模型,
 * 以及本机「已安装」模型清单。占位版(Task 4.1):仅渲染标题容器,确保菜单/路由可进。
 * 列表 / 过滤 / 分页在 Task 4.2 / 4.3 填实。
 */

import * as React from 'react';
import { useTranslation } from '../../i18n';

export const ModelGalleryPage: React.FC = () => {
  const { t } = useTranslation();
  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto px-6 py-5">
      <h1 className="text-lg font-semibold text-[var(--cy-text-primary)]">
        {t('nav.modelGallery')}
      </h1>
    </div>
  );
};
