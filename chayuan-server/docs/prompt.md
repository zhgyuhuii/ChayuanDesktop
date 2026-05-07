1、参照现在的对话框架构 他的端口是8501 chayuan start -a 或者chayuan start -w是独立启动 根据这个逻辑再创建一个配置面板界面的项目 端口 端口后的上下文用命令行配置 命令行和配置面板向导后面详细讲述 这个配置面板项目命令行输入 chayuan start  -a 能启动  hayuan start -c 能够独立启动，界面使用NICEGUI实现 首先是登录页 登录进去后是配置界面 配置界面先空白后期补充功能
2、想实现以上功能 要先实现以下命令行
chayuan update username — 修改面板用户名
chayuan update password — 修改面板密码
chayuan update port — 修改面板端口
chayuan update（不带子命令）— 由 chayuan 引导交互
chayuan user-info 命令 查看面板用户信息
3、新增 chayuan status [core|web|config] 命令 查看服务状态  不写第二个参数时会对 core|web|config 都查 
重启服务这些信息不变

根据@chayuan_data 中的yaml文件 创建每个文件对应的配置文件 如@chayuan_data/basic_settings.yaml 是基本信息配置 可以配置的项是 启日志详细信息  请求默认超时时间 知识库 等 要根据最新的配置设置 最新是配置@chayuan_data_postgresql chayuan_data是旧的配置 但是新的配置上的注释要与旧的配置上的注释一致
