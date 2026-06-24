/**
 * KbCreateFlow —— 自包含的「创建知识库」流程包装。
 *
 * 把 CreateKbDialog(文档 / 向量,内部表单)与 AddStructuredSourceDialog(结构化,独立对话框)
 * 的接线收进一个组件,对外只暴露 {open, onOpenChange, onCreated, initialKind}。
 * 用户侧 KbBoard 与 管理端 KbManagePage 共用此组件,不再各自重复 onPickStructured 接线。
 *
 * 用法:
 *   <KbCreateFlow open={open} onOpenChange={setOpen} onCreated={(kuId, kind) => refetch()} />
 *   <KbCreateFlow open initialKind="structured" .../>  // 直接进结构化,跳过类型选择屏
 */
import * as React from 'react';
import type { KuKind } from '@chayuan/api';
import { CreateKbDialog } from './CreateKbDialog';
import { AddStructuredSourceDialog } from '../AddStructuredSourceDialog';

export interface KbCreateFlowProps {
  open: boolean;
  onOpenChange(open: boolean): void;
  /** 创建成功;kuId 形如 doc:<name> / src:<id>,kind 为知识源类型。 */
  onCreated?(kuId: string, kind: KuKind): void;
  /** 可选:直接进某类表单,跳过类型选择屏。'structured' 时直开结构化对话框。 */
  initialKind?: KuKind;
}

export const KbCreateFlow: React.FC<KbCreateFlowProps> = ({
  open,
  onOpenChange,
  onCreated,
  initialKind,
}) => {
  // 「选择屏里点结构化」触发的内部开关
  const [pickerStructured, setPickerStructured] = React.useState(false);
  // 外层关闭整个流程时,重置内部结构化开关,避免下次打开直飞结构化对话框
  React.useEffect(() => {
    if (!open) setPickerStructured(false);
  }, [open]);
  // initialKind === 'structured':绕过 CreateKbDialog(它的 body 不渲染结构化),直接开结构化对话框
  const directStructured = open && initialKind === 'structured';
  const structuredOpen = pickerStructured || directStructured;

  const closeStructured = () => {
    setPickerStructured(false);
    if (directStructured) onOpenChange(false); // 直开模式下关闭即关闭整个流程
  };

  return (
    <>
      <CreateKbDialog
        open={open && initialKind !== 'structured'}
        initialKind={initialKind === 'structured' ? undefined : initialKind}
        onOpenChange={onOpenChange}
        onPickStructured={() => setPickerStructured(true)}
        onCreated={onCreated}
      />
      <AddStructuredSourceDialog
        open={structuredOpen}
        onOpenChange={(o) => { if (!o) closeStructured(); }}
        onCreated={(sourceId) => {
          closeStructured();
          onCreated?.(`src:${sourceId}`, 'structured');
        }}
      />
    </>
  );
};
