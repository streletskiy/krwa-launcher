"""Bounded, resumable transfer of sparse region files for a full-world trip."""

import hashlib
import json
import math
import re
import shutil
import zipfile

from anvil import chunk, level_data, record
from whole import DIMENSIONS, REGION

PART = 4 * 1024**2
MAX_TOTAL = 2 * 1024**3
HASH = re.compile(r"[0-9a-f]{64}")
TERRAIN = re.compile(r"(?:(DIM-1|DIM1)/)?region/(r\.-?\d{1,7}\.-?\d{1,7}\.mca)")


def region_location(name):
    match = TERRAIN.fullmatch(name)
    if not match:
        raise ValueError("Неизвестный регион или измерение.")
    prefix = (match[1] + "/") if match[1] else ""
    dimension = next(key for key, value in DIMENSIONS.items() if value == prefix)
    rx, rz = map(int, REGION.fullmatch(match[2]).groups())
    if abs(rx) > 58594 or abs(rz) > 58594:
        raise ValueError("Регион за пределами карты.")
    return dimension, prefix, rx, rz


def slots(data, rx, rz):
    if len(data) < 8192 or len(data) % 4096:
        raise ValueError("Неполный файл региона.")
    for i in range(1024):
        if data[4 * i : 4 * i + 4] != bytes(4):
            yield rx * 32 + i % 32, rz * 32 + i // 32


def manifest(files):
    if not isinstance(files, list) or not 1 <= len(files) <= 8192:
        raise ValueError("Некорректный список файлов.")
    paths, parts, total = set(), [], 0
    for item in files:
        if not isinstance(item, dict) or set(item) != {"path", "bytes", "parts"}:
            raise ValueError("Некорректный файл передачи.")
        name, size, hashes = item["path"], item["bytes"], item["parts"]
        if not isinstance(name, str) or name in paths:
            raise ValueError("Повторяющийся файл.")
        paths.add(name)
        if name != "level.dat":
            region_location(name)
        maximum = PART if name == "level.dat" else 256 * 1024**2
        if (
            type(size) is not int
            or not 0 < size <= maximum
            or not isinstance(hashes, list)
            or len(hashes) != (size + PART - 1) // PART
        ):
            raise ValueError("Некорректный размер файла.")
        total += size
        if total > MAX_TOTAL:
            raise ValueError(
                "Одна отправка может содержать до 2 ГиБ изменённых чанков."
            )
        for n, value in enumerate(hashes):
            if not isinstance(value, str) or not HASH.fullmatch(value):
                raise ValueError("Некорректная контрольная сумма.")
            parts.append((value, min(PART, size - n * PART)))
    if "level.dat" not in paths:
        raise ValueError("В посылке отсутствует персонаж.")
    key = hashlib.sha256(
        json.dumps(files, sort_keys=True, separators=(",", ":")).encode()
    ).hexdigest()
    return key, parts, total


def assemble(directory, files, output):
    with zipfile.ZipFile(
        output, "x", allowZip64=True, compression=zipfile.ZIP_DEFLATED, compresslevel=1
    ) as archive:
        for item in files:
            with archive.open(item["path"], "w", force_zip64=True) as dst:
                for key in item["parts"]:
                    with (directory / key).open("rb") as src:
                        shutil.copyfileobj(src, dst, 1024 * 1024)
    with zipfile.ZipFile(output) as archive:
        for item in files:
            name = item["path"]
            data = archive.read(name)
            if name == "level.dat":
                player = level_data(data)["Data"]["Player"]
                pos = player.get("Pos", [])
                if len(pos) != 3 or not all(
                    math.isfinite(float(n)) and abs(float(n)) <= 30000000 for n in pos
                ):
                    raise ValueError("Некорректная позиция игрока.")
                if str(player.get("Dimension")) not in DIMENSIONS:
                    raise ValueError(
                        "Завершите поездку в одном из трёх основных измерений."
                    )
                continue
            _, _, rx, rz = region_location(name)
            for x, z in slots(data, rx, rz):
                t = chunk(record(data, x, z))
                if (int(t["xPos"]), int(t["zPos"]), int(t["DataVersion"])) != (
                    x,
                    z,
                    3955,
                ):
                    raise ValueError("Координаты или версия чанка не совпадают.")
