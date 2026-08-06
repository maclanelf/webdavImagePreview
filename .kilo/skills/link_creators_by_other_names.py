#!/usr/bin/env python3
"""根据 creators.other_names 批量回填 scan_file_creators.creator_id。

通过项目 /api/admin/query-db 接口执行 SQL，复用应用的 MySQL 配置。

用法：
  python link_creators_by_other_names.py
  python link_creators_by_other_names.py --dry-run
  python link_creators_by_other_names.py --include-primary-name
  python link_creators_by_other_names.py --creator-id 123
  python link_creators_by_other_names.py --base-url http://127.0.0.1:3001
"""

from __future__ import annotations

import argparse
import ctypes
import io
import json
import os
import sys
from typing import Iterable

import requests


DEFAULT_BASE_URL = "http://192.168.101.103:3001"


def configure_console_utf8() -> None:
    """尽量统一 Windows 控制台 / Python IO 为 UTF-8。"""
    os.environ.setdefault("PYTHONIOENCODING", "utf-8")
    os.environ.setdefault("PYTHONUTF8", "1")

    if sys.platform == "win32":
        try:
            ctypes.windll.kernel32.SetConsoleCP(65001)
            ctypes.windll.kernel32.SetConsoleOutputCP(65001)
        except Exception:
            pass
        try:
            os.system("chcp 65001 >nul 2>&1")
        except Exception:
            pass

    for stream_name in ("stdin", "stdout", "stderr"):
        stream = getattr(sys, stream_name, None)
        if stream is None:
            continue
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")
        except Exception:
            if hasattr(stream, "buffer"):
                try:
                    setattr(sys, stream_name, io.TextIOWrapper(stream.buffer, encoding="utf-8", errors="replace"))
                except Exception:
                    pass


configure_console_utf8()


class QueryDbClient:
    def __init__(self, base_url: str) -> None:
        self.url = f"{base_url.rstrip('/')}/api/admin/query-db"

    def query(self, sql: str, params: list[object] | None = None) -> dict:
        try:
            response = requests.post(self.url, json={"sql": sql, "params": params or []}, timeout=60)
            response.raise_for_status()
        except requests.RequestException as error:
            raise RuntimeError(f"请求 MySQL 管理接口失败: {error}") from error

        result = response.json()
        if not result.get("success"):
            raise RuntimeError(f"SQL 执行失败: {result.get('error', '未知错误')}")
        return result


def fetch_creators(client: QueryDbClient, creator_id: int | None = None) -> list[dict]:
    sql = "SELECT id, primary_name, other_names FROM creators"
    params: list[object] = []
    if creator_id is not None:
        sql += " WHERE id = ?"
        params.append(creator_id)
    sql += " ORDER BY id ASC"
    return client.query(sql, params).get("data", [])


def dedupe_keep_order(values: Iterable[str]) -> list[str]:
    result: list[str] = []
    seen: set[str] = set()
    for value in values:
        if value not in seen:
            result.append(value)
            seen.add(value)
    return result


def parse_other_names(other_names_raw: object) -> list[str]:
    if not isinstance(other_names_raw, str) or not other_names_raw.strip():
        return []
    try:
        parsed = json.loads(other_names_raw)
    except json.JSONDecodeError:
        parsed = [other_names_raw]
    if not isinstance(parsed, list):
        return []
    return dedupe_keep_order(item.strip() for item in parsed if isinstance(item, str) and item.strip())


def build_aliases(primary_name: str | None, other_names_raw: object, include_primary_name: bool) -> list[str]:
    aliases = parse_other_names(other_names_raw)
    if include_primary_name and primary_name and primary_name.strip():
        aliases = dedupe_keep_order([primary_name.strip(), *aliases])
    return aliases


def escape_like(value: str) -> str:
    return value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def build_like_sql(aliases: list[str]) -> tuple[str, list[str]]:
    if not aliases:
        raise ValueError("aliases 不能为空")
    return " OR ".join(["parent_path LIKE ? ESCAPE '\\\\'"] * len(aliases)), [f"%{escape_like(alias)}%" for alias in aliases]


def preview_match_counts(client: QueryDbClient, aliases: list[str]) -> tuple[int, int]:
    where_sql, like_params = build_like_sql(aliases)
    result = client.query(
        f"""
        SELECT COUNT(DISTINCT parent_path) AS dir_count, COUNT(*) AS file_count
        FROM scan_file_creators
        WHERE creator_id IS NULL AND ({where_sql})
        """,
        like_params,
    )
    rows = result.get("data", [])
    row = rows[0] if rows else {}
    return int(row.get("dir_count") or 0), int(row.get("file_count") or 0)


def update_creator_links(client: QueryDbClient, creator_id: int, aliases: list[str]) -> int:
    where_sql, like_params = build_like_sql(aliases)
    result = client.query(
        f"""
        UPDATE scan_file_creators
        SET creator_id = ?
        WHERE creator_id IS NULL AND ({where_sql})
        """,
        [creator_id, *like_params],
    )
    return int(result.get("rowCount", 0))


def run(args: argparse.Namespace) -> int:
    client = QueryDbClient(args.base_url)
    print(f"[MySQL 管理接口] {client.url}")

    total_creators = total_dirs = total_files = total_updated_files = skipped_creators = 0
    creators = fetch_creators(client, args.creator_id)
    print(f"[creators] 读取到 {len(creators)} 条记录")
    if not creators:
        print("[完成] 没有可处理的 creators 记录")
        return 0

    for creator in creators:
        creator_id = int(creator["id"])
        primary_name = str(creator.get("primary_name") or "").strip()
        aliases = build_aliases(primary_name, creator.get("other_names"), args.include_primary_name)
        if not aliases:
            skipped_creators += 1
            print(f"[跳过] creator_id={creator_id}, primary_name={primary_name or '(空)'}，other_names 为空或不可解析")
            continue

        total_creators += 1
        dir_count, file_count = preview_match_counts(client, aliases)
        total_dirs += dir_count
        total_files += file_count
        print(f"[处理] creator_id={creator_id}, primary_name={primary_name or '(空)'}, aliases={' | '.join(aliases)}")
        print(f"       匹配目录: {dir_count}, 匹配文件: {file_count}")
        if args.dry_run or file_count == 0:
            continue
        updated_files = update_creator_links(client, creator_id, aliases)
        total_updated_files += updated_files
        print(f"       已更新文件数: {updated_files}")

    print("-" * 72)
    print(f"处理 creators 数: {total_creators}")
    print(f"跳过 creators 数: {skipped_creators}")
    print(f"预估匹配目录总数: {total_dirs}")
    print(f"预估匹配文件总数: {total_files}")
    print(f"实际写入文件总数: {0 if args.dry_run else total_updated_files}")
    print("[完成] creators.other_names 批量关联执行结束")
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="根据 creators.other_names 批量更新 scan_file_creators.creator_id")
    parser.add_argument("--base-url", default=os.environ.get("SKILL_BASE_URL", DEFAULT_BASE_URL), help="应用服务地址，也可通过 SKILL_BASE_URL 设置")
    parser.add_argument("--creator-id", type=int, default=None, help="只处理指定 creator_id")
    parser.add_argument("--include-primary-name", action="store_true", help="把 primary_name 也加入 LIKE 匹配条件")
    parser.add_argument("--dry-run", action="store_true", help="只预览匹配数量，不执行 UPDATE")
    return parser


if __name__ == "__main__":
    try:
        raise SystemExit(run(build_parser().parse_args()))
    except KeyboardInterrupt:
        print("\n[中断] 用户已取消执行")
        raise SystemExit(130)
    except Exception as exc:
        print(f"[错误] {exc}")
        raise SystemExit(1)
