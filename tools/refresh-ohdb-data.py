#!/usr/bin/env python3
"""Refresh Once Human build planner data from OHDB.

Pulls structured payloads from https://www.oncehumandb.com and writes normalized
JSON files under ../data. The app is static; this script is only for refreshing
local data when OHDB changes.
"""

from __future__ import annotations

import concurrent.futures
import html
import json
import re
import sys
import time
from pathlib import Path
from typing import Any
from urllib.request import Request, urlopen

BASE_URL = "https://www.oncehumandb.com"
ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / "data"
USER_AGENT = "Mozilla/5.0 (compatible; OnceHumanBuildPlanner/1.0; data refresh)"

LIST_PAGES = {
    "weapons": ("weapons", "weapons"),
    "armor": ("armor", "armor"),
    "mods": ("mods", "mods"),
    "deviations": ("deviations", "deviations"),
    "cradle": ("cradle-overrides", "overrides"),
    "items": ("items", "items"),
}

FOOD_CATEGORIES = {"Food", "Creative Cuisine", "Creative Beverages"}
FOOD_RARITIES = {"epic", "legendary"}
ANIMAL_SKIN_NAMES = {
    "Beach Crocodile Skin": "Hydration DMG Reduction",
    "Bear Skin": "Fullness DMG Reduction",
    "Cave Bear Skin": "DMG Recovery",
    "Coastal Bay Crocodile Skin": "Invisibility DMG Reduction",
    "Cowhide": "Crit DMG Reduction",
    "Crocodile Hide": "Hydration DMG Reduction",
    "Deer Hide": "Sprint DMG Reduction",
    "Desert Fox Skin": "Non-Combat DMG Reduction",
    "Dreamfused Cowhide": "Crit DMG Reduction",
    "Dreamfused Deer Hide": "Sprint DMG Reduction",
    "Dreamfused Rabbit Fur": "Mid-Air DMG Reduction",
    "Dreamfused Wolf Skin": "Weakspot Reduction",
    "Dreamfused Wool": "Danger DMG Reduction",
    "Dreamy Rabbit Fur": "Vaulting DMG Reduction",
    "Floating Ice Bear Skin": "Fullness DMG Reduction",
    "Forest Deer Hide": "Scope DMG Reduction",
    "Fox Skin": "Non-Combat DMG Reduction",
    "Golden Wool": "Random DMG Reduction",
    "Grassland Wolf Skin": "Team-Up DMG Reduction",
    "Hide": "Max HP",
    "Highland Deer Hide": "Sprint DMG Reduction",
    "Jungle Wolf Skin": "Weakspot Reduction",
    "Lucky Rabbit Fur": "Roll DMG Reduction",
    "Lunar Deer Hide": "Sprint DMG Reduction",
    "Lunar Rabbit Fur": "Mid-Air DMG Reduction",
    "Lunar Wolf Skin": "Weakspot Reduction",
    "Lunar Wool": "Danger DMG Reduction",
    "Mountain Cowhide": "Crit DMG Reduction",
    "Mountain Wool": "Non-Weakspot DMG Reduction",
    "Polar Fox Skin": "Non-Combat DMG Reduction",
    "Rabbit Fur": "Mid-Air DMG Reduction",
    "Rawhide": "",
    "Reindeer Hide": "Load DMG Reduction",
    "Rock Wall Wool": "Non-Weakspot DMG Reduction",
    "Sealskin": "Swimming DMG Reduction",
    "Snowfield Bear Skin": "Fullness Survivability",
    "Starfall Cowhide": "Crit DMG Reduction",
    "Starfall Crocodile Skin": "Hydration DMG Reduction",
    "Starfall Down": "Pollution Resist",
    "Starfall Fox Skin": "Non-Combat DMG Reduction",
    "Tundra Deer Hide": "Moving DMG Reduction",
    "Valley Cowhide": "Crit Recovery",
    "Velvet": "Pollution Resist",
    "Wasteland Wolf Skin": "Weakspot Reduction",
    "Wolf Skin": "Weakspot Reduction",
    "Wool": "Non-Weakspot DMG Reduction",
}
EXTRA_ANIMAL_SKIN_NAMES = {"Mutant Skin", "Shark Skin", "Squid Skin", "Starfall Fur", "Thick Skin"}


def fetch_text(url: str, retries: int = 2) -> str:
    last_error: Exception | None = None
    for attempt in range(1, retries + 1):
        try:
            request = Request(url, headers={"User-Agent": USER_AGENT})
            with urlopen(request, timeout=18) as response:
                return response.read().decode("utf-8", errors="replace")
        except Exception as exc:  # pragma: no cover - runtime network protection
            last_error = exc
            time.sleep(0.4 * attempt)
    raise RuntimeError(f"Failed to fetch {url}: {last_error}")


def extract_escaped_array(page_html: str, key: str) -> list[dict[str, Any]]:
    """Extract a Next/RSC escaped array like \"mods\":[{...}]."""
    marker = f'\\"{key}\\":['
    marker_index = page_html.find(marker)
    if marker_index < 0:
        raise ValueError(f"Could not find escaped array key: {key}")

    start = marker_index + len(f'\\"{key}\\":')
    depth = 0
    end: int | None = None

    for index, char in enumerate(page_html[start:], start):
        if char == "[":
            depth += 1
        elif char == "]":
            depth -= 1
            if depth == 0:
                end = index + 1
                break

    if end is None:
        raise ValueError(f"Could not find end of escaped array: {key}")

    escaped_json = page_html[start:end]
    decoded_json = escaped_json.encode("utf-8").decode("unicode_escape")
    return json.loads(decoded_json)


def extract_json_ld(page_html: str) -> list[dict[str, Any]]:
    blocks: list[dict[str, Any]] = []
    pattern = re.compile(r'<script type="application/ld\+json">(.*?)</script>', re.S)
    for match in pattern.finditer(page_html):
        raw = html.unescape(match.group(1))
        try:
            parsed = json.loads(raw)
        except json.JSONDecodeError:
            continue
        if isinstance(parsed, dict):
            blocks.append(parsed)
    return blocks


def item_page_data(url: str) -> dict[str, Any]:
    page_html = fetch_text(url)
    for block in extract_json_ld(page_html):
        if block.get("@type") == "ItemPage":
            entity = block.get("mainEntity") or {}
            props = {
                prop.get("name"): prop.get("value")
                for prop in entity.get("additionalProperty", [])
                if isinstance(prop, dict)
            }
            return {
                "description": entity.get("description") or block.get("description") or "",
                "pageDescription": block.get("description") or "",
                "properties": props,
                "dateModified": block.get("dateModified") or "",
            }
    return {"description": "", "pageDescription": "", "properties": {}, "dateModified": ""}


def normalize_url(kind: str, slug: str) -> str:
    if kind == "cradle":
        return f"{BASE_URL}/cradle-overrides/{slug}"
    return f"{BASE_URL}/{kind}/{slug}"


def with_details(kind: str, rows: list[dict[str, Any]], max_workers: int = 12) -> list[dict[str, Any]]:
    print(f"Fetching {kind} detail pages ({len(rows)} items)...", file=sys.stderr)

    def enrich(row: dict[str, Any]) -> dict[str, Any]:
        url = row["url"]
        try:
            detail = item_page_data(url)
        except Exception as exc:  # keep refresh resilient
            detail = {"description": f"Detail fetch failed: {exc}", "pageDescription": "", "properties": {}, "dateModified": ""}
        return {**row, **detail}

    enriched: list[dict[str, Any]] = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=max_workers) as executor:
        future_map = {executor.submit(enrich, row): row for row in rows}
        for index, future in enumerate(concurrent.futures.as_completed(future_map), 1):
            enriched.append(future.result())
            if index % 50 == 0:
                print(f"  {kind}: {index}/{len(rows)}", file=sys.stderr)
    enriched.sort(key=lambda item: item.get("name", ""))
    return enriched


def normalize_weapons(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    normalized = []
    for row in rows:
        normalized.append(
            {
                "id": row["slug"],
                "slug": row["slug"],
                "name": row["name"],
                "type": row.get("type") or "",
                "rarity": row.get("rarity") or "",
                "tier": row.get("tier"),
                "damage": row.get("damage"),
                "rpm": row.get("rpm"),
                "effect": row.get("description") or row.get("pageDescription") or "",
                "imageUrl": row.get("imageUrl") or "",
                "url": row["url"],
            }
        )
    return normalized


def normalize_armor(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    normalized = []
    for row in rows:
        props = row.get("properties") or {}
        normalized.append(
            {
                "id": row["slug"],
                "slug": row["slug"],
                "name": row["name"],
                "slot": row.get("armorType") or props.get("Armor Type") or "",
                "rarity": row.get("rarity") or "",
                "style": row.get("style") or "",
                "hp": row.get("hp") or props.get("HP") or "",
                "effect": row.get("description") or row.get("pageDescription") or "",
                "imageUrl": row.get("imageUrl") or "",
                "url": row["url"],
            }
        )
    return normalized


def normalize_mods(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [
        {
            "id": row["slug"],
            "slug": row["slug"],
            "name": row["name"],
            "category": row.get("category") or "",
            "slot": row.get("modType") or "",
            "variant": row.get("variant") or "",
            "rarity": row.get("rarity") or "",
            "effect": row.get("coreEffect") or "",
            "imageUrl": row.get("imageUrl") or "",
            "url": row["url"],
        }
        for row in rows
    ]


def normalize_deviations(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [
        {
            "id": row["slug"],
            "slug": row["slug"],
            "name": row["name"],
            "type": row.get("type") or "",
            "rarity": row.get("rarity") or "",
            "effect": row.get("description") or row.get("pageDescription") or "",
            "imageUrl": row.get("imageUrl") or "",
            "url": row["url"],
        }
        for row in rows
    ]


def normalize_cradle(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [
        {
            "id": row["slug"],
            "slug": row["slug"],
            "name": row["name"],
            "style": row.get("style") or "",
            "effect": row.get("description") or row.get("pageDescription") or "",
            "imageUrl": row.get("imageUrl") or "",
            "url": row["url"],
        }
        for row in rows
    ]


def normalize_food(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    normalized = []
    for row in rows:
        props = row.get("properties") or {}
        normalized.append(
            {
                "id": row["slug"],
                "slug": row["slug"],
                "name": row["name"],
                "category": row.get("category") or "",
                "rarity": row.get("rarity") or "",
                "weight": row.get("weight"),
                "effect": row.get("pageDescription") or row.get("description") or "",
                "description": row.get("description") or "",
                "imageUrl": row.get("imageUrl") or "",
                "url": row["url"],
                "properties": props,
            }
        )
    return normalized


def normalize_calibrations(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    normalized = []
    for row in rows:
        name = row["name"]
        normalized.append(
            {
                "id": row["slug"],
                "slug": row["slug"],
                "name": name,
                "shortName": name.removeprefix("Calibration Blueprint - "),
                "category": row.get("category") or "",
                "rarity": row.get("rarity") or "",
                "imageUrl": row.get("imageUrl") or "",
                "url": row["url"],
            }
        )
    return normalized


def normalize_animal_skins(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    normalized = []
    for row in rows:
        name = row["name"]
        normalized.append(
            {
                "id": row["slug"],
                "slug": row["slug"],
                "name": name,
                "category": row.get("category") or "",
                "rarity": row.get("rarity") or "",
                "effect": ANIMAL_SKIN_NAMES.get(name, ""),
                "imageUrl": row.get("imageUrl") or "",
                "url": row["url"],
            }
        )
    return normalized


def write_json(name: str, rows: list[dict[str, Any]]) -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    target = DATA_DIR / f"{name}.json"
    target.write_text(json.dumps(rows, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"Wrote {target.relative_to(ROOT)} ({len(rows)} rows)")


def main() -> int:
    raw: dict[str, list[dict[str, Any]]] = {}
    for dataset, (page, key) in LIST_PAGES.items():
        print(f"Fetching {page} list...", file=sys.stderr)
        page_html = fetch_text(f"{BASE_URL}/{page}")
        rows = extract_escaped_array(page_html, key)
        for row in rows:
            row["url"] = normalize_url("cradle" if dataset == "cradle" else page, row["slug"])
        raw[dataset] = rows

    food_rows = [
        row
        for row in raw["items"]
        if row.get("category") in FOOD_CATEGORIES and row.get("rarity") in FOOD_RARITIES
    ]
    animal_skin_rows = sorted(
        [
            row
            for row in raw["items"]
            if row.get("category") == "Materials"
            and (row.get("name") in ANIMAL_SKIN_NAMES or row.get("name") in EXTRA_ANIMAL_SKIN_NAMES)
        ],
        key=lambda item: item.get("name", ""),
    )
    calibration_rows = sorted(
        [
            row
            for row in raw["items"]
            if row.get("category") == "Calibration Blueprints"
            and row.get("name", "").startswith("Calibration Blueprint - ")
        ],
        key=lambda item: item.get("name", ""),
    )

    # Keep refresh practical: weapons and armor list payloads already include the
    # build-planner fields we need. Detail pages are fetched only where tooltip
    # effects matter and the list payload does not include them.
    detailed_deviations = with_details("deviations", raw["deviations"], max_workers=24)
    detailed_cradle = with_details("cradle", raw["cradle"], max_workers=24)
    detailed_food = with_details("food", food_rows, max_workers=24)

    write_json("weapons", normalize_weapons(raw["weapons"]))
    write_json("armor", normalize_armor(raw["armor"]))
    write_json("mods", normalize_mods(raw["mods"]))
    write_json("animal-skins", normalize_animal_skins(animal_skin_rows))
    write_json("calibrations", normalize_calibrations(calibration_rows))
    write_json("deviations", normalize_deviations(detailed_deviations))
    write_json("cradle", normalize_cradle(detailed_cradle))
    write_json("food", normalize_food(detailed_food))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
