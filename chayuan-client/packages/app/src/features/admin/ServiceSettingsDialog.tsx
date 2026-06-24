/**
 * 系统服务页右上角「设置」弹窗 —— 复用现成 BasicSettingsPage(含强制登录/跨域/
 * 服务器绑定地址等全部 basic_settings)。仅网络版 admin 入口(由调用方门控)。
 */
import * as React from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@chayuan/ui';
import { BasicSettingsPage } from './config/BasicSettingsPage';

export const ServiceSettingsDialog: React.FC<{
  open: boolean;
  onOpenChange: (open: boolean) => void;
}> = ({ open, onOpenChange }) => {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>服务基础设置</DialogTitle>
        </DialogHeader>
        <BasicSettingsPage />
      </DialogContent>
    </Dialog>
  );
};
