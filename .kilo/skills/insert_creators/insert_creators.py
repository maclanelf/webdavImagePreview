# coding: utf-8
"""
Insert Creators Skill
从 scan_files 表的 filename 中发现新博主并创建到 creators 表。

⚠️  博主名必须由 AI 人工分析路径语义判断，禁止用代码自动提取。
    路径格式完全不固定，只有 AI 能正确理解语义。

用法：
  # 获取一批待分析路径（默认 10 条，最多 100 条）
  python insert_creators.py
  python insert_creators.py --batch 20

  # AI 分析完成后，统一批量插入（去重后调用）
  python insert_creators.py --create "博主名"
  
  # 重置统计（开始新一轮识别时）
  python insert_creators.py --reset-stats
"""

import requests
import json
import argparse
import sys
import io
import os
from pathlib import Path

# 设置 stdout 编码为 UTF-8，避免 Windows 下中文路径乱码
# 注意：这只能解决 Python 内部编码问题，PowerShell 管道仍可能乱码
if sys.platform == 'win32':
    # 尝试设置控制台代码页为 UTF-8
    try:
        os.system('chcp 65001 >nul 2>&1')
    except:
        pass
    # 重新包装 stdout
    if hasattr(sys.stdout, 'buffer'):
        sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
    if hasattr(sys.stderr, 'buffer'):
        sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')

# ============================================================
# 可配置常量
# ============================================================
BASE_URL = "http://192.168.101.103:3001"
QUERY_DB_API = f"{BASE_URL}/api/admin/query-db"
DEFAULT_BATCH_SIZE = 10
STATS_FILE = Path(__file__).parent / ".insert_creators_stats.json"
# ============================================================


def query_db(sql: str, params: list = None) -> dict:
    """调用 query-db 接口执行 SQL"""
    payload = {"sql": sql, "params": params or []}
    try:
        resp = requests.post(QUERY_DB_API, json=payload, timeout=60)
        resp.raise_for_status()
    except requests.RequestException as e:
        print(f"[错误] 接口请求失败: {e}")
        sys.exit(1)

    result = resp.json()
    if not result.get("success"):
        print(f"[错误] SQL 执行失败: {result.get('error')}")
        print(f"  SQL: {sql}")
        sys.exit(1)
    return result


def load_stats() -> dict:
    """加载统计数据"""
    if not STATS_FILE.exists():
        return {
            "batch_count": 0,
            "total_analyzed": 0,
            "total_created": 0,
            "last_processed_id": 0  # 记录最后处理的 scan_files.id
        }
    try:
        with open(STATS_FILE, 'r', encoding='utf-8') as f:
            stats = json.load(f)
            # 兼容旧版本统计文件
            if "last_processed_id" not in stats:
                stats["last_processed_id"] = 0
            return stats
    except:
        return {
            "batch_count": 0,
            "total_analyzed": 0,
            "total_created": 0,
            "last_processed_id": 0
        }


def save_stats(stats: dict):
    """保存统计数据"""
    try:
        with open(STATS_FILE, 'w', encoding='utf-8') as f:
            json.dump(stats, f, ensure_ascii=False, indent=2)
    except Exception as e:
        print(f"[警告] 无法保存统计数据: {e}")


def update_batch_stats(analyzed_count: int, max_id: int):
    """更新批次统计（在获取路径后调用）"""
    stats = load_stats()
    stats["batch_count"] += 1
    stats["total_analyzed"] += analyzed_count
    stats["last_processed_id"] = max_id  # 更新最后处理的 ID
    save_stats(stats)
    return stats


def update_create_stats():
    """更新创建统计（在成功创建博主后调用）"""
    stats = load_stats()
    stats["total_created"] += 1
    save_stats(stats)


def reset_stats():
    """重置统计数据"""
    if STATS_FILE.exists():
        STATS_FILE.unlink()
    print("✅ 统计数据已重置")


def get_existing_creator_names() -> list:
    """
    步骤1：查询所有已存在的博主名称
    从 creators 表的 other_names JSON 数组中提取所有名称
    """
    sql = """
        SELECT DISTINCT name
        FROM (
            SELECT primary_name AS name FROM creators
            UNION ALL
            SELECT jt.name
            FROM creators
            JOIN JSON_TABLE(
                CASE WHEN JSON_VALID(other_names) THEN other_names ELSE JSON_ARRAY() END,
                '$[*]' COLUMNS (name VARCHAR(255) PATH '$')
            ) AS jt ON TRUE
        ) AS creator_names
        WHERE name IS NOT NULL AND name <> ''
    """
    result = query_db(sql)
    names = [row['name'] for row in result.get('data', [])]
    print(f"[步骤1] 已有博主名称数量: {len(names)}")
    return names


def get_unprocessed_files(existing_names: list, batch_size: int, last_id: int) -> tuple[list, int]:
    """
    步骤2：获取未包含已有博主名的文件（顺序处理 + 博主路径去重）
    
    策略：
    1. 从 last_id 开始顺序获取文件（不再随机）
    2. 提取博主路径（前3个/之后 到 最后1个/之前的部分）
    3. 对博主路径去重，确保同一博主目录结构只取一个文件
    4. 根据博主数量选择过滤方式
    
    返回：(文件列表, 最大ID)
    """
    # 先获取一批文件（顺序，从 last_id 开始）
    # 获取更多数量用于去重后仍有足够文件
    fetch_size = batch_size * 5
    sql = f"SELECT id, filename FROM scan_files WHERE id > ? ORDER BY id ASC LIMIT {fetch_size}"
    print(f"[步骤2] 从 ID {last_id} 开始顺序获取 {fetch_size} 条")
    result = query_db(sql, [last_id])
    all_files = result.get('data', [])
    
    if not all_files:
        print("\n✅ 没有更多文件了（已处理到末尾）")
        return [], last_id
    
    # 记录本批次的最大 ID（无论是否过滤，都要更新到这个 ID）
    batch_max_id = max(row['id'] for row in all_files)
    
    # 提取博主路径并去重
    creator_path_map = {}  # {博主路径: (id, 完整文件路径)}
    for row in all_files:
        file_id = row['id']
        filename = row['filename']
        
        # 提取博主路径：前3个/之后 到 最后1个/之前
        slash_positions = [i for i, c in enumerate(filename) if c == '/']
        
        if len(slash_positions) >= 4:
            # 至少有4个/，才能提取中间部分
            start_pos = slash_positions[2]  # 第3个/的位置
            end_pos = slash_positions[-1]   # 最后1个/的位置
            creator_path = filename[start_pos+1:end_pos]
        elif len(slash_positions) >= 1:
            # 少于4个/，提取到最后一个/之前
            creator_path = filename[:slash_positions[-1]]
        else:
            # 没有/，整个路径作为博主路径
            creator_path = filename
        
        # 同一博主路径只保留第一个文件
        if creator_path not in creator_path_map:
            creator_path_map[creator_path] = (file_id, filename)
    
    print(f"[步骤2] 博主路径去重：{len(all_files)} 条 → {len(creator_path_map)} 个不同博主路径")
    
    # 获取去重后的文件列表
    deduped_files = list(creator_path_map.values())
    
    # 根据博主数量选择过滤策略
    if not existing_names:
        # 没有已有博主，直接使用去重后的文件
        filtered_files = deduped_files[:batch_size]
        print(f"[步骤2] 无排除条件，取前 {len(filtered_files)} 条")
    elif len(existing_names) < 500:
        # 博主数较少，在客户端过滤（SQL 过滤对于顺序查询不适用）
        filtered_files = []
        for file_id, filename in deduped_files:
            # 检查是否包含任何已有博主名
            contains_existing = False
            for name in existing_names:
                if name in filename:
                    contains_existing = True
                    break
            if not contains_existing:
                filtered_files.append((file_id, filename))
                if len(filtered_files) >= batch_size:
                    break
        print(f"[步骤2] 客户端过滤：排除包含 {len(existing_names)} 个已有博主名的文件")
    else:
        # 博主数过多，同样使用客户端过滤
        filtered_files = []
        for file_id, filename in deduped_files:
            contains_existing = False
            for name in existing_names:
                if name in filename:
                    contains_existing = True
                    break
            if not contains_existing:
                filtered_files.append((file_id, filename))
                if len(filtered_files) >= batch_size:
                    break
        print(f"[步骤2] 客户端过滤：排除包含 {len(existing_names)} 个已有博主名的文件")
    
    if not filtered_files:
        # 当前批次没有符合条件的文件，返回本批次最大 ID 继续下一批
        print(f"\n⚠️  当前批次无符合条件的文件，继续下一批（本批次最大 ID: {batch_max_id}）")
        return [], batch_max_id
    
    # 提取文件名
    filenames = [filename for _, filename in filtered_files]
    
    print(f"[步骤2] 过滤后剩余: {len(filenames)} 条")
    print(f"[步骤2] 过滤结果 ID 范围: {filtered_files[0][0]} ~ {filtered_files[-1][0]}")
    print(f"[步骤2] 本批次最大 ID: {batch_max_id}\n")
    
    # 返回过滤后的文件列表和本批次最大 ID（确保下次从正确位置继续）
    return filenames, batch_max_id


def check_creator_exists(name: str) -> bool:
    """创建前再次确认博主是否已存在（防止并发重复）"""
    sql = """
        SELECT creators.id
        FROM creators
        WHERE primary_name = ?
           OR JSON_CONTAINS(
                CASE WHEN JSON_VALID(other_names) THEN other_names ELSE JSON_ARRAY() END,
                JSON_QUOTE(?)
           )
    """
    result = query_db(sql, [name, name])
    return len(result.get('data', [])) > 0


def create_creator(name: str) -> "int | None":
    """
    步骤4：创建单个博主，返回 id
    调用前已经过 AI 去重，此处仍做二次确认防止数据库已有同名
    """
    if check_creator_exists(name):
        print(f"  ⚠️  博主已存在，跳过: {name}")
        return None

    insert_sql = (
        "INSERT INTO creators (primary_name, other_names, appearance_rating, body_rating, bio, avatar_path) "
        "VALUES (?, ?, null, null, null, 0)"
    )
    query_db(insert_sql, [name, json.dumps([name], ensure_ascii=False)])

    # 查询新创建的 id
    result = query_db("SELECT id FROM creators WHERE primary_name = ?", [name])
    rows = result.get('data', [])
    if not rows:
        print(f"  ✗ 创建博主后无法查询到 ID: {name}")
        return None

    creator_id = rows[0]['id']
    print(f"  ✓ 创建新博主: {name} (id={creator_id})")
    return creator_id


def cmd_process(batch_size: int):
    """
    主流程：步骤1 → 步骤2 → 输出路径给 AI 分析

    ⚠️  AI 必须人工逐条阅读路径，语义判断博主名，禁止用任何代码自动提取。
        路径格式完全不固定，没有任何规律可循，只有 AI 能正确理解。
    """
    # 加载统计数据
    stats = load_stats()
    last_id = stats["last_processed_id"]
    
    print("\n" + "=" * 60)
    print("Insert Creators — 新博主发现任务（顺序处理模式）")
    print("=" * 60)
    
    # 显示统计信息
    if stats["batch_count"] > 0:
        success_rate = (stats["total_created"] / stats["total_analyzed"] * 100) if stats["total_analyzed"] > 0 else 0
        print(f"[统计] 已处理批次: {stats['batch_count']}, 分析: {stats['total_analyzed']} 条, 创建: {stats['total_created']} 个 (成功率: {success_rate:.1f}%)")
        print(f"[统计] 上次处理到 ID: {last_id}")

    # 步骤1：获取已有博主名（用于排除）
    existing_names = get_existing_creator_names()

    # 步骤2：获取未处理的文件路径（顺序 + 目录去重）
    filenames, max_id = get_unprocessed_files(existing_names, batch_size, last_id)
    if not filenames:
        if max_id > last_id:
            # 当前批次无符合条件的文件，但还有更多数据，更新 ID 继续
            stats = update_batch_stats(0, max_id)
            print(f"已更新处理进度到 ID {max_id}，请再次运行继续下一批")
        return
    
    # 更新批次统计
    stats = update_batch_stats(len(filenames), max_id)

    # 步骤3：输出路径列表，等待 AI 人工分析
    print("=" * 60)
    print(f"【步骤3 — AI 人工分析】待分析路径（共 {len(filenames)} 条）：")
    print("=" * 60)
    for i, filename in enumerate(filenames, 1):
        try:
            print(f"  {i:>3}. {filename}")
        except UnicodeEncodeError:
            # 处理无法编码的字符
            safe_filename = filename.encode('utf-8', errors='replace').decode('utf-8')
            print(f"  {i:>3}. {safe_filename}")

    print("\n" + "=" * 60)
    print("🚨 AI 强制约束（必须严格遵守）：")
    print("=" * 60)
    print("  1. 必须逐条人工阅读路径，语义判断博主名")
    print("  2. 禁止用正则/字符串分割/路径解析等代码自动提取")
    print("  3. 路径格式不固定，只有 AI 能正确理解语义")
    print("  4. 无法判断的条目直接跳过，不要强行猜测")
    print()
    print("【步骤3 — 去重规则】AI 分析完所有路径后：")
    print("  - 先汇总所有识别出的博主名")
    print("  - 如果多条路径识别出相同博主名，只保留第一条，舍弃后续重复")
    print("  - 去重后的博主名列表才可以执行插入")
    print()
    print("【步骤4 — 统一插入】对去重后每个博主名并发调用：")
    print("  python insert_creators.py --create \"博主名\"")
    print()
    print("【步骤5 — 继续下一批】插入完成后再次运行：")
    print("  python insert_creators.py")
    print(f"  （将从 ID {max_id} 继续处理）")
    print("=" * 60)


def cmd_create(name: str):
    """
    步骤4：创建单个博主（由 AI 去重后并发调用）
    多个 --create 命令可以同时并发执行，因为每个博主名唯一不会冲突
    """
    print(f"\n[创建博主] {name}")
    try:
        creator_id = create_creator(name)
        if creator_id is not None:
            # 成功创建，更新统计
            update_create_stats()
    except Exception as e:
        print(f"  ✗ 创建失败: {e}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="从 scan_files 发现新博主并创建到 creators 表（博主名由 AI 人工分析）"
    )
    parser.add_argument(
        "--batch", type=int, default=DEFAULT_BATCH_SIZE,
        help=f"每批获取的文件数量，推荐 10-20，最多 100（默认 {DEFAULT_BATCH_SIZE}）"
    )
    parser.add_argument(
        "--create", type=str, default=None,
        help="创建单个博主，由 AI 去重后并发调用"
    )
    parser.add_argument(
        "--reset-stats", action="store_true",
        help="重置统计数据（开始新一轮识别时使用）"
    )
    args = parser.parse_args()

    if args.reset_stats:
        reset_stats()
    elif args.create is not None:
        cmd_create(args.create)
    else:
        cmd_process(args.batch)
