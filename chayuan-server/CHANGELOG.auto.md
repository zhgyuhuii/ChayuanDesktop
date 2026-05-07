## 2026-05-06 21:03:58 +0800 - chayuan-server

- Branch: `main`
- Summary: auto-recorded local changes before commit.

### Changed Files

- ` M libs/chayuan-server/chayuan/server/api_server/openai_routes.py`
- ` M libs/chayuan-server/chayuan/settings.py`

### Diff Stat

```text
 .../chayuan/server/api_server/openai_routes.py     | 55 ++++++++++++++++++++++
 libs/chayuan-server/chayuan/settings.py            |  2 +-
 2 files changed, 56 insertions(+), 1 deletion(-)
```

## 2026-05-06 20:01:58 +0800 - chayuan-server

- Branch: `main`
- Summary: auto-recorded local changes before commit.

### Changed Files

- ` M docker/dev-stack/docker-compose.yml`
- `?? "docker/dev-stack/onlyoffice\345\220\257\345\212\250\345\221\275\344\273\244"`

### Diff Stat

```text
 docker/dev-stack/docker-compose.yml | 74 ++++++++++++++++++-------------------
 1 file changed, 37 insertions(+), 37 deletions(-)
```

## 2026-05-06 17:33:29 +0800 - chayuan-server

- Branch: `main`
- Summary: auto-recorded local changes before commit.

### Changed Files

- ` M libs/chayuan-server/chayuan/server/api_server/server_app.py`
- ` M libs/chayuan-server/chayuan/server/config_panel/dashboard.py`
- ` M libs/chayuan-server/chayuan/server/config_panel/model_config.py`
- ` M libs/chayuan-server/chayuan/server/config_panel/model_settings/page.py`
- ` M libs/chayuan-server/chayuan/server/config_panel/model_settings/state_cache.py`
- ` M libs/chayuan-server/chayuan/server/config_panel/runtime_framework_panel.py`
- ` M libs/chayuan-server/chayuan/server/config_panel/service_checks.py`
- ` M libs/chayuan-server/chayuan/server/config_panel/service_config_page.py`
- ` M libs/chayuan-server/chayuan/server/image_source/embedder.py`
- ` M libs/chayuan-server/tests/unit_tests/test_model_settings_page.py`
- `?? libs/chayuan-server/chayuan/server/config_panel/model_settings/_async_mount.py`
- `?? libs/chayuan-server/chayuan/server/config_panel/model_settings/provider_probe.py`
- `?? libs/chayuan-server/tests/unit_tests/test_async_mount.py`
- `?? libs/chayuan-server/tests/unit_tests/test_chunked_async_mount.py`
- `?? libs/chayuan-server/tests/unit_tests/test_provider_probe.py`
- `?? libs/chayuan-server/tests/unit_tests/test_readiness_banner_async.py`
- `?? libs/chayuan-server/tests/unit_tests/test_state_cache_rewarm.py`

### Diff Stat

```text
 .../chayuan/server/api_server/server_app.py        |   3 +-
 .../chayuan/server/config_panel/dashboard.py       |   6 +-
 .../chayuan/server/config_panel/model_config.py    | 473 +++++++++++++------
 .../server/config_panel/model_settings/page.py     | 105 ++---
 .../config_panel/model_settings/state_cache.py     |  64 ++-
 .../server/config_panel/runtime_framework_panel.py | 116 ++++-
 .../chayuan/server/config_panel/service_checks.py  |  14 +-
 .../server/config_panel/service_config_page.py     | 508 +++++++++++++++++++--
 .../chayuan/server/image_source/embedder.py        |  86 +++-
 .../tests/unit_tests/test_model_settings_page.py   |  24 +-
 10 files changed, 1100 insertions(+), 299 deletions(-)
```

## 2026-05-05 22:24:32 +0800 - chayuan-server

- Branch: `main`
- Summary: auto-recorded local changes before commit.

### Changed Files

- ` M libs/chayuan-server/chayuan/server/api_server/kb_routes.py`
- ` M libs/chayuan-server/chayuan/server/config_panel/service_checks.py`
- `?? libs/chayuan-server/chayuan/server/api_server/folder_sync_routes.py`
- `?? libs/chayuan-server/chayuan/server/api_server/kb_collection_routes.py`
- `?? libs/chayuan-server/chayuan/server/db/models/folder_sync_model.py`
- `?? libs/chayuan-server/chayuan/server/db/models/kb_collection_model.py`
- `?? libs/chayuan-server/chayuan/server/db/repository/folder_sync_repository.py`
- `?? libs/chayuan-server/chayuan/server/db/repository/kb_collection_repository.py`
- `?? libs/chayuan-server/chayuan/server/folder_sync/__init__.py`
- `?? libs/chayuan-server/chayuan/server/folder_sync/scanner.py`
- `?? libs/chayuan-server/chayuan/server/folder_sync/scheduler.py`
- `?? libs/chayuan-server/chayuan/server/folder_sync/uploader.py`
- `?? libs/chayuan-server/tests/unit_tests/test_collection_expansion_for_wps.py`
- `?? libs/chayuan-server/tests/unit_tests/test_folder_sync_repository.py`
- `?? libs/chayuan-server/tests/unit_tests/test_folder_sync_routes.py`
- `?? libs/chayuan-server/tests/unit_tests/test_folder_sync_scanner_and_uploader.py`
- `?? libs/chayuan-server/tests/unit_tests/test_kb_collection_repository.py`
- `?? libs/chayuan-server/tests/unit_tests/test_kb_collection_routes.py`
- `?? libs/chayuan-server/tests/unit_tests/test_probe_all_concurrent_timeout.py`

### Diff Stat

```text
 .../chayuan/server/api_server/kb_routes.py         |  55 ++++++++++
 .../chayuan/server/config_panel/service_checks.py  | 116 ++++++++++++++++-----
 2 files changed, 144 insertions(+), 27 deletions(-)
```

## 2026-05-05 20:47:03 +0800 - chayuan-server

- Branch: `main`
- Summary: auto-recorded local changes before commit.

### Changed Files

- ` M libs/chayuan-server/chayuan/server/config_panel/service_checks.py`
- ` M libs/chayuan-server/chayuan/server/image_source/embedder.py`
- ` M libs/chayuan-server/tests/unit_tests/test_onlyoffice_and_runtime_in_prereq.py`
- ` M libs/chayuan-server/tests/unit_tests/test_upload_image_resilient.py`

### Diff Stat

```text
 .../chayuan/server/config_panel/service_checks.py  | 22 +++----
 .../chayuan/server/image_source/embedder.py        | 68 +++++++++++++++++++++-
 .../test_onlyoffice_and_runtime_in_prereq.py       | 37 ++++++++----
 .../unit_tests/test_upload_image_resilient.py      | 67 ++++++++++++++++++++-
 4 files changed, 169 insertions(+), 25 deletions(-)
```

## 2026-05-05 20:41:04 +0800 - chayuan-server

- Branch: `main`
- Summary: auto-recorded local changes before commit.

### Changed Files

- ` M libs/chayuan-server/chayuan/server/image_source/embedder.py`
- ` M libs/chayuan-server/tests/unit_tests/test_upload_image_resilient.py`

### Diff Stat

```text
 .../chayuan/server/image_source/embedder.py        |  62 ++++++----
 .../unit_tests/test_upload_image_resilient.py      | 126 +++++++++++++++++++--
 2 files changed, 157 insertions(+), 31 deletions(-)
```

## 2026-05-05 20:30:50 +0800 - chayuan-server

- Branch: `main`
- Summary: auto-recorded local changes before commit.

### Changed Files

- ` M libs/chayuan-server/chayuan/server/api_server/image_routes.py`
- ` M libs/chayuan-server/chayuan/server/config_panel/runtime_framework_panel.py`
- ` M libs/chayuan-server/chayuan/server/config_panel/service_checks.py`
- ` M libs/chayuan-server/chayuan/server/config_panel/service_config_page.py`
- ` M libs/chayuan-server/chayuan/server/config_panel/service_page.py`
- ` M libs/chayuan-server/chayuan/server/image_source/embedder.py`
- `?? libs/chayuan-server/tests/unit_tests/test_external_runtimes_persistence_e2e.py`
- `?? libs/chayuan-server/tests/unit_tests/test_onlyoffice_and_runtime_in_prereq.py`
- `?? libs/chayuan-server/tests/unit_tests/test_upload_image_resilient.py`

### Diff Stat

```text
 .../chayuan/server/api_server/image_routes.py      | 109 +++++++++-----
 .../server/config_panel/runtime_framework_panel.py |  75 +++++++---
 .../chayuan/server/config_panel/service_checks.py  | 128 +++++++++++++++-
 .../server/config_panel/service_config_page.py     |   7 +-
 .../chayuan/server/config_panel/service_page.py    |  78 +++++++++-
 .../chayuan/server/image_source/embedder.py        | 165 ++++++++++++++++++++-
 6 files changed, 493 insertions(+), 69 deletions(-)
```

## 2026-05-05 20:01:16 +0800 - chayuan-server

- Branch: `main`
- Summary: auto-recorded local changes before commit.

### Changed Files

- ` M libs/chayuan-server/chayuan/server/image_source/embedder.py`
- `?? libs/chayuan-server/tests/unit_tests/test_get_embedder_fallback_keyerror.py`

### Diff Stat

```text
 .../chayuan/server/image_source/embedder.py        | 34 ++++++++++++++++++----
 1 file changed, 28 insertions(+), 6 deletions(-)
```

## 2026-05-05 18:58:18 +0800 - chayuan-server

- Branch: `main`
- Summary: auto-recorded local changes before commit.

### Changed Files

- ` M libs/chayuan-server/chayuan/server/config_panel/external_runtimes.py`
- ` M libs/chayuan-server/chayuan/server/config_panel/runtime_framework_panel.py`
- ` M libs/chayuan-server/chayuan/server/image_source/embedder.py`
- ` M libs/chayuan-server/tests/unit_tests/test_capability_grouped_local_pip_infinity.py`
- ` M libs/chayuan-server/tests/unit_tests/test_external_endpoint_dialog_contract.py`
- ` M libs/chayuan-server/tests/unit_tests/test_external_runtimes.py`
- `?? libs/chayuan-server/chayuan/server/config_panel/infinity_inventory.py`
- `?? libs/chayuan-server/tests/unit_tests/test_infinity_inventory.py`

### Diff Stat

```text
 .../server/config_panel/external_runtimes.py       |  28 +++-
 .../server/config_panel/runtime_framework_panel.py | 154 +++++++++++++++------
 .../chayuan/server/image_source/embedder.py        |  16 ++-
 .../test_capability_grouped_local_pip_infinity.py  |  83 +++++++----
 .../test_external_endpoint_dialog_contract.py      |  14 +-
 .../tests/unit_tests/test_external_runtimes.py     |  48 ++++++-
 6 files changed, 255 insertions(+), 88 deletions(-)
```

## 2026-05-05 18:38:55 +0800 - chayuan-server

- Branch: `main`
- Summary: auto-recorded local changes before commit.

### Changed Files

- ` M libs/chayuan-server/chayuan/server/config_panel/runtime_framework_panel.py`
- ` M libs/chayuan-server/chayuan/server/image_source/embedder.py`
- ` M libs/chayuan-server/tests/unit_tests/test_embedder_metrics_trace.py`

### Diff Stat

```text
 .../server/config_panel/runtime_framework_panel.py | 18 ++++----
 .../chayuan/server/image_source/embedder.py        |  4 ++
 .../unit_tests/test_embedder_metrics_trace.py      | 48 ++++++++++++++++++++++
 3 files changed, 62 insertions(+), 8 deletions(-)
```

## 2026-05-05 17:56:18 +0800 - chayuan-server

- Branch: `main`
- Summary: auto-recorded local changes before commit.

### Changed Files

- ` M libs/chayuan-server/chayuan/server/api_server/image_routes.py`
- ` M libs/chayuan-server/chayuan/server/config_panel/runtime_framework_panel.py`
- ` M libs/chayuan-server/chayuan/server/image_source/embedder.py`
- `?? libs/chayuan-server/chayuan/server/config_panel/local_infinity_pip.py`
- `?? libs/chayuan-server/tests/unit_tests/test_capability_grouped_local_pip_infinity.py`
- `?? libs/chayuan-server/tests/unit_tests/test_local_infinity_pip.py`
- `?? libs/chayuan-server/tests/unit_tests/test_local_infinity_pip_subprocess.py`
- `?? libs/chayuan-server/tests/unit_tests/test_probe_local_infinity_pip.py`

### Diff Stat

```text
 .../chayuan/server/api_server/image_routes.py      | 46 ++++++++++
 .../server/config_panel/runtime_framework_panel.py | 98 +++++++++++++++++++++-
 .../chayuan/server/image_source/embedder.py        | 19 ++++-
 3 files changed, 157 insertions(+), 6 deletions(-)
```

## 2026-05-05 17:36:20 +0800 - chayuan-server

- Branch: `main`
- Summary: auto-recorded local changes before commit.

### Changed Files

- ` M libs/chayuan-server/chayuan/server/config_panel/dashboard.py`
- ` M libs/chayuan-server/chayuan/server/config_panel/runtime_framework_panel.py`
- ` M libs/chayuan-server/chayuan/server/image_source/embedder.py`
- ` M libs/chayuan-server/chayuan/server/image_source/embedder_clients/inproc.py`
- ` M libs/chayuan-server/tests/unit_tests/test_clip_runtime_badge.py`
- ` M libs/chayuan-server/tests/unit_tests/test_embedder_clients.py`
- `?? libs/chayuan-server/chayuan/server/config_panel/external_runtimes.py`
- `?? libs/chayuan-server/tests/unit_tests/test_embedder_uses_external_infinity.py`
- `?? libs/chayuan-server/tests/unit_tests/test_external_endpoint_dialog_contract.py`
- `?? libs/chayuan-server/tests/unit_tests/test_external_runtimes.py`
- `?? libs/chayuan-server/tests/unit_tests/test_probe_external_priority.py`

### Diff Stat

```text
 .../chayuan/server/config_panel/dashboard.py       |  19 ++-
 .../server/config_panel/runtime_framework_panel.py | 188 +++++++++++++++++++--
 .../chayuan/server/image_source/embedder.py        |  56 ++++--
 .../server/image_source/embedder_clients/inproc.py |  16 +-
 .../tests/unit_tests/test_clip_runtime_badge.py    |  38 +++++
 .../tests/unit_tests/test_embedder_clients.py      |  31 ++--
 6 files changed, 299 insertions(+), 49 deletions(-)
```

## 2026-05-05 16:01:33 +0800 - chayuan-server

- Branch: `main`
- Summary: auto-recorded local changes before commit.

### Changed Files

- ` M libs/chayuan-modelmgr/src/chayuan_modelmgr/recommended.py`
- ` M libs/chayuan-server/chayuan/server/api_server/image_routes.py`
- ` M libs/chayuan-server/chayuan/server/config_panel/dashboard.py`
- ` M libs/chayuan-server/chayuan/server/config_panel/runtime_framework_panel.py`
- ` M libs/chayuan-server/chayuan/server/image_source/embedder.py`
- ` M libs/chayuan-server/chayuan/server/model_registry/marketplace.py`
- ` M libs/chayuan-server/chayuan/server/observability/metrics.py`
- ` M libs/chayuan-server/server-compose/infinity.yaml`
- `?? libs/chayuan-server/chayuan/server/image_source/embedder_clients/__init__.py`
- `?? libs/chayuan-server/chayuan/server/image_source/embedder_clients/base.py`
- `?? libs/chayuan-server/chayuan/server/image_source/embedder_clients/infinity_http.py`
- `?? libs/chayuan-server/chayuan/server/image_source/embedder_clients/inproc.py`
- `?? libs/chayuan-server/chayuan/server/model_registry/model_packs.py`
- `?? libs/chayuan-server/tests/unit_tests/test_capability_default_clip_wired.py`
- `?? libs/chayuan-server/tests/unit_tests/test_clip_runtime_badge.py`
- `?? libs/chayuan-server/tests/unit_tests/test_dashboard_image_embedder_banner.py`
- `?? libs/chayuan-server/tests/unit_tests/test_embedder_clients.py`
- `?? libs/chayuan-server/tests/unit_tests/test_embedder_metrics_trace.py`
- `?? libs/chayuan-server/tests/unit_tests/test_embedder_resolve_and_dispatch.py`
- `?? libs/chayuan-server/tests/unit_tests/test_image_models_runtime_status.py`
- `?? libs/chayuan-server/tests/unit_tests/test_marketplace_runtime_status_attach.py`
- `?? libs/chayuan-server/tests/unit_tests/test_model_packs.py`
- `?? libs/chayuan-server/tests/unit_tests/test_mount_to_infinity.py`
- `?? libs/chayuan-server/tests/unit_tests/test_recommended_models_extended.py`
- `?? libs/chayuan-server/tests/unit_tests/test_suggest_image_embedder_and_422.py`

### Diff Stat

```text
 .../src/chayuan_modelmgr/recommended.py            |  75 +++++
 .../chayuan/server/api_server/image_routes.py      | 357 ++++++++++++++++++++-
 .../chayuan/server/config_panel/dashboard.py       | 102 ++++++
 .../server/config_panel/runtime_framework_panel.py | 104 +++++-
 .../chayuan/server/image_source/embedder.py        | 255 ++++++++++++++-
 .../chayuan/server/model_registry/marketplace.py   | 103 +++++-
 .../chayuan/server/observability/metrics.py        |  24 ++
 libs/chayuan-server/server-compose/infinity.yaml   |  24 +-
 8 files changed, 1021 insertions(+), 23 deletions(-)
```

## 2026-05-05 15:19:35 +0800 - chayuan-server

- Branch: `main`
- Summary: auto-recorded local changes before commit.

### Changed Files

- ` M libs/chayuan-server/chayuan/server/config_panel/service_checks.py`
- ` M libs/chayuan-server/chayuan/server/config_panel/service_config_page.py`
- `?? docs/image-embedding-infinity-integration-plan.md`
- `?? libs/chayuan-server/tests/unit_tests/test_prereq_page_layout_and_rerank.py`

### Diff Stat

```text
 .../chayuan/server/config_panel/service_checks.py  | 71 +++++++++++++++++++++-
 .../server/config_panel/service_config_page.py     | 45 ++++++++++++--
 2 files changed, 109 insertions(+), 7 deletions(-)
```

## 2026-05-05 14:53:10 +0800 - chayuan-server

- Branch: `main`
- Summary: auto-recorded local changes before commit.

### Changed Files

- ` M libs/chayuan-server/chayuan/server/config_panel/install_dialog.py`
- ` M libs/chayuan-server/chayuan/server/model_registry/marketplace.py`
- `?? libs/chayuan-server/tests/unit_tests/test_image_embedding_infinity_runtime.py`
- `?? libs/chayuan-server/tests/unit_tests/test_install_dialog_per_service_yaml.py`

### Diff Stat

```text
 .../chayuan/server/config_panel/install_dialog.py  | 34 +++++++++++++++-------
 .../chayuan/server/model_registry/marketplace.py   |  2 +-
 2 files changed, 25 insertions(+), 11 deletions(-)
```

## 2026-05-05 14:33:19 +0800 - chayuan-server

- Branch: `main`
- Summary: auto-recorded local changes before commit.

### Changed Files

- ` M libs/chayuan-server/chayuan/server/config_panel/install_dialog.py`

### Diff Stat

```text
 .../chayuan/server/config_panel/install_dialog.py  | 86 +++++++++++++++++++---
 1 file changed, 74 insertions(+), 12 deletions(-)
```

## 2026-05-05 14:29:56 +0800 - chayuan-server

- Branch: `main`
- Summary: auto-recorded local changes before commit.

### Changed Files

- ` M libs/chayuan-server/chayuan/server/config_panel/dashboard.py`

### Diff Stat

```text
 libs/chayuan-server/chayuan/server/config_panel/dashboard.py | 4 ++--
 1 file changed, 2 insertions(+), 2 deletions(-)
```

## 2026-05-05 14:21:42 +0800 - chayuan-server

- Branch: `main`
- Summary: auto-recorded local changes before commit.

### Changed Files

- ` M libs/chayuan-server/chayuan/server/config_panel/runtime_framework_panel.py`
- `?? libs/chayuan-server/tests/unit_tests/test_docker_compose_ps_probe.py`

### Diff Stat

```text
 .../server/config_panel/runtime_framework_panel.py | 99 ++++++++++++++++++++--
 1 file changed, 94 insertions(+), 5 deletions(-)
```

## 2026-05-05 14:18:51 +0800 - chayuan-server

- Branch: `main`
- Summary: auto-recorded local changes before commit.

### Changed Files

- ` M libs/chayuan-server/chayuan/server/config_panel/install_recipes.py`
- ` M libs/chayuan-server/chayuan/server/config_panel/marketplace_grid_panel.py`
- ` M libs/chayuan-server/chayuan/server/config_panel/model_settings/defaults_subpage.py`
- ` M libs/chayuan-server/chayuan/server/model_registry/marketplace.py`
- `?? libs/chayuan-server/tests/unit_tests/test_marketplace_param_and_table.py`

### Diff Stat

```text
 .../chayuan/server/config_panel/install_recipes.py |   6 +-
 .../server/config_panel/marketplace_grid_panel.py  | 192 +++++++++++++++++++--
 .../model_settings/defaults_subpage.py             |   3 +-
 .../chayuan/server/model_registry/marketplace.py   |  10 ++
 4 files changed, 195 insertions(+), 16 deletions(-)
```

## 2026-05-05 14:10:56 +0800 - chayuan-server

- Branch: `main`
- Summary: auto-recorded local changes before commit.

### Changed Files

- ` M libs/chayuan-server/chayuan/server/config_panel/runtime_framework_panel.py`
- `?? libs/chayuan-server/tests/unit_tests/test_runtime_dynamic_only.py`

### Diff Stat

```text
 .../server/config_panel/runtime_framework_panel.py | 193 +++++++++++++--------
 1 file changed, 123 insertions(+), 70 deletions(-)
```

## 2026-05-05 13:55:59 +0800 - chayuan-server

- Branch: `main`
- Summary: auto-recorded local changes before commit.

### Changed Files

- ` M libs/chayuan-server/chayuan/server/api_server/openai_routes.py`
- ` M libs/chayuan-server/chayuan/server/config_panel/runtime_framework_panel.py`

### Diff Stat

```text
 .../chayuan/server/api_server/openai_routes.py     | 15 +++++++++++++++
 .../server/config_panel/runtime_framework_panel.py | 22 ++++++++++++++++++----
 2 files changed, 33 insertions(+), 4 deletions(-)
```

## 2026-05-05 13:47:08 +0800 - chayuan-server

- Branch: `main`
- Summary: auto-recorded local changes before commit.

### Changed Files

- ` M libs/chayuan-server/chayuan/server/config_panel/runtime_framework_panel.py`
- ` M libs/chayuan-server/tests/unit_tests/test_capability_grouped_user_yaml.py`

### Diff Stat

```text
 .../server/config_panel/runtime_framework_panel.py | 71 +++++++++++++---------
 .../test_capability_grouped_user_yaml.py           | 45 +++++++++-----
 2 files changed, 74 insertions(+), 42 deletions(-)
```

## 2026-05-05 13:30:36 +0800 - chayuan-server

- Branch: `main`
- Summary: auto-recorded local changes before commit.

### Changed Files

- ` M libs/chayuan-server/chayuan/server/config_panel/model_settings/defaults_subpage.py`
- ` M libs/chayuan-server/chayuan/server/utils.py`
- `?? libs/chayuan-server/tests/unit_tests/test_get_model_info_namespace.py`

### Diff Stat

```text
 .../model_settings/defaults_subpage.py             |  6 ++++++
 libs/chayuan-server/chayuan/server/utils.py        | 23 ++++++++++++++++++++++
 2 files changed, 29 insertions(+)
```

## 2026-05-05 13:16:57 +0800 - chayuan-server

- Branch: `main`
- Summary: auto-recorded local changes before commit.

### Changed Files

- ` M libs/chayuan-server/chayuan/server/api_server/openai_routes.py`
- `?? libs/chayuan-server/tests/unit_tests/test_capability_grouped_user_yaml.py`

### Diff Stat

```text
 .../chayuan/server/api_server/openai_routes.py     | 26 +++++++++++++++++++++-
 1 file changed, 25 insertions(+), 1 deletion(-)
```

## 2026-05-05 12:40:10 +0800 - chayuan-server

- Branch: `main`
- Summary: auto-recorded local changes before commit.

### Changed Files

- ` M libs/chayuan-server/chayuan/server/config_panel/app.py`
- ` M libs/chayuan-server/chayuan/server/config_panel/dashboard.py`

### Diff Stat

```text
 .../chayuan/server/config_panel/app.py             | 36 ++++++++++++----------
 .../chayuan/server/config_panel/dashboard.py       | 17 ++++++----
 2 files changed, 31 insertions(+), 22 deletions(-)
```

## 2026-05-05 12:32:45 +0800 - chayuan-server

- Branch: `main`
- Summary: auto-recorded local changes before commit.

### Changed Files

- ` M libs/chayuan-server/chayuan/server/config_panel/app.py`
- ` M libs/chayuan-server/chayuan/server/config_panel/model_config.py`
- `?? libs/chayuan-server/tests/unit_tests/test_enabled_persistence.py`

### Diff Stat

```text
 .../chayuan/server/config_panel/app.py             | 31 ++++++++++++++++++++++
 .../chayuan/server/config_panel/model_config.py    | 12 ++++++---
 2 files changed, 40 insertions(+), 3 deletions(-)
```

## 2026-05-05 12:21:26 +0800 - chayuan-server

- Branch: `main`
- Summary: auto-recorded local changes before commit.

### Changed Files

- ` M libs/chayuan-server/chayuan/server/api_server/openai_routes.py`
- `?? libs/chayuan-server/tests/unit_tests/test_list_models_no_collision.py`

### Diff Stat

```text
 .../chayuan/server/api_server/openai_routes.py     | 141 +++++++++++++++------
 1 file changed, 104 insertions(+), 37 deletions(-)
```

## 2026-05-05 12:04:48 +0800 - chayuan-server

- Branch: `main`
- Summary: auto-recorded local changes before commit.

### Changed Files

- ` M libs/chayuan-server/chayuan/server/api_server/server_app.py`
- `?? libs/chayuan-server/chayuan/server/api_server/debug_routes.py`

### Diff Stat

```text
 libs/chayuan-server/chayuan/server/api_server/server_app.py | 3 +++
 1 file changed, 3 insertions(+)
```

## 2026-05-05 11:51:10 +0800 - chayuan-server

- Branch: `main`
- Summary: auto-recorded local changes before commit.

### Changed Files

- ` M libs/chayuan-server/chayuan/server/config_panel/model_config.py`

### Diff Stat

```text
 .../chayuan/server/config_panel/model_config.py    | 38 +++++++++++++++++++---
 1 file changed, 33 insertions(+), 5 deletions(-)
```

## 2026-05-05 11:42:05 +0800 - chayuan-server

- Branch: `main`
- Summary: auto-recorded local changes before commit.

### Changed Files

- `?? libs/chayuan-server/tests/unit_tests/test_save_to_grouped_e2e.py`

### Diff Stat

```text
```

## 2026-05-05 11:31:13 +0800 - chayuan-server

- Branch: `main`
- Summary: auto-recorded local changes before commit.

### Changed Files

- ` M libs/chayuan-server/chayuan/server/auth/deps.py`
- ` M libs/chayuan-server/chayuan/server/config_panel/model_config.py`
- `?? libs/chayuan-server/tests/unit_tests/test_auth_guest_mode.py`

### Diff Stat

```text
 libs/chayuan-server/chayuan/server/auth/deps.py    | 35 ++++++++++++++++++++--
 .../chayuan/server/config_panel/model_config.py    | 11 +++++++
 2 files changed, 43 insertions(+), 3 deletions(-)
```

## 2026-05-05 11:09:19 +0800 - chayuan-server

- Branch: `main`
- Summary: auto-recorded local changes before commit.

### Changed Files

- ` M libs/chayuan-server/chayuan/server/config_panel/dashboard.py`
- ` M libs/chayuan-server/chayuan/server/config_panel/model_config.py`
- `?? libs/chayuan-server/tests/unit_tests/test_save_flush_and_seed.py`

### Diff Stat

```text
 .../chayuan/server/config_panel/dashboard.py       | 11 ++-
 .../chayuan/server/config_panel/model_config.py    | 99 ++++++++++++++++++++--
 2 files changed, 101 insertions(+), 9 deletions(-)
```

## 2026-05-05 10:53:03 +0800 - chayuan-server

- Branch: `main`
- Summary: auto-recorded local changes before commit.

### Changed Files

- ` M libs/chayuan-server/chayuan/server/config_panel/model_config.py`
- ` M libs/chayuan-server/chayuan/server/config_panel/model_settings/page.py`
- ` M libs/chayuan-server/chayuan/server/config_panel/model_settings/providers_subpage.py`
- ` M libs/chayuan-server/tests/unit_tests/test_model_settings_page.py`

### Diff Stat

```text
 .../chayuan/server/config_panel/model_config.py    |   4 +
 .../server/config_panel/model_settings/page.py     |  78 +++++++++-
 .../model_settings/providers_subpage.py            |  31 ++--
 .../tests/unit_tests/test_model_settings_page.py   | 164 +++++++++++++++++++++
 4 files changed, 266 insertions(+), 11 deletions(-)
```

## 2026-05-05 10:48:08 +0800 - chayuan-server

- Branch: `main`
- Summary: auto-recorded local changes before commit.

### Changed Files

- ` M libs/chayuan-server/chayuan/server/api_server/admin_routes.py`
- ` M libs/chayuan-server/chayuan/server/config_panel/model_config.py`
- ` M libs/chayuan-server/tests/unit_tests/test_providers_subpage.py`
- `?? libs/chayuan-server/tests/unit_tests/test_admin_routes_models_for.py`

### Diff Stat

```text
 .../chayuan/server/api_server/admin_routes.py      | 14 +++----
 .../chayuan/server/config_panel/model_config.py    | 40 ++++++++++++++++++-
 .../tests/unit_tests/test_providers_subpage.py     | 46 ++++++++++++++++++++++
 3 files changed, 90 insertions(+), 10 deletions(-)
```

## 2026-05-05 10:33:49 +0800 - chayuan-server

- Branch: `main`
- Summary: auto-recorded local changes before commit.

### Changed Files

- ` M libs/chayuan-server/chayuan/server/config_panel/provider_hero_strip.py`
- ` M libs/chayuan-server/chayuan/server/config_panel/runtime_framework_panel.py`

### Diff Stat

```text
 .../server/config_panel/provider_hero_strip.py     | 10 +++++++
 .../server/config_panel/runtime_framework_panel.py | 34 +++++++++++++++++++++-
 2 files changed, 43 insertions(+), 1 deletion(-)
```

## 2026-05-05 10:27:23 +0800 - chayuan-server

- Branch: `main`
- Summary: auto-recorded local changes before commit.

### Changed Files

- ` M libs/chayuan-server/chayuan/server/config_panel/dashboard.py`
- ` M libs/chayuan-server/chayuan/server/config_panel/model_settings/page.py`
- ` M libs/chayuan-server/chayuan/server/config_panel/service_config_page.py`
- `?? libs/chayuan-server/tests/unit_tests/test_model_settings_page.py`

### Diff Stat

```text
 .../chayuan/server/config_panel/dashboard.py       | 12 ++++++--
 .../server/config_panel/model_settings/page.py     | 36 +++++++++++++++++++---
 .../server/config_panel/service_config_page.py     |  6 ++--
 3 files changed, 46 insertions(+), 8 deletions(-)
```

## 2026-05-05 10:12:19 +0800 - chayuan-server

- Branch: `main`
- Summary: auto-recorded local changes before commit.

### Changed Files

- ` M libs/chayuan-server/chayuan/server/config_panel/model_config.py`

### Diff Stat

```text
 .../chayuan/server/config_panel/model_config.py         | 17 ++++++++++-------
 1 file changed, 10 insertions(+), 7 deletions(-)
```

## 2026-05-05 10:03:21 +0800 - chayuan-server

- Branch: `main`
- Summary: auto-recorded local changes before commit.

### Changed Files

- ` M libs/chayuan-server/chayuan/server/config_panel/init_assets.py`
- `?? base_data/models.customization`
- `?? libs/chayuan-server/chayuan/server/model_registry/seed.py`
- `?? libs/chayuan-server/tests/unit_tests/test_seed_models_customization.py`

### Diff Stat

```text
 .../chayuan-server/chayuan/server/config_panel/init_assets.py | 11 +++++++++++
 1 file changed, 11 insertions(+)
```

## 2026-05-05 09:54:41 +0800 - chayuan-server

- Branch: `main`
- Summary: auto-recorded local changes before commit.

### Changed Files

- ` M libs/chayuan-server/chayuan/server/config_panel/model_settings/page.py`

### Diff Stat

```text
 .../server/config_panel/model_settings/page.py     | 111 ++++++++++++++++-----
 1 file changed, 87 insertions(+), 24 deletions(-)
```

## 2026-05-05 09:47:41 +0800 - chayuan-server

- Branch: `main`
- Summary: auto-recorded local changes before commit.

### Changed Files

- ` M libs/chayuan-server/chayuan/server/config_panel/model_config.py`

### Diff Stat

```text
 .../chayuan/server/config_panel/model_config.py    | 99 +++++++++++-----------
 1 file changed, 51 insertions(+), 48 deletions(-)
```

## 2026-05-05 09:32:44 +0800 - chayuan-server

- Branch: `main`
- Summary: auto-recorded local changes before commit.

### Changed Files

- ` M libs/chayuan-server/chayuan/server/config_panel/dashboard.py`
- ` M libs/chayuan-server/chayuan/server/config_panel/model_config.py`
- `?? libs/chayuan-server/chayuan/server/config_panel/model_settings/__init__.py`
- `?? libs/chayuan-server/chayuan/server/config_panel/model_settings/defaults_subpage.py`
- `?? libs/chayuan-server/chayuan/server/config_panel/model_settings/marketplace_subpage.py`
- `?? libs/chayuan-server/chayuan/server/config_panel/model_settings/page.py`
- `?? libs/chayuan-server/chayuan/server/config_panel/model_settings/providers_subpage.py`
- `?? libs/chayuan-server/chayuan/server/config_panel/model_settings/runtime_subpage.py`
- `?? libs/chayuan-server/chayuan/server/config_panel/model_settings/state_cache.py`
- `?? libs/chayuan-server/tests/unit_tests/test_defaults_subpage.py`
- `?? libs/chayuan-server/tests/unit_tests/test_providers_subpage.py`

### Diff Stat

```text
 .../chayuan/server/config_panel/dashboard.py       |  20 +-
 .../chayuan/server/config_panel/model_config.py    | 470 ++++++++++++---------
 2 files changed, 273 insertions(+), 217 deletions(-)
```

## 2026-05-05 09:09:19 +0800 - chayuan-server

- Branch: `main`
- Summary: auto-recorded local changes before commit.

### Changed Files

- ` M libs/chayuan-server/chayuan/server/config_panel/_safe_ui.py`
- ` M libs/chayuan-server/chayuan/server/config_panel/marketplace_grid_panel.py`
- ` M libs/chayuan-server/tests/unit_tests/test_safe_ui.py`

### Diff Stat

```text
 .../chayuan/server/config_panel/_safe_ui.py        | 56 ++++++++++++++++++-
 .../server/config_panel/marketplace_grid_panel.py  | 13 +++++
 .../tests/unit_tests/test_safe_ui.py               | 62 ++++++++++++++++++++++
 3 files changed, 130 insertions(+), 1 deletion(-)
```

## 2026-05-05 08:53:43 +0800 - chayuan-server

- Branch: `main`
- Summary: auto-recorded local changes before commit.

### Changed Files

- ` M libs/chayuan-server/chayuan/img/model_logos/gpt4all.png`
- ` M libs/chayuan-server/chayuan/img/model_logos/jan.png`
- ` M libs/chayuan-server/chayuan/img/model_logos/koboldcpp.png`
- ` M libs/chayuan-server/chayuan/img/model_logos/llama-cpp.png`
- ` M libs/chayuan-server/chayuan/img/model_logos/localai.png`
- ` D libs/chayuan-server/chayuan/img/model_logos/openllm.jpg`
- ` M libs/chayuan-server/chayuan/img/model_logos/text-gen-webui.png`
- ` M libs/chayuan-server/chayuan/img/model_logos/tgi.png`
- ` M libs/chayuan-server/chayuan/server/config_panel/model_config.py`
- ` M libs/chayuan-server/chayuan/server/config_panel/provider_hero_strip.py`
- `?? libs/chayuan-server/chayuan/img/model_logos/openllm.png`

### Diff Stat

```text
 .../chayuan/img/model_logos/gpt4all.png            | Bin 1580 -> 1925 bytes
 .../chayuan-server/chayuan/img/model_logos/jan.png | Bin 67207 -> 66809 bytes
 .../chayuan/img/model_logos/koboldcpp.png          | Bin 6832 -> 7104 bytes
 .../chayuan/img/model_logos/llama-cpp.png          | Bin 32494 -> 7438 bytes
 .../chayuan/img/model_logos/localai.png            | Bin 951954 -> 24756 bytes
 .../chayuan/img/model_logos/openllm.jpg            | Bin 3183 -> 0 bytes
 .../chayuan/img/model_logos/text-gen-webui.png     | Bin 87412 -> 87057 bytes
 .../chayuan-server/chayuan/img/model_logos/tgi.png | Bin 26772 -> 28277 bytes
 .../chayuan/server/config_panel/model_config.py    |   2 +-
 .../server/config_panel/provider_hero_strip.py     |   8 +++++---
 10 files changed, 6 insertions(+), 4 deletions(-)
```

## 2026-05-05 08:50:52 +0800 - chayuan-server

- Branch: `main`
- Summary: auto-recorded local changes before commit.

### Changed Files

- ` M libs/chayuan-server/chayuan/server/config_panel/model_config.py`
- ` M libs/chayuan-server/chayuan/server/config_panel/provider_hero_strip.py`
- ` M libs/chayuan-server/tests/unit_tests/test_provider_hero_strip.py`
- `?? libs/chayuan-server/chayuan/img/model_logos/gpt4all.png`
- `?? libs/chayuan-server/chayuan/img/model_logos/jan.png`
- `?? libs/chayuan-server/chayuan/img/model_logos/koboldcpp.png`
- `?? libs/chayuan-server/chayuan/img/model_logos/llama-cpp.png`
- `?? libs/chayuan-server/chayuan/img/model_logos/localai.png`
- `?? libs/chayuan-server/chayuan/img/model_logos/openllm.jpg`
- `?? libs/chayuan-server/chayuan/img/model_logos/text-gen-webui.png`
- `?? libs/chayuan-server/chayuan/img/model_logos/tgi.png`

### Diff Stat

```text
 .../chayuan/server/config_panel/model_config.py    |  65 +++++++-
 .../server/config_panel/provider_hero_strip.py     | 167 +++++++++++++++------
 .../tests/unit_tests/test_provider_hero_strip.py   | 144 +++++++++++++++++-
 3 files changed, 327 insertions(+), 49 deletions(-)
```

## 2026-05-05 08:29:46 +0800 - chayuan-server

- Branch: `main`
- Summary: auto-recorded local changes before commit.

### Changed Files

- ` M libs/chayuan-server/chayuan/server/config_panel/install_dialog.py`
- ` M libs/chayuan-server/chayuan/server/config_panel/runtime_framework_panel.py`
- ` M libs/chayuan-server/pyproject.toml`
- `?? libs/chayuan-server/BASE_DEPS.md`

### Diff Stat

```text
 .../chayuan/server/config_panel/install_dialog.py  |  6 ++++--
 .../server/config_panel/runtime_framework_panel.py | 17 +++++++++++++++
 libs/chayuan-server/pyproject.toml                 | 25 ++++++++++++++++------
 3 files changed, 39 insertions(+), 9 deletions(-)
```

## 2026-05-04 18:56:11 +0800 - chayuan-server

- Branch: `main`
- Summary: auto-recorded local changes before commit.

### Changed Files

- ` M libs/chayuan-server/chayuan/server/config_panel/runtime_framework_panel.py`

### Diff Stat

```text
 .../server/config_panel/runtime_framework_panel.py | 102 +++++++++++++++++++--
 1 file changed, 95 insertions(+), 7 deletions(-)
```

## 2026-05-04 18:54:47 +0800 - chayuan-server

- Branch: `main`
- Summary: auto-recorded local changes before commit.

### Changed Files

- ` M libs/chayuan-server/chayuan/server/config_panel/compose_manager.py`
- ` M libs/chayuan-server/chayuan/server/config_panel/container_lifecycle.py`
- ` M libs/chayuan-server/chayuan/server/config_panel/init_assets.py`
- `?? docker/server-compose/comfyui/docker-compose.yaml`
- `?? docker/server-compose/cosyvoice/docker-compose.yaml`
- `?? docker/server-compose/funasr/docker-compose.yaml`
- `?? docker/server-compose/infinity/docker-compose.yaml`
- `?? docker/server-compose/paddleocr/docker-compose.yaml`
- `?? docker/server-compose/piper-tts/docker-compose.yaml`
- `?? docker/server-compose/vllm/docker-compose.yaml`
- `?? docker/server-compose/whisper/docker-compose.yaml`
- `?? libs/chayuan-server/server-compose/README.md`
- `?? libs/chayuan-server/server-compose/comfyui.yaml`
- `?? libs/chayuan-server/server-compose/infinity.yaml`
- `?? libs/chayuan-server/server-compose/llamacpp.yaml`
- `?? libs/chayuan-server/server-compose/ollama.yaml`
- `?? libs/chayuan-server/server-compose/onlyoffice.yaml`
- `?? libs/chayuan-server/server-compose/vllm.yaml`

### Diff Stat

```text
 .../chayuan/server/config_panel/compose_manager.py | 192 +++++++++++++++++++++
 .../server/config_panel/container_lifecycle.py     |  57 ++++--
 .../chayuan/server/config_panel/init_assets.py     |  15 ++
 3 files changed, 252 insertions(+), 12 deletions(-)
```

## 2026-05-04 18:29:50 +0800 - chayuan-server

- Branch: `main`
- Summary: auto-recorded local changes before commit.

### Changed Files

- ` M libs/chayuan-server/chayuan/server/config_panel/install_dialog.py`
- ` M libs/chayuan-server/chayuan/server/config_panel/runtime_framework_panel.py`
- `?? libs/chayuan-server/chayuan/server/config_panel/compose_sources.py`

### Diff Stat

```text
 .../chayuan/server/config_panel/install_dialog.py  | 66 ++++++++++++++++++++++
 .../server/config_panel/runtime_framework_panel.py | 11 +++-
 2 files changed, 75 insertions(+), 2 deletions(-)
```

## 2026-05-04 18:01:27 +0800 - chayuan-server

- Branch: `main`
- Summary: auto-recorded local changes before commit.

### Changed Files

- ` M libs/chayuan-server/chayuan/server/config_panel/app.py`
- ` M libs/chayuan-server/chayuan/server/config_panel/install_dialog.py`

### Diff Stat

```text
 .../chayuan/server/config_panel/app.py             | 44 +++++++++++++
 .../chayuan/server/config_panel/install_dialog.py  | 74 +++++++++++++++++++---
 2 files changed, 109 insertions(+), 9 deletions(-)
```

## 2026-05-04 17:50:56 +0800 - chayuan-server

- Branch: `main`
- Summary: auto-recorded local changes before commit.

### Changed Files

- ` M libs/chayuan-server/chayuan/server/config_panel/container_lifecycle.py`
- ` M libs/chayuan-server/chayuan/server/config_panel/install_dialog.py`

### Diff Stat

```text
 .../server/config_panel/container_lifecycle.py     | 161 ++++++++-
 .../chayuan/server/config_panel/install_dialog.py  | 398 +++++++++++----------
 2 files changed, 361 insertions(+), 198 deletions(-)
```

## 2026-05-04 17:44:35 +0800 - chayuan-server

- Branch: `main`
- Summary: auto-recorded local changes before commit.

### Changed Files

- ` M libs/chayuan-server/chayuan/server/config_panel/_safe_ui.py`
- ` M libs/chayuan-server/chayuan/server/config_panel/app.py`
- ` M libs/chayuan-server/chayuan/server/config_panel/install_dialog.py`

### Diff Stat

```text
 .../chayuan/server/config_panel/_safe_ui.py        | 50 +++++++++++++
 .../chayuan/server/config_panel/app.py             | 10 ++-
 .../chayuan/server/config_panel/install_dialog.py  | 86 ++++++++++++++--------
 3 files changed, 115 insertions(+), 31 deletions(-)
```

## 2026-05-04 17:36:08 +0800 - chayuan-server

- Branch: `main`
- Summary: auto-recorded local changes before commit.

### Changed Files

- `?? libs/chayuan-server/tests/unit_tests/test_config_center_ensure_seeded.py`

### Diff Stat

```text
```

## 2026-05-04 17:33:34 +0800 - chayuan-server

- Branch: `main`
- Summary: auto-recorded local changes before commit.

### Changed Files

- ` M libs/chayuan-server/chayuan/server/config_center/__init__.py`
- ` M libs/chayuan-server/chayuan/server/config_center/bootstrap.py`
- ` M libs/chayuan-server/chayuan/server/config_panel/install_dialog.py`
- ` M libs/chayuan-server/chayuan/server/config_panel/install_recipes.py`
- ` M libs/chayuan-server/chayuan/startup.py`

### Diff Stat

```text
 .../chayuan/server/config_center/__init__.py       |  2 +-
 .../chayuan/server/config_center/bootstrap.py      | 96 ++++++++++++++++++++++
 .../chayuan/server/config_panel/install_dialog.py  |  6 +-
 .../chayuan/server/config_panel/install_recipes.py | 43 ++++++++++
 libs/chayuan-server/chayuan/startup.py             | 61 +++++++++-----
 5 files changed, 184 insertions(+), 24 deletions(-)
```

## 2026-05-04 17:28:51 +0800 - chayuan-server

- Branch: `main`
- Summary: auto-recorded local changes before commit.

### Changed Files

- ` M libs/chayuan-server/chayuan/server/config_panel/model_config.py`
- ` M libs/chayuan-server/chayuan/server/config_panel/runtime_framework_panel.py`
- `?? libs/chayuan-server/tests/unit_tests/test_container_health_strip.py`

### Diff Stat

```text
 .../chayuan/server/config_panel/model_config.py    | 104 +++++++++++++++++----
 .../server/config_panel/runtime_framework_panel.py |  75 +++++++++++----
 2 files changed, 141 insertions(+), 38 deletions(-)
```

## 2026-05-04 17:09:18 +0800 - chayuan-server

- Branch: `main`
- Summary: auto-recorded local changes before commit.

### Changed Files

- ` M libs/chayuan-server/chayuan/server/config_panel/dashboard.py`
- ` M libs/chayuan-server/chayuan/server/config_panel/install_dialog.py`
- ` M libs/chayuan-server/chayuan/server/config_panel/install_task_manager.py`
- ` M libs/chayuan-server/chayuan/server/config_panel/runtime_framework_panel.py`

### Diff Stat

```text
 .../chayuan/server/config_panel/dashboard.py       | 14 ++++++
 .../chayuan/server/config_panel/install_dialog.py  | 17 ++++---
 .../server/config_panel/install_task_manager.py    | 53 +++++++++++++++++-----
 .../server/config_panel/runtime_framework_panel.py | 51 ++++++++++++++++++---
 4 files changed, 110 insertions(+), 25 deletions(-)
```

## 2026-05-04 16:58:36 +0800 - chayuan-server

- Branch: `main`
- Summary: auto-recorded local changes before commit.

### Changed Files

- ` M libs/chayuan-server/chayuan/server/config_panel/compose_manager.py`
- ` M libs/chayuan-server/chayuan/server/config_panel/container_lifecycle.py`
- ` M libs/chayuan-server/chayuan/server/config_panel/install_dialog.py`
- `?? libs/chayuan-server/chayuan/server/config_panel/container_health_strip.py`

### Diff Stat

```text
 .../chayuan/server/config_panel/compose_manager.py | 133 +++++++++++++++++++++
 .../server/config_panel/container_lifecycle.py     |  45 ++++++-
 .../chayuan/server/config_panel/install_dialog.py  |  21 +++-
 3 files changed, 196 insertions(+), 3 deletions(-)
```

## 2026-05-04 16:46:04 +0800 - chayuan-server

- Branch: `main`
- Summary: auto-recorded local changes before commit.

### Changed Files

- ` M libs/chayuan-server/chayuan/server/config_panel/container_lifecycle.py`
- ` M libs/chayuan-server/chayuan/server/config_panel/install_task_manager.py`
- `?? libs/chayuan-server/tests/unit_tests/test_auto_register.py`
- `?? libs/chayuan-server/tests/unit_tests/test_container_lifecycle.py`

### Diff Stat

```text
 .../server/config_panel/container_lifecycle.py        |  7 ++++++-
 .../server/config_panel/install_task_manager.py       | 19 +++++++++++++++++++
 2 files changed, 25 insertions(+), 1 deletion(-)
```

## 2026-05-04 16:35:36 +0800 - chayuan-server

- Branch: `main`
- Summary: auto-recorded local changes before commit.

### Changed Files

- ` M libs/chayuan-server/chayuan/server/config_panel/compose_manager.py`
- ` M libs/chayuan-server/chayuan/server/config_panel/install_dialog.py`
- `?? libs/chayuan-server/chayuan/server/config_panel/auto_register.py`
- `?? libs/chayuan-server/chayuan/server/config_panel/container_lifecycle.py`

### Diff Stat

```text
 .../chayuan/server/config_panel/compose_manager.py | 147 +++++++++++++++--
 .../chayuan/server/config_panel/install_dialog.py  | 178 +++++++++++++++++++++
 2 files changed, 309 insertions(+), 16 deletions(-)
```

## 2026-05-04 16:26:56 +0800 - chayuan-server

- Branch: `main`
- Summary: auto-recorded local changes before commit.

### Changed Files

- ` M libs/chayuan-server/chayuan/server/config_panel/install_dialog.py`
- ` M libs/chayuan-server/chayuan/server/config_panel/model_config.py`
- ` M libs/chayuan-server/chayuan/server/config_panel/runtime_framework_panel.py`

### Diff Stat

```text
 .../chayuan/server/config_panel/install_dialog.py  | 122 +++++++++++++++++----
 .../chayuan/server/config_panel/model_config.py    |  42 +++++--
 .../server/config_panel/runtime_framework_panel.py |  45 +++++++-
 3 files changed, 176 insertions(+), 33 deletions(-)
```

## 2026-05-04 16:08:28 +0800 - chayuan-server

- Branch: `main`
- Summary: auto-recorded local changes before commit.

### Changed Files

- ` M libs/chayuan-server/chayuan/server/api_server/chat_routes.py`
- ` M libs/chayuan-server/chayuan/startup.py`

### Diff Stat

```text
 .../chayuan/server/api_server/chat_routes.py       |  4 +-
 libs/chayuan-server/chayuan/startup.py             | 58 ++++++++++++++++++----
 2 files changed, 52 insertions(+), 10 deletions(-)
```

## 2026-05-04 15:59:24 +0800 - chayuan-server

- Branch: `main`
- Summary: auto-recorded local changes before commit.

### Changed Files

- ` M libs/chayuan-server/chayuan/cli.py`
- ` M libs/chayuan-server/chayuan/server/db/repository/knowledge_file_repository.py`
- ` M libs/chayuan-server/chayuan/server/knowledge_base/migrate.py`
- ` M libs/chayuan-server/chayuan/startup.py`

### Diff Stat

```text
 libs/chayuan-server/chayuan/cli.py                 | 69 +++++++++++++++-------
 .../db/repository/knowledge_file_repository.py     | 16 +++--
 .../chayuan/server/knowledge_base/migrate.py       | 52 +++++++++++-----
 libs/chayuan-server/chayuan/startup.py             | 14 ++---
 4 files changed, 102 insertions(+), 49 deletions(-)
```

## 2026-05-04 15:49:48 +0800 - chayuan-server

- Branch: `main`
- Summary: auto-recorded local changes before commit.

### Changed Files

- ` M libs/chayuan-server/chayuan/cli.py`
- ` M libs/chayuan-server/chayuan/settings.py`

### Diff Stat

```text
 libs/chayuan-server/chayuan/cli.py      | 14 ++++++++++----
 libs/chayuan-server/chayuan/settings.py | 18 ++++++++++++++++--
 2 files changed, 26 insertions(+), 6 deletions(-)
```

## 2026-05-04 15:46:14 +0800 - chayuan-server

- Branch: `main`
- Summary: auto-recorded local changes before commit.

### Changed Files

- ` M libs/chayuan-server/chayuan/cli.py`

### Diff Stat

```text
 libs/chayuan-server/chayuan/cli.py | 80 ++++++++++++++++++++++++++------------
 1 file changed, 55 insertions(+), 25 deletions(-)
```

## 2026-05-04 15:41:59 +0800 - chayuan-server

- Branch: `main`
- Summary: auto-recorded local changes before commit.

### Changed Files

- ` M libs/chayuan-server/chayuan/init_database.py`

### Diff Stat

```text
 libs/chayuan-server/chayuan/init_database.py | 63 ++++++++++++++++++++++------
 1 file changed, 51 insertions(+), 12 deletions(-)
```

## 2026-05-04 15:25:25 +0800 - chayuan-server

- Branch: `main`
- Summary: auto-recorded local changes before commit.

### Changed Files

- ` M libs/chayuan-server/chayuan/cli.py`

### Diff Stat

```text
 libs/chayuan-server/chayuan/cli.py | 33 ++++++---------------------------
 1 file changed, 6 insertions(+), 27 deletions(-)
```

## 2026-05-04 15:22:55 +0800 - chayuan-server

- Branch: `main`
- Summary: auto-recorded local changes before commit.

### Changed Files

- ` M libs/chayuan-server/chayuan/server/config_panel/model_config.py`

### Diff Stat

```text
 .../chayuan/server/config_panel/model_config.py    | 100 ++++++++++++++++++---
 1 file changed, 87 insertions(+), 13 deletions(-)
```

## 2026-05-04 15:14:38 +0800 - chayuan-server

- Branch: `main`
- Summary: auto-recorded local changes before commit.

### Changed Files

- ` M libs/chayuan-server/chayuan/server/config_panel/dashboard.py`
- ` M libs/chayuan-server/chayuan/server/config_panel/model_config.py`

### Diff Stat

```text
 .../chayuan/server/config_panel/dashboard.py       |  6 +-
 .../chayuan/server/config_panel/model_config.py    | 93 ++++++++++++++++++++++
 2 files changed, 97 insertions(+), 2 deletions(-)
```

## 2026-05-04 12:58:00 +0800 - chayuan-server

- Branch: `main`
- Summary: auto-recorded local changes before commit.

### Changed Files

- ` M libs/chayuan-server/chayuan/cli.py`
- ` M libs/chayuan-server/chayuan/paths.py`
- ` M libs/chayuan-server/chayuan/server/config_panel/install_dialog.py`
- ` M libs/chayuan-server/chayuan/server/config_panel/install_recipes.py`
- ` M libs/chayuan-server/chayuan/server/config_panel/install_task_manager.py`
- ` M libs/chayuan-server/chayuan/server/config_panel/mirror_pool.py`
- ` M libs/chayuan-server/chayuan/server/config_panel/model_config.py`
- ` M libs/chayuan-server/chayuan/server/config_panel/runtime_framework_panel.py`
- ` M libs/chayuan-server/chayuan/server/modality/_runtime_server_base.py`
- ` M libs/chayuan-server/chayuan/server/modality/cosyvoice_server.py`
- ` M libs/chayuan-server/chayuan/server/modality/funasr_server.py`
- ` M libs/chayuan-server/chayuan/server/modality/paddleocr_server.py`
- ` M libs/chayuan-server/chayuan/server/modality/rapidocr_server.py`
- ` M libs/chayuan-server/chayuan/server/modality/voxcpm2_server.py`
- ` M scripts/install_diagnose.py`
- `?? libs/chayuan-server/chayuan/brandlock/__init__.py`
- `?? libs/chayuan-server/chayuan/brandlock/_canary.py`
- `?? libs/chayuan-server/chayuan/brandlock/_evidence.py`
- `?? libs/chayuan-server/chayuan/brandlock/_manifest.py`
- `?? libs/chayuan-server/chayuan/brandlock/_verifier.py`
- `?? libs/chayuan-server/chayuan/brandlock/manifest.json`
- `?? libs/chayuan-server/chayuan/server/config_panel/compose_manager.py`
- `?? libs/chayuan-server/chayuan/server/config_panel/init_assets.py`

### Diff Stat

```text
 libs/chayuan-server/chayuan/cli.py                 |  54 +++++++
 libs/chayuan-server/chayuan/paths.py               | 155 +++++++++++++++++++++
 .../chayuan/server/config_panel/install_dialog.py  |  29 +++-
 .../chayuan/server/config_panel/install_recipes.py |  51 +++++--
 .../server/config_panel/install_task_manager.py    | 104 +++++++++-----
 .../chayuan/server/config_panel/mirror_pool.py     |  23 +--
 .../chayuan/server/config_panel/model_config.py    |  27 ++--
 .../server/config_panel/runtime_framework_panel.py |  19 ++-
 .../server/modality/_runtime_server_base.py        |  21 +--
 .../chayuan/server/modality/cosyvoice_server.py    |   2 +-
 .../chayuan/server/modality/funasr_server.py       |   4 +-
 .../chayuan/server/modality/paddleocr_server.py    |   2 +-
 .../chayuan/server/modality/rapidocr_server.py     |   2 +-
 .../chayuan/server/modality/voxcpm2_server.py      |   4 +-
 scripts/install_diagnose.py                        | 121 ++++++++++------
 15 files changed, 481 insertions(+), 137 deletions(-)
```

## 2026-05-04 12:11:28 +0800 - chayuan-server

- Branch: `main`
- Summary: auto-recorded local changes before commit.

### Changed Files

- ` M libs/chayuan-runtime/src/chayuan_runtime/framework_wiring.py`
- ` M libs/chayuan-runtime/src/chayuan_runtime/registry.py`
- ` M libs/chayuan-server/chayuan/server/config_panel/install_dialog.py`
- ` M libs/chayuan-server/chayuan/server/config_panel/install_recipes.py`
- ` M libs/chayuan-server/chayuan/server/config_panel/install_task_manager.py`
- ` M libs/chayuan-server/chayuan/server/config_panel/runtime_framework_panel.py`
- `?? libs/chayuan-runtime/src/chayuan_runtime/adapters/voxcpm2_adapter.py`
- `?? libs/chayuan-server/chayuan/server/modality/voxcpm2_server.py`

### Diff Stat

```text
 .../src/chayuan_runtime/framework_wiring.py        |  1 +
 .../src/chayuan_runtime/registry.py                |  1 +
 .../chayuan/server/config_panel/install_dialog.py  |  3 ++
 .../chayuan/server/config_panel/install_recipes.py | 49 ++++++++++++++++++++++
 .../server/config_panel/install_task_manager.py    | 10 +++++
 .../server/config_panel/runtime_framework_panel.py | 10 +++++
 6 files changed, 74 insertions(+)
```

## 2026-05-04 11:52:25 +0800 - chayuan-server

- Branch: `main`
- Summary: auto-recorded local changes before commit.

### Changed Files

- ` M libs/chayuan-server/chayuan/server/config_panel/install_recipes.py`
- `?? libs/chayuan-server/chayuan/server/config_panel/mirror_pool.py`

### Diff Stat

```text
 .../chayuan/server/config_panel/install_recipes.py | 51 +++++++++++++++++++---
 1 file changed, 45 insertions(+), 6 deletions(-)
```

## 2026-05-04 11:46:48 +0800 - chayuan-server

- Branch: `main`
- Summary: auto-recorded local changes before commit.

### Changed Files

- ` M libs/chayuan-server/chayuan/server/chat/kb_chat.py`
- ` M libs/chayuan-server/chayuan/server/config_panel/install_dialog.py`
- ` M libs/chayuan-server/chayuan/server/modality/audio.py`
- ` M libs/chayuan-server/chayuan/server/utils.py`
- ` M scripts/install_diagnose.py`
- `?? libs/chayuan-server/chayuan/server/capability_router.py`

### Diff Stat

```text
 libs/chayuan-server/chayuan/server/chat/kb_chat.py | 66 ++++++++++++++----
 .../chayuan/server/config_panel/install_dialog.py  | 80 ++++++++++++++--------
 .../chayuan/server/modality/audio.py               | 28 ++++++--
 libs/chayuan-server/chayuan/server/utils.py        | 32 ++++++++-
 scripts/install_diagnose.py                        | 72 +++++++++++++++++++
 5 files changed, 227 insertions(+), 51 deletions(-)
```

## 2026-05-04 11:22:22 +0800 - chayuan-server

- Branch: `main`
- Summary: auto-recorded local changes before commit.

### Changed Files

- ` M libs/chayuan-server/chayuan/server/config_panel/install_dialog.py`

### Diff Stat

```text
 .../chayuan/server/config_panel/install_dialog.py  | 53 ++++++++++++++--------
 1 file changed, 35 insertions(+), 18 deletions(-)
```

## 2026-05-04 11:14:38 +0800 - chayuan-server

- Branch: `main`
- Summary: auto-recorded local changes before commit.

### Changed Files

- ` M libs/chayuan-server/chayuan/server/config_panel/model_config.py`
- ` M libs/chayuan-server/chayuan/settings.py`

### Diff Stat

```text
 .../chayuan/server/config_panel/model_config.py    | 51 +++++++++++++++++++---
 libs/chayuan-server/chayuan/settings.py            |  7 ++-
 2 files changed, 51 insertions(+), 7 deletions(-)
```

## 2026-05-04 10:49:18 +0800 - chayuan-server

- Branch: `main`
- Summary: auto-recorded local changes before commit.

### Changed Files

- ` M libs/chayuan-server/chayuan/server/config_panel/model_config.py`

### Diff Stat

```text
 .../chayuan/server/config_panel/model_config.py    | 77 +++++++++++++---------
 1 file changed, 47 insertions(+), 30 deletions(-)
```

## 2026-05-04 10:47:11 +0800 - chayuan-server

- Branch: `main`
- Summary: auto-recorded local changes before commit.

### Changed Files

- ` M libs/chayuan-server/chayuan/server/config_panel/install_dialog.py`
- ` M libs/chayuan-server/chayuan/server/config_panel/install_recipes.py`
- ` M libs/chayuan-server/chayuan/server/config_panel/install_task_manager.py`
- ` M libs/chayuan-server/chayuan/server/config_panel/mirror_source_panel.py`
- ` M libs/chayuan-server/chayuan/server/config_panel/runtime_framework_panel.py`
- ` M libs/chayuan-server/tests/unit_tests/test_install_task_manager.py`

### Diff Stat

```text
 .../chayuan/server/config_panel/install_dialog.py  |  40 +++-
 .../chayuan/server/config_panel/install_recipes.py |  97 +++++-----
 .../server/config_panel/install_task_manager.py    | 201 +++++++++++++++------
 .../server/config_panel/mirror_source_panel.py     |  31 +++-
 .../server/config_panel/runtime_framework_panel.py |   7 +-
 .../tests/unit_tests/test_install_task_manager.py  |  18 +-
 6 files changed, 280 insertions(+), 114 deletions(-)
```

## 2026-05-04 10:27:03 +0800 - chayuan-server

- Branch: `main`
- Summary: auto-recorded local changes before commit.

### Changed Files

- ` M libs/chayuan-server/chayuan/server/config_panel/model_config.py`
- ` M libs/chayuan-server/chayuan/server/config_panel/provider_hero_strip.py`

### Diff Stat

```text
 .../chayuan/server/config_panel/model_config.py    | 42 ++++++++++++++++++----
 .../server/config_panel/provider_hero_strip.py     | 21 +++++------
 2 files changed, 44 insertions(+), 19 deletions(-)
```

## 2026-05-04 10:23:14 +0800 - chayuan-server

- Branch: `main`
- Summary: auto-recorded local changes before commit.

### Changed Files

- ` M libs/chayuan-server/chayuan/server/config_panel/install_dialog.py`
- ` M libs/chayuan-server/chayuan/server/config_panel/model_config.py`

### Diff Stat

```text
 .../chayuan/server/config_panel/install_dialog.py  | 161 +++++++++++++++++----
 .../chayuan/server/config_panel/model_config.py    | 120 ++++++++++++---
 2 files changed, 231 insertions(+), 50 deletions(-)
```

## 2026-05-04 10:10:54 +0800 - chayuan-server

- Branch: `main`
- Summary: auto-recorded local changes before commit.

### Changed Files

- ` M libs/chayuan-server/chayuan/server/config_panel/model_config.py`

### Diff Stat

```text
 .../chayuan/server/config_panel/model_config.py    | 91 +++++++++++++++++-----
 1 file changed, 73 insertions(+), 18 deletions(-)
```

## 2026-05-04 10:04:50 +0800 - chayuan-server

- Branch: `main`
- Summary: auto-recorded local changes before commit.

### Changed Files

- ` M libs/chayuan-server/chayuan/server/config_panel/model_config.py`
- ` M libs/chayuan-server/chayuan/server/config_panel/runtime_framework_panel.py`

### Diff Stat

```text
 .../chayuan/server/config_panel/model_config.py            |  5 +++--
 .../chayuan/server/config_panel/runtime_framework_panel.py | 14 +++++++-------
 2 files changed, 10 insertions(+), 9 deletions(-)
```

## 2026-05-04 10:03:47 +0800 - chayuan-server

- Branch: `main`
- Summary: auto-recorded local changes before commit.

### Changed Files

- ` M libs/chayuan-server/chayuan/server/config_panel/model_config.py`

### Diff Stat

```text
 .../chayuan/server/config_panel/model_config.py    | 39 +++++++++++++++++++---
 1 file changed, 34 insertions(+), 5 deletions(-)
```

## 2026-05-04 10:02:23 +0800 - chayuan-server

- Branch: `main`
- Summary: auto-recorded local changes before commit.

### Changed Files

- ` M libs/chayuan-server/chayuan/server/config_panel/install_dialog.py`
- ` M libs/chayuan-server/chayuan/server/config_panel/model_config.py`
- ` M libs/chayuan-server/chayuan/server/config_panel/provider_hero_strip.py`

### Diff Stat

```text
 .../chayuan/server/config_panel/install_dialog.py  | 68 +++++++++++++++++++++-
 .../chayuan/server/config_panel/model_config.py    | 13 ++++-
 .../server/config_panel/provider_hero_strip.py     | 44 ++++++++++++++
 3 files changed, 123 insertions(+), 2 deletions(-)
```

## 2026-05-04 09:54:05 +0800 - chayuan-server

- Branch: `main`
- Summary: auto-recorded local changes before commit.

### Changed Files

- ` M libs/chayuan-server/chayuan/server/config_panel/install_dialog.py`
- ` M libs/chayuan-server/chayuan/server/config_panel/provider_hero_strip.py`

### Diff Stat

```text
 .../chayuan/server/config_panel/install_dialog.py  | 215 +++++++++++++--------
 .../server/config_panel/provider_hero_strip.py     |   8 +-
 2 files changed, 142 insertions(+), 81 deletions(-)
```

## 2026-05-04 09:40:56 +0800 - chayuan-server

- Branch: `main`
- Summary: auto-recorded local changes before commit.

### Changed Files

- ` M libs/chayuan-server/chayuan/server/config_panel/install_dialog.py`
- ` M libs/chayuan-server/chayuan/server/config_panel/install_task_manager.py`

### Diff Stat

```text
 .../chayuan/server/config_panel/install_dialog.py  | 122 ++++++++++++++++++++-
 .../server/config_panel/install_task_manager.py    |  82 ++++++++++++--
 2 files changed, 196 insertions(+), 8 deletions(-)
```

## 2026-05-04 09:39:22 +0800 - chayuan-server

- Branch: `main`
- Summary: auto-recorded local changes before commit.

### Changed Files

- ` M libs/chayuan-server/chayuan/server/config_panel/model_config.py`
- ` M libs/chayuan-server/chayuan/server/config_panel/runtime_framework_panel.py`

### Diff Stat

```text
 .../chayuan/server/config_panel/model_config.py    |  59 +++++++++--
 .../server/config_panel/runtime_framework_panel.py | 113 ++++++++++++++++++++-
 2 files changed, 161 insertions(+), 11 deletions(-)
```

## 2026-05-04 09:31:43 +0800 - chayuan-server

- Branch: `main`
- Summary: auto-recorded local changes before commit.

### Changed Files

- ` M libs/chayuan-server/chayuan/server/config_panel/model_config.py`

### Diff Stat

```text
 .../chayuan/server/config_panel/model_config.py    | 146 ++++++++++++++++++++-
 1 file changed, 140 insertions(+), 6 deletions(-)
```

## 2026-05-04 09:20:17 +0800 - chayuan-server

- Branch: `main`
- Summary: auto-recorded local changes before commit.

### Changed Files

- ` M libs/chayuan-server/chayuan/server/config_panel/install_dialog.py`
- ` M libs/chayuan-server/chayuan/server/config_panel/runtime_framework_panel.py`
- ` M scripts/install_diagnose.py`

### Diff Stat

```text
 .../chayuan/server/config_panel/install_dialog.py  | 129 +++++++++++++-
 .../server/config_panel/runtime_framework_panel.py | 186 +++++++++++++++++++--
 scripts/install_diagnose.py                        |  52 +++++-
 3 files changed, 350 insertions(+), 17 deletions(-)
```

## 2026-05-04 09:03:33 +0800 - chayuan-server

- Branch: `main`
- Summary: auto-recorded local changes before commit.

### Changed Files

- ` M libs/chayuan-gateway/pyproject.toml`
- ` M libs/chayuan-server/chayuan/cli.py`
- ` M scripts/install_diagnose.py`
- ` M scripts/install_smart.ps1`

### Diff Stat

```text
 libs/chayuan-gateway/pyproject.toml |   7 +-
 libs/chayuan-server/chayuan/cli.py  | 216 +++++++++++++++++++++++++++++-------
 scripts/install_diagnose.py         | 110 +++++++++++++++++-
 scripts/install_smart.ps1           |  28 ++++-
 4 files changed, 313 insertions(+), 48 deletions(-)
```

## 2026-05-04 08:53:02 +0800 - chayuan-server

- Branch: `main`
- Summary: auto-recorded local changes before commit.

### Changed Files

- ` M docs/contributing/README_dev.md`
- ` M scripts/fix_conda_nexus.ps1`
- ` M scripts/install_ai_platform.ps1`
- ` M scripts/repair_torch.ps1`
- `?? scripts/install_diagnose.py`
- `?? scripts/install_smart.ps1`
- `?? scripts/install_smart.sh`

### Diff Stat

```text
 docs/contributing/README_dev.md | 32 ++++++++++++++++++++++++++++----
 scripts/fix_conda_nexus.ps1     |  2 +-
 scripts/install_ai_platform.ps1 |  2 +-
 scripts/repair_torch.ps1        |  2 +-
 4 files changed, 31 insertions(+), 7 deletions(-)
```

## 2026-05-04 08:28:52 +0800 - chayuan-server

- Branch: `main`
- Summary: auto-recorded local changes before commit.

### Changed Files

- ` M libs/chayuan-server/chayuan/server/config_panel/model_config.py`
- ` M libs/chayuan-server/chayuan/server/config_panel/runtime_framework_panel.py`
- ` M libs/chayuan-server/tests/unit_tests/test_runtime_framework_panel.py`

### Diff Stat

```text
 .../chayuan/server/config_panel/model_config.py    |  9 ++++--
 .../server/config_panel/runtime_framework_panel.py | 36 +++++++++++++++++++---
 .../unit_tests/test_runtime_framework_panel.py     | 14 +++++++++
 3 files changed, 53 insertions(+), 6 deletions(-)
```

## 2026-05-04 08:17:22 +0800 - chayuan-server

- Branch: `main`
- Summary: auto-recorded local changes before commit.

### Changed Files

- ` M docs/contributing/README_dev.md`
- ` M libs/chayuan-server/chayuan/server/config_panel/install_dialog.py`
- ` M libs/chayuan-server/chayuan/server/config_panel/model_config.py`
- ` M libs/chayuan-server/chayuan/server/config_panel/runtime_framework_panel.py`
- ` M scripts/install_ai_platform.ps1`
- ` M scripts/install_ai_platform.sh`
- `?? libs/chayuan-server/chayuan/server/modality/_runtime_server_base.py`
- `?? libs/chayuan-server/chayuan/server/modality/cosyvoice_server.py`
- `?? libs/chayuan-server/chayuan/server/modality/funasr_server.py`
- `?? libs/chayuan-server/chayuan/server/modality/paddleocr_server.py`
- `?? libs/chayuan-server/chayuan/server/modality/rapidocr_server.py`

### Diff Stat

```text
 docs/contributing/README_dev.md                    |  38 +++-
 .../chayuan/server/config_panel/install_dialog.py  | 197 ++++++++++++++++-
 .../chayuan/server/config_panel/model_config.py    |  10 +
 .../server/config_panel/runtime_framework_panel.py | 238 ++++++++++++++++-----
 scripts/install_ai_platform.ps1                    |  37 +++-
 scripts/install_ai_platform.sh                     |  16 +-
 6 files changed, 464 insertions(+), 72 deletions(-)
```

## 2026-05-03 20:59:52 +0800 - chayuan-server

- Branch: `main`
- Summary: auto-recorded local changes before commit.

### Changed Files

- ` M libs/chayuan-server/chayuan/server/api_server/knowledge_universe_routes.py`
- ` M libs/chayuan-server/chayuan/server/retrieval/query/orchestrator.py`
- `?? libs/chayuan-server/chayuan/server/retrieval/query/synthesis.py`

### Diff Stat

```text
 .../server/api_server/knowledge_universe_routes.py | 11 +++++++---
 .../chayuan/server/retrieval/query/orchestrator.py | 25 ++++++++++++++++++++++
 2 files changed, 33 insertions(+), 3 deletions(-)
```

## 2026-05-03 20:20:07 +0800 - chayuan-server

- Branch: `main`
- Summary: auto-recorded local changes before commit.

### Changed Files

- ` M libs/chayuan-server/chayuan/server/api_server/knowledge_universe_routes.py`

### Diff Stat

```text
 .../server/api_server/knowledge_universe_routes.py | 176 ++++++++++++++++++++-
 1 file changed, 175 insertions(+), 1 deletion(-)
```

## 2026-05-03 19:55:05 +0800 - chayuan-server

- Branch: `main`
- Summary: auto-recorded local changes before commit.

### Changed Files

- ` M libs/chayuan-server/chayuan/server/retrieval/query/adapters/structured.py`

### Diff Stat

```text
 .../server/retrieval/query/adapters/structured.py        | 16 +++++++++++++++-
 1 file changed, 15 insertions(+), 1 deletion(-)
```

## 2026-05-03 19:46:32 +0800 - chayuan-server

- Branch: `main`
- Summary: auto-recorded local changes before commit.

### Changed Files

- ` M libs/chayuan-server/chayuan/server/api_server/knowledge_universe_routes.py`

### Diff Stat

```text
 .../server/api_server/knowledge_universe_routes.py | 194 ++++++++++++++-------
 1 file changed, 130 insertions(+), 64 deletions(-)
```

## 2026-05-03 19:31:41 +0800 - chayuan-server

- Branch: `main`
- Summary: auto-recorded local changes before commit.

### Changed Files

- ` M libs/chayuan-server/chayuan/server/agent/tools_factory/text2sql.py`
- ` M libs/chayuan-server/chayuan/server/api_server/knowledge_universe_routes.py`

### Diff Stat

```text
 .../chayuan/server/agent/tools_factory/text2sql.py |  6 ++++-
 .../server/api_server/knowledge_universe_routes.py | 28 +++++++++++++++++++++-
 2 files changed, 32 insertions(+), 2 deletions(-)
```

## 2026-05-03 19:20:34 +0800 - chayuan-server

- Branch: `main`
- Summary: auto-recorded local changes before commit.

### Changed Files

- ` M libs/chayuan-server/chayuan/server/api_server/knowledge_universe_routes.py`
- `?? libs/chayuan-server/tests/unit_tests/test_extract_sql_from_text.py`

### Diff Stat

```text
 .../server/api_server/knowledge_universe_routes.py | 55 ++++++++++++++++++++--
 1 file changed, 51 insertions(+), 4 deletions(-)
```

## 2026-05-03 19:10:34 +0800 - chayuan-server

- Branch: `main`
- Summary: auto-recorded local changes before commit.

### Changed Files

- ` M libs/chayuan-server/chayuan/startup.py`

### Diff Stat

```text
 libs/chayuan-server/chayuan/startup.py | 2 +-
 1 file changed, 1 insertion(+), 1 deletion(-)
```

## 2026-05-03 18:44:37 +0800 - chayuan-server

- Branch: `feat/kb-search-batch`
- Summary: auto-recorded local changes before commit.

### Changed Files

- ` M libs/chayuan-server/chayuan/server/kb_query/schemas.py`
- ` M libs/chayuan-server/tests/unit_tests/test_kb_query_schemas.py`

### Diff Stat

```text
 .../chayuan/server/kb_query/schemas.py             | 15 +++++++++++++++
 .../tests/unit_tests/test_kb_query_schemas.py      | 22 ++++++++++++++++++++++
 2 files changed, 37 insertions(+)
```

## 2026-05-03 18:33:45 +0800 - chayuan-server

- Branch: `feat/kb-search-batch`
- Summary: auto-recorded local changes before commit.

### Changed Files

- ` M libs/chayuan-server/chayuan/server/api_server/knowledge_universe_routes.py`
- ` M libs/chayuan-server/chayuan/server/knowledge_source/sql/text2sql.py`
- ` M libs/chayuan-server/chayuan/server/retrieval/query/refs.py`
- ` M libs/chayuan-server/tests/knowledge_source/test_sql_safety.py`

### Diff Stat

```text
 .../server/api_server/knowledge_universe_routes.py | 54 ++++++++++++++++++++++
 .../server/knowledge_source/sql/text2sql.py        | 38 ++++++++++-----
 .../chayuan/server/retrieval/query/refs.py         | 18 ++++++--
 .../tests/knowledge_source/test_sql_safety.py      | 31 +++++++++++++
 4 files changed, 126 insertions(+), 15 deletions(-)
```

## 2026-05-03 18:09:38 +0800 - chayuan-server

- Branch: `feat/kb-search-batch`
- Summary: auto-recorded local changes before commit.

### Changed Files

- ` M libs/chayuan-server/chayuan/server/kb_query/evals.py`
- ` M libs/chayuan-server/chayuan/server/kb_query/schemas.py`
- ` M libs/chayuan-server/chayuan/server/kb_query/service.py`
- ` M libs/chayuan-server/chayuan/server/retrieval/universe/service.py`
- ` M libs/chayuan-server/tests/unit_tests/test_kb_query_schemas.py`
- ` M libs/chayuan-server/tests/unit_tests/test_kb_query_service.py`
- `?? libs/chayuan-server/chayuan/server/retrieval/query/__init__.py`
- `?? libs/chayuan-server/chayuan/server/retrieval/query/adapters/__init__.py`
- `?? libs/chayuan-server/chayuan/server/retrieval/query/adapters/document.py`
- `?? libs/chayuan-server/chayuan/server/retrieval/query/adapters/office.py`
- `?? libs/chayuan-server/chayuan/server/retrieval/query/adapters/structured.py`
- `?? libs/chayuan-server/chayuan/server/retrieval/query/adapters/structured_tools.py`
- `?? libs/chayuan-server/chayuan/server/retrieval/query/adapters/vector.py`
- `?? libs/chayuan-server/chayuan/server/retrieval/query/authz.py`
- `?? libs/chayuan-server/chayuan/server/retrieval/query/orchestrator.py`
- `?? libs/chayuan-server/chayuan/server/retrieval/query/refs.py`
- `?? libs/chayuan-server/chayuan/server/retrieval/query/results.py`
- `?? libs/chayuan-server/chayuan/server/retrieval/query/router.py`

### Diff Stat

```text
 .../chayuan/server/kb_query/evals.py               |  41 +++-
 .../chayuan/server/kb_query/schemas.py             |  30 +++
 .../chayuan/server/kb_query/service.py             | 214 +--------------------
 .../chayuan/server/retrieval/universe/service.py   |  33 +++-
 .../tests/unit_tests/test_kb_query_schemas.py      |  14 ++
 .../tests/unit_tests/test_kb_query_service.py      |  34 ++--
 6 files changed, 132 insertions(+), 234 deletions(-)
```

## 2026-05-03 11:50:44 +0800 - chayuan-server

- Branch: `feat/kb-search-batch`
- Summary: auto-recorded local changes before commit.

### Changed Files

- ` M libs/chayuan-server/chayuan/server/api_server/kb_routes.py`
- ` M libs/chayuan-server/chayuan/server/api_server/knowledge_universe_routes.py`
- ` M libs/chayuan-server/chayuan/server/config_panel/app.py`
- ` M libs/chayuan-server/chayuan/server/kb_query/citations.py`
- ` M libs/chayuan-server/chayuan/server/kb_query/service.py`
- ` M libs/chayuan-server/chayuan/startup.py`
- `?? libs/chayuan-server/chayuan/server/retrieval/__init__.py`
- `?? libs/chayuan-server/chayuan/server/retrieval/universe/__init__.py`
- `?? libs/chayuan-server/chayuan/server/retrieval/universe/service.py`
- `?? libs/chayuan-server/tests/unit_tests/test_universe_retrieval_service.py`

### Diff Stat

```text
 .../chayuan/server/api_server/kb_routes.py         | 78 ++++------------------
 .../server/api_server/knowledge_universe_routes.py | 68 +++++++++++++------
 .../chayuan/server/config_panel/app.py             | 17 ++++-
 .../chayuan/server/kb_query/citations.py           | 25 ++++++-
 .../chayuan/server/kb_query/service.py             | 11 ++-
 libs/chayuan-server/chayuan/startup.py             | 37 ++++++++--
 6 files changed, 140 insertions(+), 96 deletions(-)
```

## 2026-05-03 11:07:19 +0800 - chayuan-server

- Branch: `feat/kb-search-batch`
- Summary: auto-recorded local changes before commit.

### Changed Files

- ` M libs/chayuan-server/chayuan/server/api_server/openapi_routes.py`
- ` M libs/chayuan-server/chayuan/server/config_panel/apps_page.py`
- ` M libs/chayuan-server/chayuan/server/config_panel/apps_store.py`
- ` M libs/chayuan-server/tests/unit_tests/test_openapi_app_auth.py`

### Diff Stat

```text
 .../chayuan/server/api_server/openapi_routes.py    |  82 ++++++---
 .../chayuan/server/config_panel/apps_page.py       | 196 +++++++++++++++++++++
 .../chayuan/server/config_panel/apps_store.py      |  29 +++
 .../tests/unit_tests/test_openapi_app_auth.py      |  10 +-
 4 files changed, 294 insertions(+), 23 deletions(-)
```

## 2026-05-03 10:57:54 +0800 - chayuan-server

- Branch: `feat/kb-search-batch`
- Summary: auto-recorded local changes before commit.

### Changed Files

- ` M libs/chayuan-server/chayuan/server/api_server/kb_routes.py`
- ` M libs/chayuan-server/chayuan/server/api_server/knowledge_universe_routes.py`
- ` M libs/chayuan-server/chayuan/server/auth/source_access.py`

### Diff Stat

```text
 .../chayuan/server/api_server/kb_routes.py         | 254 ++++++++++++++++++++-
 .../server/api_server/knowledge_universe_routes.py | 147 +++++++-----
 .../chayuan/server/auth/source_access.py           |   3 +
 3 files changed, 339 insertions(+), 65 deletions(-)
```

## 2026-05-03 10:39:01 +0800 - chayuan-server

- Branch: `feat/kb-search-batch`
- Summary: auto-recorded local changes before commit.

### Changed Files

- ` M libs/chayuan-server/chayuan/server/config_panel/apps_page.py`
- ` M libs/chayuan-server/chayuan/server/shared/secret_store.py`

### Diff Stat

```text
 .../chayuan/server/config_panel/apps_page.py       | 70 ++++++++++++----------
 .../chayuan/server/shared/secret_store.py          | 27 +++------
 2 files changed, 49 insertions(+), 48 deletions(-)
```

## 2026-05-03 05:27:53 +0800 - chayuan-server

- Branch: `feat/kb-search-batch`
- Summary: auto-recorded local changes before commit.

### Changed Files

- ` M libs/chayuan-server/chayuan/server/api_server/kb_routes.py`
- ` M libs/chayuan-server/chayuan/server/api_server/openapi_routes.py`
- ` M libs/chayuan-server/chayuan/server/auth/access.py`
- ` M libs/chayuan-server/chayuan/server/config_panel/apps_store.py`
- ` M libs/chayuan-server/chayuan/server/observability/metrics.py`
- ` M libs/chayuan-server/chayuan/server/shared/scopes.py`
- `?? libs/chayuan-server/chayuan/server/auth/app_acl.py`
- `?? libs/chayuan-server/chayuan/server/auth/download_token.py`
- `?? libs/chayuan-server/chayuan/server/auth/kb_audit.py`
- `?? libs/chayuan-server/chayuan/server/db/alembic/versions/0020_app_kb_grant.py`
- `?? libs/chayuan-server/chayuan/server/db/models/app_kb_grant_model.py`
- `?? libs/chayuan-server/chayuan/server/file_rag/batch_search.py`
- `?? libs/chayuan-server/tests/unit_tests/test_kb_acl_decisions.py`
- `?? libs/chayuan-server/tests/unit_tests/test_kb_metrics.py`
- `?? libs/chayuan-server/tests/unit_tests/test_kb_search_batch.py`
- `?? scripts/perf/locustfile_kb_search.py`

### Diff Stat

```text
 .../chayuan/server/api_server/kb_routes.py         | 178 ++++++++++-
 .../chayuan/server/api_server/openapi_routes.py    | 348 +++++++++++++++++++--
 libs/chayuan-server/chayuan/server/auth/access.py  |  17 +-
 .../chayuan/server/config_panel/apps_store.py      |  12 +-
 .../chayuan/server/observability/metrics.py        |  86 +++++
 .../chayuan-server/chayuan/server/shared/scopes.py |   3 +-
 6 files changed, 614 insertions(+), 30 deletions(-)
```

## 2026-05-02 23:03:50 +0800 - chayuan-server

- Branch: `main`
- Summary: auto-recorded local changes before commit.

### Changed Files

- ` M libs/chayuan-server/chayuan/server/api_server/admin_routes.py`
- ` M libs/chayuan-server/chayuan/server/api_server/model_registry_routes.py`
- ` M libs/chayuan-server/chayuan/server/config_panel/dashboard.py`
- ` M libs/chayuan-server/chayuan/server/config_panel/install_task_manager.py`
- ` M libs/chayuan-server/chayuan/server/config_panel/marketplace_grid_panel.py`
- ` M libs/chayuan-server/chayuan/server/config_panel/mirror_source_panel.py`
- ` M libs/chayuan-server/chayuan/server/config_panel/monitoring.py`
- ` M libs/chayuan-server/chayuan/server/config_panel/provider_hero_strip.py`
- ` M libs/chayuan-server/chayuan/server/config_panel/service_page.py`
- ` M libs/chayuan-server/tests/unit_tests/test_friendlify_and_derive.py`
- `?? libs/chayuan-server/chayuan/server/config_panel/_safe_ui.py`
- `?? libs/chayuan-server/tests/unit_tests/test_safe_ui.py`

### Diff Stat

```text
 .../chayuan/server/api_server/admin_routes.py      |  70 +++++++++++-
 .../server/api_server/model_registry_routes.py     |  79 +++++++++++--
 .../chayuan/server/config_panel/dashboard.py       |   4 +-
 .../server/config_panel/install_task_manager.py    |  49 ++++++++
 .../server/config_panel/marketplace_grid_panel.py  |  12 +-
 .../server/config_panel/mirror_source_panel.py     | 124 +++++++++++++--------
 .../chayuan/server/config_panel/monitoring.py      |   4 +-
 .../server/config_panel/provider_hero_strip.py     |  15 ++-
 .../chayuan/server/config_panel/service_page.py    |   5 +-
 .../tests/unit_tests/test_friendlify_and_derive.py |  76 +++++++++++++
 10 files changed, 376 insertions(+), 62 deletions(-)
```

## 2026-05-02 22:31:59 +0800 - chayuan-server

- Branch: `main`
- Summary: auto-recorded local changes before commit.

### Changed Files

- ` M libs/chayuan-server/chayuan/server/config_panel/_guidance_card.py`
- ` M libs/chayuan-server/chayuan/server/config_panel/install_dialog.py`
- ` M libs/chayuan-server/chayuan/server/config_panel/install_recipes.py`
- ` M libs/chayuan-server/chayuan/server/config_panel/install_task_manager.py`
- ` M libs/chayuan-server/chayuan/server/config_panel/marketplace_grid_panel.py`
- ` M libs/chayuan-server/chayuan/server/config_panel/mirror_source_panel.py`
- ` M libs/chayuan-server/chayuan/server/config_panel/provider_hero_strip.py`
- ` M libs/chayuan-server/chayuan/server/config_panel/runtime_framework_panel.py`
- `?? libs/chayuan-server/tests/unit_tests/test_friendlify_and_derive.py`

### Diff Stat

```text
 .../chayuan/server/config_panel/_guidance_card.py  |   8 +-
 .../chayuan/server/config_panel/install_dialog.py  |  12 ++
 .../chayuan/server/config_panel/install_recipes.py |  53 +++--
 .../server/config_panel/install_task_manager.py    | 127 ++++++++++-
 .../server/config_panel/marketplace_grid_panel.py  |  34 +--
 .../server/config_panel/mirror_source_panel.py     |  69 +++++-
 .../server/config_panel/provider_hero_strip.py     |  13 +-
 .../server/config_panel/runtime_framework_panel.py | 236 +++++++++++++++++----
 8 files changed, 465 insertions(+), 87 deletions(-)
```

## 2026-05-02 22:14:32 +0800 - chayuan-server

- Branch: `main`
- Summary: auto-recorded local changes before commit.

### Changed Files

- ` M libs/chayuan-server/chayuan/server/config_panel/install_recipes.py`
- ` M libs/chayuan-server/tests/unit_tests/test_install_recipes.py`

### Diff Stat

```text
 .../chayuan/server/config_panel/install_recipes.py | 208 +++++++++++++++------
 .../tests/unit_tests/test_install_recipes.py       |  71 +++++++
 2 files changed, 223 insertions(+), 56 deletions(-)
```

## 2026-05-02 22:03:04 +0800 - chayuan-server

- Branch: `main`
- Summary: auto-recorded local changes before commit.

### Changed Files

- ` M libs/chayuan-server/tests/unit_tests/test_install_recipes.py`
- ` M libs/chayuan-server/tests/unit_tests/test_install_task_manager.py`

### Diff Stat

```text
 .../tests/unit_tests/test_install_recipes.py       | 122 +++++++++++++++++++++
 .../tests/unit_tests/test_install_task_manager.py  |  41 +++++++
 2 files changed, 163 insertions(+)
```

## 2026-05-02 21:59:03 +0800 - chayuan-server

- Branch: `main`
- Summary: auto-recorded local changes before commit.

### Changed Files

- ` M libs/chayuan-server/chayuan/server/config_panel/dashboard.py`
- ` M libs/chayuan-server/chayuan/server/config_panel/install_dialog.py`
- ` M libs/chayuan-server/chayuan/server/config_panel/install_recipes.py`
- ` M libs/chayuan-server/chayuan/server/config_panel/install_task_manager.py`
- ` M libs/chayuan-server/chayuan/server/config_panel/runtime_framework_panel.py`

### Diff Stat

```text
 .../chayuan/server/config_panel/dashboard.py       |   7 +-
 .../chayuan/server/config_panel/install_dialog.py  |  35 +++
 .../chayuan/server/config_panel/install_recipes.py | 240 ++++++++++++++++++---
 .../server/config_panel/install_task_manager.py    |  52 +++++
 .../server/config_panel/runtime_framework_panel.py |  51 ++++-
 5 files changed, 349 insertions(+), 36 deletions(-)
```

## 2026-05-02 21:48:16 +0800 - chayuan-server

- Branch: `main`
- Summary: auto-recorded local changes before commit.

### Changed Files

- ` M libs/chayuan-server/chayuan/server/api_server/data_mount_routes.py`
- `?? libs/chayuan-server/tests/unit_tests/test_data_mount_import_filter.py`

### Diff Stat

```text
 .../chayuan/server/api_server/data_mount_routes.py | 59 ++++++++++++++++++++--
 1 file changed, 54 insertions(+), 5 deletions(-)
```

## 2026-05-02 21:24:02 +0800 - chayuan-server

- Branch: `main`
- Summary: auto-recorded local changes before commit.

### Changed Files

- ` M libs/chayuan-server/chayuan/server/config_panel/marketplace_grid_panel.py`
- ` M libs/chayuan-server/chayuan/server/config_panel/model_config.py`
- ` M libs/chayuan-server/chayuan/server/config_panel/runtime_framework_panel.py`
- ` M libs/chayuan-server/chayuan/server/model_registry/marketplace.py`
- `?? libs/chayuan-server/chayuan/server/config_panel/install_dialog.py`
- `?? libs/chayuan-server/chayuan/server/config_panel/install_recipes.py`
- `?? libs/chayuan-server/chayuan/server/config_panel/install_task_manager.py`
- `?? libs/chayuan-server/tests/unit_tests/test_install_recipes.py`
- `?? libs/chayuan-server/tests/unit_tests/test_install_task_manager.py`

### Diff Stat

```text
 .../server/config_panel/marketplace_grid_panel.py  | 807 ++++++++++++---------
 .../chayuan/server/config_panel/model_config.py    |  66 +-
 .../server/config_panel/runtime_framework_panel.py | 208 +++---
 .../chayuan/server/model_registry/marketplace.py   | 120 ++-
 4 files changed, 705 insertions(+), 496 deletions(-)
```

## 2026-05-02 20:56:13 +0800 - chayuan-server

- Branch: `main`
- Summary: auto-recorded local changes before commit.

### Changed Files

- ` M libs/chayuan-modelmgr/src/chayuan_modelmgr/mirrors.py`
- ` M libs/chayuan-server/chayuan/server/api_server/kb_routes.py`
- ` M libs/chayuan-server/chayuan/server/data_mount/materializer.py`
- ` M libs/chayuan-server/chayuan/server/db/repository/data_mount_repository.py`

### Diff Stat

```text
 .../src/chayuan_modelmgr/mirrors.py                |   7 +-
 .../chayuan/server/api_server/kb_routes.py         | 119 +++++++++++++++++++++
 .../chayuan/server/data_mount/materializer.py      |   4 +
 .../server/db/repository/data_mount_repository.py  |  62 +++++++++++
 4 files changed, 188 insertions(+), 4 deletions(-)
```

## 2026-05-02 20:46:25 +0800 - chayuan-server

- Branch: `main`
- Summary: auto-recorded local changes before commit.

### Changed Files

- ` M libs/chayuan-server/chayuan/server/api_server/data_mount_routes.py`
- ` M libs/chayuan-server/chayuan/server/chat/mounts/service.py`
- ` M libs/chayuan-server/chayuan/server/db/repository/data_mount_repository.py`
- `?? docs/data-mount-guide.md`
- `?? libs/chayuan-server/chayuan/server/data_mount/__init__.py`
- `?? libs/chayuan-server/chayuan/server/data_mount/base.py`
- `?? libs/chayuan-server/chayuan/server/data_mount/materializer.py`
- `?? libs/chayuan-server/chayuan/server/data_mount/registry.py`
- `?? libs/chayuan-server/chayuan/server/data_mount/schema_analyzer.py`
- `?? libs/chayuan-server/chayuan/server/data_mount/sources/__init__.py`
- `?? libs/chayuan-server/chayuan/server/data_mount/sources/_helpers.py`
- `?? libs/chayuan-server/chayuan/server/data_mount/sources/annotation.py`
- `?? libs/chayuan-server/chayuan/server/data_mount/sources/confluence.py`
- `?? libs/chayuan-server/chayuan/server/data_mount/sources/conversation.py`
- `?? libs/chayuan-server/chayuan/server/data_mount/sources/file.py`
- `?? libs/chayuan-server/chayuan/server/data_mount/sources/github.py`
- `?? libs/chayuan-server/chayuan/server/data_mount/sources/kb.py`
- `?? libs/chayuan-server/chayuan/server/data_mount/sources/knowledge_source.py`
- `?? libs/chayuan-server/chayuan/server/data_mount/sources/mongo.py`
- `?? libs/chayuan-server/chayuan/server/data_mount/sources/notion.py`
- `?? libs/chayuan-server/chayuan/server/data_mount/sources/s3.py`
- `?? libs/chayuan-server/chayuan/server/data_mount/sources/sql.py`
- `?? libs/chayuan-server/chayuan/server/data_mount/sources/web.py`
- `?? libs/chayuan-server/tests/unit_tests/test_data_mount_sources.py`

### Diff Stat

```text
 .../chayuan/server/api_server/data_mount_routes.py | 162 +++++++++++++++++++++
 .../chayuan/server/chat/mounts/service.py          |  58 +++++++-
 .../server/db/repository/data_mount_repository.py  | 137 ++++++++++++++---
 3 files changed, 338 insertions(+), 19 deletions(-)
```

## 2026-05-02 20:03:10 +0800 - chayuan-server

- Branch: `main`
- Summary: auto-recorded local changes before commit.

### Changed Files

- ` M .gitignore`
- `?? packaging/windows/AppxManifest.xml`
- `?? packaging/windows/Assets/README.md`

### Diff Stat

```text
 .gitignore | 5 +++++
 1 file changed, 5 insertions(+)
```

## 2026-05-02 18:29:53 +0800 - chayuan-server

- Branch: `main`
- Summary: auto-recorded local changes before commit.

### Changed Files

- ` M libs/chayuan-server/chayuan/server/config_panel/model_config.py`

### Diff Stat

```text
 .../chayuan/server/config_panel/model_config.py      | 20 ++++++++++++++++++++
 1 file changed, 20 insertions(+)
```

## 2026-05-02 18:29:43 +0800 - chayuan-server

- Branch: `main`
- Summary: auto-recorded local changes before commit.

### Changed Files

- `?? libs/chayuan-server/chayuan/server/config_panel/runtime_framework_panel.py`
- `?? libs/chayuan-server/tests/unit_tests/test_runtime_framework_panel.py`

### Diff Stat

```text
```

## 2026-05-02 17:59:09 +0800 - chayuan-server

- Branch: `main`
- Summary: auto-recorded local changes before commit.

### Changed Files

- ` M libs/chayuan-gateway/src/chayuan_gateway/routers/admin.py`
- ` M libs/chayuan-gateway/tests/test_gateway.py`
- ` M libs/chayuan-registry/src/chayuan_registry/models.py`
- ` M libs/chayuan-server/chayuan/server/ai_platform/repo_bridge.py`
- `?? libs/chayuan-gateway/src/chayuan_gateway/services/__init__.py`
- `?? libs/chayuan-gateway/src/chayuan_gateway/services/model_locator.py`
- `?? libs/chayuan-gateway/tests/test_model_locator.py`

### Diff Stat

```text
 .../src/chayuan_gateway/routers/admin.py           | 51 ++++++++++++++++++++++
 libs/chayuan-gateway/tests/test_gateway.py         | 40 +++++++++++++++++
 .../src/chayuan_registry/models.py                 | 20 +++++++++
 .../chayuan/server/ai_platform/repo_bridge.py      | 17 ++++++++
 4 files changed, 128 insertions(+)
```

## 2026-05-02 17:50:53 +0800 - chayuan-server

- Branch: `main`
- Summary: auto-recorded local changes before commit.

### Changed Files

- ` M libs/chayuan-gateway/src/chayuan_gateway/routers/admin.py`
- ` M libs/chayuan-gateway/src/chayuan_gateway/routers/embeddings.py`
- ` M libs/chayuan-gateway/tests/test_gateway.py`
- ` M libs/chayuan-modelmgr/src/chayuan_modelmgr/__init__.py`
- ` M libs/chayuan-modelmgr/src/chayuan_modelmgr/downloader.py`
- ` M libs/chayuan-modelmgr/src/chayuan_modelmgr/mirrors.py`
- ` M libs/chayuan-modelmgr/tests/test_modelmgr.py`
- ` M libs/chayuan-runtime/tests/test_adapters_wire.py`
- `?? .github/workflows/perf-locust.yml`
- `?? .github/workflows/smoke-comfyui-cpu.yml`
- `?? docs/knowledge-center-audit-and-95pct-roadmap.md`
- `?? libs/chayuan-modelmgr/src/chayuan_modelmgr/recommended.py`
- `?? scripts/ci/spin_up_gateway.py`
- `?? scripts/perf/locustfile.py`

### Diff Stat

```text
 .../src/chayuan_gateway/routers/admin.py           | 434 ++++++++++++++++++++-
 .../src/chayuan_gateway/routers/embeddings.py      | 143 ++++++-
 libs/chayuan-gateway/tests/test_gateway.py         |  82 ++++
 .../src/chayuan_modelmgr/__init__.py               |  10 +
 .../src/chayuan_modelmgr/downloader.py             |  44 ++-
 .../src/chayuan_modelmgr/mirrors.py                |  56 ++-
 libs/chayuan-modelmgr/tests/test_modelmgr.py       |  75 ++++
 libs/chayuan-runtime/tests/test_adapters_wire.py   |  98 +++++
 8 files changed, 918 insertions(+), 24 deletions(-)
```

## 2026-05-02 17:16:03 +0800 - chayuan-server

- Branch: `main`
- Summary: auto-recorded local changes before commit.

### Changed Files

- `?? docs/multimodal-ai-platform-requirements-coverage.md`

### Diff Stat

```text
```

## 2026-05-02 17:15:47 +0800 - chayuan-server

- Branch: `main`
- Summary: auto-recorded local changes before commit.

### Changed Files

- ` M README.md`
- ` M libs/chayuan-gateway/src/chayuan_gateway/routers/admin.py`

### Diff Stat

```text
 README.md                                          | 36 +++++++++++
 .../src/chayuan_gateway/routers/admin.py           | 75 ++++++++++++++++++++++
 2 files changed, 111 insertions(+)
```

## 2026-05-02 17:09:09 +0800 - chayuan-server

- Branch: `main`
- Summary: auto-recorded local changes before commit.

### Changed Files

- ` M libs/chayuan-gateway/src/chayuan_gateway/routers/chat.py`
- ` M libs/chayuan-gateway/tests/test_gateway.py`
- ` M libs/chayuan-runtime/src/chayuan_runtime/adapters/comfyui_adapter.py`
- ` M libs/chayuan-runtime/src/chayuan_runtime/registry.py`
- ` M libs/chayuan-runtime/tests/test_adapters_wire.py`
- ` M libs/chayuan-supervisor/tests/test_runtime_adapter.py`
- `?? .github/workflows/smoke-ollama.yml`
- `?? libs/chayuan-runtime/src/chayuan_runtime/adapters/_comfyui_workflows.py`
- `?? scripts/ci/smoke_ollama_chat.py`

### Diff Stat

```text
 .../src/chayuan_gateway/routers/chat.py            |  72 ++++++-
 libs/chayuan-gateway/tests/test_gateway.py         |  39 ++++
 .../chayuan_runtime/adapters/comfyui_adapter.py    | 221 ++++++++++++++++++++-
 .../src/chayuan_runtime/registry.py                |  13 ++
 libs/chayuan-runtime/tests/test_adapters_wire.py   | 131 ++++++++++++
 .../tests/test_runtime_adapter.py                  |  20 +-
 6 files changed, 478 insertions(+), 18 deletions(-)
```

## 2026-05-02 16:52:24 +0800 - chayuan-server

- Branch: `main`
- Summary: auto-recorded local changes before commit.

### Changed Files

- ` M libs/chayuan-server/chayuan/cli.py`
- ` M libs/chayuan-server/chayuan/cli_doctor.py`
- ` M libs/chayuan-server/chayuan/server/api_server/server_app.py`
- ` M libs/chayuan-server/chayuan/server/config_panel/local_service_detector.py`
- ` M libs/chayuan-server/chayuan/server/config_panel/service_page.py`
- ` M libs/chayuan-server/chayuan/settings.py`
- ` M libs/chayuan-server/chayuan/startup.py`
- `?? .github/workflows/build-installers.yml`
- `?? docker/dev-stack-alt-ports/.env.example`
- `?? docker/dev-stack-alt-ports/README.md`
- `?? docker/dev-stack-alt-ports/docker-compose.yml`
- `?? libs/chayuan-cli/pyproject.toml`
- `?? libs/chayuan-cli/src/chayuan_cli/__init__.py`
- `?? libs/chayuan-cli/src/chayuan_cli/__main__.py`
- `?? libs/chayuan-cli/src/chayuan_cli/commands/__init__.py`
- `?? libs/chayuan-cli/src/chayuan_cli/commands/doctor.py`
- `?? libs/chayuan-cli/src/chayuan_cli/commands/info.py`
- `?? libs/chayuan-cli/src/chayuan_cli/commands/model.py`
- `?? libs/chayuan-cli/src/chayuan_cli/commands/service.py`
- `?? libs/chayuan-cli/tests/test_cli.py`
- `?? libs/chayuan-core/pyproject.toml`
- `?? libs/chayuan-core/src/chayuan_core/__init__.py`
- `?? libs/chayuan-core/src/chayuan_core/__main__.py`
- `?? libs/chayuan-core/src/chayuan_core/config.py`
- `?? libs/chayuan-core/src/chayuan_core/events.py`
- `?? libs/chayuan-core/src/chayuan_core/logging_setup.py`
- `?? libs/chayuan-core/src/chayuan_core/paths.py`
- `?? libs/chayuan-core/src/chayuan_core/platform_info.py`
- `?? libs/chayuan-core/tests/test_core.py`
- `?? libs/chayuan-discovery/pyproject.toml`
- `?? libs/chayuan-discovery/src/chayuan_discovery/__init__.py`
- `?? libs/chayuan-discovery/src/chayuan_discovery/__main__.py`
- `?? libs/chayuan-discovery/src/chayuan_discovery/daemon.py`
- `?? libs/chayuan-discovery/src/chayuan_discovery/poller.py`
- `?? libs/chayuan-discovery/src/chayuan_discovery/watcher.py`
- `?? libs/chayuan-discovery/tests/test_discovery.py`
- `?? libs/chayuan-gateway/pyproject.toml`
- `?? libs/chayuan-gateway/src/chayuan_gateway/__init__.py`
- `?? libs/chayuan-gateway/src/chayuan_gateway/__main__.py`
- `?? libs/chayuan-gateway/src/chayuan_gateway/app.py`
- `?? libs/chayuan-gateway/src/chayuan_gateway/deps.py`
- `?? libs/chayuan-gateway/src/chayuan_gateway/middlewares/__init__.py`
- `?? libs/chayuan-gateway/src/chayuan_gateway/middlewares/auth.py`
- `?? libs/chayuan-gateway/src/chayuan_gateway/middlewares/ratelimit.py`
- `?? libs/chayuan-gateway/src/chayuan_gateway/routers/__init__.py`
- `?? libs/chayuan-gateway/src/chayuan_gateway/routers/admin.py`
- `?? libs/chayuan-gateway/src/chayuan_gateway/routers/audio.py`
- `?? libs/chayuan-gateway/src/chayuan_gateway/routers/chat.py`
- `?? libs/chayuan-gateway/src/chayuan_gateway/routers/embeddings.py`
- `?? libs/chayuan-gateway/src/chayuan_gateway/routers/images.py`
- `?? libs/chayuan-gateway/src/chayuan_gateway/routers/models.py`
- `?? libs/chayuan-gateway/src/chayuan_gateway/routers/ocr.py`
- `?? libs/chayuan-gateway/src/chayuan_gateway/routers/rerank.py`
- `?? libs/chayuan-gateway/src/chayuan_gateway/routers/system.py`
- `?? libs/chayuan-gateway/src/chayuan_gateway/routers/videos.py`
- `?? libs/chayuan-gateway/tests/test_gateway.py`
- `?? libs/chayuan-identify/pyproject.toml`
- `?? libs/chayuan-identify/src/chayuan_identify/__init__.py`
- `?? libs/chayuan-identify/src/chayuan_identify/__main__.py`
- `?? libs/chayuan-identify/src/chayuan_identify/identifier.py`
- `?? libs/chayuan-identify/src/chayuan_identify/rules.py`
- `?? libs/chayuan-identify/src/chayuan_identify/signatures.py`
- `?? libs/chayuan-identify/tests/test_identify.py`
- `?? libs/chayuan-modelmgr/pyproject.toml`
- `?? libs/chayuan-modelmgr/src/chayuan_modelmgr/__init__.py`
- `?? libs/chayuan-modelmgr/src/chayuan_modelmgr/downloader.py`
- `?? libs/chayuan-modelmgr/src/chayuan_modelmgr/importer.py`
- `?? libs/chayuan-modelmgr/src/chayuan_modelmgr/mirrors.py`
- `?? libs/chayuan-modelmgr/src/chayuan_modelmgr/progress.py`
- `?? libs/chayuan-modelmgr/src/chayuan_modelmgr/verifier.py`
- `?? libs/chayuan-modelmgr/tests/test_modelmgr.py`
- `?? libs/chayuan-packager/pyproject.toml`
- `?? libs/chayuan-packager/src/chayuan_packager/__init__.py`
- `?? libs/chayuan-packager/src/chayuan_packager/bundle.py`
- `?? libs/chayuan-packager/src/chayuan_packager/cli.py`
- `?? libs/chayuan-packager/src/chayuan_packager/filter.py`
- `?? libs/chayuan-packager/src/chayuan_packager/scan.py`
- `?? libs/chayuan-packager/src/chayuan_packager/targets/__init__.py`
- `?? libs/chayuan-packager/src/chayuan_packager/targets/linux.py`
- `?? libs/chayuan-packager/src/chayuan_packager/targets/mac.py`
- `?? libs/chayuan-packager/src/chayuan_packager/targets/win.py`
- `?? libs/chayuan-packager/src/chayuan_packager/verify.py`
- `?? libs/chayuan-packager/tests/test_packager.py`
- `?? libs/chayuan-preflight/pyproject.toml`
- `?? libs/chayuan-preflight/src/chayuan_preflight/__init__.py`
- `?? libs/chayuan-preflight/src/chayuan_preflight/av_checks.py`
- `?? libs/chayuan-preflight/src/chayuan_preflight/fixers/__init__.py`
- `?? libs/chayuan-preflight/src/chayuan_preflight/fixers/add-mp-exclusion.ps1`
- `?? libs/chayuan-preflight/src/chayuan_preflight/fixers/raise-ulimit.sh`
- `?? libs/chayuan-preflight/src/chayuan_preflight/gpu_checks.py`
- `?? libs/chayuan-preflight/src/chayuan_preflight/linux_checks.py`
- `?? libs/chayuan-preflight/src/chayuan_preflight/mac_checks.py`
- `?? libs/chayuan-preflight/src/chayuan_preflight/os_checks.py`
- `?? libs/chayuan-preflight/src/chayuan_preflight/port_checks.py`
- `?? libs/chayuan-preflight/src/chayuan_preflight/report.py`
- `?? libs/chayuan-preflight/tests/test_preflight.py`
- `?? libs/chayuan-registry/pyproject.toml`
- `?? libs/chayuan-registry/src/chayuan_registry/__init__.py`
- `?? libs/chayuan-registry/src/chayuan_registry/db.py`
- `?? libs/chayuan-registry/src/chayuan_registry/migrations/__init__.py`
- `?? libs/chayuan-registry/src/chayuan_registry/models.py`
- `?? libs/chayuan-registry/src/chayuan_registry/repository.py`
- `?? libs/chayuan-registry/tests/test_registry.py`
- `?? libs/chayuan-runtime/pyproject.toml`
- `?? libs/chayuan-runtime/src/chayuan_runtime/__init__.py`
- `?? libs/chayuan-runtime/src/chayuan_runtime/adapters/__init__.py`
- `?? libs/chayuan-runtime/src/chayuan_runtime/adapters/_http.py`
- `?? libs/chayuan-runtime/src/chayuan_runtime/adapters/comfyui_adapter.py`
- `?? libs/chayuan-runtime/src/chayuan_runtime/adapters/cosyvoice_adapter.py`
- `?? libs/chayuan-runtime/src/chayuan_runtime/adapters/funasr_adapter.py`
- `?? libs/chayuan-runtime/src/chayuan_runtime/adapters/infinity_adapter.py`
- `?? libs/chayuan-runtime/src/chayuan_runtime/adapters/llamacpp_adapter.py`
- `?? libs/chayuan-runtime/src/chayuan_runtime/adapters/ollama_adapter.py`
- `?? libs/chayuan-runtime/src/chayuan_runtime/adapters/paddleocr_adapter.py`
- `?? libs/chayuan-runtime/src/chayuan_runtime/adapters/piper_adapter.py`
- `?? libs/chayuan-runtime/src/chayuan_runtime/adapters/rapidocr_adapter.py`
- `?? libs/chayuan-runtime/src/chayuan_runtime/adapters/vllm_adapter.py`
- `?? libs/chayuan-runtime/src/chayuan_runtime/adapters/whispercpp_adapter.py`
- `?? libs/chayuan-runtime/src/chayuan_runtime/base.py`
- `?? libs/chayuan-runtime/src/chayuan_runtime/registry.py`
- `?? libs/chayuan-runtime/tests/test_adapters_wire.py`
- `?? libs/chayuan-runtime/tests/test_runtime.py`
- `?? libs/chayuan-server/chayuan/cli_ai_platform_doctor.py`
- `?? libs/chayuan-server/chayuan/cli_service.py`
- `?? libs/chayuan-server/chayuan/data/ai_platform_config/default.env`
- `?? libs/chayuan-server/chayuan/data/ai_platform_config/default.yaml`
- `?? libs/chayuan-server/chayuan/data/ai_platform_config/model_rules.yaml`
- `?? libs/chayuan-server/chayuan/data/ai_platform_config/profiles/cluster.yaml`
- `?? libs/chayuan-server/chayuan/data/ai_platform_config/profiles/server.yaml`
- `?? libs/chayuan-server/chayuan/data/ai_platform_config/profiles/standalone.yaml`
- `?? libs/chayuan-server/chayuan/data/ai_platform_config/releases.yaml`
- `?? libs/chayuan-server/chayuan/data/ai_platform_config/supervisor.yaml`
- `?? libs/chayuan-server/chayuan/server/ai_platform/__init__.py`
- `?? libs/chayuan-server/chayuan/server/ai_platform/event_bridge.py`
- `?? libs/chayuan-server/chayuan/server/ai_platform/repo_bridge.py`
- `?? libs/chayuan-server/chayuan/server/ai_platform/runtime_config.py`
- `?? libs/chayuan-server/chayuan/server/api_server/runtime_routes.py`
- `?? libs/chayuan-server/chayuan/server/model_registry/identifier.py`
- `?? libs/chayuan-server/chayuan/server/model_registry/local_index.py`
- `?? libs/chayuan-server/chayuan/server/model_registry/watcher.py`
- `?? libs/chayuan-server/chayuan/server/runtime/__init__.py`
- `?? libs/chayuan-server/chayuan/server/runtime/bootstrap.py`
- `?? libs/chayuan-server/chayuan/server/runtime/credentials.py`
- `?? libs/chayuan-server/chayuan/server/runtime/port_allocator.py`
- `?? libs/chayuan-server/chayuan/server/runtime/runtime_info.py`
- `?? libs/chayuan-server/chayuan/server/runtime/vendor_loader.py`
- `?? libs/chayuan-server/tests/unit_tests/ai_platform/__init__.py`
- `?? libs/chayuan-server/tests/unit_tests/ai_platform/test_event_bridge.py`
- `?? libs/chayuan-server/tests/unit_tests/ai_platform/test_integration_mount.py`
- `?? libs/chayuan-server/tests/unit_tests/ai_platform/test_repo_bridge.py`
- `?? libs/chayuan-server/tests/unit_tests/ai_platform/test_runtime_config.py`
- `?? libs/chayuan-server/tests/unit_tests/runtime/__init__.py`
- `?? libs/chayuan-server/tests/unit_tests/runtime/test_bootstrap.py`
- `?? libs/chayuan-server/tests/unit_tests/runtime/test_credentials.py`
- `?? libs/chayuan-server/tests/unit_tests/runtime/test_identifier.py`
- `?? libs/chayuan-server/tests/unit_tests/runtime/test_local_index.py`
- `?? libs/chayuan-server/tests/unit_tests/runtime/test_port_allocator.py`
- `?? libs/chayuan-server/tests/unit_tests/runtime/test_runtime_info.py`
- `?? libs/chayuan-server/tests/unit_tests/runtime/test_vendor_loader.py`
- `?? libs/chayuan-supervisor/pyproject.toml`
- `?? libs/chayuan-supervisor/src/chayuan_supervisor/__init__.py`
- `?? libs/chayuan-supervisor/src/chayuan_supervisor/__main__.py`
- `?? libs/chayuan-supervisor/src/chayuan_supervisor/credentials.py`
- `?? libs/chayuan-supervisor/src/chayuan_supervisor/health.py`
- `?? libs/chayuan-supervisor/src/chayuan_supervisor/manager.py`
- `?? libs/chayuan-supervisor/src/chayuan_supervisor/port_allocator.py`
- `?? libs/chayuan-supervisor/src/chayuan_supervisor/process.py`
- `?? libs/chayuan-supervisor/src/chayuan_supervisor/restart_policy.py`
- `?? libs/chayuan-supervisor/src/chayuan_supervisor/runtime_adapter.py`
- `?? libs/chayuan-supervisor/tests/test_runtime_adapter.py`
- `?? libs/chayuan-supervisor/tests/test_supervisor.py`
- `?? packaging/python312/.gitignore`
- `?? packaging/python312/README.md`
- `?? packaging/python312/chayuan_packaging/__init__.py`
- `?? packaging/python312/chayuan_packaging/fetchers/__init__.py`
- `?? packaging/python312/chayuan_packaging/fetchers/base.py`
- `?? packaging/python312/chayuan_packaging/fetchers/github.py`
- `?? packaging/python312/chayuan_packaging/fetchers/hf_mirror.py`
- `?? packaging/python312/chayuan_packaging/fetchers/http.py`
- `?? packaging/python312/chayuan_packaging/fetchers/local.py`
- `?? packaging/python312/chayuan_packaging/manifest.py`
- `?? packaging/python312/chayuan_packaging/pack.py`
- `?? packaging/python312/chayuan_packaging/platform_info.py`
- `?? packaging/python312/chayuan_packaging/targets/__init__.py`
- `?? packaging/python312/chayuan_packaging/targets/linux.py`
- `?? packaging/python312/chayuan_packaging/targets/mac.py`
- `?? packaging/python312/chayuan_packaging/targets/windows.py`
- `?? packaging/python312/chayuan_packaging/unpack.py`
- `?? packaging/python312/layout.yaml`
- `?? packaging/python312/pyproject.toml`
- `?? scripts/ai_platform/dev-setup.sh`
- `?? scripts/ai_platform/install-linux.sh`
- `?? scripts/ai_platform/install-mac.sh`
- `?? scripts/ai_platform/install-windows.ps1`
- `?? scripts/ai_platform/start.bat`
- `?? scripts/ai_platform/start.ps1`
- `?? scripts/ai_platform/start.sh`
- `?? scripts/dev_setup_all.sh`
- `?? scripts/install_ai_platform.ps1`
- `?? scripts/install_ai_platform.sh`
- `?? vendor/README.md`
- `?? vendor/runtimes/README.md`
- `?? vendor/services/README.md`

### Diff Stat

```text
 libs/chayuan-server/chayuan/cli.py                 | 19 +++++
 libs/chayuan-server/chayuan/cli_doctor.py          | 10 +++
 .../chayuan/server/api_server/server_app.py        | 18 ++++
 .../server/config_panel/local_service_detector.py  | 13 +--
 .../chayuan/server/config_panel/service_page.py    | 98 ++++++++++++++++++++++
 libs/chayuan-server/chayuan/settings.py            | 52 ++++++++++++
 libs/chayuan-server/chayuan/startup.py             | 21 +++++
 7 files changed, 226 insertions(+), 5 deletions(-)
```

## 2026-05-02 11:06:03 +0800 - chayuan-server

- Branch: `main`
- Summary: auto-recorded local changes before commit.

### Changed Files

- ` M libs/chayuan-server/chayuan/server/api_server/model_registry_routes.py`
- ` M libs/chayuan-server/chayuan/server/model_registry/catalog.py`

### Diff Stat

```text
 .../server/api_server/model_registry_routes.py     |   3 +-
 .../chayuan/server/model_registry/catalog.py       | 385 +++++++++++++++++++--
 2 files changed, 367 insertions(+), 21 deletions(-)
```

## 2026-05-02 10:47:21 +0800 - chayuan-server

- Branch: `main`
- Summary: auto-recorded local changes before commit.

### Changed Files

- ` M libs/chayuan-server/chayuan/server/model_registry/catalog.py`

### Diff Stat

```text
 .../chayuan/server/model_registry/catalog.py             | 16 +++++++++++++++-
 1 file changed, 15 insertions(+), 1 deletion(-)
```

## 2026-05-02 10:42:50 +0800 - chayuan-server

- Branch: `main`
- Summary: auto-recorded local changes before commit.

### Changed Files

- ` M libs/chayuan-server/chayuan/server/api_server/model_registry_routes.py`
- ` M libs/chayuan-server/chayuan/server/model_registry/catalog.py`

### Diff Stat

```text
 .../server/api_server/model_registry_routes.py     |  25 +++
 .../chayuan/server/model_registry/catalog.py       | 174 ++++++++++++++++++++-
 2 files changed, 197 insertions(+), 2 deletions(-)
```

## 2026-05-02 10:36:41 +0800 - chayuan-server

- Branch: `main`
- Summary: auto-recorded local changes before commit.

### Changed Files

- ` M libs/chayuan-server/chayuan/server/api_server/model_registry_routes.py`
- ` M libs/chayuan-server/chayuan/server/model_registry/catalog.py`

### Diff Stat

```text
 .../server/api_server/model_registry_routes.py     |  2 +-
 .../chayuan/server/model_registry/catalog.py       | 40 +++++++++++++++++-----
 2 files changed, 33 insertions(+), 9 deletions(-)
```

## 2026-05-02 10:30:43 +0800 - chayuan-server

- Branch: `main`
- Summary: auto-recorded local changes before commit.

### Changed Files

- ` M libs/chayuan-server/chayuan/server/api_server/model_registry_routes.py`
- ` M libs/chayuan-server/chayuan/server/model_registry/catalog.py`

### Diff Stat

```text
 .../server/api_server/model_registry_routes.py     |  32 ++-
 .../chayuan/server/model_registry/catalog.py       | 264 +++++++++++++++++++--
 2 files changed, 272 insertions(+), 24 deletions(-)
```

## 2026-05-02 10:13:17 +0800 - chayuan-server

- Branch: `main`
- Summary: auto-recorded local changes before commit.

### Changed Files

- ` M libs/chayuan-server/chayuan/server/api_server/server_app.py`

### Diff Stat

```text
 libs/chayuan-server/chayuan/server/api_server/server_app.py | 1 +
 1 file changed, 1 insertion(+)
```

## 2026-05-02 09:59:19 +0800 - chayuan-server

- Branch: `main`
- Summary: auto-recorded local changes before commit.

### Changed Files

- ` M libs/chayuan-server/chayuan/server/model_registry/catalog.py`
- ` M libs/chayuan-server/chayuan/server/model_registry/crawler.py`

### Diff Stat

```text
 .../chayuan/server/model_registry/catalog.py       | 47 +++++++++++++++-------
 .../chayuan/server/model_registry/crawler.py       | 37 ++++++++++++++++-
 2 files changed, 68 insertions(+), 16 deletions(-)
```

## 2026-05-02 09:56:49 +0800 - chayuan-server

- Branch: `main`
- Summary: auto-recorded local changes before commit.

### Changed Files

- ` M libs/chayuan-server/chayuan/server/api_server/model_registry_routes.py`
- ` M libs/chayuan-server/chayuan/server/model_registry/catalog.py`
- `?? libs/chayuan-server/chayuan/server/model_registry/crawler.py`

### Diff Stat

```text
 .../server/api_server/model_registry_routes.py     |  25 ++++
 .../chayuan/server/model_registry/catalog.py       | 133 ++++++++++++++++++++-
 2 files changed, 155 insertions(+), 3 deletions(-)
```

## 2026-05-02 09:32:01 +0800 - chayuan-server

- Branch: `main`
- Summary: auto-recorded local changes before commit.

### Changed Files

- ` M libs/chayuan-server/chayuan/server/api_server/model_registry_routes.py`
- ` M libs/chayuan-server/chayuan/server/config_center/store.py`

### Diff Stat

```text
 .../server/api_server/model_registry_routes.py     |  2 +-
 .../chayuan/server/config_center/store.py          | 36 +++++++++++++++++++---
 2 files changed, 33 insertions(+), 5 deletions(-)
```

## 2026-05-02 09:22:16 +0800 - chayuan-server

- Branch: `main`
- Summary: auto-recorded local changes before commit.

### Changed Files

- ` M libs/chayuan-server/chayuan/server/model_registry/catalog.py`

### Diff Stat

```text
 .../chayuan/server/model_registry/catalog.py       | 263 ++++++++++++++++++++-
 1 file changed, 262 insertions(+), 1 deletion(-)
```

## 2026-05-02 09:20:01 +0800 - chayuan-server

- Branch: `main`
- Summary: auto-recorded local changes before commit.

### Changed Files

- ` M libs/chayuan-server/chayuan/server/api_server/server_app.py`
- `?? libs/chayuan-server/chayuan/server/api_server/model_registry_routes.py`
- `?? libs/chayuan-server/chayuan/server/model_registry/catalog.py`

### Diff Stat

```text
 libs/chayuan-server/chayuan/server/api_server/server_app.py | 2 ++
 1 file changed, 2 insertions(+)
```

## 2026-05-02 08:31:32 +0800 - chayuan-server

- Branch: `main`
- Summary: auto-recorded local changes before commit.

### Changed Files

- ` M libs/chayuan-server/chayuan/server/config_panel/model_config.py`

### Diff Stat

```text
 .../chayuan/server/config_panel/model_config.py    | 142 +++++----------------
 1 file changed, 35 insertions(+), 107 deletions(-)
```

## 2026-05-02 08:19:03 +0800 - chayuan-server

- Branch: `main`
- Summary: auto-recorded local changes before commit.

### Changed Files

- ` M libs/chayuan-server/chayuan/server/config_panel/image_model_panel.py`

### Diff Stat

```text
 .../server/config_panel/image_model_panel.py       | 113 +++++++++++++++++++--
 1 file changed, 105 insertions(+), 8 deletions(-)
```

## 2026-05-02 08:14:48 +0800 - chayuan-server

- Branch: `main`
- Summary: auto-recorded local changes before commit.

### Changed Files

- ` M libs/chayuan-server/chayuan/server/config_panel/image_model_panel.py`
- ` M libs/chayuan-server/chayuan/server/config_panel/model_config.py`
- ` M libs/chayuan-server/chayuan/server/image_source/model_manager.py`

### Diff Stat

```text
 .../server/config_panel/image_model_panel.py       |   5 +-
 .../chayuan/server/config_panel/model_config.py    | 142 ++++++++++++++++-----
 .../chayuan/server/image_source/model_manager.py   |  18 ++-
 3 files changed, 121 insertions(+), 44 deletions(-)
```

## 2026-05-02 08:06:30 +0800 - chayuan-server

- Branch: `main`
- Summary: auto-recorded local changes before commit.

### Changed Files

- ` M libs/chayuan-server/chayuan/server/config_panel/image_model_panel.py`
- ` M libs/chayuan-server/chayuan/server/image_source/model_manager.py`
- ` M libs/chayuan-server/chayuan/webui_pages/knowledge_source/settings.py`

### Diff Stat

```text
 .../server/config_panel/image_model_panel.py       | 43 +++++++++++++++-------
 .../chayuan/server/image_source/model_manager.py   | 17 +++++++--
 .../webui_pages/knowledge_source/settings.py       |  6 +--
 3 files changed, 46 insertions(+), 20 deletions(-)
```

## 2026-05-01 20:32:05 +0800 - chayuan-server

- Branch: `main`
- Summary: auto-recorded local changes before commit.

### Changed Files

- ` M libs/chayuan-server/chayuan/server/config_panel/dashboard.py`
- `?? libs/chayuan-server/chayuan/server/config_panel/local_service_catalog.py`
- `?? libs/chayuan-server/chayuan/server/config_panel/local_service_detector.py`
- `?? libs/chayuan-server/chayuan/server/config_panel/service_checks.py`
- `?? libs/chayuan-server/chayuan/server/config_panel/service_config_page.py`
- `?? libs/chayuan-server/chayuan/server/config_panel/service_page.py`

### Diff Stat

```text
 .../chayuan/server/config_panel/dashboard.py       | 272 ++++++++++++++++++---
 1 file changed, 241 insertions(+), 31 deletions(-)
```

## 2026-05-01 19:44:54 +0800 - chayuan-server

- Branch: `main`
- Summary: auto-recorded local changes before commit.

### Changed Files

- ` M libs/chayuan-server/chayuan/server/api_server/office_routes.py`

### Diff Stat

```text
 .../chayuan/server/api_server/office_routes.py     | 150 +++++++++++++++++++--
 1 file changed, 140 insertions(+), 10 deletions(-)
```

## 2026-05-01 19:39:04 +0800 - chayuan-server

- Branch: `main`
- Summary: auto-recorded local changes before commit.

### Changed Files

- ` M libs/chayuan-server/chayuan/img/model_logos/anthropic.png`
- `?? libs/chayuan-server/chayuan/img/model_logos/claude.png`
- `?? libs/chayuan-server/chayuan/img/model_logos/claude_dark.png`

### Diff Stat

```text
 .../chayuan/img/model_logos/anthropic.png            | Bin 4298 -> 28361 bytes
 1 file changed, 0 insertions(+), 0 deletions(-)
```

## 2026-05-01 19:19:39 +0800 - chayuan-server

- Branch: `main`
- Summary: auto-recorded local changes before commit.

### Changed Files

- ` M libs/chayuan-server/chayuan/server/api_server/office_assistant_runtime.py`
- ` M libs/chayuan-server/chayuan/server/api_server/office_routes.py`

### Diff Stat

```text
 .../server/api_server/office_assistant_runtime.py  | 24 +++++++++++++++++++---
 .../chayuan/server/api_server/office_routes.py     |  2 +-
 2 files changed, 22 insertions(+), 4 deletions(-)
```

## 2026-05-01 18:32:47 +0800 - chayuan-server

- Branch: `main`
- Summary: auto-recorded local changes before commit.

### Changed Files

- ` M libs/chayuan-server/chayuan/server/api_server/office_routes.py`

### Diff Stat

```text
 .../chayuan/server/api_server/office_routes.py     | 27 +++++++++-------------
 1 file changed, 11 insertions(+), 16 deletions(-)
```

## 2026-05-01 18:10:14 +0800 - chayuan-server

- Branch: `main`
- Summary: auto-recorded local changes before commit.

### Changed Files

- ` M libs/chayuan-server/chayuan/server/api_server/office_assistant_runtime.py`
- ` M libs/chayuan-server/chayuan/server/api_server/office_routes.py`

### Diff Stat

```text
 .../server/api_server/office_assistant_runtime.py  | 87 ++++++++++++++++++--
 .../chayuan/server/api_server/office_routes.py     | 95 ++++++++++++++++++++++
 2 files changed, 176 insertions(+), 6 deletions(-)
```

## 2026-05-01 17:54:17 +0800 - chayuan-server

- Branch: `main`
- Summary: auto-recorded local changes before commit.

### Changed Files

- ` M libs/chayuan-server/chayuan/server/api_server/office_assistant_runtime.py`
- ` M libs/chayuan-server/chayuan/server/api_server/office_routes.py`

### Diff Stat

```text
 .../server/api_server/office_assistant_runtime.py  | 25 +++++++++--
 .../chayuan/server/api_server/office_routes.py     | 50 +++++++++++++++++++---
 2 files changed, 66 insertions(+), 9 deletions(-)
```

## 2026-05-01 17:31:34 +0800 - chayuan-server

- Branch: `main`
- Summary: auto-recorded local changes before commit.

### Changed Files

- ` M libs/chayuan-server/chayuan/server/api_server/office_assistant_runtime.py`

### Diff Stat

```text
 .../server/api_server/office_assistant_runtime.py  | 58 ++++++++++++++++++++--
 1 file changed, 53 insertions(+), 5 deletions(-)
```

## 2026-05-01 17:17:51 +0800 - chayuan-server

- Branch: `main`
- Summary: auto-recorded local changes before commit.

### Changed Files

- ` M libs/chayuan-server/chayuan/server/api_server/office_assistant_runtime.py`
- ` M libs/chayuan-server/chayuan/server/api_server/office_routes.py`

### Diff Stat

```text
 .../chayuan/server/api_server/office_assistant_runtime.py      | 10 ++++++++++
 libs/chayuan-server/chayuan/server/api_server/office_routes.py | 10 +++++++---
 2 files changed, 17 insertions(+), 3 deletions(-)
```

## 2026-05-01 17:11:51 +0800 - chayuan-server

- Branch: `main`
- Summary: auto-recorded local changes before commit.

### Changed Files

- ` M libs/chayuan-server/chayuan/server/api_server/office_routes.py`

### Diff Stat

```text
 .../chayuan/server/api_server/office_routes.py              | 13 ++++++++++++-
 1 file changed, 12 insertions(+), 1 deletion(-)
```

## 2026-05-01 16:45:11 +0800 - chayuan-server

- Branch: `main`
- Summary: auto-recorded local changes before commit.

### Changed Files

- ` M libs/chayuan-server/chayuan/server/api_server/office_assistant_runtime.py`
- ` M libs/chayuan-server/chayuan/server/api_server/office_routes.py`

### Diff Stat

```text
 .../server/api_server/office_assistant_runtime.py  |  1 +
 .../chayuan/server/api_server/office_routes.py     | 64 +++++++++++++++++++++-
 2 files changed, 64 insertions(+), 1 deletion(-)
```

## 2026-05-01 16:23:56 +0800 - chayuan-server

- Branch: `main`
- Summary: auto-recorded local changes before commit.

### Changed Files

- ` M libs/chayuan-server/chayuan/server/api_server/office_assistant_runtime.py`

### Diff Stat

```text
 .../chayuan/server/api_server/office_assistant_runtime.py               | 2 ++
 1 file changed, 2 insertions(+)
```

## 2026-05-01 16:18:32 +0800 - chayuan-server

- Branch: `main`
- Summary: auto-recorded local changes before commit.

### Changed Files

- ` M libs/chayuan-server/chayuan/server/api_server/office_assistant_runtime.py`

### Diff Stat

```text
 .../server/api_server/office_assistant_runtime.py  | 38 ++++++++++++++++++++--
 1 file changed, 36 insertions(+), 2 deletions(-)
```

## 2026-05-01 16:10:52 +0800 - chayuan-server

- Branch: `main`
- Summary: auto-recorded local changes before commit.

### Changed Files

- ` M libs/chayuan-server/chayuan/server/file_rag/hybrid_service.py`

### Diff Stat

```text
 .../chayuan/server/file_rag/hybrid_service.py      | 37 +++++++++++++++++-----
 1 file changed, 29 insertions(+), 8 deletions(-)
```

## 2026-05-01 16:05:11 +0800 - chayuan-server

- Branch: `main`
- Summary: auto-recorded local changes before commit.

### Changed Files

- ` M libs/chayuan-server/chayuan/server/api_server/office_assistant_runtime.py`
- ` M libs/chayuan-server/chayuan/server/api_server/office_routes.py`

### Diff Stat

```text
 .../server/api_server/office_assistant_runtime.py  | 104 ++++++++++++++++++++-
 .../chayuan/server/api_server/office_routes.py     |   1 +
 2 files changed, 101 insertions(+), 4 deletions(-)
```

## 2026-05-01 15:58:39 +0800 - chayuan-server

- Branch: `main`
- Summary: auto-recorded local changes before commit.

### Changed Files

- ` M libs/chayuan-server/chayuan/server/api_server/office_assistant_runtime.py`
- ` M libs/chayuan-server/chayuan/server/api_server/office_routes.py`

### Diff Stat

```text
 .../server/api_server/office_assistant_runtime.py  | 35 ++++++++++++++++++++--
 .../chayuan/server/api_server/office_routes.py     | 19 ++++++++++--
 2 files changed, 50 insertions(+), 4 deletions(-)
```

## 2026-05-01 15:46:34 +0800 - chayuan-server

- Branch: `main`
- Summary: auto-recorded local changes before commit.

### Changed Files

- ` M libs/chayuan-server/chayuan/server/api_server/office_assistant_runtime.py`
- ` M libs/chayuan-server/chayuan/server/api_server/office_routes.py`

### Diff Stat

```text
 .../server/api_server/office_assistant_runtime.py   | 21 ++++++++++++++++++++-
 .../chayuan/server/api_server/office_routes.py      | 17 ++++++++++++++++-
 2 files changed, 36 insertions(+), 2 deletions(-)
```

## 2026-05-01 15:46:02 +0800 - chayuan-server

- Branch: `main`
- Summary: auto-recorded local changes before commit.

### Changed Files

- ` M libs/chayuan-server/chayuan/server/api_server/office_assistant_runtime.py`
- ` M libs/chayuan-server/chayuan/server/api_server/office_routes.py`

### Diff Stat

```text
 .../server/api_server/office_assistant_runtime.py  | 149 +++++++++++++++++++++
 .../chayuan/server/api_server/office_routes.py     |   8 ++
 2 files changed, 157 insertions(+)
```

## 2026-05-01 15:42:07 +0800 - chayuan-server

- Branch: `main`
- Summary: auto-recorded local changes before commit.

### Changed Files

- ` M libs/chayuan-server/chayuan/server/api_server/office_assistant_runtime.py`
- ` M libs/chayuan-server/chayuan/server/api_server/office_routes.py`

### Diff Stat

```text
 .../server/api_server/office_assistant_runtime.py  | 253 ++++++++++++++++++++-
 .../chayuan/server/api_server/office_routes.py     |  28 +++
 2 files changed, 278 insertions(+), 3 deletions(-)
```

## 2026-05-01 15:25:00 +0800 - chayuan-server

- Branch: `main`
- Summary: auto-recorded local changes before commit.

### Changed Files

- ` M libs/chayuan-server/chayuan/server/api_server/office_assistant_runtime.py`
- ` M libs/chayuan-server/chayuan/server/api_server/office_routes.py`

### Diff Stat

```text
 .../server/api_server/office_assistant_runtime.py  | 16 ++++++++-----
 .../chayuan/server/api_server/office_routes.py     | 26 ++++++++++++++++++++++
 2 files changed, 37 insertions(+), 5 deletions(-)
```

## 2026-05-01 15:24:23 +0800 - chayuan-server

- Branch: `main`
- Summary: auto-recorded local changes before commit.

### Changed Files

- ` M libs/chayuan-server/chayuan/server/api_server/office_routes.py`
- `?? libs/chayuan-server/chayuan/server/api_server/office_assistant_runtime.py`

### Diff Stat

```text
 .../chayuan/server/api_server/office_routes.py     | 84 ++++++++++++++--------
 1 file changed, 53 insertions(+), 31 deletions(-)
```

## 2026-05-01 15:12:13 +0800 - chayuan-server

- Branch: `main`
- Summary: auto-recorded local changes before commit.

### Changed Files

- ` M libs/chayuan-server/chayuan/server/api_server/office_routes.py`

### Diff Stat

```text
 .../chayuan/server/api_server/office_routes.py     | 105 ++++++++++++++++++++-
 1 file changed, 104 insertions(+), 1 deletion(-)
```

## 2026-05-01 14:53:39 +0800 - chayuan-server

- Branch: `main`
- Summary: auto-recorded local changes before commit.

### Changed Files

- ` M libs/chayuan-server/chayuan/server/api_server/office_routes.py`

### Diff Stat

```text
 .../chayuan/server/api_server/office_routes.py             | 14 ++++++++++++++
 1 file changed, 14 insertions(+)
```

## 2026-05-01 14:36:23 +0800 - chayuan-server

- Branch: `main`
- Summary: auto-recorded local changes before commit.

### Changed Files

- ` M docker/dev-stack/.env.example`
- ` M docker/dev-stack/docker-compose.yml`
- ` M libs/chayuan-server/chayuan/server/api_server/office_routes.py`

### Diff Stat

```text
 docker/dev-stack/.env.example                                  | 9 +++++++++
 docker/dev-stack/docker-compose.yml                            | 2 ++
 libs/chayuan-server/chayuan/server/api_server/office_routes.py | 4 ++++
 3 files changed, 15 insertions(+)
```

## 2026-05-01 12:37:24 +0800 - chayuan-server

- Branch: `main`
- Summary: auto-recorded local changes before commit.

### Changed Files

- ` M libs/chayuan-server/chayuan/server/chat/graph/graph.py`
- ` M libs/chayuan-server/chayuan/server/chat/graph/nodes.py`
- ` M libs/chayuan-server/chayuan/server/chat/graph/runner.py`
- ` M libs/chayuan-server/chayuan/server/db/repository/data_mount_repository.py`

### Diff Stat

```text
 .../chayuan/server/chat/graph/graph.py             |  12 ++-
 .../chayuan/server/chat/graph/nodes.py             | 108 ++++++++++++++++++++-
 .../chayuan/server/chat/graph/runner.py            |  10 ++
 .../server/db/repository/data_mount_repository.py  |   1 -
 4 files changed, 127 insertions(+), 4 deletions(-)
```

## 2026-05-01 12:34:41 +0800 - chayuan-server

- Branch: `main`
- Summary: auto-recorded local changes before commit.

### Changed Files

- ` M libs/chayuan-server/chayuan/server/api_server/annotation_routes.py`
- ` M libs/chayuan-server/chayuan/server/api_server/server_app.py`
- ` M libs/chayuan-server/chayuan/server/chat/graph/state.py`
- ` M libs/chayuan-server/chayuan/server/db/migrations/__init__.py`
- `?? libs/chayuan-server/chayuan/server/api_server/data_mount_routes.py`
- `?? libs/chayuan-server/chayuan/server/chat/mounts/__init__.py`
- `?? libs/chayuan-server/chayuan/server/chat/mounts/service.py`
- `?? libs/chayuan-server/chayuan/server/db/alembic/versions/0019_data_mount.py`
- `?? libs/chayuan-server/chayuan/server/db/models/data_mount_model.py`
- `?? libs/chayuan-server/chayuan/server/db/repository/data_mount_repository.py`

### Diff Stat

```text
 .../chayuan/server/api_server/annotation_routes.py | 58 ++++++++++++++++++++++
 .../chayuan/server/api_server/server_app.py        |  2 +
 .../chayuan/server/chat/graph/state.py             |  8 +++
 .../chayuan/server/db/migrations/__init__.py       | 17 +++++++
 4 files changed, 85 insertions(+)
```

## 2026-05-01 12:22:07 +0800 - chayuan-server

- Branch: `main`
- Summary: auto-recorded local changes before commit.

### Changed Files

- ` M libs/chayuan-server/chayuan/server/api_server/annotation_routes.py`

### Diff Stat

```text
 libs/chayuan-server/chayuan/server/api_server/annotation_routes.py | 2 ++
 1 file changed, 2 insertions(+)
```

## 2026-05-01 12:09:32 +0800 - chayuan-server

- Branch: `main`
- Summary: auto-recorded local changes before commit.

### Changed Files

- ` M libs/chayuan-server/chayuan/server/api_server/knowledge_universe_routes.py`
- ` M libs/chayuan-server/chayuan/server/api_server/office_routes.py`

### Diff Stat

```text
 .../server/api_server/knowledge_universe_routes.py | 121 ++++++++++++++++++++-
 .../chayuan/server/api_server/office_routes.py     |  40 +++++--
 2 files changed, 152 insertions(+), 9 deletions(-)
```

## 2026-05-01 11:52:22 +0800 - chayuan-server

- Branch: `main`
- Summary: auto-recorded local changes before commit.

### Changed Files

- ` M libs/chayuan-server/chayuan/server/api_server/office_routes.py`

### Diff Stat

```text
 .../chayuan/server/api_server/office_routes.py     | 33 ++++++++++++++++++++--
 1 file changed, 30 insertions(+), 3 deletions(-)
```

## 2026-05-01 11:21:25 +0800 - chayuan-server

- Branch: `main`
- Summary: auto-recorded local changes before commit.

### Changed Files

- ` M libs/chayuan-server/chayuan/server/api_server/annotation_routes.py`
- ` M libs/chayuan-server/chayuan/server/api_server/knowledge_universe_routes.py`
- ` M libs/chayuan-server/chayuan/server/api_server/office_routes.py`
- ` M libs/chayuan-server/chayuan/server/db/repository/annotation_repository.py`

### Diff Stat

```text
 .../chayuan/server/api_server/annotation_routes.py |  25 ++++
 .../server/api_server/knowledge_universe_routes.py |  44 ++++++
 .../chayuan/server/api_server/office_routes.py     |  50 ++++++-
 .../server/db/repository/annotation_repository.py  | 161 +++++++++++++++++++++
 4 files changed, 276 insertions(+), 4 deletions(-)
```

## 2026-05-01 11:06:12 +0800 - chayuan-server

- Branch: `main`
- Summary: auto-recorded local changes before commit.

### Changed Files

- ` M libs/chayuan-server/chayuan/cli.py`
- ` M libs/chayuan-server/chayuan/server/api_server/kb_routes.py`
- ` M libs/chayuan-server/chayuan/server/config_panel/schema.py`
- ` M libs/chayuan-server/chayuan/server/file_rag/retrieval_pipeline/rewriter.py`
- ` M libs/chayuan-server/chayuan/server/ingest_queue/__init__.py`
- ` M libs/chayuan-server/chayuan/server/ingest_queue/backend.py`
- ` M libs/chayuan-server/chayuan/server/ingest_queue/tasks.py`
- ` M libs/chayuan-server/chayuan/settings.py`

### Diff Stat

```text
 libs/chayuan-server/chayuan/cli.py                 |   5 +-
 .../chayuan/server/api_server/kb_routes.py         |  19 +++
 .../chayuan/server/config_panel/schema.py          |  50 ++++++-
 .../server/file_rag/retrieval_pipeline/rewriter.py |  80 +++++++++-
 .../chayuan/server/ingest_queue/__init__.py        |   7 +-
 .../chayuan/server/ingest_queue/backend.py         | 166 ++++++++++++++++++++-
 .../chayuan/server/ingest_queue/tasks.py           |  48 +++++-
 libs/chayuan-server/chayuan/settings.py            |  21 +++
 8 files changed, 379 insertions(+), 17 deletions(-)
```

## 2026-05-01 10:55:11 +0800 - chayuan-server

- Branch: `main`
- Summary: auto-recorded local changes before commit.

### Changed Files

- ` M libs/chayuan-server/chayuan/server/api_server/annotation_routes.py`

### Diff Stat

```text
 .../chayuan/server/api_server/annotation_routes.py | 52 ++++++++++++++++++++++
 1 file changed, 52 insertions(+)
```

## 2026-05-01 10:47:19 +0800 - chayuan-server

- Branch: `main`
- Summary: auto-recorded local changes before commit.

### Changed Files

- ` M libs/chayuan-server/chayuan/server/chat/handlers/kb.py`

### Diff Stat

```text
 .../chayuan/server/chat/handlers/kb.py             | 49 +++++++++++++++++++++-
 1 file changed, 48 insertions(+), 1 deletion(-)
```

## 2026-05-01 10:38:46 +0800 - chayuan-server

- Branch: `main`
- Summary: auto-recorded local changes before commit.

### Changed Files

- ` M libs/chayuan-server/chayuan/server/api_server/kb_routes.py`
- ` M libs/chayuan-server/chayuan/server/api_server/office_routes.py`

### Diff Stat

```text
 .../chayuan/server/api_server/kb_routes.py         | 41 +++++++++++++++++++++-
 .../chayuan/server/api_server/office_routes.py     | 18 ++++++++--
 2 files changed, 56 insertions(+), 3 deletions(-)
```

## 2026-05-01 10:36:25 +0800 - chayuan-server

- Branch: `main`
- Summary: auto-recorded local changes before commit.

### Changed Files

- ` M libs/chayuan-server/chayuan/server/api_server/knowledge_universe_routes.py`

### Diff Stat

```text
 .../server/api_server/knowledge_universe_routes.py | 40 ++++++++++++++++++++--
 1 file changed, 38 insertions(+), 2 deletions(-)
```

## 2026-05-01 10:25:45 +0800 - chayuan-server

- Branch: `main`
- Summary: auto-recorded local changes before commit.

### Changed Files

- ` M libs/chayuan-server/chayuan/server/ingest_queue/tasks.py`

### Diff Stat

```text
 .../chayuan/server/ingest_queue/tasks.py           | 77 ++++++++++++++++------
 1 file changed, 56 insertions(+), 21 deletions(-)
```

## 2026-05-01 10:05:10 +0800 - chayuan-server

- Branch: `main`
- Summary: auto-recorded local changes before commit.

### Changed Files

- ` M libs/chayuan-server/chayuan/server/api_server/annotation_routes.py`

### Diff Stat

```text
 .../chayuan/server/api_server/annotation_routes.py | 84 ++++++++++++++++++++++
 1 file changed, 84 insertions(+)
```

## 2026-05-01 09:57:35 +0800 - chayuan-server

- Branch: `main`
- Summary: auto-recorded local changes before commit.

### Changed Files

- ` M libs/chayuan-server/chayuan/server/config_panel/dashboard.py`
- ` M libs/chayuan-server/chayuan/server/config_panel/schema.py`
- ` M libs/chayuan-server/chayuan/settings.py`

### Diff Stat

```text
 .../chayuan/server/config_panel/dashboard.py       |  5 +++++
 .../chayuan/server/config_panel/schema.py          | 22 +++++++++++++++++++---
 libs/chayuan-server/chayuan/settings.py            |  8 ++++++++
 3 files changed, 32 insertions(+), 3 deletions(-)
```

## 2026-05-01 09:47:48 +0800 - chayuan-server

- Branch: `main`
- Summary: auto-recorded local changes before commit.

### Changed Files

- ` M libs/chayuan-server/chayuan/server/api_server/office_routes.py`

### Diff Stat

```text
 .../chayuan/server/api_server/office_routes.py     | 89 +++++++++++++++++++++-
 1 file changed, 88 insertions(+), 1 deletion(-)
```

## 2026-05-01 09:28:01 +0800 - chayuan-server

- Branch: `main`
- Summary: auto-recorded local changes before commit.

### Changed Files

- ` M libs/chayuan-server/chayuan/server/api_server/office_routes.py`
- ` M libs/chayuan-server/chayuan/server/file_rag/document_loaders/mydocloader.py`

### Diff Stat

```text
 .../chayuan/server/api_server/office_routes.py     | 91 +++++++++++++++++++++-
 .../file_rag/document_loaders/mydocloader.py       |  2 +
 2 files changed, 90 insertions(+), 3 deletions(-)
```

## 2026-05-01 09:18:49 +0800 - chayuan-server

- Branch: `main`
- Summary: auto-recorded local changes before commit.

### Changed Files

- ` M libs/chayuan-server/chayuan/server/file_rag/document_loaders/mydocloader.py`

### Diff Stat

```text
 .../file_rag/document_loaders/mydocloader.py       | 95 ++++++++++++++++++----
 1 file changed, 80 insertions(+), 15 deletions(-)
```

## 2026-05-01 09:02:34 +0800 - chayuan-server

- Branch: `main`
- Summary: auto-recorded local changes before commit.

### Changed Files

- ` M docker/docker-compose.yaml`
- ` M docker/prod/README.md`
- ` M docker/prod/chayuan/basic_settings.yaml`
- ` M docker/prod/docker-compose.yaml`
- ` M libs/chayuan-server/chayuan/cli.py`
- ` M libs/chayuan-server/chayuan/cli_admin.py`
- ` M libs/chayuan-server/chayuan/server/api_server/storage_routes.py`
- ` M libs/chayuan-server/chayuan/server/config_panel/api_gate.py`
- ` M libs/chayuan-server/chayuan/server/config_panel/dashboard.py`
- ` M libs/chayuan-server/chayuan/server/config_panel/health.py`
- ` M libs/chayuan-server/chayuan/server/config_panel/kb_manage_page.py`
- ` M libs/chayuan-server/chayuan/server/config_panel/monitoring.py`
- ` M libs/chayuan-server/chayuan/server/config_panel/performance_page.py`
- ` M libs/chayuan-server/chayuan/server/config_panel/schema.py`
- ` M libs/chayuan-server/chayuan/server/config_panel/storage_config.py`
- ` M libs/chayuan-server/chayuan/server/utils.py`
- ` M libs/chayuan-server/chayuan/tray/app_generic.py`
- ` M libs/chayuan-server/chayuan/tray/app_mac.py`
- ` M libs/chayuan-server/chayuan/tray/common.py`
- ` M libs/chayuan-server/chayuan/webui.py`
- ` M libs/chayuan-server/chayuan/webui_pages/knowledge_source/settings.py`
- ` D libs/chayuan-server/tests/unit_tests/test_service_config.py`
- ` M libs/chayuan-server/tests/unit_tests/test_stop_command.py`
- ` M libs/chayuan-server/tests/unit_tests/test_webui_menu_slimmed.py`
- ` M scripts/e2e_test.py`

### Diff Stat

```text
 docker/docker-compose.yaml                         |   1 -
 docker/prod/README.md                              |  11 +-
 docker/prod/chayuan/basic_settings.yaml            |   6 +-
 docker/prod/docker-compose.yaml                    |  13 +-
 libs/chayuan-server/chayuan/cli.py                 |  36 ++----
 libs/chayuan-server/chayuan/cli_admin.py           |  14 +--
 .../chayuan/server/api_server/storage_routes.py    |   6 +-
 .../chayuan/server/config_panel/api_gate.py        |   2 +-
 .../chayuan/server/config_panel/dashboard.py       |   4 +-
 .../chayuan/server/config_panel/health.py          |   2 -
 .../chayuan/server/config_panel/kb_manage_page.py  |   6 +-
 .../chayuan/server/config_panel/monitoring.py      |   4 +-
 .../server/config_panel/performance_page.py        |   8 +-
 .../chayuan/server/config_panel/schema.py          |   6 +-
 .../chayuan/server/config_panel/storage_config.py  |   2 +-
 libs/chayuan-server/chayuan/server/utils.py        |   8 --
 libs/chayuan-server/chayuan/tray/app_generic.py    |   1 -
 libs/chayuan-server/chayuan/tray/app_mac.py        |   4 -
 libs/chayuan-server/chayuan/tray/common.py         |  20 +---
 libs/chayuan-server/chayuan/webui.py               |   2 +-
 .../webui_pages/knowledge_source/settings.py       |  32 +----
 .../tests/unit_tests/test_service_config.py        |  85 -------------
 .../tests/unit_tests/test_stop_command.py          |   6 +-
 .../tests/unit_tests/test_webui_menu_slimmed.py    |   6 +-
 scripts/e2e_test.py                                | 132 ++-------------------
 25 files changed, 64 insertions(+), 353 deletions(-)
```

## 2026-05-01 08:54:50 +0800 - chayuan-server

- Branch: `main`
- Summary: auto-recorded local changes before commit.

### Changed Files

- ` M libs/chayuan-server/chayuan/server/config_panel/dashboard.py`
- ` D libs/chayuan-server/chayuan/server/config_panel/local_service_catalog.py`
- ` D libs/chayuan-server/chayuan/server/config_panel/local_service_detector.py`
- ` M libs/chayuan-server/chayuan/server/config_panel/monitoring.py`
- ` M libs/chayuan-server/chayuan/server/config_panel/restart.py`
- ` M libs/chayuan-server/chayuan/server/config_panel/scalability.py`
- ` M libs/chayuan-server/chayuan/server/config_panel/schema.py`
- ` D libs/chayuan-server/chayuan/server/config_panel/service_checks.py`
- ` D libs/chayuan-server/chayuan/server/config_panel/service_config_page.py`
- ` D libs/chayuan-server/chayuan/server/config_panel/service_page.py`
- ` M libs/chayuan-server/chayuan/server/config_panel/stop.py`
- ` M libs/chayuan-server/chayuan/settings.py`
- ` M libs/chayuan-server/chayuan/startup.py`

### Diff Stat

```text
 .../chayuan/server/config_panel/dashboard.py       |  267 +-
 .../server/config_panel/local_service_catalog.py   |  644 -----
 .../server/config_panel/local_service_detector.py  |  631 -----
 .../chayuan/server/config_panel/monitoring.py      |    2 -
 .../chayuan/server/config_panel/restart.py         |   19 +-
 .../chayuan/server/config_panel/scalability.py     |   39 +-
 .../chayuan/server/config_panel/schema.py          |   15 -
 .../chayuan/server/config_panel/service_checks.py  |  623 -----
 .../server/config_panel/service_config_page.py     |  332 ---
 .../chayuan/server/config_panel/service_page.py    | 2863 --------------------
 .../chayuan/server/config_panel/stop.py            |    1 -
 libs/chayuan-server/chayuan/settings.py            |    3 -
 libs/chayuan-server/chayuan/startup.py             |  156 +-
 13 files changed, 44 insertions(+), 5551 deletions(-)
```

## 2026-05-01 08:47:19 +0800 - chayuan-server

- Branch: `main`
- Summary: auto-recorded local changes before commit.

### Changed Files

- ` M libs/chayuan-server/chayuan/server/file_rag/document_loaders/partition.py`

### Diff Stat

```text
 .../server/file_rag/document_loaders/partition.py  | 29 +++++++++++++++++++---
 1 file changed, 26 insertions(+), 3 deletions(-)
```

## 2026-05-01 08:46:26 +0800 - chayuan-server

- Branch: `main`
- Summary: auto-recorded local changes before commit.

### Changed Files

- ` M libs/chayuan-server/chayuan/server/api_server/office_routes.py`
- ` M libs/chayuan-server/chayuan/server/api_server/office_vectorize_routes.py`
- ` M libs/chayuan-server/chayuan/server/ingest_queue/tasks.py`
- `?? libs/chayuan-server/chayuan/server/api_server/office_fast_ingest.py`

### Diff Stat

```text
 .../chayuan/server/api_server/office_routes.py     | 37 ++++++++-
 .../server/api_server/office_vectorize_routes.py   | 95 ++++++++++++++++++----
 .../chayuan/server/ingest_queue/tasks.py           | 90 ++++++++++++++++----
 3 files changed, 188 insertions(+), 34 deletions(-)
```

## 2026-05-01 08:29:43 +0800 - chayuan-server

- Branch: `main`
- Summary: auto-recorded local changes before commit.

### Changed Files

- ` M libs/chayuan-server/chayuan/server/api_server/office_routes.py`
- ` M libs/chayuan-server/chayuan/server/ingest_queue/tasks.py`

### Diff Stat

```text
 .../chayuan/server/api_server/office_routes.py     | 11 +++---
 .../chayuan/server/ingest_queue/tasks.py           | 46 ++++++++++++++++++++++
 2 files changed, 52 insertions(+), 5 deletions(-)
```

## 2026-05-01 08:23:34 +0800 - chayuan-server

- Branch: `main`
- Summary: auto-recorded local changes before commit.

### Changed Files

- ` M libs/chayuan-server/chayuan/server/api_server/office_vectorize_routes.py`
- ` M libs/chayuan-server/chayuan/server/file_rag/document_loaders/mydocloader.py`
- ` M libs/chayuan-server/chayuan/server/file_rag/document_loaders/myimgloader.py`
- ` M libs/chayuan-server/chayuan/server/file_rag/document_loaders/mypdfloader.py`
- ` M libs/chayuan-server/chayuan/server/file_rag/document_loaders/mypptloader.py`
- ` M libs/chayuan-server/chayuan/server/ingest_queue/tasks.py`
- `?? libs/chayuan-server/chayuan/server/file_rag/document_loaders/partition.py`

### Diff Stat

```text
 .../server/api_server/office_vectorize_routes.py   |  7 ++++-
 .../file_rag/document_loaders/mydocloader.py       |  6 ++--
 .../file_rag/document_loaders/myimgloader.py       |  5 ++--
 .../file_rag/document_loaders/mypdfloader.py       |  5 ++--
 .../file_rag/document_loaders/mypptloader.py       |  6 ++--
 .../chayuan/server/ingest_queue/tasks.py           | 34 ++++++++++++++++++----
 6 files changed, 45 insertions(+), 18 deletions(-)
```

## 2026-05-01 08:09:36 +0800 - chayuan-server

- Branch: `main`
- Summary: auto-recorded local changes before commit.

### Changed Files

- ` M libs/chayuan-server/chayuan/server/api_server/office_routes.py`

### Diff Stat

```text
 .../chayuan/server/api_server/office_routes.py     | 50 ++++++++++++++++++++++
 1 file changed, 50 insertions(+)
```

## 2026-05-01 08:07:03 +0800 - chayuan-server

- Branch: `main`
- Summary: auto-recorded local changes before commit.

### Changed Files

- ` M libs/chayuan-server/chayuan/server/api_server/kb_routes.py`
- ` M libs/chayuan-server/chayuan/server/db/migrations/__init__.py`
- ` M libs/chayuan-server/chayuan/server/db/models/knowledge_file_model.py`
- ` M libs/chayuan-server/chayuan/server/db/repository/knowledge_file_repository.py`
- ` M libs/chayuan-server/chayuan/server/ingest_queue/__init__.py`
- ` M libs/chayuan-server/chayuan/server/ingest_queue/tasks.py`
- ` M libs/chayuan-server/chayuan/server/knowledge_base/kb_doc_api.py`
- ` M libs/chayuan-server/chayuan/server/knowledge_base/kb_service/base.py`

### Diff Stat

```text
 .../chayuan/server/api_server/kb_routes.py         |  45 ++++++++
 .../chayuan/server/db/migrations/__init__.py       |  27 +++++
 .../server/db/models/knowledge_file_model.py       |   2 +
 .../db/repository/knowledge_file_repository.py     | 120 ++++++++++++++++++++-
 .../chayuan/server/ingest_queue/__init__.py        |   3 +
 .../chayuan/server/ingest_queue/tasks.py           |   3 +
 .../chayuan/server/knowledge_base/kb_doc_api.py    |  27 ++++-
 .../server/knowledge_base/kb_service/base.py       |   2 +
 8 files changed, 226 insertions(+), 3 deletions(-)
```

## 2026-05-01 08:01:04 +0800 - chayuan-server

- Branch: `main`
- Summary: auto-recorded local changes before commit.

### Changed Files

- ` M libs/chayuan-server/chayuan/server/api_server/kb_routes.py`
- ` M libs/chayuan-server/chayuan/server/ingest_queue/__init__.py`
- ` M libs/chayuan-server/chayuan/server/ingest_queue/backend.py`
- ` M libs/chayuan-server/chayuan/server/ingest_queue/tasks.py`

### Diff Stat

```text
 .../chayuan/server/api_server/kb_routes.py         | 40 +++++++++++---
 .../chayuan/server/ingest_queue/__init__.py        |  8 +--
 .../chayuan/server/ingest_queue/backend.py         | 43 +++++++++++++--
 .../chayuan/server/ingest_queue/tasks.py           | 62 +++++++++++++++-------
 4 files changed, 123 insertions(+), 30 deletions(-)
```

## 2026-05-01 07:47:41 +0800 - chayuan-server

- Branch: `main`
- Summary: auto-recorded local changes before commit.

### Changed Files

- ` M libs/chayuan-server/chayuan/server/api_server/kb_routes.py`
- ` M libs/chayuan-server/chayuan/server/api_server/knowledge_universe_routes.py`
- ` M libs/chayuan-server/chayuan/server/ingest_queue/__init__.py`
- ` M libs/chayuan-server/chayuan/server/ingest_queue/backend.py`
- ` M libs/chayuan-server/chayuan/server/ingest_queue/tasks.py`

### Diff Stat

```text
 .../chayuan/server/api_server/kb_routes.py         | 43 +++++++++++
 .../server/api_server/knowledge_universe_routes.py | 13 +++-
 .../chayuan/server/ingest_queue/__init__.py        | 47 ++++++++++++
 .../chayuan/server/ingest_queue/backend.py         |  4 +-
 .../chayuan/server/ingest_queue/tasks.py           | 87 ++++++++++++++++++++++
 5 files changed, 191 insertions(+), 3 deletions(-)
```

## 2026-05-01 07:37:34 +0800 - chayuan-server

- Branch: `main`
- Summary: auto-recorded local changes before commit.

### Changed Files

- ` M libs/chayuan-server/chayuan/server/db/migrations/__init__.py`
- ` M libs/chayuan-server/chayuan/server/db/models/knowledge_base_model.py`
- ` M libs/chayuan-server/chayuan/server/db/repository/knowledge_base_repository.py`
- ` M libs/chayuan-server/chayuan/server/knowledge_base/kb_service/base.py`
- ` M libs/chayuan-server/chayuan/server/knowledge_base/kb_service/chromadb_kb_service.py`
- ` M libs/chayuan-server/chayuan/server/knowledge_base/kb_service/es_kb_service.py`
- ` M libs/chayuan-server/chayuan/server/knowledge_base/kb_service/milvus_kb_service.py`
- ` M libs/chayuan-server/chayuan/server/knowledge_base/kb_service/pg_kb_service.py`
- ` M libs/chayuan-server/chayuan/server/knowledge_base/kb_service/relyt_kb_service.py`
- ` M libs/chayuan-server/chayuan/server/knowledge_base/kb_service/zilliz_kb_service.py`
- ` M libs/chayuan-server/chayuan/server/knowledge_base/utils.py`

### Diff Stat

```text
 .../chayuan/server/db/migrations/__init__.py       | 13 +++++++
 .../server/db/models/knowledge_base_model.py       |  4 ++-
 .../db/repository/knowledge_base_repository.py     | 18 +++++++++-
 .../server/knowledge_base/kb_service/base.py       | 16 +++++++--
 .../kb_service/chromadb_kb_service.py              |  8 ++---
 .../knowledge_base/kb_service/es_kb_service.py     |  6 ++--
 .../knowledge_base/kb_service/milvus_kb_service.py |  2 +-
 .../knowledge_base/kb_service/pg_kb_service.py     |  8 ++---
 .../knowledge_base/kb_service/relyt_kb_service.py  | 14 ++++----
 .../knowledge_base/kb_service/zilliz_kb_service.py |  2 +-
 .../chayuan/server/knowledge_base/utils.py         | 40 ++++++++++++++++++++--
 11 files changed, 104 insertions(+), 27 deletions(-)
```

## 2026-05-01 07:33:50 +0800 - chayuan-server

- Branch: `main`
- Summary: auto-recorded local changes before commit.

### Changed Files

- ` M libs/chayuan-server/chayuan/server/file_rag/result_envelope.py`

### Diff Stat

```text
 .../chayuan/server/file_rag/result_envelope.py     | 28 +++++++++++++++++++++-
 1 file changed, 27 insertions(+), 1 deletion(-)
```

## 2026-05-01 07:14:03 +0800 - chayuan-server

- Branch: `main`
- Summary: auto-recorded local changes before commit.

### Changed Files

- ` M libs/chayuan-server/chayuan/server/api_server/knowledge_universe_routes.py`
- ` M libs/chayuan-server/chayuan/server/chat/handlers/kb.py`
- ` M libs/chayuan-server/chayuan/server/file_rag/hybrid_service.py`

### Diff Stat

```text
 .../server/api_server/knowledge_universe_routes.py |  42 +-------
 .../chayuan/server/chat/handlers/kb.py             |  13 ++-
 .../chayuan/server/file_rag/hybrid_service.py      | 118 ++++++++++++++++++++-
 3 files changed, 130 insertions(+), 43 deletions(-)
```

## 2026-05-01 07:07:10 +0800 - chayuan-server

- Branch: `main`
- Summary: auto-recorded local changes before commit.

### Changed Files

- ` M libs/chayuan-server/chayuan/server/api_server/knowledge_universe_routes.py`
- ` M libs/chayuan-server/chayuan/server/api_server/openai_routes.py`
- ` M libs/chayuan-server/chayuan/server/chat/handlers/kb.py`
- ` M libs/chayuan-server/chayuan/server/config_panel/model_config.py`
- ` M libs/chayuan-server/chayuan/settings.py`

### Diff Stat

```text
 .../server/api_server/knowledge_universe_routes.py | 15 +++---------
 .../chayuan/server/api_server/openai_routes.py     | 28 +++++++++++++++++++---
 .../chayuan/server/chat/handlers/kb.py             |  9 ++++---
 .../chayuan/server/config_panel/model_config.py    | 19 +--------------
 libs/chayuan-server/chayuan/settings.py            |  4 ++--
 5 files changed, 37 insertions(+), 38 deletions(-)
```

## 2026-05-01 06:55:44 +0800 - chayuan-server

- Branch: `main`
- Summary: auto-recorded local changes before commit.

### Changed Files

- ` M libs/chayuan-server/chayuan/server/file_rag/hybrid_service.py`
- ` M libs/chayuan-server/chayuan/settings.py`

### Diff Stat

```text
 .../chayuan/server/file_rag/hybrid_service.py      | 83 ++++++++++++++++++----
 libs/chayuan-server/chayuan/settings.py            |  5 ++
 2 files changed, 74 insertions(+), 14 deletions(-)
```

## 2026-05-01 06:47:44 +0800 - chayuan-server

- Branch: `main`
- Summary: auto-recorded local changes before commit.

### Changed Files

- ` M libs/chayuan-server/chayuan/server/api_server/kb_routes.py`
- ` M libs/chayuan-server/chayuan/server/api_server/knowledge_universe_routes.py`
- ` M libs/chayuan-server/tests/unit_tests/test_kb_admin_rebuild.py`

### Diff Stat

```text
 .../chayuan/server/api_server/kb_routes.py         | 70 ++++++++++------
 .../server/api_server/knowledge_universe_routes.py | 95 ++++++++++++++++++++++
 .../tests/unit_tests/test_kb_admin_rebuild.py      | 46 +++++++++++
 3 files changed, 188 insertions(+), 23 deletions(-)
```

## 2026-05-01 06:02:22 +0800 - chayuan-server

- Branch: `main`
- Summary: auto-recorded local changes before commit.

### Changed Files

- ` M libs/chayuan-server/chayuan/server/knowledge_base/kb_service/milvus_kb_service.py`

### Diff Stat

```text
 .../knowledge_base/kb_service/milvus_kb_service.py | 122 +++++++++++++--------
 1 file changed, 75 insertions(+), 47 deletions(-)
```

## 2026-05-01 05:59:50 +0800 - chayuan-server

- Branch: `main`
- Summary: auto-recorded local changes before commit.

### Changed Files

- ` M libs/chayuan-server/chayuan/server/api_server/openai_routes.py`

### Diff Stat

```text
 .../chayuan/server/api_server/openai_routes.py     | 57 +++++++++++++++++++++-
 1 file changed, 55 insertions(+), 2 deletions(-)
```

## 2026-05-01 05:53:47 +0800 - chayuan-server

- Branch: `main`
- Summary: auto-recorded local changes before commit.

### Changed Files

- ` M libs/chayuan-server/chayuan/server/knowledge_base/kb_service/milvus_kb_service.py`

### Diff Stat

```text
 .../knowledge_base/kb_service/milvus_kb_service.py | 99 ++++++++++++++++++----
 1 file changed, 83 insertions(+), 16 deletions(-)
```

## 2026-05-01 05:39:29 +0800 - chayuan-server

- Branch: `main`
- Summary: auto-recorded local changes before commit.

### Changed Files

- ` M docs/office-assistant-architecture-plan.md`
- ` M libs/chayuan-server/chayuan/server/api_server/ai_space_routes.py`
- ` M libs/chayuan-server/chayuan/server/api_server/office_routes.py`
- ` M libs/chayuan-server/chayuan/server/api_server/server_app.py`
- ` M libs/chayuan-server/chayuan/server/db/migrations/__init__.py`
- `?? docs/langchain-annotation-training-plan.md`
- `?? libs/chayuan-server/chayuan/server/api_server/annotation_routes.py`
- `?? libs/chayuan-server/chayuan/server/db/models/annotation_model.py`
- `?? libs/chayuan-server/chayuan/server/db/models/route_context_model.py`
- `?? libs/chayuan-server/chayuan/server/db/repository/annotation_repository.py`
- `?? libs/chayuan-server/chayuan/server/db/repository/route_context_repository.py`

### Diff Stat

```text
 docs/office-assistant-architecture-plan.md         |  98 ++++
 .../chayuan/server/api_server/ai_space_routes.py   | 163 +++++-
 .../chayuan/server/api_server/office_routes.py     | 632 ++++++++++++++++++++-
 .../chayuan/server/api_server/server_app.py        |   2 +
 .../chayuan/server/db/migrations/__init__.py       |  37 ++
 5 files changed, 906 insertions(+), 26 deletions(-)
```

## 2026-04-30 22:39:32 +0800 - chayuan-server

- Branch: `main`
- Summary: auto-recorded local changes before commit.

### Changed Files

- ` M docs/office-assistant-architecture-plan.md`
- ` M libs/chayuan-server/chayuan/server/api_server/ai_space_routes.py`
- ` M libs/chayuan-server/chayuan/server/api_server/office_routes.py`
- ` M libs/chayuan-server/chayuan/server/db/migrations/__init__.py`
- ` M libs/chayuan-server/chayuan/startup.py`

### Diff Stat

```text
 docs/office-assistant-architecture-plan.md         |  32 +++
 .../chayuan/server/api_server/ai_space_routes.py   |  64 ++++++
 .../chayuan/server/api_server/office_routes.py     | 218 +++++++++++++++------
 .../chayuan/server/db/migrations/__init__.py       |  42 ++++
 libs/chayuan-server/chayuan/startup.py             |  13 +-
 5 files changed, 309 insertions(+), 60 deletions(-)
```

## 2026-04-30 22:33:19 +0800 - chayuan-server

- Branch: `main`
- Summary: auto-recorded local changes before commit.

### Changed Files

- ` M docs/kb-query-api-plan.md`
- ` M libs/chayuan-server/chayuan/server/api_server/kb_routes.py`
- ` M libs/chayuan-server/chayuan/server/api_server/office_routes.py`
- `?? docs/office-assistant-architecture-plan.md`
- `?? libs/chayuan-server/tests/unit_tests/test_kb_admin_rebuild.py`

### Diff Stat

```text
 docs/kb-query-api-plan.md                          | 115 +++++++
 .../chayuan/server/api_server/kb_routes.py         | 233 ++++++++++++-
 .../chayuan/server/api_server/office_routes.py     | 373 +++++++++++++++++++++
 3 files changed, 720 insertions(+), 1 deletion(-)
```

## 2026-04-30 21:49:39 +0800 - chayuan-server

- Branch: `main`
- Summary: auto-recorded local changes before commit.

### Changed Files

- ` M libs/chayuan-server/chayuan/server/api_server/server_app.py`
- `?? docs/kb-query-api-plan.md`
- `?? libs/chayuan-server/chayuan/server/api_server/kb_query_routes.py`
- `?? libs/chayuan-server/chayuan/server/kb_query/__init__.py`
- `?? libs/chayuan-server/chayuan/server/kb_query/authz.py`
- `?? libs/chayuan-server/chayuan/server/kb_query/citations.py`
- `?? libs/chayuan-server/chayuan/server/kb_query/evals.py`
- `?? libs/chayuan-server/chayuan/server/kb_query/index_status.py`
- `?? libs/chayuan-server/chayuan/server/kb_query/jobs.py`
- `?? libs/chayuan-server/chayuan/server/kb_query/registry.py`
- `?? libs/chayuan-server/chayuan/server/kb_query/schemas.py`
- `?? libs/chayuan-server/chayuan/server/kb_query/service.py`
- `?? libs/chayuan-server/tests/unit_tests/test_kb_query_schemas.py`
- `?? libs/chayuan-server/tests/unit_tests/test_kb_query_service.py`

### Diff Stat

```text
 libs/chayuan-server/chayuan/server/api_server/server_app.py | 2 ++
 1 file changed, 2 insertions(+)
```

## 2026-04-30 20:39:21 +0800 - chayuan-server

- Branch: `main`
- Summary: auto-recorded local changes before commit.

### Changed Files

- ` M libs/chayuan-server/chayuan/server/api_server/openai_routes.py`
- ` M libs/chayuan-server/chayuan/server/utils.py`

### Diff Stat

```text
 .../chayuan/server/api_server/openai_routes.py     | 10 +++++++--
 libs/chayuan-server/chayuan/server/utils.py        | 24 ++++++++++++----------
 2 files changed, 21 insertions(+), 13 deletions(-)
```

