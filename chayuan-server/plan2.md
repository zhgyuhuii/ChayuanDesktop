本轮落地总览                                                        
                                                                                                                                                                     
  T1 结构化输出（已完成度 ~95% → 收口）                                                                                                                              
  - shared/structured_schemas.py + shared/structured_llm.call_structured 已覆盖 text2sql / graph_text2sql 四节点 / text2mongo / text2es / router / graphrag 共 9     
  个站点                                                                                                                                                             
  - 清掉了 file_rag/graphrag/extractor.py 里最后一段死代码 _extract_json                                                                                             
                                                                                                                                                                     
  T2 检索质量跃迁                                                                                                                                                    
  - 新增 kb_settings.USE_COLBERT / USE_COLPALI / COLBERT_WEIGHT / COLPALI_WEIGHT，plugins/__init__.py 注册时读配置，不再硬编码 enabled=False                         
  - eval/runner.py 加 _call_retrieval_only 捕获 contexts（RAGAS faithfulness 才真实起作用）+ 新增 run_eval_with_gate 作 CI 阈值门禁                                  
                                                                                                                                                                     
  T3 Text2SQL 自愈                                                                                                                                                   
  - max_retries 默认从 2 提到 3（与 plan 对齐）                                                                                                                      
  - node_synthesize 加自学习钩子：成功 Q→SQL 以 approved=0 入 training repo，retrieve_similar 默认只拉 approved=1，不会自我污染                                      
                                                                                                                                                                     
  T4 异步 KB 构建                                                                                                                                                    
  - _write_status 除写 Redis key 外，同步 publish 到 chayuan:ingest:task:{id}:events                                                                                 
  - 新端点 GET /knowledge_base/{kb}/build_progress/{task_id} SSE 订阅，Redis 不可用时退化为轮询                                                                      
                                                                                                                                                                     
  T5 关闭 feature flag                                                                                                                                               
  - is_dispatcher_enabled() 默认 True；运维用 CHAYUAN_DISABLE_CHAT_DISPATCHER=1 临时旁路
  - 删除 api_allinone_stale.py / llm_api_stale.py / webui_allinone_stale.py / llm_api_shutdown.py                                                                    
                                                                                                 
  T6 create_react_agent + HIL                                                                                                                                        
  - agent_factory.build_react_agent 接受 checkpointer / interrupt_before / interrupt_after                                                                           
  - 新增 _default_checkpointer()：CHAYUAN_AGENT_CHECKPOINTER=memory|postgres|sqlite:<path> 懒建                                                                      
  - 流式路径 chat/graph/runner.py 在 mode=agent + tools 时改走 react_agent.astream_events，带 thread_id=conversation_id                                              
  - 新增 POST /chat/v2/chat/resume 作 HIL 审批入口                                                                                                                   
                                                                                                                                                                     
  T8 向量存储生产化                                                                                                                                                  
  - kb_service/atomic_rebuild.py：FAISS 走目录 rename、Milvus 走 rename_collection，失败自动回滚                                                                     
  - /knowledge_base/recreate_vector_store 新增 atomic_swap=true 开关                                                                                                 
                                                                                                                                                                     
  T10 多模态                                                                                                                                                         
  - server/modality/{audio, video, service}.py —— ASR (faster-whisper / openai-whisper / OpenAI) + TTS (edge-tts / OpenAI) + 视频抽帧/ASR/Vision                     
  - 新增 /modality/asr、/modality/tts、/modality/video/understand                                                                                                    
  - DTO 加 audio_url / video_url / modality；dispatcher 0 号阶段按模态预处理                                                                                         
                                                                                                                                                                     
  T11 Multi-Agent Supervisor                                                                                                                                         
  - ChatMode.SUPERVISOR + handlers/supervisor.py + node_generate 分支；researcher → writer → reviewer 已在 supervisor.build_supervisor_team                          
                                                                                                                                                                     
  T12 MCP Server 反向输出                                                                                                                                            
  - mcp_server/server.py 新增 chayuan_list_kbs / chayuan_list_sources；stdio + SSE 入口照旧                                                                          
                                                                                                                                                                     
  Hive 支持                                                                                                                                                          
  - sql/dialects.py 加 _hive_url + hive profile（PyHive 优先、impyla 兜底；支持 auth / kerberos_service_name / configuration options）                               
  - registry.py 新增 hive/impala 映射 + 别名 hive2 / hiveserver2 / apache-hive → hive；友好名录入 all_supported_dialects                                             
  - WebUI _SQL_DIALECTS 下拉新增 "Apache Hive (HiveServer2)"，默认端口 10000                                                                                         
  - 命中知识对话：用户只要把 Hive 作为一个知识源注册，multi_source 模式（默认全选 or 按 source_ids）自动并行召回；Text2SQL 图按 dialect="hive" 走，sqlglot 原生校验  
  HiveQL                                                                                                                                                             
                                                                                                                                                                     
  ---                                                                                                                                                                
  继续改进建议（架构师视角）                                                                                                                                         
                                                                                                                                                                     
  P0 · 与已落地的工作对齐的立即优化  
  1. Hive 性能：Hive 查询慢，建议给每个 source 加 query_timeout_sec 并把 Hive 默认拉长到 300s；同时给 LLM 生成 prompt 注入方言提示（DATE_FORMAT / FROM_UNIXTIME /    
  禁止 LIMIT OFFSET）。                                                                                                                                              
  2. ColBERT 索引 build 目前在插件本地路径（cwd/.colbert/indexes/），应把 index_root 改到 CHAYUAN_ROOT/data/colbert_indexes/，避免多进程部署互踩。                   
  3. Checkpointer 目前按进程单例，但 Postgres checkpointer 应支持按 tenant 分表或加 tenant_id 列，否则多租户会互相看到别人的 thread。                                
                                                                                                                                                                     
  P1 · plan.md 里剩余的 T7 / T9（尚未实施）                                                                                                                          
  4. T7 Alembic + asyncpg 生产化：create_all() 在多副本启动时会 race；迁到 Alembic + asyncpg/asyncmy 的 repository 异步化是下一个最大 ROI。                          
  5. T9 多租户 RLS：现在仍是 WHERE user_id=... 应用层约束；应开 Postgres RLS + TenantContextMiddleware 把 tenant 写入 SET LOCAL app.tenant_id，SQL Connector AST     
  改写注入 tenant_id（非字符串拼接）。                                                                                                                               
                                                                                                                                                                     
  P2 · 非 plan 但工程上值得做的                                                                                                                                      
  6. Prompt 版本化：散落的 prompt 字符串应沉到 shared/prompts/*.yaml + version，可 A/B；当前 _GENERATE_SYS、_CLASSIFY_SYS 等直接写死在 .py 里。
  7. LLM 重试统一：utils / chat / connector 各自实现；用 tenacity 封装一个 @llm_retry decorator，支持按 provider 独立 circuit breaker（plan P2-2）。                 
  8. Embedding 批服务化：本地 sentence-transformers 直接嵌在进程里；高并发下应抽离 Infinity / TEI 作为 side-car，吞吐 × 10。                                         
  9. 语义缓存 TTL 分级：当前单一 TTL；按查询"时间敏感度"动态 TTL（已有检测机制，但还没分级）。                                                                       
  10. 观测闭环：RAGAS 分数应写入 Prometheus（rag_faithfulness_score gauge），否则 CI 门禁是非流式快照，无法看退化趋势。                                              
  11. 异步 Hive 驱动缺位：Hive 没有 asyncmy 级别的异步驱动，现在必走同步 + threadpool；流量一大时会打满 threadpool。可考虑给 Hive 加 per-source 连接池上限与独立     
  executor。                                                                                                                                                         
  12. Supervisor 状态持久化：build_supervisor_team 没接 checkpointer，长报告中断后不可续；沿用 T6 的 _default_checkpointer() 注入即可。                              
  13. ModalityService 媒体存储：视频抽帧目前落 /tmp；生产应统一经 file_storage 模块落 MinIO/OSS，方便链路追踪与审计。                                                
  14. Hive 生产加固：                                                                                                                                                
      - 开启 fetch_size 和 socket_keepalive 避免长 MR 作业被中断                                                                                                     
      - introspect() 对 Hive 要做库（database）级别的枚举（SHOW DATABASES），不是只拉 default                                                                        
      - Kerberos 场景需要把 ticket 生命周期纳入 connection pool 策略                                                                                                 
  15. 前端 SSE 重连：T4 的 build_progress SSE 没有 retry 头，弱网下前端会断流；建议加 retry: 3000\n\n 首包。                                                         
                                                                                                                                                                     
  这些项按 ROI 排序应该是：T7 + T9（必须，生产级必备）→ 10 / 6 / 7（可观测性与统一性）→ Hive 深化 14（有用户诉求）→ 其它。



