# Hub API Probe Notes - 2026-06-02

Real probe results for HuggingFace (hf-mirror) and ModelScope APIs.
Used as ground truth for hub adapter implementation.

---

## 1. HuggingFace - Model Search

**Endpoint:** `GET https://hf-mirror.com/api/models`
**Must use `-L` (follow redirects)**

**Probe command:**
```bash
curl -sL 'https://hf-mirror.com/api/models?search=qwen3&filter=gguf&sort=downloads&direction=-1&limit=5&full=false'
```

**HTTP status:** 200

**Response shape:** Top-level JSON array `[]`

**Item fields (from real response):**
```
_id          string   internal HF id
id           string   "owner/repo-name" (canonical model_id)
author       string   owner name
gated        bool     access gating
lastModified string   ISO-8601 datetime
likes        int
private      bool
sha          string   HEAD commit sha
downloads    int      total downloads
tags         string[] free-form tags (includes "gguf", task names, license, etc.)
pipeline_tag string   canonical task (see values below)
createdAt    string   ISO-8601 datetime
modelId      string   same as id (duplicate field)
siblings     object[] [{rfilename: string}] - file list (no size in search, need tree call)
```

**pipeline_tag values observed:**
- `text-generation`
- `image-text-to-text`

**tags structure example (first item):**
```
["gguf", "qwen3_next", "unsloth", "qwen", "qwen3", "text-generation",
 "base_model:Qwen/Qwen3-Coder-Next", "base_model:quantized:Qwen/Qwen3-Coder-Next",
 "license:apache-2.0", "endpoints_compatible", "region:us", "conversational"]
```

**Pagination params:**
- `limit` (int, default 30, max 100)
- `offset` (int) OR `cursor` (string from previous response Link header)

**fixture:** `fixtures/hub/hf_search.json` (3 items)

---

## 2. HuggingFace - File Tree (with sizes)

**Endpoint:** `GET https://hf-mirror.com/api/models/{owner}/{repo}/tree/{revision}`
**Must use `-L`; `?recursive=true` to flatten all paths**

**Probe command:**
```bash
curl -sL 'https://hf-mirror.com/api/models/Qwen/Qwen2.5-0.5B-Instruct-GGUF/tree/main?recursive=true'
```

**HTTP status:** 200

**Response shape:** Top-level JSON array `[]`

**Item fields:**
```
type    string  "file" | "directory"
oid     string  git object id
size    int     file size in bytes (actual, NOT lfs pointer size)
path    string  relative file path from repo root
lfs     object | null
  lfs.oid         string  sha256 of actual content
  lfs.size        int     same as file size (bytes)
  lfs.pointerSize int     size of the LFS pointer file
xetHash string | null  (optional, xet CDN hash)
```

**Key insight:** `size` is always the REAL file size (not pointer size).
LFS files have `lfs != null`. Non-LFS files have `lfs: null` (field absent).

**GGUF file example:**
```json
{
  "type": "file",
  "oid": "8a56296b...",
  "size": 1266425696,
  "lfs": {"oid": "8e0ae260...", "size": 1266425696, "pointerSize": 135},
  "path": "qwen2.5-0.5b-instruct-fp16.gguf"
}
```

**fixture:** `fixtures/hub/hf_tree.json` (5 items)

---

## 3. ModelScope - Model Search

**Endpoint:** `PUT https://www.modelscope.cn/api/v1/dolphin/models`
**Must use PUT with JSON body**

**Probe command:**
```bash
curl -sL -X PUT 'https://www.modelscope.cn/api/v1/dolphin/models' \
  -H 'Content-Type: application/json' \
  -d '{"PageSize":5,"PageNumber":1,"Name":"qwen","SortBy":"Default"}'
```

**HTTP status:** 200

**Response shape:**
```
Code    int    200 = success
Data
  Model
    Models     []  <- MODEL ARRAY IS HERE: Data.Model.Models
    TotalCount int
  FiledAgg   object  facet counts for filtering
  Source     object | null
  Target     object | null
```

**SortBy valid values (confirmed):** `"Default"` works. `"Downloads"` causes 400.

**Model item fields (key fields for adapter):**
```
Id             int     numeric model id
Name           string  model name (e.g. "Qwen3.6-27B")
Path           string  owner/organization path (e.g. "Qwen", "unsloth")
ChineseName    string  localized Chinese name (may be empty)
Description    string
Downloads      int
Stars          int     (equivalent to HF likes)
CreatedTime    int     unix timestamp
LastUpdatedTime int    unix timestamp
License        string  (e.g. "apache-2.0")
Tasks          []Task | null  <- TASK ARRAY (see below)
Tags           []string | null
Frameworks     []string  (e.g. ["Pytorch"])
Libraries      []string  (e.g. ["safetensors", "pytorch"])
ModelType      []string  (e.g. ["qwen3_5"])
Architectures  []string
Avatar         string  URL to model avatar image
```

**Tasks[] item fields (key for capability mapping):**
```
Name        string  canonical task name (e.g. "text-generation", "image-text-to-text")
ChineseName string  Chinese name (e.g. "文本生成", "视觉多模态理解")
DomainName  string  domain (e.g. "nlp", "multi-modal")
Id          int
```

**Tasks.Name values observed:**
- `"text-generation"` (Chinese: "文本生成") - DomainName: "nlp"
- `"image-text-to-text"` (Chinese: "视觉多模态理解") - DomainName: "multi-modal"
- `null` (Tasks field itself is null for some models)

**NOTE:** Tasks can be null at item level. Always guard with `tasks or []`.

**Pagination params:** `PageNumber` (1-based), `PageSize`

**fixture:** `fixtures/hub/ms_search.json` (3 items trimmed, full structure preserved)

---

## 4. ModelScope - Model Files

**Endpoint:** `GET https://www.modelscope.cn/api/v1/models/{owner}/{name}/repo/files`
**Params:** `Revision=master&Root=` (Root='' for repo root)

**Probe command:**
```bash
curl -sL 'https://www.modelscope.cn/api/v1/models/Qwen/Qwen2.5-0.5B-Instruct-GGUF/repo/files?Revision=master&Root='
```

**HTTP status:** 200

**Response shape:**
```
Code  int  200 = success
Data
  Files         []  <- FILE ARRAY IS HERE: Data.Files
  IsVisual      bool
  LatestCommitter string
```

**File item fields:**
```
Name           string  filename only (e.g. "qwen2.5-0.5b-instruct-fp16.gguf")
Path           string  relative path from repo root (same as Name for flat repos)
Size           int     file size in bytes
Type           string  "blob" (file) | "tree" (directory)
IsLFS          bool    true if stored in git-lfs
Sha256         string
Revision       string  git commit sha
CommitMessage  string
CommittedDate  int     unix timestamp
CommitterName  string
InCheck        bool
Mode           string  git file mode (e.g. "33188" = 0100644)
```

**Key insight:** `Size` is the ACTUAL file size (same as HF). `IsLFS: true` for GGUF files.

**fixture:** `fixtures/hub/ms_files.json` (5 items)

---

## 5. Field -> NormalizedModelCard Mapping

| NormalizedModelCard field | HF field | MS field | Notes |
|---|---|---|---|
| source | (literal "hf") | (literal "ms") | |
| model_id | id | Path + "/" + Name | e.g. "Qwen/Qwen2.5-0.5B-Instruct-GGUF" |
| display_name | id.split("/")[1] | Name | repo name part |
| owner | author | Path | |
| capability | pipeline_tag | Tasks[0].Name | null->None; map text-generation->chat, image-text-to-text->vision |
| param_size | parse from id/tags | parse from Name/ModelType | regex: r'(\d+\.?\d*)[bB]' |
| file_size_bytes | (from tree call) | (from files call) | sum GGUF file sizes |
| format | "gguf" if filter=gguf | parse from Name/Libraries | |
| runnable | True if gguf | True if gguf | llama-server compatible |
| downloads | downloads | Downloads | |
| likes | likes | Stars | |
| updated_at | lastModified | LastUpdatedTime (unix->iso) | |
| tags | tags[] | Tags[] | |

**capability mapping from Task.Name / pipeline_tag:**
- `text-generation` -> `chat`
- `image-text-to-text` -> `vision`
- `text-to-speech` -> `tts`
- `automatic-speech-recognition` -> `asr`
- `feature-extraction` / `sentence-similarity` -> `embedding`
- `image-feature-extraction` -> `image-embedding`
- None / unknown -> None (show as "unknown" in UI)

---

## 6. Pagination Summary

| Hub | Param style | Notes |
|---|---|---|
| HF | `limit` + `offset` OR `cursor` | cursor from Link header preferred for large traversal |
| MS | `PageNumber` (1-based) + `PageSize` | standard page-based |

---

## 7. Known Gotchas

1. **HF search `siblings` has NO size** - must make separate tree call per model to get file sizes.
2. **MS `Tasks` can be null** (not empty array) - always `tasks or []`.
3. **MS model_id = `Path + "/" + Name`**, NOT a flat field.
4. **MS `SortBy`** only accepts `"Default"` (confirmed); `"Downloads"` returns 400.
5. **HF mirror requires `-L`** (redirect follow) for all calls.
6. **MS `LastUpdatedTime` is unix timestamp (int)**, HF `lastModified` is ISO-8601 string.
7. **HF `full=false`** omits config/cardData - use it for search, only set `full=true` if you need model config.
