---
schema_version: 1
id: mem_01M4ZKYTWHT2257XEFDVZ8PC6R
layer: 2
scope: member
owner:
  member: local
  agent: ""
title: SimpleAIBrain 存储层架构与 FileStore 接口
kind: decision
importance: 0.8
stability: 720
access_count: 1
last_access: 2026-10-16T05:42:14.499Z
status: active
pinned: false
superseded_by: null
source_ids:
  - mem_01M4ZKQ0YSP82HSRFXQAQV87NF
tags: []
created_by: consolidator
created_at: 2026-10-15T11:08:03.345Z
updated_at: 2026-10-16T07:04:07.977Z
body: 存储层确立以目录为地址、Frontmatter 为事实源的 FileStore 架构，主键采用 mem_<ULID> 格式，数据落盘至 L1/L2/L3 子目录，暴露含初始化、扫描、读写、移动及追加日志在内的 9 项核心统一操作接口。来源：mem_01M4ZKQ0YSP82HSRFXQAQV87NF
---

存储层确立以目录为地址、Frontmatter 为事实源的 FileStore 架构，主键采用 mem_<ULID> 格式，数据落盘至 L1/L2/L3 子目录，暴露含初始化、扫描、读写、移动及追加日志在内的 9 项核心统一操作接口。来源：mem_01M4ZKQ0YSP82HSRFXQAQV87NF
