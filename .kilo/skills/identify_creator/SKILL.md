---
name: identify-creator
description: 先补齐 scan_file_creators，再按 parent_path 做 AI 目录识别，并按博主名批量关联目录
version: 1.3.0
---

# identify-creator

媒体文件博主识别 skill。通过 AI 分析目录路径 `parent_path`，识别目录对应的博主名称，并批量写入 `scan_file_creators`。

## 核心功能

- 启动时自动把 `scan_files` 缺失数据补齐到 `scan_file_creators`
- 从 `scan_file_creators.parent_path` 获取未识别目录
- AI 先对本批目录结果做一次博主名去重
- 对每个唯一博主名，只写一次代表目录
- 脚本自动把所有 `parent_path LIKE '%博主名%'` 的未识别目录批量关联到该博主
  - 批量关联仅更新 `creator_id IS NULL` 的记录，不覆盖已有关联
- 支持直接按名字批量关联：运行 `python identify_creator.py --link-name "博主名"`
- 支持利用 creators 表别名批量关联：运行 `python identify_creator.py --link-creator-id 123`
- 支持纠错复核：按当前博主和路径文本筛选已关联目录，运行 `python identify_creator.py --review-creator-name "xin" --contains "moxing"`

## 使用场景

当目录数量很大、逐目录逐次写入效率太低时，使用这个 skill 提高批量识别效率。

## 已关联数据纠错流程

当已知某个博主存在错误关联时，必须先使用复核命令筛选目录，不能直接按名称批量更新：

```bash
python .kilo/skills/identify_creator/identify_creator.py --review-creator-name "xin" --contains "moxing" --batch 100
```

该命令只读取并输出当前已关联到 `xin`、且 `parent_path` 包含 `moxing` 的目录，不修改数据。AI 必须逐条重新判断：

1. 确认正确博主后，执行 `python .kilo/skills/identify_creator/identify_creator.py --path "目录路径" --name "正确博主名"` 覆盖原关联。
2. 无法确认正确博主时，执行 `python .kilo/skills/identify_creator/identify_creator.py --path "目录路径" --unknown`。
3. 路径包含 `moxing` 的目录绝不能重新关联为 `xin`。

当前默认服务地址为 `http://192.168.101.103:3001`。

## 用户如何提问（让 AI 自动使用 --link-creator-id）

当你想让 AI **直接利用 creators 表里已维护的主名称/别名** 来批量关联目录，而不是一条条 `--path --name`，提问时需要把“使用 `--link-creator-id`”作为明确的指令写进去。

### ✅ 推荐提问模板（直接复制即可）

1) 按指定 creator_id 批量关联：

> 使用 identify_creator skill，把 creators 表中 id=123（含 primary_name + other_names 别名）对应的所有目录批量关联。
> 要求：必须执行 `python .kilo/skills/identify_creator/identify_creator.py --link-creator-id 123`，不要使用 `python -c`，不要逐目录 `--path`。

2) 一次处理多个 creator_id：

> 使用 identify_creator skill，按 creators 表的别名批量关联目录。
> 依次对 id=123、id=456、id=789 执行 `--link-creator-id`。
> 只更新 `creator_id IS NULL`，不要覆盖已有值。

### ✅ 你可以要求 AI 先查 creators 再执行

> 先用 query-db 查询 `SELECT id, primary_name, other_names FROM creators WHERE primary_name LIKE '%小U优优子%' OR other_names LIKE '%小U优优子%'`。
> 然后对查到的 id 执行 `--link-creator-id <id>`。
> 注意：后续批量关联必须通过 identify_creator.py 参数完成，不要用 python -c 打印查询结果。

### ✅ 复核错误关联数据

针对“路径包含 `moxing` 却被错误关联为 `xin`”的情况，可直接使用以下提示词：

> 请重新识别数据中关联博主名称是 xin 的数据。根据已知条件发现，之前的 AI 识别误将路径中带有 moxing 的识别为 xin，请根据 skill 中规则，重新识别博主为 xin 的数据，识别到正确的博主数据。正确的调用 IP 地址是 http://192.168.101.103:3001。

必须先筛选再逐条复核：

1. 执行 `python .kilo/skills/identify_creator/identify_creator.py --review-creator-name "xin" --contains "moxing" --batch 100`。
2. 只对脚本输出的目录逐条人工分析，不得直接执行全量 SQL 更新。
3. 正确博主使用 `--path "目录路径" --name "正确博主名"`。
4. 无法确认时使用 `--path "目录路径" --unknown`。
5. 路径包含 `moxing` 的目录绝对不能写回 `xin`。

## AI 强制约束

### 1. 禁止自作主张扩展流程

- **禁止创建任何辅助文件**
- **禁止修改 [`identify_creator.py`](./identify_creator.py)**
- **禁止自动写规则代码提取博主名**
- **禁止使用 `python -c "import requests; ..."` 直接查 SQL 或直接打印中文路径**

### 2. 必须严格按当前提效流程执行

1. 先运行批量获取命令
2. AI 阅读本批目录
3. 先做“博主名去重”

4. 对每个唯一博主只执行一次写入
5. 剩余无法归类的目录再单独处理
6. 如需按 ID 区间排查目录，只能运行 [`python identify_creator.py --start-id 119788 --end-id 156889`](./identify_creator.py) 这类脚本参数命令，不能自己写 `python -c`

### 3. 默认目录同人规则

- 一个目录默认对应一个博主
- 即使实际可能存在例外，也先按整目录归属处理
- 如果路径或文件描述包含 `moxing`，禁止将该目录识别或关联为博主 `xin`；即使同时出现 `xin` 也必须排除，无法确认其他博主时使用 `--unknown`。

### 4. 批量关联规则

当 AI 确认博主名后，脚本会自动执行等价逻辑：

- 先更新当前代表目录
- 再将所有 `parent_path LIKE '%博主名%'` 且 `creator_id IS NULL` 的目录批量关联到该博主

### 5. 无法识别时

- 使用 `--unknown`
- 不要跳过目录

### 6. 编码要求

- 所有查询和编辑都统一通过 [`identify_creator.py`](./identify_creator.py) 执行
- 脚本内部已经尽量统一 Windows 控制台为 UTF-8
- 不要绕过脚本直接请求 [`/api/admin/query-db`](app/api/admin/query-db/route.ts:9) 然后在 `cmd.exe` 里裸打印中文结果
