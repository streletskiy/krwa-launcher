"""Return vehicle entities by UUID without replacing a chunk's mobs or containers."""

import hashlib
import math
import re
from collections import defaultdict

import nbtlib
from anvil import (
    VERSION,
    chunk,
    compressed,
    decode,
    inflate,
    index,
    record,
    region_name,
    replace_records,
)

CARTS = {
    "minecraft:" + k
    for k in (
        "boat",
        "chest_boat",
        "minecart",
        "chest_minecart",
        "hopper_minecart",
        "furnace_minecart",
    )
}
BOAT_TYPES = {
    "oak",
    "spruce",
    "birch",
    "jungle",
    "acacia",
    "dark_oak",
    "mangrove",
    "cherry",
    "bamboo",
}
ENTITIES = re.compile(r"entities/r\.(-?\d{1,7})\.(-?\d{1,7})\.mca")
SABLE = re.compile(
    r"(?:sublevels/r\.-?\d{1,7}\.-?\d{1,7}(?:\.slvlr|\.\d{1,5}\.slvls|(?:\.r|\.\d{1,5}\.s)/\d{1,4}\.slvl)|data/sable_sub_level_(?:occupancy|force_load_tickets)\.dat)"
)
REMOVED = "removed/"


def location(name, dimensions):
    from whole import dimension_prefix

    for dim in dimensions:
        prefix = dimension_prefix(dim)
        if name.startswith(prefix):
            rel = name[len(prefix) :]
            if ENTITIES.fullmatch(rel) or SABLE.fullmatch(rel):
                return dim, prefix, rel
    return None


def current_files(root, dimensions):
    from whole import dimension_prefix

    for dim in dimensions:
        prefix = dimension_prefix(dim)
        folder = root / prefix
        for pattern in (
            "entities/r.*.mca",
            "sublevels/r.*",
            "sublevels/r.*/*.slvl",
            "data/sable_sub_level_*.dat",
        ):
            for path in folder.glob(pattern):
                name = path.relative_to(root).as_posix()
                if not path.is_file() or not location(name, dimensions):
                    continue
                if (
                    path.is_symlink()
                    or path.resolve() != root.resolve() / name
                    or path.stat().st_size > 256 * 1024**2
                ):
                    raise ValueError("Недоступен файл транспорта.")
                yield name, path


def entity_id(entity):
    value = entity.get("UUID")
    return (
        value.tobytes().hex()
        if isinstance(value, nbtlib.IntArray) and len(value) == 4
        else None
    )


def entities(names, read, dimensions):
    from transfer import slots

    found = {}
    occupied = set()
    for rel in sorted(names):
        dim, _, sub = location(rel, dimensions)
        match = ENTITIES.fullmatch(sub)
        if not match:
            continue
        data = read(rel)
        if not data:
            continue
        for x, z in slots(data, *map(int, match.groups())):
            tag = chunk(record(data, x, z))
            if int(tag.get("DataVersion", 0)) != VERSION or list(
                tag.get("Position", ())
            ) != [x, z]:
                raise ValueError("Некорректный чанк сущностей.")
            top = tag.get("Entities", ())
            stack = [(entity, True) for entity in top]
            while stack:
                entity, standalone = stack.pop()
                stack.extend((child, False) for child in entity.get("Passengers", ()))
                key = entity_id(entity)
                if not key:
                    continue
                if key in occupied and (key in found or str(entity.get("id")) in CARTS):
                    raise ValueError("Повторяющийся UUID транспорта.")
                occupied.add(key)
                if standalone and str(entity.get("id")) in CARTS:
                    found[key] = (dim, rel, x, z, entity)
    return found, occupied


def view(entry):
    from merge import text_tag

    if entry is None:
        return None
    e = entry[-1]
    return (
        entry[0],
        *(
            text_tag(e.get(k))
            for k in (
                "id",
                "Pos",
                "Rotation",
                "Type",
                "Items",
                "Passengers",
                "Fuel",
                "PushX",
                "PushZ",
            )
        ),
    )


def description(entry):
    if entry is None:
        return "Отсутствует"
    e = entry[-1]
    return f"{str(e['id'])} · {entry[0]} · " + ", ".join(
        f"{float(v):.1f}" for v in e["Pos"]
    )


def safe(entry, previous):
    from merge import inventory_safe

    if entry is None:
        return previous is None or inventory_safe(
            previous[-1].get("Items", []), [], True
        )
    _, _, cx, cz, e = entry
    pos = e.get("Pos", ())
    if (
        len(pos) != 3
        or not all(math.isfinite(float(v)) and abs(float(v)) <= 30000000 for v in pos)
        or (math.floor(pos[0]) // 16, math.floor(pos[2]) // 16) != (cx, cz)
    ):
        return False
    for key, n, max_abs in (("Rotation", 2, 1e6), ("Motion", 3, 100)):
        values = e.get(key, ())
        if len(values) != n or not all(
            math.isfinite(float(v)) and abs(float(v)) <= max_abs for v in values
        ):
            return False
    if (
        e.get("Passengers")
        or e.get("LootTable")
        or str(e.get("Type", "oak")) not in BOAT_TYPES
    ):
        return False
    if previous and str(previous[-1]["id"]) != str(e["id"]):
        return False
    if not inventory_safe(
        previous[-1].get("Items", []) if previous else [], e.get("Items", []), True
    ):
        return False
    return all(
        math.isfinite(float(e.get(k, 0))) and abs(float(e.get(k, 0))) <= bound
        for k, bound in (("Fuel", 32767), ("PushX", 100), ("PushZ", 100))
    )


def riding_ids(root):
    reserved = set()
    for path in (root / "playerdata").glob("*.dat"):
        player = decode(inflate(path.read_bytes(), 31))
        entity = player.get("RootVehicle", {}).get("Entity")
        stack = [entity] if entity else []
        while stack:
            entity = stack.pop()
            reserved.add(entity_id(entity))
            stack.extend(entity.get("Passengers", ()))
    return reserved


def plan_entities(root, meta, before, after, live_paths, edits, deleted, rider=None):
    from merge import selected, text_tag

    dims = meta["dimensions"]
    base_names = {
        n for n in before.namelist() if location(n, dims) and "/entities/" in "/" + n
    }
    delta = {n for n in edits if "/entities/" in "/" + n}
    if not rider and not delta and not (base_names & deleted):
        return [], {}
    old, old_occupied = entities(base_names, before.read, dims)
    new, new_occupied = entities(
        (base_names | delta) - deleted,
        lambda n: after.read(n) if n in delta else before.read(n),
        dims,
    )
    if rider:
        from whole import dimension_prefix

        dim, mount = rider
        item = mount["Entity"]
        key = entity_id(item)
        if (
            dim not in dims
            or not key
            or key in new_occupied
            or str(item.get("id")) not in CARTS
            or entity_id({"UUID": mount.get("Attach")}) != key
            or item.get("Passengers")
        ):
            raise ValueError(
                "Сохраните поездку после выхода из транспорта для переноса этой группы сущностей."
            )
        x, _, z = item["Pos"]
        cx, cz = math.floor(x) // 16, math.floor(z) // 16
        new[key] = (
            dim,
            dimension_prefix(dim) + region_name(cx, cz, "entities"),
            cx,
            cz,
            item,
        )
        new_occupied.add(key)
    live, occupied = entities(live_paths, lambda n: live_paths[n].read_bytes(), dims)
    mounted_on_server = riding_ids(root)
    changes, pending = [], defaultdict(dict)
    sources = {}

    def bucket(entry):
        _, rel, x, z, _ = entry
        slot = index(x, z)
        if slot not in pending[rel]:
            if rel not in sources:
                sources[rel] = (
                    live_paths[rel].read_bytes() if rel in live_paths else b""
                )
            packet = record(sources[rel], x, z)
            pending[rel][slot] = (
                chunk(packet)
                if packet
                else nbtlib.File(
                    {
                        "DataVersion": nbtlib.Int(VERSION),
                        "Position": nbtlib.IntArray([x, z]),
                        "Entities": nbtlib.List[nbtlib.Compound]([]),
                    }
                )
            )
        return pending[rel][slot]["Entities"]

    for key in sorted(old.keys() | new.keys()):
        a, b, c = old.get(key), live.get(key), new.get(key)
        if view(a) == view(c) or view(b) == view(c):
            continue
        valid = (
            key not in mounted_on_server
            and safe(c, a)
            and safe(c, b)
            and not any(
                entry and (entry[-1].get("Passengers") or entry[-1].get("LootTable"))
                for entry in (a, b)
            )
            and not any(
                key in present and not entry
                for present, entry in (
                    (occupied, b),
                    (old_occupied, a),
                    (new_occupied, c),
                )
            )
        )
        mode = "manual" if not valid else ("auto" if view(a) == view(b) else "conflict")
        change = dict(
            kind="Транспорт",
            object=key,
            pos=None,
            before=description(a),
            live=description(b),
            after=description(c),
            mode=mode,
        )
        change["revision"] = hashlib.sha256(
            (text_tag(b[-1]) if b else "").encode()
        ).hexdigest()
        changes.append(change)
        if not valid or not selected(meta, change):
            continue
        if b:
            dest = bucket(b)
            for i, entity in enumerate(dest):
                if entity_id(entity) == key:
                    del dest[i]
                    break
        if c:
            item = (
                nbtlib.Compound(b[-1])
                if b
                else nbtlib.Compound({"id": c[-1]["id"], "UUID": c[-1]["UUID"]})
            )
            for k in (
                "Pos",
                "Rotation",
                "Motion",
                "Type",
                "Items",
                "Fuel",
                "PushX",
                "PushZ",
            ):
                if k in c[-1]:
                    item[k] = c[-1][k]
                elif k in item:
                    del item[k]
            bucket(c).append(item)
    return changes, {
        rel: replace_records(
            sources[rel], {i: compressed(t) for i, t in chunks.items()}
        )
        for rel, chunks in pending.items()
    }
