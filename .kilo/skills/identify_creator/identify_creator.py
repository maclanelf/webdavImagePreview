"""
Creator Identification Skill
通过 AI 逐条分析文件路径识别博主，关联或创建博主记录。

用法：
  # 获取一批待分析路径（默认 10 条）
  python identify_creator.py
  python identify_creator.py --batch 100
  
  # 写入结果（传入目录路径）
  python identify_creator.py --path "/xxx/博主目录" --name "博主名"
  
  # 标记为无法识别
  python identify_creator.py --path "/xxx/目录" --unknown
  
  # 重置统计（开始新一轮识别时）
  python identify_creator.py --reset-stats

重要：
  - 使用 --batch 参数一次性获取多条记录，不要循环调用
  - ❌ 错误：for ($i=1; $i -le 100; $i++) { python identify_creator.py }
  - ✅ 正确：python identify_creator.py --batch 100
  
  自适应处理模式：
  - 所有模式开始前，都会先把 scan_files 中缺失的 file_path / parent_path 补齐到 scan_file_creators
  - 正常模式：直接从 scan_file_creators 按 parent_path 查询待识别目录，每次返回 batch_size 个目录
  - 降级模式：当最近5轮获取数据量都 ≤2 条时自动启动
    * 批次大小固定为 100 条
    * 直接查询 scan_file_creators 中所有未识别目录（不使用 last_id）
    * 跳过顺序游标，直接获取 100 个目录进行识别
    * 适用于剩余大多是 creator_id=-1 或难以识别的目录
    * 无法识别的必须标记为 -1，不能跳过

  提效策略：
  - AI 在一批目录中先做一次“博主名去重”
  - 对唯一博主名（如 A/B/C/D/E）分别写入一次
  - 若 AI 判定某目录对应博主名为 A，则脚本会自动把所有 parent_path LIKE '%A%' 且 creator_id IS NULL 的记录批量更新为该博主
    （仅更新 NULL，避免覆盖人工修正结果）
"""

import requests
import json
import argparse
import sys
import io
import os
import ctypes
from pathlib import Path

def configure_console_utf8():
    """尽量统一 Windows 控制台 / Python IO 为 UTF-8，避免中文路径乱码。"""
    os.environ.setdefault("PYTHONIOENCODING", "utf-8")
    os.environ.setdefault("PYTHONUTF8", "1")

    if sys.platform != 'win32':
        return

    try:
        ctypes.windll.kernel32.SetConsoleCP(65001)
        ctypes.windll.kernel32.SetConsoleOutputCP(65001)
    except Exception:
        pass

    try:
        os.system('chcp 65001 >nul 2>&1')
    except Exception:
        pass

    for stream_name in ('stdin', 'stdout', 'stderr'):
        stream = getattr(sys, stream_name, None)
        if stream is None:
            continue

        try:
            stream.reconfigure(encoding='utf-8', errors='replace')
            continue
        except Exception:
            pass

        if hasattr(stream, 'buffer'):
            try:
                wrapped = io.TextIOWrapper(stream.buffer, encoding='utf-8', errors='replace')
                setattr(sys, stream_name, wrapped)
            except Exception:
                pass


configure_console_utf8()

# ============================================================
# 可配置常量
# ============================================================
BASE_URL = "http://192.168.101.103:3001"
QUERY_DB_API = f"{BASE_URL}/api/admin/query-db"
UNKNOWN_CREATOR_ID = -1
DEFAULT_BATCH_SIZE = 10
REDUCED_BATCH_SIZE = 100  # 降级后的批次大小（不再乘以5，直接获取100条逐个识别）
STATS_FILE = Path(__file__).parent / ".identify_creator_stats.json"
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


def print_rows(rows: list):
    """统一按 UTF-8 友好方式输出记录，避免调用方再使用 python -c 直接打印。"""
    print(f"rows={len(rows)}")
    for row in rows:
        row_id = row.get('id', '')
        row_path = row.get('path', '')
        try:
            print(f"{row_id}|{row_path}")
        except UnicodeEncodeError:
            safe_path = str(row_path).encode('utf-8', errors='replace').decode('utf-8')
            print(f"{row_id}|{safe_path}")


def sync_scan_file_creators_from_scan_files() -> int:
    """先将 scan_files 中缺失的文件补齐到 scan_file_creators"""
    sql = """
        INSERT INTO scan_file_creators (file_path, parent_path)
        SELECT sf.filename, sf.parent_path
        FROM scan_files sf
        LEFT JOIN scan_file_creators sfc ON sfc.file_path = sf.filename
        WHERE sfc.file_path IS NULL
    """
    result = query_db(sql)
    row_count = result.get("rowCount", 0)
    if row_count > 0:
        print(f"[初始化] 已从 scan_files 补齐 {row_count} 条记录到 scan_file_creators")
    else:
        print("[初始化] scan_file_creators 已与 scan_files 同步，无需补齐")
    return row_count


def load_stats() -> dict:
    """加载统计数据"""
    if not STATS_FILE.exists():
        return {
            "batch_count": 0,
            "total_analyzed": 0,
            "total_identified": 0,
            "last_processed_id": 0,
            "recent_batch_sizes": [],  # 最近几轮的批次大小
            "is_reduced_mode": False  # 是否处于降级模式
        }
    try:
        with open(STATS_FILE, 'r', encoding='utf-8') as f:
            stats = json.load(f)
            if "last_processed_id" not in stats:
                stats["last_processed_id"] = 0
            if "recent_batch_sizes" not in stats:
                stats["recent_batch_sizes"] = []
            if "is_reduced_mode" not in stats:
                stats["is_reduced_mode"] = False
            return stats
    except:
        return {
            "batch_count": 0,
            "total_analyzed": 0,
            "total_identified": 0,
            "last_processed_id": 0,
            "recent_batch_sizes": [],
            "is_reduced_mode": False
        }


def save_stats(stats: dict):
    """保存统计数据"""
    try:
        with open(STATS_FILE, 'w', encoding='utf-8') as f:
            json.dump(stats, f, ensure_ascii=False, indent=2)
    except Exception as e:
        print(f"[警告] 无法保存统计数据: {e}")


def update_batch_stats(analyzed_count: int, max_id: int):
    """更新批次统计"""
    stats = load_stats()
    stats["batch_count"] += 1
    stats["total_analyzed"] += analyzed_count
    stats["last_processed_id"] = max_id
    
    # 记录最近几轮的批次大小（保留最近5轮）
    stats["recent_batch_sizes"].append(analyzed_count)
    if len(stats["recent_batch_sizes"]) > 5:
        stats["recent_batch_sizes"] = stats["recent_batch_sizes"][-5:]
    
    save_stats(stats)
    return stats


def update_identify_stats():
    """更新识别统计"""
    stats = load_stats()
    stats["total_identified"] += 1
    save_stats(stats)


def reset_stats():
    """重置统计数据"""
    if STATS_FILE.exists():
        STATS_FILE.unlink()
    print("✅ 识别统计数据已重置")


def should_reduce_batch_size(stats: dict) -> bool:
    """
    判断是否应该降低批次大小
    
    条件：最近5轮获取到的数据量都很少（每轮 ≤ 2 条）
    说明 scan_file_creators 中剩余候选目录大多是 creator_id=-1 或难以识别的目录
    """
    recent_sizes = stats.get("recent_batch_sizes", [])
    
    # 至少需要5轮数据才能判断
    if len(recent_sizes) < 5:
        return False
    
    # 检查最近5轮是否都 ≤ 2 条
    return all(size <= 2 for size in recent_sizes)


def get_unidentified_batch(batch_size: int, last_id: int, skip_dedup: bool = False) -> tuple[list, int, bool]:
    """
    序列获取未识别目录（按目录粒度）
    
    参数：
    - skip_dedup: 是否跳过基于 last_id 的顺序窗口（降级模式时为 True）
    
    返回：(记录列表, 最大ID, 是否到达末尾)
    """
    if skip_dedup:
        # 降级模式：直接从 scan_file_creators 获取所有未识别目录，不使用 last_id
        sql = """
            SELECT MIN(id) AS id, parent_path AS path
            FROM scan_file_creators
            WHERE creator_id IS NULL
            GROUP BY parent_path
            ORDER BY MIN(id) ASC
            LIMIT ?
        """
        
        print(f"[步骤1] 🔴 降级模式：直接从 scan_file_creators 获取未识别目录，限制 {batch_size} 条")
        result = query_db(sql, [batch_size])
        all_rows = result.get('data', [])
        
        if not all_rows:
            print("\n✅ 没有更多未识别的目录了（scan_file_creators 中所有未识别目录已处理完）")
            return [], last_id, True
        
        batch_max_id = max(row['id'] for row in all_rows)
        print(f"[步骤1] 降级模式：获取到 {len(all_rows)} 个目录")
        print(f"[步骤1] 目录 ID 范围: {all_rows[0]['id']} ~ {all_rows[-1]['id']}\n")
        return all_rows, batch_max_id, False
    
    # 正常模式：直接按 parent_path 查询待识别目录
    sql = """
        SELECT MIN(id) AS id, parent_path AS path
        FROM scan_file_creators
        WHERE creator_id IS NULL
          AND id > ?
        GROUP BY parent_path
        ORDER BY MIN(id) ASC
        LIMIT ?
    """
    
    print(f"[步骤1] 从 ID {last_id} 开始顺序获取 {batch_size} 个待识别目录")
    result = query_db(sql, [last_id, batch_size])
    rows = result.get('data', [])
    
    if not rows:
        print("\n✅ 没有更多未识别的目录了（已处理到数据库末尾）")
        return [], last_id, True
    
    batch_max_id = max(row['id'] for row in rows)
    
    print(f"[步骤1] 返回 {len(rows)} 个目录用于分析")
    print(f"[步骤1] 返回目录 ID 范围: {rows[0]['id']} ~ {rows[-1]['id']}")
    print(f"[步骤1] 本批次最大 ID: {batch_max_id}\n")
    
    return rows, batch_max_id, False


def cmd_query_range(start_id: int, end_id: int):
    """按 ID 区间查询待识别目录。统一通过脚本参数调用，避免 python -c 直接打印乱码。"""
    sync_scan_file_creators_from_scan_files()

    if start_id > end_id:
        print("[错误] --start-id 不能大于 --end-id")
        sys.exit(1)

    sql = """
        SELECT MIN(id) AS id, parent_path AS path
        FROM scan_file_creators
        WHERE creator_id IS NULL
          AND id BETWEEN ? AND ?
        GROUP BY parent_path
        ORDER BY MIN(id) ASC
    """
    result = query_db(sql, [start_id, end_id])
    rows = result.get('data', [])
    print_rows(rows)


def cmd_review_creator_assignments(creator_name: str, contains: str, batch_size: int):
    """列出需人工复核的已关联目录，不直接修改任何数据。"""
    normalized_creator_name = (creator_name or '').strip()
    normalized_contains = (contains or '').strip()
    if not normalized_creator_name or not normalized_contains:
        print('[错误] --review-creator-name 和 --contains 不能为空')
        sys.exit(1)

    creator_result = query_db(
        'SELECT id FROM creators WHERE primary_name = ? LIMIT 1',
        [normalized_creator_name],
    )
    creator_rows = creator_result.get('data', [])
    if not creator_rows:
        print(f"[错误] creators 中不存在 primary_name={normalized_creator_name!r} 的博主")
        sys.exit(1)

    creator_id = creator_rows[0]['id']
    sql = """
        SELECT MIN(id) AS id, parent_path AS path
        FROM scan_file_creators
        WHERE creator_id = ?
          AND parent_path LIKE ?
        GROUP BY parent_path
        ORDER BY MIN(id) ASC
        LIMIT ?
    """
    result = query_db(sql, [creator_id, f"%{normalized_contains}%", batch_size])
    rows = result.get('data', [])

    print("\n" + "=" * 60)
    print("Creator Assignment Review — 已关联目录复核")
    print("=" * 60)
    print(f"[筛选] 当前博主: {normalized_creator_name} (id={creator_id})")
    print(f"[筛选] 路径包含: {normalized_contains}")
    print_rows(rows)
    if not rows:
        print('[完成] 没有符合条件的已关联目录')
        return

    print("\n【AI 复核规则】")
    print("  1. 逐条人工分析目录，不得自动推断博主名。")
    print(f"  2. 当前列表包含 {normalized_contains!r}，禁止重新关联为 {normalized_creator_name!r}。")
    print("  3. 确认正确博主后逐目录执行：")
    print('     python identify_creator.py --path "目录路径" --name "正确博主名"')
    print("  4. 无法确认正确博主时逐目录执行：")
    print('     python identify_creator.py --path "目录路径" --unknown')


def cmd_link_by_name(creator_name: str):
    """仅根据博主名批量关联目录（parent_path LIKE '%name%'）。

    用于提效：当 AI 判断本批目录中出现博主名 A，可直接运行一次该命令完成批量更新，
    无需再为 A 选择“代表目录”。

    注意：为避免覆盖人工修正结果，只更新 creator_id IS NULL 的记录。
    """
    sync_scan_file_creators_from_scan_files()

    normalized = (creator_name or '').strip()
    if not normalized:
        print('[错误] --link-name 不能为空')
        sys.exit(1)

    creator_id = find_or_create_creator(normalized)
    dirs, files = batch_update_by_name(normalized, creator_id)
    if dirs == 0:
        print(f"[完成] 未找到 parent_path 包含 '{normalized}' 且 creator_id IS NULL 的记录")
    else:
        print(f"[完成] 已批量关联到博主 {normalized} (id={creator_id})")


def get_creator_aliases(creator_row: dict) -> list:
    """从 creators 表行中提取 primary_name + other_names(JSON数组) 的去重别名列表。"""
    names: list[str] = []

    primary = (creator_row.get('primary_name') or '').strip()
    if primary:
        names.append(primary)

    other_names_raw = creator_row.get('other_names')
    if isinstance(other_names_raw, str) and other_names_raw.strip():
        try:
            parsed = json.loads(other_names_raw)
            if isinstance(parsed, list):
                for item in parsed:
                    if isinstance(item, str):
                        n = item.strip()
                        if n:
                            names.append(n)
        except Exception:
            # ignore malformed json
            pass

    # 去重（保持顺序）
    deduped: list[str] = []
    seen = set()
    for n in names:
        if n not in seen:
            deduped.append(n)
            seen.add(n)

    return deduped


def link_by_creator_aliases(creator_id: int, aliases: list[str]) -> tuple[int, int]:
    """把 parent_path LIKE 任一别名 的未识别记录批量关联到 creator_id。

    注意：仅更新 creator_id IS NULL（不覆盖人工修正结果）。
    返回：(匹配目录数, 匹配文件数)
    """
    aliases = [a.strip() for a in (aliases or []) if isinstance(a, str) and a.strip()]
    if not aliases:
        return 0, 0

    like_conditions = ' OR '.join(['parent_path LIKE ?'] * len(aliases))
    like_params = [f"%{a}%" for a in aliases]

    count_sql = f"""
        SELECT COUNT(DISTINCT parent_path) AS dir_count, COUNT(*) AS file_count
        FROM scan_file_creators
        WHERE creator_id IS NULL
          AND ({like_conditions})
    """
    count_result = query_db(count_sql, like_params)
    count_rows = count_result.get('data', [])
    dir_count = count_rows[0].get('dir_count', 0) if count_rows else 0
    file_count = count_rows[0].get('file_count', 0) if count_rows else 0

    if dir_count == 0:
        return 0, 0

    update_sql = f"""
        UPDATE scan_file_creators
        SET creator_id = ?,
            updated_at = CURRENT_TIMESTAMP
        WHERE creator_id IS NULL
          AND ({like_conditions})
    """
    query_db(update_sql, [creator_id, *like_params])
    return dir_count, file_count


def cmd_link_by_creator_id(creator_id: int):
    """从 creators 表读取主名称+别名，批量关联 scan_file_creators。

    规则：
    - 查询 creators：SELECT id, primary_name, other_names FROM creators WHERE id = ?
    - 对 primary_name 与 other_names 列表中的每个别名，执行 parent_path LIKE '%别名%'
    - 将所有匹配且 creator_id IS NULL 的记录批量更新为该 creator_id
    """
    sync_scan_file_creators_from_scan_files()

    creator_result = query_db(
        'SELECT id, primary_name, other_names FROM creators WHERE id = ? LIMIT 1',
        [creator_id]
    )
    creator_rows = creator_result.get('data', [])
    if not creator_rows:
        print(f"[错误] creators 中不存在 id={creator_id} 的博主")
        sys.exit(1)

    creator_row = creator_rows[0]
    aliases = get_creator_aliases(creator_row)
    if not aliases:
        print(f"[错误] 博主 id={creator_id} 没有可用的 primary_name / other_names")
        sys.exit(1)

    print(f"[批量关联] 博主 id={creator_id}，别名数量={len(aliases)}")
    for a in aliases:
        print(f"  - {a}")

    dirs, files = link_by_creator_aliases(creator_id, aliases)
    if dirs == 0:
        print("[完成] 未找到匹配且 creator_id IS NULL 的目录")
    else:
        print(f"[完成] 已批量关联 {dirs} 个目录 / {files} 个文件 到 creator_id={creator_id}")


def get_remaining_count() -> int:
    """查询剩余未识别数量"""
    sql = """
        SELECT COUNT(DISTINCT parent_path) as cnt
        FROM scan_file_creators
        WHERE creator_id IS NULL
    """
    result = query_db(sql)
    rows = result.get("data", [])
    return rows[0].get("cnt", 0) if rows else 0


def find_or_create_creator(name: str) -> int:
    """查询或创建博主，返回 id"""
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
    rows = result.get("data", [])

    if rows:
        creator_id = rows[0]["id"]
        print(f"  ✓ 找到已有博主: {name} (id={creator_id})")
        return creator_id

    # 创建新博主
    insert_sql = (
        "INSERT INTO creators (primary_name, other_names, appearance_rating, body_rating, bio, avatar_path) "
        "VALUES (?, ?, null, null, null, 0)"
    )
    query_db(insert_sql, [name, json.dumps([name], ensure_ascii=False)])
    print(f"  ✓ 创建新博主: {name}")

    result = query_db(sql, [name, name])
    rows = result.get("data", [])
    if not rows:
        print(f"[错误] 创建博主后仍无法查询到 id: {name}")
        sys.exit(1)
    return rows[0]["id"]


def update_creator_id(target_path: str, creator_id: int):
    """基于目标目录，批量写入或更新 scan_file_creators 的 creator_id"""
    sql = """
        UPDATE scan_file_creators
        SET creator_id = ?,
            updated_at = CURRENT_TIMESTAMP
        WHERE parent_path = ?
    """
    query_db(sql, [creator_id, target_path])
    print(f"  ✓ 更新 creator_id={creator_id}")


def batch_update_by_name(name: str, creator_id: int) -> tuple[int, int]:
    """按博主名批量更新所有 parent_path 包含该名称的未识别目录"""
    count_sql = """
        SELECT COUNT(DISTINCT parent_path) AS dir_count, COUNT(*) AS file_count
        FROM scan_file_creators
        WHERE parent_path LIKE ?
          AND creator_id IS NULL
    """
    count_result = query_db(count_sql, [f"%{name}%"])
    count_rows = count_result.get("data", [])
    dir_count = count_rows[0].get("dir_count", 0) if count_rows else 0
    file_count = count_rows[0].get("file_count", 0) if count_rows else 0

    if dir_count == 0:
        return 0, 0

    update_sql = """
        UPDATE scan_file_creators
        SET creator_id = ?,
            updated_at = CURRENT_TIMESTAMP
        WHERE parent_path LIKE ?
          AND creator_id IS NULL
    """
    query_db(update_sql, [creator_id, f"%{name}%"])
    print(f"  ✓ 批量关联 {dir_count} 个目录 / {file_count} 个文件（parent_path LIKE '%{name}%')")
    return dir_count, file_count


def cmd_get(batch_size: int):
    """获取一批未识别目录，输出给 AI 分析"""
    sync_scan_file_creators_from_scan_files()

    stats = load_stats()
    last_id = stats["last_processed_id"]
    recent_sizes = stats.get("recent_batch_sizes", [])
    
    # 判断是否需要降级到逐个识别模式
    is_reduced_mode = should_reduce_batch_size(stats)
    
    # 更新降级模式状态到统计文件
    stats["is_reduced_mode"] = is_reduced_mode
    save_stats(stats)
    
    # 自适应批次大小和去重策略
    original_batch_size = batch_size
    if is_reduced_mode:
        batch_size = REDUCED_BATCH_SIZE
        print(f"\n{'='*60}")
        print(f"⚠️  【降级模式已启动】")
        print(f"{'='*60}")
        print(f"📌 批次大小：{original_batch_size} → {batch_size} 条")
        print(f"📌 去重策略：关闭（逐个目录识别）")
        print(f"📌 原因：最近5轮获取数据量都很少（≤2条）")
        print(f"📊 最近5轮数据量: {recent_sizes}")
        print(f"📋 本次将获取 {batch_size} 个目录，逐个分析")
        print(f"⚠️  重要：所有 {batch_size} 个目录都必须处理，无法识别的标记为 -1")
        print(f"{'='*60}\n")
    
    print("\n" + "=" * 60)
    print("Creator Identification — 博主识别任务（按目录聚合，顺序处理模式）")
    if is_reduced_mode:
        print("🔴 【降级模式】逐个目录识别")
    print("=" * 60)
    
    remaining = get_remaining_count()
    print(f"[统计] 剩余未识别: {remaining} 条")
    
    if stats["batch_count"] > 0:
        success_rate = (stats["total_identified"] / stats["total_analyzed"] * 100) if stats["total_analyzed"] > 0 else 0
        print(f"[统计] 已处理批次: {stats['batch_count']}, 分析: {stats['total_analyzed']} 条, 识别: {stats['total_identified']} 个 (成功率: {success_rate:.1f}%)")
        print(f"[统计] 上次处理到 ID: {last_id}")
        if len(recent_sizes) > 0:
            print(f"[统计] 最近批次数据量: {recent_sizes}")
        if is_reduced_mode:
            print(f"[统计] 🔴 当前模式: 降级模式")
    
    # 降级模式：跳过去重
    records, max_id, is_end = get_unidentified_batch(batch_size, last_id, skip_dedup=is_reduced_mode)
    
    if not records:
        if is_end:
            print("\n✅ 所有记录已处理完毕（已到达数据库末尾）")
            # 重置降级模式标记
            stats["is_reduced_mode"] = False
            save_stats(stats)
            return
        else:
            stats = update_batch_stats(0, max_id)
            stats["is_reduced_mode"] = is_reduced_mode
            save_stats(stats)
            print(f"\n⚠️  当前批次无符合条件的记录")
            print(f"✅ 已自动更新进度到 ID {max_id}")
            print(f"📌 剩余未识别记录: {remaining} 条")
            
            if should_reduce_batch_size(stats):
                print(f"\n💡 提示：最近5轮获取数据量都很少，下次将自动启动降级模式（{REDUCED_BATCH_SIZE} 条，不去重）")
            
            print(f"\n请再次运行以下命令继续下一批：")
            print(f"   python identify_creator.py --batch {original_batch_size}")
            return
    
    actual_max_id = max(record['id'] for record in records)
    stats = update_batch_stats(len(records), actual_max_id)
    stats["is_reduced_mode"] = is_reduced_mode
    save_stats(stats)
    
    print("=" * 60)
    print(f"【待识别目录】（共 {len(records)} 条）：")
    if is_reduced_mode:
        print("🔴 【降级模式提示】必须逐个分析所有目录，无法识别的使用 --unknown 标记为 -1")
    print("=" * 60)
    for i, record in enumerate(records, 1):
        try:
            print(f"  {i:>3}. [ID:{record['id']}] {record['path']}")
        except UnicodeEncodeError:
            safe_path = record['path'].encode('utf-8', errors='replace').decode('utf-8')
            print(f"  {i:>3}. [ID:{record['id']}] {safe_path}")
    
    print("\n" + "=" * 60)
    print("【AI 分析指引】：")
    print("=" * 60)
    print("  1. 逐条阅读目录路径，识别该目录默认对应的博主名称")
    print("  2. 对本批结果先做一次 AI 去重，只保留唯一博主名")
    print("     例如：这一批目录最终只识别出 A / B / C / D / E 五个博主")
    print("  3. 对每个唯一博主，选择一个代表目录执行一次写入命令：")
    print("     python identify_creator.py --path \"代表目录路径\" --name \"博主名\"")
    print("     （脚本会先更新该目录，再自动把所有 parent_path LIKE '%博主名%' 且 creator_id IS NULL 的目录批量关联过去）")
    print("     或者（更快）：直接按名称批量关联，无需挑代表目录：")
    print("     python identify_creator.py --link-name \"博主名\"")
    print("     或者（使用已有 creators 表别名批量关联）：")
    print("     python identify_creator.py --link-creator-id 123")
    print("  4. 无法识别且无法归入任何已识别博主的目录，单独使用：")
    print("     python identify_creator.py --path \"目录路径\" --unknown")
    print("  5. 如需按 ID 区间排查目录，必须使用脚本参数，不要使用 python -c 直接发 SQL：")
    print("     python identify_creator.py --start-id 119788 --end-id 156889")
    print("  6. 完成本批次后再次运行：")
    print(f"     python identify_creator.py --batch {original_batch_size}")
    print(f"     （将从 ID {actual_max_id} 继续处理）")
    print("=" * 60)


def cmd_write(target_path: str, creator_name: str):
    """写入识别结果"""
    print(f"\n[写入结果]")
    print(f"  目录: {target_path}")
    print(f"  博主: {creator_name if creator_name else '(无法识别)'}")

    # 防止已知误判再次写回：包含 moxing 的路径不得关联为 xin。
    if 'moxing' in target_path.lower() and creator_name.strip().lower() == 'xin':
        print("[错误] 路径包含 moxing，禁止关联为 xin；请重新识别正确博主或使用 --unknown")
        sys.exit(1)

    # 通常你会先运行 --batch 获取待识别目录（脚本会自动 sync）。
    # 为了提效，这里不做“每次写入都全量 sync”。仅在确实找不到目录时，再补齐一次并重试。
    sql = "SELECT MIN(id) AS id FROM scan_file_creators WHERE parent_path = ?"

    def ensure_dir_exists_in_scan_file_creators() -> int | None:
        result = query_db(sql, [target_path])
        rows = result.get("data", [])
        return rows[0]["id"] if rows else None

    record_id = ensure_dir_exists_in_scan_file_creators()
    if record_id is None:
        sync_scan_file_creators_from_scan_files()
        record_id = ensure_dir_exists_in_scan_file_creators()

    if record_id is None:
        print("[错误] 未在 scan_file_creators 中找到对应目录（即使补齐后仍不存在），无法写入识别结果")
        sys.exit(1)

    if not creator_name:
        update_creator_id(target_path, UNKNOWN_CREATOR_ID)
        print(f"  ✓ 已标记 creator_id={UNKNOWN_CREATOR_ID}")
    else:
        creator_id = find_or_create_creator(creator_name)
        update_creator_id(target_path, creator_id)
        batch_update_by_name(creator_name, creator_id)
        update_identify_stats()

    remaining = get_remaining_count()
    print(f"\n[完成] 剩余: {remaining} 条")


def cmd_status():
    """查看当前识别状态"""
    sync_scan_file_creators_from_scan_files()

    stats = load_stats()
    
    print("\n" + "=" * 60)
    print("Creator Identification — 当前状态（按目录聚合）")
    print("=" * 60)
    
    remaining = get_remaining_count()
    print(f"[统计] 剩余未识别: {remaining} 条")
    
    if stats["batch_count"] > 0:
        success_rate = (stats["total_identified"] / stats["total_analyzed"] * 100) if stats["total_analyzed"] > 0 else 0
        print(f"[统计] 已处理批次: {stats['batch_count']}")
        print(f"[统计] 已分析: {stats['total_analyzed']} 条")
        print(f"[统计] 已识别: {stats['total_identified']} 个")
        print(f"[统计] 成功率: {success_rate:.1f}%")
        print(f"[统计] 上次处理到 ID: {stats['last_processed_id']}")
        
        recent_sizes = stats.get("recent_batch_sizes", [])
        if len(recent_sizes) > 0:
            print(f"[统计] 最近批次数据量: {recent_sizes}")
        
        is_reduced = stats.get("is_reduced_mode", False)
        if is_reduced:
            print(f"\n🔴 【当前模式】降级模式")
            print(f"   - 批次大小: {REDUCED_BATCH_SIZE} 条")
            print(f"   - 去重策略: 关闭")
            print(f"   - 处理方式: 逐个目录识别")
            print(f"   - 重要提示: 所有目录都必须处理，无法识别的标记为 -1")
        else:
            print(f"\n✅ 【当前模式】正常模式")
            print(f"   - 查询策略: 直接按 parent_path 查询目录")
            print(f"   - 处理方式: 每个目录识别一次，并回填整个目录")
    else:
        print("\n尚未开始处理")
    
    print("=" * 60)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="媒体文件博主识别工具（按目录聚合的顺序处理模式）"
    )
    parser.add_argument("--batch", type=int, default=DEFAULT_BATCH_SIZE, help=f"每批获取的记录数量（默认 {DEFAULT_BATCH_SIZE}）")
    parser.add_argument("--path", type=str, default=None, help="目录路径（parent_path）")
    parser.add_argument(
        "--name",
        type=str,
        nargs='?',
        default=None,
        help="博主名（空字符串表示无法识别；写入时会额外批量关联 parent_path LIKE '%%博主名%%' 且 creator_id IS NULL 的目录）"
    )
    parser.add_argument(
        "--link-name",
        type=str,
        default=None,
        help="仅按博主名批量关联目录（等价 parent_path LIKE '%%name%%' 且 creator_id IS NULL），用于替代逐目录写入"
    )
    parser.add_argument(
        "--link-creator-id",
        type=int,
        default=None,
        help="从 creators 表读取主名称/别名，批量关联目录（等价 parent_path LIKE '%%别名%%'... 且 creator_id IS NULL）"
    )
    parser.add_argument("--start-id", type=int, default=None, help="查询待识别目录的起始 ID（用于替代 python -c 直接查 SQL）")
    parser.add_argument("--end-id", type=int, default=None, help="查询待识别目录的结束 ID（用于替代 python -c 直接查 SQL）")
    parser.add_argument("--review-creator-name", type=str, default=None, help="复核当前已关联到指定主名称的目录，需与 --contains 同时使用")
    parser.add_argument("--contains", type=str, default=None, help="复核时筛选 parent_path 必须包含的文本")
    parser.add_argument("--unknown", action="store_true", help="标记为无法识别（等同于 --name ''）")
    parser.add_argument("--reset-stats", action="store_true", help="重置统计数据（开始新一轮识别时使用）")
    parser.add_argument("--status", action="store_true", help="查看当前识别状态和模式")
    args = parser.parse_args()

    if args.unknown:
        args.name = ""

    if args.review_creator_name is not None or args.contains is not None:
        if args.review_creator_name is None or args.contains is None:
            print("[错误] --review-creator-name 和 --contains 必须同时提供")
            parser.print_help()
            sys.exit(1)
        if (
            args.path is not None or args.name is not None or args.unknown
            or args.link_name is not None or args.link_creator_id is not None
            or args.start_id is not None or args.end_id is not None
            or args.status or args.reset_stats
        ):
            print("[错误] 复核参数不能与其他操作参数同时使用")
            parser.print_help()
            sys.exit(1)
        cmd_review_creator_assignments(args.review_creator_name, args.contains, args.batch)
    elif args.status:
        cmd_status()
    elif args.reset_stats:
        reset_stats()
    elif args.start_id is not None or args.end_id is not None:
        if args.start_id is None or args.end_id is None:
            print("[错误] --start-id 和 --end-id 必须同时提供")
            parser.print_help()
            sys.exit(1)
        cmd_query_range(args.start_id, args.end_id)
    elif args.link_name is not None:
        if args.path is not None or args.name is not None or args.unknown:
            print("[错误] --link-name 不能与 --path/--name/--unknown 同时使用")
            parser.print_help()
            sys.exit(1)
        cmd_link_by_name(args.link_name)
    elif args.link_creator_id is not None:
        if args.path is not None or args.name is not None or args.unknown:
            print("[错误] --link-creator-id 不能与 --path/--name/--unknown 同时使用")
            parser.print_help()
            sys.exit(1)
        if args.link_name is not None:
            print("[错误] --link-creator-id 不能与 --link-name 同时使用")
            parser.print_help()
            sys.exit(1)
        cmd_link_by_creator_id(args.link_creator_id)
    elif args.path is not None and args.name is not None:
        cmd_write(args.path, args.name.strip())
    elif args.path is None and args.name is None:
        cmd_get(args.batch)
    else:
        print("[错误] --path 和 --name 必须同时提供，或都不提供")
        parser.print_help()
        sys.exit(1)
