"""Bounded, resumable transfer of sparse region files for a full-world trip."""

import hashlib
import json
import math
import re
import shutil
import zipfile

from anvil import chunk, level_data, record
from whole import DIMENSIONS, REGION, dimension_prefix
from progress import progress_paths
from vehicles import location, REMOVED

PART = 4 * 1024**2
MAX_TOTAL = 2 * 1024**3
HASH = re.compile(r"[0-9a-f]{64}")


def region_location(name, dimensions=None):
    prefix, sep, filename = name.rpartition("region/")
    match = REGION.fullmatch(filename)
    if not sep or not match:
        raise ValueError("Неизвестный регион или измерение.")
    dimension = next((k for k, v in DIMENSIONS.items() if v == prefix), None)
    if dimension is None:
        parts = prefix.rstrip("/").split("/")
        if len(parts) < 3 or parts[0] != "dimensions":
            raise ValueError("Неизвестное измерение.")
        dimension = parts[1] + ":" + "/".join(parts[2:])
        if dimension_prefix(dimension) != prefix:
            raise ValueError("Некорректный путь измерения.")
    if dimensions is not None and dimension not in dimensions:
        raise ValueError("Измерение отсутствует в снимке.")
    rx, rz = map(int, match.groups())
    if abs(rx) > 58594 or abs(rz) > 58594:
        raise ValueError("Регион за пределами карты.")
    return dimension, prefix, rx, rz


def slots(data, rx, rz):
    if len(data) < 8192:
        raise ValueError("Неполный файл региона.")
    for i in range(1024):
        if data[4 * i : 4 * i + 4] != bytes(4):
            yield rx * 32 + i % 32, rz * 32 + i // 32


def manifest(files, uid=None, dimensions=None):
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
        logical = name.removeprefix(REMOVED)
        vehicle = location(logical, dimensions or DIMENSIONS)
        if name.startswith(REMOVED) and (not vehicle or size != 1):
            raise ValueError("Недопустимая запись удаления.")
        if name != "level.dat" and name not in progress_paths(uid) and not vehicle:
            region_location(name, dimensions)
        maximum = (
            PART
            if name == "level.dat"
            else (16 * 1024**2 if name in progress_paths(uid) else 256 * 1024**2)
        )
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
    if any(n.removeprefix(REMOVED) in paths for n in paths if n.startswith(REMOVED)):
        raise ValueError("Один файл указан для записи и удаления.")
    if "level.dat" not in paths:
        raise ValueError("В посылке отсутствует персонаж.")
    key = hashlib.sha256(
        json.dumps(files, sort_keys=True, separators=(",", ":")).encode()
    ).hexdigest()
    return key, parts, total


def assemble(directory, files, output, uid=None, dimensions=None):
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
                if str(player.get("Dimension")) not in (dimensions or DIMENSIONS):
                    raise ValueError("Измерение игрока отсутствует в снимке.")
                continue
            if name in progress_paths(uid) or location(
                name.removeprefix(REMOVED), dimensions or DIMENSIONS
            ):
                continue
            _, _, rx, rz = region_location(name, dimensions)
            for x, z in slots(data, rx, rz):
                t = chunk(record(data, x, z))
                if (int(t["xPos"]), int(t["zPos"]), int(t["DataVersion"])) != (
                    x,
                    z,
                    3955,
                ):
                    raise ValueError("Координаты или версия чанка не совпадают.")
