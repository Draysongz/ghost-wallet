#!/usr/bin/env python3
"""
ghost_memory.py

Bridge between Ghost Wallet (Node/TS) and Sibyl Memory (Python library).

Four commands:
  store-rule    -- save a risk rule the user has stated
  store-lesson  -- save a record of what happened on a past trade
  list-rules    -- list all stored risk rules for a tenant
  list-lessons  -- list all stored trade lessons for a tenant

Node calls this script as a subprocess and reads the JSON it prints.

Multi-user note:
  Every command requires --tenant_id. One shared memory.db (the default
  path below) serves every Ghost Wallet user; isolation is enforced by
  Sibyl Memory itself, scoped once at MemoryClient.local(tenant_id=...)
  construction -- every call made on that client instance (set_entity,
  list_entities) is automatically scoped to that tenant. Use the user's
  wallet address as tenant_id -- it's already the unique per-user
  identifier in this product, so there's no need for a second user-ID
  system.

Usage examples (run these yourself in a terminal to test):

  python3 ghost_memory.py store-rule \
      --tenant_id 0xUSERWALLET \
      --rule_type max_exposure_pct \
      --applies_to meme-tokens \
      --threshold 20 \
      --unit percent \
      --notes "Got burned twice going all-in on meme coins"

  python3 ghost_memory.py store-lesson \
      --tenant_id 0xUSERWALLET \
      --asset PEPE \
      --category_tags meme,low-liquidity \
      --position_size_usd 500 \
      --outcome_pct -68 \
      --lesson "Sold a third at the top, held the rest into a rug"

  python3 ghost_memory.py list-rules --tenant_id 0xUSERWALLET
  python3 ghost_memory.py list-lessons --tenant_id 0xUSERWALLET
"""

import argparse
import json
import uuid
from datetime import datetime, timezone

from sibyl_memory_client import MemoryClient

# Ghost Wallet stores two distinct kinds of memory, in two separate
# categories within the same tenant. See schema.ts for field definitions --
# this file only needs to know the category names and how to build a
# unique `name` for each entity.
CATEGORY_RULES = "ghost-risk-rule"
CATEGORY_LESSONS = "ghost-trade-lesson"

DEFAULT_DB_PATH = "~/.sibyl-memory/memory.db"

VALID_UNITS = ("percent", "usd", "hours", "none")


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def make_rule_name(rule_type: str, applies_to: str) -> str:
    # Unique per (rule_type, applies_to). Storing the same combo again
    # overwrites the old rule -- that's intentional, it's an update.
    return f"{rule_type}__{applies_to}"


def make_lesson_name(asset: str) -> str:
    # NOT overwrite-by-name: many lessons can stack for the same asset,
    # so the name must be unique per lesson, not per asset. Timestamp +
    # short UUID suffix keeps names sortable and collision-proof.
    ts = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%f")
    return f"{asset}__{ts}__{uuid.uuid4().hex[:8]}"


def get_client(tenant_id: str, db_path: str) -> MemoryClient:
    # One shared local memory file, scoped once here by tenant_id.
    # Every call made on the returned client (set_entity, list_entities)
    # is automatically scoped to this tenant -- verified against the
    # library's real signatures, not assumed.
    return MemoryClient.local(db_path, tenant_id=tenant_id)


def cmd_store_rule(args: argparse.Namespace) -> None:
    client = get_client(args.tenant_id, args.db_path)
    name = make_rule_name(args.rule_type, args.applies_to)

    body = {
        "rule_type": args.rule_type,
        "applies_to": args.applies_to,
        "threshold": args.threshold,
        "unit": args.unit,
        "notes": args.notes or "",
        "created_at": _now_iso(),
    }

    result = client.set_entity(CATEGORY_RULES, name, body)
    print(json.dumps({"ok": True, "action": "store_rule", "entity": result}))


def cmd_store_lesson(args: argparse.Namespace) -> None:
    client = get_client(args.tenant_id, args.db_path)
    name = make_lesson_name(args.asset)

    category_tags = [t.strip() for t in args.category_tags.split(",") if t.strip()]

    body = {
        "asset": args.asset,
        "category_tags": category_tags,
        "position_size_usd": args.position_size_usd,
        "outcome_pct": args.outcome_pct,
        "lesson": args.lesson,
        "created_at": _now_iso(),
    }

    result = client.set_entity(CATEGORY_LESSONS, name, body)
    print(json.dumps({"ok": True, "action": "store_lesson", "entity": result}))


def cmd_list_rules(args: argparse.Namespace) -> None:
    client = get_client(args.tenant_id, args.db_path)
    # list_entities has a native `limit` param -- use it directly instead
    # of fetching everything and slicing after the fact.
    entities = client.list_entities(category=CATEGORY_RULES, limit=args.limit or 100)
    print(json.dumps({"ok": True, "action": "list_rules", "entities": entities}))


def cmd_list_lessons(args: argparse.Namespace) -> None:
    client = get_client(args.tenant_id, args.db_path)
    entities = client.list_entities(category=CATEGORY_LESSONS, limit=args.limit or 100)
    print(json.dumps({"ok": True, "action": "list_lessons", "entities": entities}))


def _add_common_args(sub: argparse.ArgumentParser) -> None:
    sub.add_argument(
        "--tenant_id",
        required=True,
        help="Unique per-user identifier (use the user's wallet address)",
    )
    sub.add_argument(
        "--db_path",
        required=False,
        default=DEFAULT_DB_PATH,
        help=f"Path to the shared Sibyl Memory DB file (default: {DEFAULT_DB_PATH})",
    )


def main() -> None:
    parser = argparse.ArgumentParser(description="Ghost Wallet <-> Sibyl Memory bridge")
    subparsers = parser.add_subparsers(dest="command", required=True)

    store_rule_parser = subparsers.add_parser("store-rule", help="Save a risk rule")
    _add_common_args(store_rule_parser)
    store_rule_parser.add_argument("--rule_type", required=True, help="e.g. max_exposure_pct")
    store_rule_parser.add_argument("--applies_to", required=True, help="e.g. meme-tokens, or *")
    store_rule_parser.add_argument("--threshold", required=True, type=float)
    store_rule_parser.add_argument("--unit", required=True, choices=VALID_UNITS)
    store_rule_parser.add_argument("--notes", required=False, default="", help="Why this rule exists")
    store_rule_parser.set_defaults(func=cmd_store_rule)

    store_lesson_parser = subparsers.add_parser("store-lesson", help="Save a trade lesson")
    _add_common_args(store_lesson_parser)
    store_lesson_parser.add_argument("--asset", required=True, help="Token symbol/name")
    store_lesson_parser.add_argument(
        "--category_tags",
        required=True,
        help="Comma-separated tags for matching future trades, e.g. 'meme,low-liquidity'",
    )
    store_lesson_parser.add_argument("--position_size_usd", required=True, type=float)
    store_lesson_parser.add_argument(
        "--outcome_pct", required=True, type=float, help="e.g. -68 for a 68%% loss"
    )
    store_lesson_parser.add_argument("--lesson", required=True, help="Plain-language takeaway")
    store_lesson_parser.set_defaults(func=cmd_store_lesson)

    list_rules_parser = subparsers.add_parser("list-rules", help="List all stored risk rules")
    _add_common_args(list_rules_parser)
    list_rules_parser.add_argument("--limit", required=False, type=int, default=None)
    list_rules_parser.set_defaults(func=cmd_list_rules)

    list_lessons_parser = subparsers.add_parser("list-lessons", help="List all stored trade lessons")
    _add_common_args(list_lessons_parser)
    list_lessons_parser.add_argument("--limit", required=False, type=int, default=None)
    list_lessons_parser.set_defaults(func=cmd_list_lessons)

    args = parser.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()