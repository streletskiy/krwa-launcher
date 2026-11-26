"""Download manifest for the three vanilla dimensions of a Java world."""

import gzip
import hashlib
import re
import shutil
import zipfile

import nbtlib
from anvil import encode, level_data
from parcel import get_player

DIMENSIONS = {
    "minecraft:overworld": "",
    "minecraft:the_nether": "DIM-1/",
    "minecraft:the_end": "DIM1/",
}
REGION = re.compile(r"r\.(-?\d+)\.(-?\d+)\.mca")
EXTERNAL = re.compile(r"c\.-?\d+\.-?\d+\.mcc")


def dimension_files(root):
    for prefix in DIMENSIONS.values():
        for group in ("region", "poi", "entities"):
            folder = root / prefix / group
            if not folder.is_dir():
                continue
            for path in sorted(folder.iterdir()):
                if REGION.fullmatch(path.name) or EXTERNAL.fullmatch(path.name):
                    if (
                        path.is_symlink()
                        or not path.is_file()
                        or path.resolve().parent != folder.resolve()
                        or not path.resolve().is_relative_to(root.resolve())
                    ):
                        raise ValueError("Недоступен файл измерения.")
                    yield prefix + group + "/" + path.name, path


def export_whole(root, uid, name, target):
    player = get_player(root, uid)
    if str(player.get("Dimension")) not in DIMENSIONS:
        raise ValueError("Выйдите в обычном мире, Нижнем мире или Крае.")
    level = level_data((root / "level.dat").read_bytes())
    for key in ("RootVehicle", "ShoulderEntityLeft", "ShoulderEntityRight"):
        player.pop(key, None)
    level["Data"]["Player"] = nbtlib.Compound(player)
    level["Data"]["LevelName"] = nbtlib.String("KRWA · " + name)
    level["Data"]["allowCommands"] = nbtlib.Byte(0)
    files = list(dimension_files(root))
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
        "dimensions": list(DIMENSIONS),
        "files": manifest,
        "bytes": sum(item["bytes"] for item in manifest),
    }
