# identify_creator

媒体文件博主识别 skill。通过 AI 直接分析目录 `parent_path`，识别目录对应的博主名称，并将结果批量写入 `scan_file_creators`。

## 当前设计原则

- **开始识别前，先把 `scan_files` 全量补齐到 `scan_file_creators`**
- **查询粒度是目录，不是文件**
- **数据来源是 `scan_file_creators.parent_path`**
- **默认策略：一个目录就是一个博主**
- **提效策略：AI 先对一批目录识别结果做“博主名去重”，再按博主名批量关联目录**
- **批量关联规则：如果识别出博主名为 A，则会将所有 `parent_path LIKE '%A%'` 且 `creator_id IS NULL` 的记录批量更新为 A**
- **强制排除规则：路径或文件描述包含 `moxing` 时，禁止识别或关联为博主 `xin`；即使同时出现 `xin` 也必须排除，无法确认其他博主时使用 `--unknown`**

---

## ⛔ 执行约束

### 绝对禁止

- ❌ 创建任何辅助脚本
- ❌ 修改 [`identify_creator.py`](./identify_creator.py)
- ❌ 使用规则代码自动提取博主名
- ❌ 循环调用获取命令
- ❌ 使用 `python -c "import requests; ..."` 直接发 SQL 查询或直接打印中文目录

### 必须遵守

- ✅ 每次处理前接受脚本自动执行的全量补齐 SQL
- ✅ AI 逐条人工阅读目录路径并判断博主名
- ✅ 对本批目录结果做一次 AI 去重，只保留唯一博主名集合
- ✅ 对每个唯一博主只写一次代表目录，剩余目录交给脚本按名称批量关联
- ✅ 所有查询 / 编辑博主操作都通过 [`identify_creator.py`](./identify_creator.py) 的参数入口完成

---

## 工作机制

### 1. 初始化补齐

每次运行脚本时，都会先执行以下 SQL，把 [`scan_files`](lib/database.ts) 中缺失的记录补齐到 `scan_file_creators`：

```sql
INSERT INTO scan_file_creators (file_path, parent_path)
SELECT sf.filename, sf.parent_path
FROM scan_files sf
LEFT JOIN scan_file_creators sfc ON sfc.file_path = sf.filename
WHERE sfc.file_path IS NULL;
```

这样后续所有识别流程都可以只基于 `scan_file_creators` 进行。

### 2. 待识别目录获取

脚本按 `parent_path` 从 `scan_file_creators` 中获取 `creator_id IS NULL` 的目录。

### 2.1 为什么不要再用 `python -c`

在 Windows `cmd.exe` 下，直接用 `python -c` 打印 `requests` 查询结果时，容易绕过脚本内部的 UTF-8 控制台初始化，导致中文目录显示乱码。

因此这里强制要求：

- 查询目录 → 用脚本参数
- 编辑博主 → 用脚本参数
- 不要自己写 `python -c "import requests; ..."`

### 3. 提效策略

AI 不再对每个目录都立即单独写入。

而是：

1. 先看一批目录
2. 识别出唯一博主名集合，例如 `A / B / C / D / E`
3. 对每个唯一博主，只选择一个代表目录执行一次写入
4. 脚本自动把所有 `parent_path LIKE '%博主名%'` 的未识别目录批量更新为该博主

说明：

- 批量更新只作用于 `creator_id IS NULL` 的记录
- 已经有 `creator_id` 的记录不会被覆盖（避免覆盖人工修正结果）

### 3.1 进一步提效：无需代表目录，直接按名字批量关联

当 AI 已经明确识别出博主名（例如“唐十七”），你可以直接运行：

```bash
python .kilo/skills/identify_creator/identify_creator.py --link-name "唐十七"
```

该命令会：

- 自动创建/查找该博主
- 批量更新所有 `parent_path LIKE '%唐十七%'` 且 `creator_id IS NULL` 的记录

### 3.2 进一步提效：利用 creators 表的主名称 + 别名批量关联

当你已经在 creators 表维护好了主名称与别名（`primary_name` + `other_names` JSON 数组），你可以直接按 creator_id 做批量关联。

例如 creators 中：

- `primary_name = "小U优优子"`
- `other_names = ["小U优优子","小优优子"]`

则运行：

```bash
python .kilo/skills/identify_creator/identify_creator.py --link-creator-id 123
```

脚本会：

1. 查询 creators：`SELECT id, primary_name, other_names FROM creators WHERE id = 123`
2. 取出 `primary_name` + `other_names` 内所有别名
3. 将所有满足 `(parent_path LIKE '%小U优优子%' OR parent_path LIKE '%小优优子%') AND creator_id IS NULL` 的记录批量更新为 `creator_id = 123`

说明：

- 仍然只更新 `creator_id IS NULL`，不会覆盖已有关联。

### 4. 默认目录同人策略

- 一个目录默认就是一个博主
- 即使现实中可能存在少量例外，本 skill 仍然按整目录归属同一博主处理

---

## 默认执行模式

### 批量模式

```bash
python .kilo/skills/identify_creator/identify_creator.py --batch 50
```

脚本会：

1. 补齐 `scan_file_creators`
2. 获取待识别目录
3. 输出目录列表给 AI

### 降级模式

最近 5 轮批次都很小的时候，自动进入降级模式：

- 固定取 100 个目录
- 不使用 `last_id` 顺序窗口
- 每个目录都必须处理

---

## 使用方式

### 获取待识别目录

```bash
python .kilo/skills/identify_creator/identify_creator.py
python .kilo/skills/identify_creator/identify_creator.py --batch 100
```

### 按 ID 区间查询待识别目录

```bash
python .kilo/skills/identify_creator/identify_creator.py --start-id 119788 --end-id 156889
```

这个命令用于替代手工写 `python -c "import requests; ..."`，避免 Windows 控制台乱码。

### 写入识别结果

```bash
python .kilo/skills/identify_creator/identify_creator.py --path "代表目录路径" --name "博主名"
```

含义：

- 先把该目录更新为对应博主
- 再自动把所有 `parent_path LIKE '%博主名%'` 的未识别目录整体关联到同一个博主

### 标记无法识别

```bash
python .kilo/skills/identify_creator/identify_creator.py --path "目录路径" --unknown
```

### 纠正已关联的错误博主

当发现 `moxing` 路径被错误关联到 `xin` 时，先只读复核，默认每批输出 10 个目录：

```bash
python .kilo/skills/identify_creator/identify_creator.py --review-creator-name "xin" --contains "moxing" --batch 100
```

复核命令只列出当前 `creator_id` 为 `xin` 且路径包含 `moxing` 的目录，不会修改数据。AI 逐条判断后：

```bash
# 已确认正确博主，覆盖该目录原有的 xin 关联
python .kilo/skills/identify_creator/identify_creator.py --path "目录路径" --name "正确博主名"

# 无法确认正确博主，覆盖为“不认识”
python .kilo/skills/identify_creator/identify_creator.py --path "目录路径" --unknown
```

路径中包含 `moxing` 时，禁止重新关联为 `xin`。默认服务地址为 `http://192.168.101.103:3001`。

---

## 推荐执行流程

1. 运行：

```bash
python .kilo/skills/identify_creator/identify_creator.py --batch 50
```

2. AI 分析本批目录
3. 先做 AI 去重，例如最终只识别出 `A / B / C / D / E`
4. 分别执行：

```bash
python .kilo/skills/identify_creator/identify_creator.py --path "A的代表目录" --name "A"
python .kilo/skills/identify_creator/identify_creator.py --path "B的代表目录" --name "B"
python .kilo/skills/identify_creator/identify_creator.py --path "C的代表目录" --name "C"
```

5. 无法归入任何博主的目录，再单独用 `--unknown`

---

## 总结

这个版本的核心策略是：

**先全量补齐 `scan_file_creators`，再按目录识别，并利用“博主名去重 + `parent_path LIKE` 批量更新”来显著提高处理效率。**

同时，**所有查询和编辑都必须通过 [`identify_creator.py`](./identify_creator.py) 的参数入口执行，以尽量保证 Windows 下中文目录和博主名不乱码。**
