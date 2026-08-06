# 安装说明

## 快速安装

将整个 [`identify_creator`](./) 文件夹复制到目标项目的 [`.kilo/skills/`](.kilo/skills/) 目录下。

```text
目标项目/
└── .kilo/
    └── skills/
        └── identify_creator/
            ├── identify_creator.py
            ├── README.md
            ├── SKILL.md
            ├── config.json
            └── INSTALL.md
```

## 依赖安装

确保已安装 Python 3.7+ 和 `requests`：

```bash
pip install requests
```

## 配置

编辑 [`identify_creator.py`](./identify_creator.py) 顶部常量：

```python
BASE_URL = "http://192.168.101.103:3001"
QUERY_DB_API = f"{BASE_URL}/api/admin/query-db"
UNKNOWN_CREATOR_ID = -1
```

## 验证安装

运行：

```bash
python .kilo/skills/identify_creator/identify_creator.py --status
```

如果能显示当前剩余未识别目录数量和当前模式，说明安装成功。

## 当前行为说明

- 脚本从 `scan_files.parent_path` 查询候选目录
- 识别结果写入 `scan_file_creators`
- 正常模式直接按目录处理
- 同目录默认归属同一博主

详见 [`README.md`](./README.md) 与 [`SKILL.md`](./SKILL.md)。
