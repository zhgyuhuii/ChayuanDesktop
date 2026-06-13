import { getPlatform } from '@chayuan/platform-shared';

/**
 * 下载远程 URL 为本地文件 — 统一走平台 saveBinary(Tauri 弹原生「保存位置」
 * 对话框 + 写文件;web 用 showSaveFilePicker / anchor)。
 *
 * 为什么不用 <a download>:Tauri webview 里静态 <a download> 不触发下载,
 * 必须 fetch 成 blob 再交给 saveBinary。范例见 video-generation/VideoLibraryPage.tsx。
 *
 * @param name 建议的保存文件名(含扩展名)
 * @param url  资源 URL(http/https 或后端任务文件 URL)
 */
export async function downloadUrlAsFile(name: string, url: string): Promise<void> {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`下载失败: HTTP ${resp.status}`);
  const blob = await resp.blob();
  await getPlatform().fs.saveBinary(name, blob);
}
