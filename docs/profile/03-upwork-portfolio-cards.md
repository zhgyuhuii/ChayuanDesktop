# Upwork 加长版 · Specialized Profile + 作品集项目卡

> 英文内容**可直接粘贴到 Upwork**(国际客户看的);中文是给你的使用说明。
> 用法:把下面的「Specialized Profile」放进 Upwork 的专项档案(选 *AI Apps* / *Full-Stack Development*);每个「Portfolio Card」对应 Upwork 后台 **Portfolio → Add project**(标题 + 描述 + 技能标签 + 截图)。
> ⚠️ 加截图/可点链接转化率翻倍——察元的界面截图、GitHub、demo 视频尽量放;政府类项目只写 "government client",不放具体名称。

---

## A. Extended Specialized Profile(加长版概述 · 英文,直接粘贴)

> **Senior Full-Stack & AI/LLM Engineer — I build production AI products end to end.**
>
> 19 years of professional software engineering, the last two focused entirely on **AI/LLM applications**. I don't just prototype — I ship complete, deployed systems: architecture, backend, frontend, model integration, and DevOps, often single-handedly.
>
> **My flagship work:** I architected and built **Chayuan**, a full enterprise AI assistant platform. It unifies **RAG over five knowledge-source types** (documents, SQL databases, vector stores, office files, images), **Text2SQL** structured-data Q&A, **multimodal generation** (text-to-image/video, digital human, TTS/ASR), and a **unified model gateway** that runs **local inference (llama.cpp / whisper) alongside 170+ cloud models** — with RBAC multi-tenancy and one-command Docker deployment. Stack: Python/FastAPI · React/TypeScript · Vue · Tauri · PostgreSQL/Milvus/Redis. 5 repositories, 3,700+ commits, 4 shipped product editions.
>
> **Before AI**, I spent 16+ years on enterprise platforms: cloud-native microservices (Java/Spring Cloud), an O2O commerce platform, a smart-agriculture super-app I built solo, and lifecycle project-management/audit systems for government and university clients — including a national exam system serving **thousands of concurrent users**.
>
> **What I can deliver for you:**
> - **RAG & LLM apps** — chat over your data, Text2SQL, AI agents, multimodal, with grounded citations
> - **Self-hosted / private AI** — keep your data in-house with local model inference
> - **Full-stack web** — React/Vue + Python(FastAPI)/Java(Spring Cloud)
> - **Cross-platform desktop** — Electron / Tauri
> - **Architecture, microservices & Docker deployment**
>
> I work **async-friendly** and communicate in **clear written English**. I scope honestly, deliver complete and reliable software, and stick around for iteration. Message me with what you're building.

**中文说明**:这是"AI Apps"专项档案用的加长概述;比主 Overview 更长更展开。Upwork 一个账号可建多个 Specialized Profile,建议建 **①AI & LLM Development ②Full-Stack Development** 两个,各放对应侧重的版本(AI 版用上面这段,全栈版把 AI 段缩短、突出微服务/跨端)。

---

## B. Portfolio Project Cards(作品集项目卡 · 英文可直接粘贴)

### Card 1 — Chayuan: Enterprise AI Assistant Platform(旗舰,放第一个)
**Title:** Enterprise AI Assistant Platform — RAG, Multimodal & Model Gateway

**Description:**
> I architected and built a complete enterprise AI platform from the ground up. **The challenge:** organizations want ChatGPT-style AI over their *own* private data — documents, databases, and media — without sending anything to the public cloud. **What I built:** a single platform that unifies RAG across five knowledge-source types (documents, SQL, vector stores, office files, images), Text2SQL for natural-language database queries, multimodal generation (image/video/digital-human/TTS), and a unified model gateway running **both local models (llama.cpp, whisper) and 170+ cloud models**. Added RBAC multi-tenancy, a unified file service, and one-command Docker deployment. **Result:** one engine shipped as 4 product editions (office add-in, desktop, team server, enterprise), fully self-hostable, with all data staying on-prem.

**Tech:** Python, FastAPI, LangChain, RAG, React, TypeScript, Vue, Tauri, PostgreSQL, Milvus, Redis, Docker
**Skills tags:** `LLM` `RAG` `Python` `FastAPI` `React` `AI Chatbot` `Full-Stack` `Docker`

---

### Card 2 — Chat With Your Documents (RAG with Citations)
**Title:** RAG Chatbot Over Your Documents — With Source Citations

**Description:**
> **The problem:** teams have hundreds of PDFs/Word/Excel files and need accurate answers they can *trust* — not hallucinations. **What I built:** a retrieval-augmented chatbot that ingests mixed document formats, does multi-query retrieval + reranking, and answers with **inline citations and one-click access to the source passage**. Supports hybrid (keyword + vector) search and per-document permissions. **Result:** users get grounded, auditable answers — every claim traces back to a real source.

**Tech:** Python, FastAPI, vector DB (Milvus), embeddings, rerankers, React
**Skills tags:** `RAG` `LLM` `Vector Database` `Python` `AI Chatbot` `Semantic Search`

---

### Card 3 — Chat With Your Database (Natural Language → SQL)
**Title:** Text2SQL — Ask Your Database Questions in Plain English

**Description:**
> **The problem:** business users can't write SQL, so data sits unused. **What I built:** a natural-language-to-SQL engine — schema linking, SQL planning, **read-only AST validation** (so it can never modify data), execution, and a grounded natural-language answer plus the table and the generated SQL for transparency. Works across **17 SQL dialects**. **Result:** non-technical staff query live databases by just asking, with safe, auditable, verifiable results.

**Tech:** Python, LLM, SQL (multi-dialect), schema linking, FastAPI
**Skills tags:** `Text2SQL` `LLM` `SQL` `Python` `Data Analytics` `AI`

---

### Card 4 — Multimodal Content Generation Suite
**Title:** AI Multimodal Suite — Image, Video, Digital Human & Voice

**Description:**
> **What I built:** an integrated generation suite inside a chat experience — **text-to-image / image-to-image**, **text-to-video / image-to-video**, **digital-human** talking-head video, and **TTS with voice cloning** plus speech-to-text. The LLM rewrites and enhances user prompts using conversation context, and all outputs land in a reusable artifact panel for preview/download. **Result:** non-designers produce images, short videos, and voiceovers from a simple chat.

**Tech:** Python, FastAPI, diffusion/video models, TTS/ASR (whisper), React
**Skills tags:** `Generative AI` `Text-to-Image` `Text-to-Video` `TTS` `Python` `AI`

---

### Card 5 — Self-Hosted / Private LLM Gateway
**Title:** Private LLM Gateway — Local Inference + 170+ Cloud Models

**Description:**
> **The problem:** companies want LLM features but can't send sensitive data to OpenAI, and want to avoid vendor lock-in and runaway API bills. **What I built:** a unified model gateway that runs **local open-source models on-prem** (llama.cpp for chat/embeddings/rerank, whisper for speech) and **transparently switches to 170+ cloud models** when needed — one API, swappable backends, fully offline-capable. **Result:** clients get LLM capabilities with **data never leaving their network** and freedom to optimize cost per task.

**Tech:** Python, FastAPI, llama.cpp, whisper, OpenAI-compatible API, Docker
**Skills tags:** `LLM` `Self-Hosted AI` `llama.cpp` `Python` `API Integration` `DevOps`

---

### Card 6 — Cloud-Native O2O Commerce Platform
**Title:** Cloud-Native O2O Commerce Platform (Microservices)

**Description:**
> **What I built:** a platform connecting brick-and-mortar stores with online ordering across WeChat/Alipay/Douyin mini-programs, with a full multi-role supply chain (customers, merchants, suppliers). Built on **Spring Cloud microservices** (Nacos, Gateway, Feign, Seata distributed transactions, RocketMQ, XXL-JOB scheduling), Elasticsearch search, MySQL, and object storage. **Result:** a scalable, production O2O system handling the full order-to-delivery flow.

**Tech:** Java, Spring Cloud, Nacos, Seata, RocketMQ, Elasticsearch, MySQL, MinIO
**Skills tags:** `Java` `Spring Cloud` `Microservices` `Backend` `E-commerce` `Elasticsearch`

---

### Card 7 — Smart Agriculture Super-App (Solo Full-Stack Build)
**Title:** Smart Agriculture Super-App — Built Single-Handedly

**Description:**
> **What I built (solo):** a comprehensive agriculture platform — online expert consultation, supply/demand marketplace across dozens of categories, VR farm tours, and aggregated big-data on tenders and companies. Front to back: **Vue + Spring Cloud microservices**, Redis, Elasticsearch, a VR rendering engine (Krpano), Canal data sync, RocketMQ, and Seata. **Result:** an entire multi-feature platform delivered end-to-end by one engineer.

**Tech:** Vue, Java, Spring Cloud, Elasticsearch, Redis, Krpano (VR), RocketMQ
**Skills tags:** `Full-Stack` `Vue.js` `Spring Cloud` `Microservices` `Solo Developer`

---

### Card 8 — Cross-Platform Desktop App with Deep OS Integration
**Title:** Cross-Platform Desktop App — Deep Linux/OS Integration

**Description:**
> **What I built:** a desktop management application for a custom Linux environment — installable app desktop, app catalog, and **deep system integration**: process management, file operations, command execution, inter-process sharing, and window hosting. Front end in **Electron + Vue 3**, backend in Spring Cloud with Redis/Elasticsearch, plus native C/C++ where performance mattered. (I also work in **Tauri** for lighter desktop builds.) **Result:** a stable, high-performance desktop platform in production.

**Tech:** Electron, Vue 3, Tauri, C/C++, Spring Cloud, Redis, Linux
**Skills tags:** `Electron` `Tauri` `Desktop Application` `Vue.js` `C++` `Linux`

---

### (可选 Card 9)— High-Concurrency Online Exam System
**Title:** High-Concurrency Online Exam Platform (Thousands of Concurrent Users)

**Description:**
> Built a national standardized-language-exam system (listening, multiple-choice, composition, writing) engineered to support **thousands of test-takers online simultaneously**. Focus on concurrency, reliability, and exam integrity. **Result:** stable large-scale concurrent testing.

**Tech:** C# / .NET, networking (socket, web services), high-concurrency design
**Skills tags:** `High Concurrency` `Backend` `C#` `System Architecture`

---

## C. 上传到 Upwork 的小贴士(中文)
1. **顺序**:作品集卡按客户最想要的排——AI 类(Card 1–5)放最前,全栈/桌面(6–8)在后。
2. **截图/链接是关键**:每张卡尽量配 1–3 张图或 demo 链接。察元的 UI 截图、架构图、GitHub(若可公开)最有说服力;没有就做几张干净的功能截图。
3. **脱敏**:政府/国防/高校客户一律 "a government client / a university client",不写真实名称;商业项目可写产品名(察元、商郎天网等)。
4. **每张卡选 3–6 个 Skills 标签**,和你主档案的技能标签对齐(利于搜索匹配)。
5. **标题控制在 ~60 字符内**,开头放最强关键词(RAG / AI / Full-Stack)。
6. **真实性**:这些都是你真做过的项目,放心写;只是用客户视角(问题→我做了什么→结果)重述,更打动人。
