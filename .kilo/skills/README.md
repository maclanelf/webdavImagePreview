# Kilo Skills 总览

本目录包含用于博主管理的两个 skill。

---

## 📦 已安装的 Skills

### 1. insert_creators
**功能：** 从 scan_files 表提取新博主名并创建到 creators 表

**使用场景：** 初始化博主库，发现新博主

**核心特点：**
- 通过排除已有博主名来避免重复处理
- 不需要额外的跟踪表
- 自动聚焦到未处理的文件

**快速开始：**
```bash
python .kilo/skills/insert_creators/insert_creators.py --batch 10
```

📖 [详细文档](./insert_creators/README.md)

---

### 2. identify_creator
**功能：** 识别媒体文件的博主，关联 creator_id 到 scan_file_creators 表

**使用场景：** 为已评分的媒体文件标记博主

**核心特点：**
- 支持单任务和批量模式（最多 100 条）
- 自动去重，避免同批次重复博主名
- 批量关联同名路径下的其他文件

**快速开始：**
```bash
python .kilo/skills/identify_creator/identify_creator.py --batch 20
```

📖 [详细文档](./identify_creator/README.md)

---

## 🔄 推荐工作流程

### 阶段 1：初始化博主库

使用 `insert_creators` 从所有文件中提取博主名：

```bash
# 处理第一批 10 个文件
python .kilo/skills/insert_creators/insert_creators.py --batch 10

# AI 分析并创建博主后，继续下一批
python .kilo/skills/insert_creators/insert_creators.py --batch 10

# 重复直到没有新博主
```

**预期结果：** creators 表中有了所有博主的基础数据

---

### 阶段 2：关联媒体文件

使用 `identify_creator` 为已评分的媒体文件标记博主：

```bash
# 批量识别 20 个媒体文件
# AI 会自动分析路径并关联博主
```

**预期结果：** scan_file_creators 表中的 creator_id 字段被填充

---

## 📊 数据流向

```
scan_files (所有文件)
    ↓
[insert_creators]
    ↓
creators (博主库)
    ↓
[identify_creator]
    ↓
scan_file_creators.creator_id (媒体-博主关联)
```

---

## 🔧 配置

两个 skill 都需要配置服务器地址，编辑各自的 `.py` 文件：

```python
BASE_URL = "http://192.168.101.103:3001"  # 当前项目服务地址
```

---

## 📝 表结构要求

### scan_files
```sql
CREATE TABLE scan_files (
    id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    filename VARCHAR(512) NOT NULL,
    ...
);
```

### creators
```sql
CREATE TABLE creators (
    id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    primary_name VARCHAR(255) NOT NULL,
    other_names TEXT,  -- JSON 数组文本
    appearance_rating TINYINT,
    body_rating TINYINT,
    bio TEXT,
    avatar_path TEXT
);
```

### scan_file_creators
```sql
CREATE TABLE scan_file_creators (
    id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    file_path VARCHAR(512) NOT NULL,
    parent_path VARCHAR(512) NOT NULL,
    creator_id BIGINT,
    ...
);
```

---

## 🆚 两个 Skill 的区别

| 特性 | insert_creators | identify_creator |
|------|----------------|------------------|
| **数据源** | scan_files.filename | scan_file_creators.parent_path |
| **目标表** | creators | scan_file_creators.creator_id |
| **主要操作** | INSERT creators | UPDATE scan_file_creators |
| **去重策略** | 排除已有博主名的文件 | 批量去重 + 检查已有博主 |
| **使用频率** | 初期密集，后期偶尔 | 持续使用 |
| **数据量** | 处理所有文件 | 处理已扫描文件 |

---

## 💡 使用技巧

### 1. 先创建博主库
在使用 `identify_creator` 之前，先用 `insert_creators` 建立完整的博主库，这样识别准确率更高。

### 2. 定期更新博主库
当 `scan_files` 新增文件后，定期运行 `insert_creators` 发现新博主。

### 3. 批量处理
两个 skill 都支持批量处理，建议：
- `insert_creators`: 10-20 条/批
- `identify_creator`: 20-50 条/批

### 4. 新开对话
处理大量数据时，每 500-1000 条新开一次对话，避免上下文累积。

---

## 🐛 故障排查

### 问题：insert_creators 一直返回相同的文件

**原因：** 这些文件路径中没有包含任何已有博主名

**解决：** 
1. 检查 creators 表是否为空
2. 检查文件路径格式是否正常
3. 尝试减少批量数，逐个分析

### 问题：identify_creator 找不到博主

**原因：** creators 表中没有对应的博主

**解决：**
1. 先运行 `insert_creators` 创建博主
2. 或者在识别时选择"创建新博主"

### 问题：服务器连接超时

**原因：** BASE_URL 配置错误或服务器未启动

**解决：**
1. 检查 `.py` 文件中的 BASE_URL
2. 确认服务器正在运行
3. 测试 API 是否可访问

---

## 📦 移植使用

将整个 `.kilo/skills/` 目录复制到目标项目即可：

```bash
# 复制整个 skills 目录
cp -r .kilo/skills /path/to/target/project/.kilo/

# 或只复制需要的 skill
cp -r .kilo/skills/identify_creator /path/to/target/project/.kilo/skills/
```

---

## 📄 许可证

MIT License
