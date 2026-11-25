"""Export just the permitted square. Server paths never come from the client."""

import gzip
import math
import struct
import uuid
import zipfile
from collections import defaultdict
from pathlib import Path

import nbtlib
from anvil import (
    chunk,
    decode,
    encode,
    index,
    inflate,
    level_data,
    read_region,
    record,
    region_name,
    replace_records,
)

RADIUS = 2
MAX_UPLOAD = 48 * 1024**2
FOLDERS = ("region", "entities", "poi")
FIELDS = ("Inventory", "EnderItems", "XpLevel", "XpP", "XpTotal")


# World-wide/team data and entity identities cannot be spliced into a live server.
# Export terrain and block entities; travel mobs are simulated locally.
def player_file(root, uid):
    return Path(root) / "playerdata" / (str(uuid.UUID(uid)) + ".dat")


def get_player(root, uid):
    file = player_file(root, uid)
    if not file.is_file():
        raise ValueError("Сначала зайдите в основной мир и выйдите из игры.")
    return decode(inflate(file.read_bytes(), 31))


def area(cx, cz):
    return [
        (x, z)
        for z in range(cz - RADIUS, cz + RADIUS + 1)
        for x in range(cx - RADIUS, cx + RADIUS + 1)
    ]


def export_world(root, uid, name, target, center=None):
    player = get_player(root, uid)
    if str(player.get("Dimension")) != "minecraft:overworld":
        raise ValueError("Перед поездкой выйдите из игры в обычном мире.")
    pos = list(map(float, player["Pos"]))
    cx, cz = math.floor(pos[0] / 16), math.floor(pos[2] / 16)
    if center is not None:
        if abs(cx - center[0]) > RADIUS or abs(cz - center[1]) > RADIUS:
            raise ValueError(
                "Выйдите из игры в пределах участка, разрешённого администратором."
            )
        cx, cz = center
    data = level_data((root / "level.dat").read_bytes())
    level = data["Data"]
    player.pop("RootVehicle", None)
    player.pop("ShoulderEntityLeft", None)
    player.pop("ShoulderEntityRight", None)
    for k in (
        "SpawnX",
        "SpawnY",
        "SpawnZ",
        "SpawnDimension",
        "SpawnForced",
        "SpawnAngle",
    ):
        player.pop(k, None)
    for axis, value in zip("XYZ", pos):
        level["Spawn" + axis] = nbtlib.Int(math.floor(value))
    dimensions = level.get("WorldGenSettings", {}).get("dimensions", {})
    if "minecraft:overworld" in dimensions:
        # A newly decorated neighbouring chunk can generate ore and structures
        # inside an already saved parcel. Outside the border, generate empty terrain.
        dimensions["minecraft:overworld"]["generator"] = nbtlib.Compound(
            {
                "type": nbtlib.String("minecraft:flat"),
                "settings": nbtlib.Compound(
                    {
                        "biome": nbtlib.String("minecraft:plains"),
                        "layers": nbtlib.List[nbtlib.Compound](
                            [
                                nbtlib.Compound(
                                    {
                                        "height": nbtlib.Int(1),
                                        "block": nbtlib.String("minecraft:air"),
                                    }
                                )
                            ]
                        ),
                        "structure_overrides": nbtlib.List[nbtlib.String]([]),
                        "features": nbtlib.Byte(0),
                        "lakes": nbtlib.Byte(0),
                    }
                ),
            }
        )
    level["Player"] = nbtlib.Compound(player)
    level["LevelName"] = nbtlib.String("KRWA · " + name)
    level["allowCommands"] = nbtlib.Byte(0)
    level["BorderCenterX"] = nbtlib.Double(cx * 16 + 8)
    level["BorderCenterZ"] = nbtlib.Double(cz * 16 + 8)
    size = (2 * RADIUS + 1) * 16
    level["BorderSize"] = level["BorderSizeLerpTarget"] = nbtlib.Double(size)
    level["BorderSizeLerpTime"] = nbtlib.Long(0)
    tiles = area(cx, cz)
    emitted = []
    with zipfile.ZipFile(
        target, "x", compression=zipfile.ZIP_DEFLATED, compresslevel=2
    ) as archive:
        archive.writestr("level.dat", gzip.compress(encode(data), mtime=0))
        for folder in FOLDERS:
            groups = defaultdict(list)
            for x, z in tiles:
                groups[region_name(x, z, folder)].append((x, z))
            for rel, coords in groups.items():
                source = read_region(root, rel)
                records = {}
                for x, z in coords:
                    payload = record(source, x, z)
                    if payload is None:
                        continue
                    if folder == "region":
                        parsed = chunk(payload)
                        if str(parsed.get("Status")) not in ("minecraft:full", "full"):
                            continue
                        if int(parsed["xPos"]) != x or int(parsed["zPos"]) != z:
                            raise ValueError("Ошибка координат исходного мира.")
                        emitted.append((x, z))
                    if folder == "entities":
                        # Do not export other players' pets, villagers or moving ships.
                        continue
                    records[index(x, z)] = payload
                if records:
                    archive.writestr(rel, replace_records(b"", records))
        if (math.floor(pos[0] / 16), math.floor(pos[2] / 16)) not in emitted:
            raise ValueError("Чанк игрока ещё не сохранён.")
    return {
        "cx": cx,
        "cz": cz,
        "radius": RADIUS,
        "chunks": emitted,
        "dimension": "minecraft:overworld",
    }


def read_package(path, allowed):
    files = {}
    total = 0
    # Our writer and the launcher produce ordinary single-disk ZIPs without a comment.
    # Bound central-directory allocation before constructing ZipInfo objects.
    with path.open("rb") as source:
        source.seek(-22, 2)
        footer = source.read(22)
    sig, disk, start_disk, n_disk, n_total, table_size, table_off, comment = (
        struct.unpack("<4s4H2IH", footer)
    )
    if (
        sig != b"PK\x05\x06"
        or disk
        or start_disk
        or comment
        or n_disk != n_total
        or not 1 <= n_total <= 24
        or table_size > 8192
        or table_off + table_size != path.stat().st_size - 22
    ):
        raise ValueError("Некорректный каталог ZIP.")
    with zipfile.ZipFile(path) as archive:
        if len(archive.infolist()) > 24:
            raise ValueError("Слишком много файлов в поездке.")
        for item in archive.infolist():
            if item.filename not in allowed or item.filename in files:
                raise ValueError("Посторонние или повторяющиеся файлы в поездке.")
            total += item.file_size
            if total > MAX_UPLOAD or item.file_size < 1:
                raise ValueError("Слишком большой архив мира.")
            files[item.filename] = archive.read(item)
    if "level.dat" not in files:
        raise ValueError("В архиве отсутствует level.dat.")
    return files


def validate_upload(path, meta):
    files = read_package(path, supported_files(meta))
    current = level_data(files["level.dat"])["Data"]["Player"]
    if len(current["Pos"]) != 3 or not all(
        math.isfinite(float(x)) for x in current["Pos"]
    ):
        raise ValueError("Некорректная позиция.")
    for cx, cz in meta["chunks"]:
        raw = record(files[region_name(cx, cz)], cx, cz)
        if raw is None:
            raise ValueError("Отсутствует выданный чанк.")
        parsed = chunk(raw)
        if int(parsed["DataVersion"]) != 3955 or (
            int(parsed["xPos"]),
            int(parsed["zPos"]),
        ) != (cx, cz):
            raise ValueError("Чанк другого мира.")


def supported_files(meta):
    return (
        {"level.dat"}
        | {region_name(x, z) for x, z in meta["chunks"]}
        | {region_name(x, z, "poi") for x, z in meta["chunks"]}
    )
