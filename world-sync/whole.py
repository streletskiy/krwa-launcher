"""Download manifest for the saved dimensions of a Java world."""

import gzip
import hashlib
import re
import shutil
import zipfile

import nbtlib
from progress import snapshot_progress
from anvil import encode, level_data
from parcel import get_player

DIMENSIONS = {
    "minecraft:overworld": "",
    "minecraft:the_nether": "DIM-1/",
    "minecraft:the_end": "DIM1/",
}
REGION = re.compile(r"r\.(-?\d+)\.(-?\d+)\.mca")
EXTERNAL = re.compile(r"c\.-?\d+\.-?\d+\.mcc")


def dimension_prefix(key):
    if key in DIMENSIONS:
        return DIMENSIONS[key]
    if not isinstance(key, str) or not re.fullmatch(
        r"[a-z0-9_-][a-z0-9_.-]*:[a-z0-9_.-]+(?:/[a-z0-9_.-]+)*", key
    ):
        raise ValueError("Некорректное измерение.")
    parts = key.replace(":", "/").split("/")
    if any(part.endswith(".") or part in (".", "..") for part in parts):
        raise ValueError("Некорректный путь измерения.")
    return "dimensions/" + "/".join(parts) + "/"


def dimensions(root, level):
    found = dict(DIMENSIONS)
    keys = set(level["Data"].get("WorldGenSettings", {}).get("dimensions", {}))
    for group in ("region", "entities", "poi", "data", "sublevels"):
        for folder in (root / "dimensions").rglob(group):
            parts = folder.parent.relative_to(root / "dimensions").parts
            if len(parts) >= 2 and folder.is_dir():
                keys.add(parts[0] + ":" + "/".join(parts[1:]))
    for key in sorted(keys):
        found[key] = dimension_prefix(key)
    return found


def dimension_files(root, prefixes):
    for prefix in prefixes:
        patterns = {
            "region": (REGION, EXTERNAL),
            "poi": (REGION, EXTERNAL),
            "entities": (REGION, EXTERNAL),
            "sublevels": (re.compile(r"r\.-?\d+\.-?\d+\.slvlr"),),
            "data": (
                re.compile(
                    r"(?:map_\d+|idcounts|raids(?:_end)?|random_sequences|aeronautics_unloaded_balloons|create_aeronautics_automated_logistics_(?:runtime|ship_body_directory)|sable_sub_level_force_load_tickets)\.dat"
                ),
            ),
            "": (re.compile(r"mfix_stronghold_cache_v2\.nbt"),),
        }
        if not prefix:
            patterns["serverconfig"] = (
                re.compile(
                    r"openpartiesandclaims-(?:default-player|expired-claim|server-claim|wilderness)-config\.toml"
                ),
            )
        for group, allowed in patterns.items():
            folder = root / prefix / group
            if not folder.is_dir():
                continue
            for path in sorted(folder.iterdir()):
                if any(pattern.fullmatch(path.name) for pattern in allowed):
                    if (
                        path.is_symlink()
                        or not path.is_file()
                        or path.resolve().parent != folder.resolve()
                        or not path.resolve().is_relative_to(root.resolve())
                    ):
                        raise ValueError("Недоступен файл измерения.")
                    yield path.relative_to(root).as_posix(), path


def export_whole(root, uid, name, target):
    player = get_player(root, uid)
    level = level_data((root / "level.dat").read_bytes())
    dims = dimensions(root, level)
    if str(player.get("Dimension")) not in dims:
        raise ValueError("Измерение игрока отсутствует в снимке.")
    for key in ("RootVehicle", "ShoulderEntityLeft", "ShoulderEntityRight"):
        player.pop(key, None)
    level["Data"]["Player"] = nbtlib.Compound(player)
    level["Data"]["LevelName"] = nbtlib.String("KRWA · " + name)
    level["Data"]["allowCommands"] = nbtlib.Byte(0)
    from vehicles import current_files

    files = sorted(
        dict(
            [*dimension_files(root, dims.values()), *current_files(root, dims)]
        ).items()
    )
    size = sum(path.stat().st_size for _, path in files)
    if shutil.disk_usage(target.parent).free < size + 2 * 1024**3:
        raise ValueError("Недостаточно места для полного снимка.")
    manifest = []
    with zipfile.ZipFile(target, "x", allowZip64=True) as archive:
        data = gzip.compress(encode(level), mtime=0)
        archive.writestr("level.dat", data)
        manifest.append(
            {
                "path": "level.dat",
                "bytes": len(data),
                "sha256": hashlib.sha256(data).hexdigest(),
            }
        )
        progress, team = snapshot_progress(root, uid, name)
        for rel, payload in progress.items():
            archive.writestr(rel, payload)
            manifest.append(
                {
                    "path": rel,
                    "bytes": len(payload),
                    "sha256": hashlib.sha256(payload).hexdigest(),
                }
            )
        for rel, path in files:
            digest = hashlib.sha256()
            written = 0
            with (
                path.open("rb") as src,
                archive.open(rel, "w", force_zip64=True) as dst,
            ):
                while block := src.read(1024 * 1024):
                    written += len(block)
                    digest.update(block)
                    dst.write(block)
            manifest.append(
                {"path": rel, "bytes": written, "sha256": digest.hexdigest()}
            )
    return {
        "scope": "world",
        "dimensions": list(dims),
        "team": team,
        "files": manifest,
        "bytes": sum(item["bytes"] for item in manifest),
    }
