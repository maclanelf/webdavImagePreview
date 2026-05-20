#!/usr/bin/env python3
from __future__ import annotations

import argparse
from collections import Counter
from pathlib import Path


def transform_sql(sql_text: str) -> tuple[str, dict[str, object]]:
    output: list[str] = []
    index = 0
    in_single_quoted_string = False
    unquoted_identifier_replacements = 0
    backtick_identifier_replacements = 0
    unquoted_identifier_details: Counter[str] = Counter()
    backtick_identifier_details: Counter[str] = Counter()

    while index < len(sql_text):
        current_char = sql_text[index]

        if in_single_quoted_string:
            if current_char == "'":
                if index + 1 < len(sql_text) and sql_text[index + 1] == "'":
                    output.append("''")
                    index += 2
                    continue

                in_single_quoted_string = False

            output.append(current_char)
            index += 1
            continue

        if current_char == "'":
            in_single_quoted_string = True
            output.append(current_char)
            index += 1
            continue

        if current_char == '"':
            end_index = index + 1
            while end_index < len(sql_text) and sql_text[end_index] != '"':
                end_index += 1

            if end_index >= len(sql_text):
                output.append(current_char)
                index += 1
                continue

            identifier = sql_text[index + 1:end_index]
            if identifier == 'creators':
                output.append('creators')
                unquoted_identifier_replacements += 1
                unquoted_identifier_details[identifier] += 1
            else:
                output.append(f'`{identifier}`')
                backtick_identifier_replacements += 1
                backtick_identifier_details[identifier] += 1

            index = end_index + 1
            continue

        output.append(current_char)
        index += 1

    return ''.join(output), {
        'unquoted_identifier_replacements': unquoted_identifier_replacements,
        'backtick_identifier_replacements': backtick_identifier_replacements,
        'total_replacements': unquoted_identifier_replacements + backtick_identifier_replacements,
        'unquoted_identifier_details': dict(unquoted_identifier_details),
        'backtick_identifier_details': dict(backtick_identifier_details),
    }


def build_default_output_path(input_path: Path) -> Path:
    return input_path.with_name(f"{input_path.stem}.converted{input_path.suffix}")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            '将 creators.sql 中的表名双引号去掉，并把字段名等 SQL 标识符的双引号转换为反引号。'
        )
    )
    parser.add_argument('input_file', help='输入 SQL 文件路径')
    parser.add_argument('output_file', nargs='?', help='输出 SQL 文件路径')
    parser.add_argument(
        '--in-place',
        action='store_true',
        help='直接覆盖输入文件',
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    input_path = Path(args.input_file)

    if not input_path.exists():
        raise SystemExit(f'输入文件不存在: {input_path}')

    if args.in_place:
        output_path = input_path
    elif args.output_file:
        output_path = Path(args.output_file)
    else:
        output_path = build_default_output_path(input_path)

    original_sql_text = input_path.read_text(encoding='utf-8')
    transformed_sql_text, stats = transform_sql(original_sql_text)
    output_path.write_text(transformed_sql_text, encoding='utf-8')

    print(f'转换完成: {output_path}')
    print(f'实际总替换次数: {stats["total_replacements"]}')
    print(f'去掉双引号的标识符次数: {stats["unquoted_identifier_replacements"]}')
    print(f'改为反引号的字段标识符次数: {stats["backtick_identifier_replacements"]}')

    if stats['unquoted_identifier_details']:
        print('去掉双引号的标识符明细:')
        for identifier, count in sorted(stats['unquoted_identifier_details'].items()):
            print(f'  {identifier}: {count}')

    if stats['backtick_identifier_details']:
        print('改为反引号的字段标识符明细:')
        for identifier, count in sorted(stats['backtick_identifier_details'].items()):
            print(f'  {identifier}: {count}')


if __name__ == '__main__':
    main()
