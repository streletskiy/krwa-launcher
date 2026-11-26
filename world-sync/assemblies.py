"""Review a dimension's Sable storage, holding pointers and occupancy as one change."""

import hashlib
import math

import nbtlib
from anvil import decode, inflate
from vehicles import SABLE, location


def fingerprint(files):
    return hashlib.sha256(repr(sorted(files.items())).encode()).hexdigest()


def spans(name, raw, read, names, used_external):
    sector = 128 if name.endswith(".slvlr") else 4096
    if len(raw) < 4096 or len(raw) % sector:
        raise ValueError("Неполный файл Sable.")
    used = set(range(4096 // sector))
    for slot in range(1024):
        span = int.from_bytes(raw[slot * 4 : slot * 4 + 4], "big")
        if not span:
            continue
        start, length = span >> 8, span & 255
        sectors = set(range(start, start + length))
        offset = start * sector
        if not length or used & sectors or offset + length * sector > len(raw):
            raise ValueError("Повреждён сектор Sable.")
        used.update(sectors)
        size = int.from_bytes(raw[offset : offset + 4], "big")
        flag = raw[offset + 4]
        if flag == 16 and size == 1:
            ext = (
                name.rsplit(".", 1)[0]
                + (".r/" if sector == 128 else ".s/")
                + str(slot)
                + ".slvl"
            )
            if ext not in names:
                raise ValueError("Отсутствует внешняя часть транспорта.")
            used_external.add(ext)
            payload = read(ext)
        elif flag == 0 and 1 < size <= length * sector - 4:
            payload = raw[offset + 5 : offset + 4 + size]
        else:
            raise ValueError("Неизвестный формат записи Sable.")
        yield slot, decode(inflate(payload, 31))


def validate(files, read):
    objects, pointers, occupied, dependencies, plots, external = (
        set(),
        set(),
        set(),
        set(),
        set(),
        set(),
    )
    plot_bits = set()
    ticket_ids = set()
    for name in sorted(files):
        if name.endswith(".slvl"):
            continue
        raw = read(name)
        if name.endswith(".dat"):
            tag = decode(inflate(raw, 31))
            if not isinstance(tag.get("data"), nbtlib.Compound):
                raise ValueError("Некорректные данные Sable.")
            info = tag["data"]
            if name.endswith("_occupancy.dat"):
                mask = info["sub_level_occupancy"]
                if not isinstance(mask, nbtlib.LongArray) or len(mask) > 256:
                    raise ValueError("Некорректная карта занятых участков Sable.")
                for word, value in enumerate(mask):
                    plot_bits.update(
                        64 * word + i for i in range(64) if int(value) & (1 << i)
                    )
            else:
                for ticket in info["tickets"]:
                    ticket_ids.add(tuple(ticket["uuid"]))
            continue
        for slot, tag in spans(name, raw, read, files, external):
            stem = name.rsplit(".", 1)[0]
            if name.endswith(".slvlr"):
                for pointer in tag["pointers"]:
                    value = int(pointer)
                    if value < 0 or value & 65535 >= 1024:
                        raise ValueError("Некорректный указатель Sable.")
                    pointers.add((stem + "." + str(value >> 16), value & 65535))
            else:
                occupied.add((stem, slot))
                key = tuple(tag["uuid"])
                plot = tag["plot"]
                coord = int(plot["plot_x"]), int(plot["plot_z"])
                if (
                    not isinstance(tag["uuid"], nbtlib.IntArray)
                    or len(key) != 4
                    or key in objects
                    or coord in plots
                    or any(v < 0 or v >= 128 for v in coord)
                    or int(plot["log_size"]) != 7
                    or not isinstance(plot.get("chunks"), nbtlib.Compound)
                ):
                    raise ValueError("Конфликт идентификаторов или координат сборки.")
                for component, axes in (
                    ("position", "xyz"),
                    ("orientation", "xyzw"),
                    ("rotation_point", "xyz"),
                ):
                    vector = tag["pose"][component]
                    if any(
                        not math.isfinite(float(vector[a]))
                        or abs(float(vector[a])) > 3.1e7
                        for a in axes
                    ):
                        raise ValueError("Некорректное положение сборки.")
                bounds = tag["world_bounds"]
                for axis in "XYZ":
                    low, high = float(bounds["min" + axis]), float(bounds["max" + axis])
                    if not -3.1e7 <= low <= high <= 3.1e7:
                        raise ValueError("Некорректные границы сборки.")
                # Administrative command-bearing blocks are never imported with an assembly.
                raw_tag = tag.snbt()
                if any(
                    marker in raw_tag
                    for marker in (
                        "minecraft:command_block",
                        "minecraft:chain_command_block",
                        "minecraft:repeating_command_block",
                        "minecraft:structure_block",
                        "minecraft:jigsaw",
                        "minecraft:spawner",
                    )
                ):
                    raise ValueError("Сборка содержит служебные блоки.")
                objects.add(key)
                plots.add(coord)
                dependencies.update(
                    tuple(v) for v in tag.get("loading_dependencies", ())
                )
    if plot_bits != {x + (z << 7) for x, z in plots} or not ticket_ids.issubset(
        objects
    ):
        raise ValueError(
            "Карта участков или загрузочные билеты не совпадают со сборками Sable."
        )
    if (
        pointers != occupied
        or not dependencies.issubset(objects)
        or external != {n for n in files if n.endswith(".slvl")}
    ):
        raise ValueError("У сборки отсутствуют связанные данные.")
    return len(objects)


def plan(meta, before, after, live_paths, edits, deleted):
    from merge import selected

    changes, writes = [], {}
    dims = meta["dimensions"]
    base_hash = {f["path"]: f["sha256"] for f in meta["files"]}
    for dim in dims:

        def belongs(n):
            info = location(n, [dim])
            return info is not None and SABLE.fullmatch(info[2])

        modified = {n for n in edits | deleted if belongs(n)}
        if not modified:
            continue
        old = {n: h for n, h in base_hash.items() if belongs(n)}
        live = {
            n: hashlib.sha256(p.read_bytes()).hexdigest()
            for n, p in live_paths.items()
            if belongs(n)
        }
        new = {n: h for n, h in old.items() if n not in deleted}
        for n in modified - deleted:
            new[n] = hashlib.sha256(after.read(n)).hexdigest()
        # Visiting empty chunks can create all-zero holding indexes. Ignore those when comparing.
        blank = hashlib.sha256(bytes(4096)).hexdigest()

        def meaningful(source):
            return {
                n: h
                for n, h in source.items()
                if not (n.endswith((".slvlr", ".slvls")) and h == blank)
            }

        if meaningful(new) == meaningful(old) or meaningful(new) == meaningful(live):
            continue
        mode = "conflict"
        detail = "Перенести связанный набор файлов транспорта"

        def get(n):
            return after.read(n) if n in edits else before.read(n)

        try:
            count = validate(new, get)
            detail = f"После поездки сборок: {count}. Изменено файлов: {len(modified)}."
            if meaningful(old) != meaningful(live):
                mode = "manual"
                detail = "Серверный транспорт изменился после выезда. Нужен ручной перенос из архива."
        except (ValueError, TypeError, KeyError, IndexError, OverflowError) as error:
            mode = "manual"
            detail = str(error)[:200] or "Требуется ручная проверка формата Sable."
        change = dict(
            kind="Сборки Create Aeronautics",
            object=dim,
            pos=None,
            mode=mode,
            before=f"Файлов в снимке: {len(old)}",
            live=f"Файлов на сервере: {len(live)}",
            after=detail,
            revision=fingerprint(live),
        )
        changes.append(change)
        if mode != "manual" and selected(meta, change):
            for name in modified:
                writes[name] = None if name in deleted else get(name)
    return changes, writes
