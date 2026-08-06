# 安装说明

## 快速安装

将整个 `insert_creators` 文件夹复制到目标项目的 `.kilo/skills/` 目录下。

```
目标项目/
└── .kilo/
    └── skills/
        └── insert_creators/
            ├── insert_creators.py
            ├── README.md
            ├── config.json
            └── INSTALL.md
```

## 依赖安装

确保已安装 Python 3.7+ 和 requests 库：

```bash
pip install requests
```

## 配置

编辑 `insert_creators.py` 文件顶部的配置常量：

```python
BASE_URL = "http://192.168.101.103:3001"  # 当前项目服务地址
QUERY_DB_API = f"{BASE_URL}/api/admin/query-db"
DEFAULT_BATCH_SIZE = 10  # 每批处理的文件数量
```

## 数据库要求

确保数据库中存在以下表：

### 1. scan_files 表
```sql
CREATE TABLE scan_files (
    id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    filename VARCHAR(512) NOT NULL,
    ...
);
```

### 2. creators 表
```sql
CREATE TABLE creators (
    id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    primary_name VARCHAR(255) NOT NULL,
    other_names TEXT,  -- JSON 数组文本，如 '["名字1", "名字2"]'
    appearance_rating TINYINT,
    body_rating TINYINT,
    bio TEXT,
    avatar_path TEXT
);
```

## 验证安装

运行以下命令测试：

```bash
python .kilo/skills/insert_creators/insert_creators.py --batch 5
```

如果显示文件列表和 AI 任务提示，说明安装成功。

## 使用方式

详见 `README.md` 文件。

## 与 identify_creator 的区别

| 功能 | insert_creators | identify_creator |
|------|----------------|------------------|
| 目的 | 创建新博主 | 关联已有博主到媒体文件 |
| 数据源 | scan_files.filename | scan_file_creators.parent_path |
| 输出 | creators 表 | scan_file_creators.creator_id |
| 使用场景 | 初始化博主库 | 标记文件的博主 |

**推荐流程：**
1. 先用 `insert_creators` 创建博主库
2. 再用 `identify_creator` 关联媒体文件
