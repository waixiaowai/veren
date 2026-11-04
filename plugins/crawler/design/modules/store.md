---
title: 存储适配
description: 数据整形、介质工厂、增量写入与匿名化脱敏的统一存储层。
sidebar:
  order: 24
  label: 存储适配
lastUpdated: 2026-11-04
---

存储适配（核心域）：把各平台异构的结构化数据整形为统一实体，按配置选择的介质落库或落盘，拥有全部落地数据的变更权；与平台爬取器的分界是「爬取器只生产内存数据，一切落地动作归本模块」，与介质的分界是「本模块只面向统一契约，介质差异收敛在实现类内」。

## 1. Responsibilities

- 数据整形：把各平台原始数据映射为统一实体字段，拼装访问地址、聚合媒体与标签列表、记录来源关键词。
- 匿名化脱敏：人物标识哈希化、昵称遮蔽，落地数据不含可识别个人的字段；创作者档案在教学版中整体不落库。
- 介质工厂：按保存介质配置分发到八种实现（csv、json、jsonl、sqlite、mysql/postgres 数据库、mongodb、excel），未知介质报错。
- 增量写入：按业务主键判断存在性，存在则更新互动计数类字段，否则插入。
- 介质收尾：Excel 模式数据全量驻内存，由启动器在采集结束统一落盘。

## 2. Key Design Decisions

1. **按主键存在即更新**：以业务主键（内容 id、评论 id）判断，更新仅限互动计数与修改时间。违反后果：重复采集产生重复记录，或覆盖首次采集的原始内容字段。
2. **人物标识强制脱敏**：所有落地路径经哈希与遮蔽处理，脱敏在整形阶段完成、介质实现不做二次处理。违反后果：可识别个人信息进入落地介质，违反教学版隐私红线。
3. **介质切换只动配置**：八种实现共享同一组整形函数，介质差异完全收敛在实现类。违反后果：每换介质都要重复实现一遍数据映射。
4. **Excel 全量驻内存**：Excel 实现以类级单例持有工作簿，采集结束统一落盘。违反后果：中途落盘会写出半成品文件。

## 3. Contracts

```ts
// 统一存储契约
abstract class AbstractStore {
  abstract storeContent(contentItem: Record<string, unknown>): Promise<void>;
  abstract storeComment(commentItem: Record<string, unknown>): Promise<void>;
  abstract storeCreator(creator: Record<string, unknown>): Promise<void>;
}

// 介质枚举与工厂
type SaveDataOption = "csv" | "db" | "json" | "jsonl" | "sqlite" | "mongodb" | "excel" | "postgres";
interface StoreFactoryContract {
  // 未知介质抛 InvalidSaveOptionError
  create(option: SaveDataOption): AbstractStore;
}

// 整形后的内容实体（字段全集见数据字典）
interface ContentRecord {
  id: string;                  // 平台业务主键
  title: string | null;
  desc: string | null;
  url: string;                 // 含访问令牌的完整地址（平台适用时）
  publishTime: number | null;
  likedCount: number | null; commentCount: number | null;
  collectedCount: number | null; shareCount: number | null;
  imageList: string; videoUrl: string | null;
  tagList: string;
  sourceKeyword: string | null;
  creatorHash: string;         // 匿名哈希
  nickname: string;            // 已遮蔽昵称
  addTs: number; lastModifyTs: number;
}
```

落盘文件命名约定：数据文件为 `数据根/平台/介质类型/采集模式_实体类型_日期.扩展名`；Excel 为 `数据根/平台/平台_采集模式_时间戳.xlsx`（固定工作表：内容、评论，B 站另有联系人、动态表）。

## 4. Flow

```ts
// 用途：表达整形与增量写入，含失败分支
async function saveContent(raw: RawItem): Promise<void> {
  const record: ContentRecord = shapeContent(raw);       // 映射 + 脱敏 + 上下文补全
  const store = storeFactory.create(config.saveDataOption);
  try {
    await store.storeContent(record);                    // 分介质实现
  } catch (err) {
    logError("[Store]", record.id, err);                 // 单条失败记日志
    throw;                                               // 由采集层决定批次去留
  }
}

// 数据库实现的增量语义
async function upsertContent(record: ContentRecord): Promise<void> {
  await withSession(async (session) => {                 // 会话提交/回滚集中管理
    const existing = await session.find(ContentTable, record.id);
    if (existing) {
      await session.updateCountsOnly(existing, record);  // 只更新互动计数与修改时间
    } else {
      await session.insert(record);
    }
  });                                                    // 异常自动回滚后上抛
}
```

失败分支与恢复策略：

- **单条写入失败**：数据库实现会话内回滚后上抛，该条不落库；文件实现的追加写失败记录日志，已写行保留。采集可重跑：主键存在即更新的语义保证重跑幂等。
- **未知介质**：工厂立即抛错，不产生半成品文件。
- **Excel 进程中断**：数据尚未落盘，属已知损失边界；重跑采集可恢复全部数据（主键幂等）。
- **连接失败**：数据库连接参数来自环境变量与配置，连接失败在首条写入时暴露，进程报错退出。

## 5. Storage Matrix

| 介质 | 写入方式 | 去重语义 | 备注 |
| --- | --- | --- | --- |
| csv | 追加行，首行写表头 | 无（靠重跑主键幂等在库类介质生效） | 带字节序标记便于表格软件打开 |
| json | 全量读入追加后重写 | 无 | 单文件对象数组，格式化缩进 |
| jsonl | 逐行追加 | 无 | 词云读取的唯一来源 |
| sqlite / db / postgres | 会话内查询后插入或更新 | 主键存在即更新计数 | 自动建库建表 |
| mongodb | 文档级 upsert | 主键存在即整体更新 | 集合按平台前缀命名 |
| excel | 内存工作簿，结束统一落盘 | 无 | 空工作表不落文件 |

## 6. Acceptance

1. **成功路径**：八种介质各完成一次内容与评论写入，文件或表结构符合命名与字段约定。
2. **拒绝路径**：配置不存在的介质值时，进程在首条数据写入前报介质错误退出，不产生半成品文件。
3. **失败恢复**：数据库连接中断导致单条写入失败时，该条不落库且会话回滚，重跑采集后数据完整且无重复。
4. **幂等路径**：同一内容连续写入两次，库类介质中仅一条记录且互动计数被更新。
5. **脱敏路径**：任意介质落地数据中，人物标识均为哈希值、昵称均为遮蔽形式，不存在明文可识别字段。
6. **收尾路径**：Excel 模式采集正常结束后数据文件才出现，且空工作表不产生文件。
