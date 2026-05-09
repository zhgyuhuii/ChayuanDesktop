; ====================================================================
; NSIS 安装钩子: 把默认 ASCII 快捷方式改成中文「察元AI」
;
; 为什么需要这个文件
; ----------------
; tauri.conf.json 里 productName 必须保持 ASCII("Chayuan"),原因:
;   * WiX 3.14 light.exe 在 productName 含中文时会失败(Unicode 处理不稳)
;   * cargo / 各种 Windows 工具链对 ASCII binary name 兼容性最好
;
; 但用户希望桌面图标 / 开始菜单显示「察元AI」中文。Tauri 2 默认用
; ${PRODUCTNAME} 创建快捷方式,会得到 "Chayuan.lnk"。我们在 POSTINSTALL
; 钩子里删掉默认 .lnk,创建中文名 .lnk,最终视觉效果就是中文图标。
;
; 注意
; ----
; 1. 本文件**必须以 UTF-8 BOM 保存**,NSIS Unicode build 才会正确读取「察元AI」
;    几个汉字。Tauri 默认编译 Unicode NSIS,支持 BOM。
; 2. Add/Remove Programs / 控制面板里的应用名仍是 "Chayuan"(走 Windows 注册表,
;    Tauri 注入用的是 productName 不可绕过)。视觉上略不一致,但卸载流程不受影响。
; 3. 如果用户取消"创建桌面快捷方式"复选框,$DESKTOP\Chayuan.lnk 不存在,
;    Delete 静默跳过,不报错。
; ====================================================================

; PREINSTALL 钩子留空 —— 之前尝试过 ``StrCpy $AddDesktopShortcut 0`` 想阻止
; Tauri 默认创建快捷方式,但当前 Tauri 2 NSIS 模板里 ``$AddDesktopShortcut``
; 不再作为顶层 ``Var`` 声明,直接 StrCpy 一个未声明变量会让 makensis 报
; ``Usage: StrCpy $(user_var: output) ...`` 终止整个脚本生成。
;
; 当前策略改为「让 Tauri 默认创建 ASCII 快捷方式 → POSTINSTALL 阶段把它
; 整批删掉 → 同位置创建中文快捷方式」,POSTINSTALL 在 Tauri 自己的
; CreateShortcut 之后执行,Delete 命中,最终用户桌面只看到中文图标。

!macro NSIS_HOOK_POSTINSTALL
  ; --- 桌面快捷方式 ---
  ; Tauri 2 NSIS 模板会按 productName / mainBinaryName 创建一个 ASCII .lnk;
  ; 不同版本 / 升级覆盖装可能留下不同名字。这里把所有可能候选名兜底删一
  ; 遍,再统一创建中文「察元AI.lnk」。
  Delete "$DESKTOP\${PRODUCTNAME}.lnk"
  Delete "$DESKTOP\${MAINBINARYNAME}.lnk"
  Delete "$DESKTOP\Chayuan.lnk"
  Delete "$DESKTOP\chayuan.lnk"
  Delete "$DESKTOP\Chayuan AI.lnk"
  Delete "$DESKTOP\Chayuan-AI.lnk"
  Delete "$DESKTOP\chayuan-desktop.lnk"
  Delete "$DESKTOP\察元.lnk"
  Delete "$DESKTOP\察元 AI.lnk"
  CreateShortCut "$DESKTOP\察元AI.lnk" "$INSTDIR\${MAINBINARYNAME}.exe"

  ; --- 开始菜单(Tauri 默认放在 SMPROGRAMS\${PRODUCTNAME}\ 子目录下) ---
  Delete "$SMPROGRAMS\${PRODUCTNAME}\${PRODUCTNAME}.lnk"
  Delete "$SMPROGRAMS\${PRODUCTNAME}\${MAINBINARYNAME}.lnk"
  Delete "$SMPROGRAMS\Chayuan\Chayuan.lnk"
  Delete "$SMPROGRAMS\chayuan\chayuan.lnk"
  RMDir  "$SMPROGRAMS\${PRODUCTNAME}"
  RMDir  "$SMPROGRAMS\Chayuan"
  RMDir  "$SMPROGRAMS\chayuan"
  CreateDirectory "$SMPROGRAMS\察元AI"
  CreateShortCut  "$SMPROGRAMS\察元AI\察元AI.lnk" "$INSTDIR\${MAINBINARYNAME}.exe"
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  ; 卸载时清理可能残留的所有图标(中文 + 英文,以防之前装的版本只有英文图标)
  Delete "$DESKTOP\察元AI.lnk"
  Delete "$DESKTOP\察元.lnk"
  Delete "$DESKTOP\察元 AI.lnk"
  Delete "$DESKTOP\${PRODUCTNAME}.lnk"
  Delete "$DESKTOP\${MAINBINARYNAME}.lnk"
  Delete "$DESKTOP\Chayuan.lnk"
  Delete "$DESKTOP\chayuan.lnk"
  Delete "$DESKTOP\Chayuan AI.lnk"
  Delete "$DESKTOP\Chayuan-AI.lnk"
  Delete "$DESKTOP\chayuan-desktop.lnk"

  Delete "$SMPROGRAMS\察元AI\察元AI.lnk"
  RMDir  "$SMPROGRAMS\察元AI"
  Delete "$SMPROGRAMS\${PRODUCTNAME}\${PRODUCTNAME}.lnk"
  Delete "$SMPROGRAMS\${PRODUCTNAME}\${MAINBINARYNAME}.lnk"
  RMDir  "$SMPROGRAMS\${PRODUCTNAME}"
  Delete "$SMPROGRAMS\Chayuan\Chayuan.lnk"
  RMDir  "$SMPROGRAMS\Chayuan"

  ; --- 清理"记忆的数据目录路径" ---
  ; 数据目录的指针存在 ``%APPDATA%\chayuan\desktop.json``(见 src/data_dir.rs);
  ; 不清的话用户卸载重装时,首启动会自动复用上次路径,跳过 FirstRunSetup 向导。
  ; 用户明确要求每次重装都强制弹一次目录选择,所以这里删整个 ``%APPDATA%\chayuan\``。
  ;
  ; 注意:**只删 desktop config 目录**,不动 CHAYUAN_ROOT 真实用户数据(那个由
  ; 用户在向导里自选的 D:\chayuan_data 之类持久路径,卸载完整保留)。
  RMDir /r "$APPDATA\chayuan"
!macroend
