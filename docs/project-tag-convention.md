# project 标签约定(多项目记忆池隔离)

> 背景:2026-10-24 审查发现,歌曲生成项目线(用户称 soundGenPrj,含 pipeline-chongear8 / pipeline-chuci1 / 重耳的逆袭 等工作区)所存记忆 **48/48 条均无 project 标签**,按 project 检索为 0 命中,各项目记忆混靠全文关键词区分。
> 纪律:memory.edit 只能改 content,不能补 project 字段——已存条目无法补标,**只能从存入那一刻带对**。

## 约定

1. **凡在项目工作区存记忆,一律带 project 标签**,值 = 工作区名(如 `SoundGenPrj`、`chongear8`、`chuci1`),小写随意但同项目保持一致。
2. `memory.save` 用法:工具参数加 `project: "SoundGenPrj"`(与 `_brainToken` 一样是参数,不是 HTTP 头)。
3. 自动会话摘要(memory.submit_session)由 hook 携带工作区 project(若插件支持);不支持时接受无标签,由巩固层按内容归并,但**人工/显式存储必须带标**。
4. 跨项目通用原则(如 Suno style 规范)才存无标签或 studio 作用域,供全工作室检索。

## 粘贴到项目工作区 AGENTS.md 的片段

```markdown
## 记忆 project 标签(硬性)

- 本工作区所有 memory.save / memory.submit_session 调用,工具参数一律带 `project: "SoundGenPrj"`(与 _brainToken 同级参数,非 HTTP 头)。
- 检索本项目记忆:memory.context / memory.search 带 `project: "SoundGenPrj"`。
- 无标签条目无法事后补标(memory.edit 不支持改 project),存错只能重存。
```

## 已知历史欠账

- 2026-10-24 之前的歌曲线记忆(约 48+ 条 member 作用域)均无标签;无法补标,接受现状,靠巩固层的主题归并消化。
- v1 规范条目(style v1、双版词 v1)已被 v2 取代但 L1 仍 active:属巩固层正常滞后,无需人工手术。
