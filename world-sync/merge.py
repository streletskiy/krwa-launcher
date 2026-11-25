"""Plan a three-way merge. Never transplant uploaded chunks, tags or entities."""

import gzip
import hashlib
import zipfile
from collections import defaultdict

import nbtlib
from anvil import (
    blocks,
    chunk,
    compressed,
    encode,
    index,
    level_data,
    read_region,
    record,
    region_name,
    replace_records,
    sections,
    write_states,
)
from parcel import FIELDS, get_player, player_file, read_package, supported_files

# Plain full cubes have no POI, ticking block entities, executable data or neighbours
# that must be registered with a mod. Extend only after a round-trip test.
MATERIALS = set(
    """air stone granite polished_granite diorite polished_diorite andesite polished_andesite
cobblestone mossy_cobblestone dirt coarse_dirt rooted_dirt grass_block gravel sand red_sand sandstone
smooth_sandstone cut_sandstone red_sandstone smooth_stone tuff calcite deepslate cobbled_deepslate
polished_deepslate deepslate_tiles deepslate_bricks bricks stone_bricks mossy_stone_bricks cracked_stone_bricks
glass tinted_glass packed_mud mud_bricks terracotta netherrack blackstone basalt end_stone end_stone_bricks
obsidian snow_block clay quartz_block smooth_quartz amethyst_block coal_block iron_block copper_block gold_block
diamond_block emerald_block lapis_block redstone_block raw_iron_block raw_copper_block raw_gold_block""".split()
)
for wood in "oak spruce birch jungle acacia dark_oak cherry mangrove pale_oak bamboo crimson warped".split():
    MATERIALS.add(wood + "_planks")
for color in "white orange magenta light_blue yellow lime pink gray light_gray cyan purple blue brown green red black".split():
    for suffix in ("wool", "concrete", "terracotta", "stained_glass"):
        MATERIALS.add(color + "_" + suffix)
for ore in "coal copper iron gold redstone lapis diamond emerald".split():
    MATERIALS.update((ore + "_ore", "deepslate_" + ore + "_ore"))
PLAIN = {"minecraft:" + name for name in MATERIALS}
for wood in (
    "oak",
    "spruce",
    "birch",
    "jungle",
    "acacia",
    "dark_oak",
    "cherry",
    "mangrove",
):
    for axis in ("x", "y", "z"):
        for stem in (
            wood + "_log",
            wood + "_wood",
            "stripped_" + wood + "_log",
            "stripped_" + wood + "_wood",
        ):
            PLAIN.add("minecraft:" + stem + "[axis=" + axis + "]")
PLAIN.update(
    ("minecraft:grass_block[snowy=false]", "minecraft:grass_block[snowy=true]")
)
ITEMS = {k.partition("[")[0] for k in PLAIN} | {
    "minecraft:" + k
    for k in """coal charcoal raw_copper copper_ingot raw_iron iron_ingot raw_gold
gold_ingot diamond emerald lapis_lazuli redstone stick flint clay_ball quartz amethyst_shard glass_bottle
bread apple wheat carrot potato baked_potato cobbled_deepslate torch""".split()
}
MAX_EDITS = 16000


for material in ("wooden", "stone", "iron", "golden", "diamond", "netherite"):
    ITEMS.update(
        "minecraft:" + material + "_" + tool
        for tool in ("sword", "pickaxe", "axe", "shovel", "hoe")
    )


def canonical(value):
    if isinstance(value, nbtlib.Compound):
        return nbtlib.Compound({key: canonical(value[key]) for key in sorted(value)})
    if isinstance(value, nbtlib.List):
        return type(value)(canonical(item) for item in value)
    return value


def text_tag(value):
    return canonical(value).snbt() if value is not None else "—"


def entity_state(tag):
    if (
        tag is not None
        and str(tag.get("id", "")).startswith("create:")
        and "NeedsSpeedUpdate" in tag
    ):
        # The kinetic graph toggles this transient flag when loading a saved world.
        tag = nbtlib.Compound({k: v for k, v in tag.items() if k != "NeedsSpeedUpdate"})
    return text_tag(tag)


def clean_items(items):
    for item in items:
        if (
            set(item) - {"Slot", "id", "count", "components"}
            or str(item.get("id")) not in ITEMS
        ):
            return False
        if not isinstance(item.get("Slot"), nbtlib.Byte) or not isinstance(
            item.get("id"), nbtlib.String
        ):
            return False
        if not isinstance(item.get("count"), (nbtlib.Int, nbtlib.Byte)):
            return False
        comp = item.get("components", {})
        if not isinstance(comp, (dict, nbtlib.Compound)) or set(comp) - {
            "minecraft:damage"
        }:
            return False
        if "minecraft:damage" in comp and (
            not isinstance(comp["minecraft:damage"], nbtlib.Int)
            or not 0 <= int(comp["minecraft:damage"]) <= 4096
        ):
            return False
        if not (1 <= int(item.get("count", 0)) <= 64):
            return False
    return True


def inventory_safe(before, after, ender=False):
    # An unchanged backpack/tool may carry mod data. Only changed slots are imported.
    def slots(items):
        result = {int(i["Slot"]): i for i in items}
        if len(result) != len(items) or any(
            k
            not in (set(range(27)) if ender else {*range(36), 100, 101, 102, 103, -106})
            for k in result
        ):
            raise ValueError("Некорректные ячейки инвентаря.")
        return result

    old, new = slots(before), slots(after)
    return all(
        clean_items([item for item in (old.get(k), new.get(k)) if item is not None])
        for k in old.keys() | new.keys()
        if text_tag(old.get(k)) != text_tag(new.get(k))
    )


def projected_inventory(items):
    return (
        ", ".join(
            f"{int(i['Slot'])}: {i.get('id')} ×{int(i.get('count', 1))}" for i in items
        )
        or "пусто"
    )


def plan(root, uid, meta, base_path, upload_path, live_path=None):
    allowed = supported_files(meta)
    base = read_package(base_path, allowed)
    offline = read_package(upload_path, allowed)
    originals, replacements, changes = {}, defaultdict(dict), []

    def add(kind, pos, a, b, c, mode):
        if len(changes) >= MAX_EDITS:
            raise ValueError("Слишком много изменений за одну поездку.")
        changes.append(dict(kind=kind, pos=pos, before=a, live=b, after=c, mode=mode))

    player = get_player(root, uid)
    before_player = level_data(base["level.dat"])["Data"]["Player"]
    after_player = level_data(offline["level.dat"])["Data"]["Player"]
    if text_tag(before_player.get("UUID")) != text_tag(after_player.get("UUID")):
        raise ValueError("Персонаж в сохранении не совпадает с исходным снимком.")
    player_dirty = False
    for field in FIELDS:
        a, b, c = (p.get(field) for p in (before_player, player, after_player))
        if text_tag(a) == text_tag(c):
            continue
        inventory = field in ("Inventory", "EnderItems")
        valid = a is not None and b is not None and c is not None and type(a) is type(c)
        if valid and inventory:
            valid = inventory_safe(a, c, field == "EnderItems")
        elif valid:
            number = float(c)
            valid = 0 <= number <= (1 if field == "XpP" else 2147483647)
        mode = (
            "manual"
            if not valid
            else "conflict"
            if text_tag(a) != text_tag(b)
            else "auto"
        )

        def display(obj):
            return (
                projected_inventory(obj)
                if inventory and obj is not None
                else text_tag(obj)
            )

        add(field, None, display(a), display(b), display(c), mode)
        changes[-1]["revision"] = hashlib.sha256(text_tag(b).encode()).hexdigest()
        if valid:
            if inventory:
                old_slots, live_slots, new_slots = (
                    {int(i["Slot"]): i for i in values} for values in (a, b, c)
                )
                for slot in old_slots.keys() | new_slots.keys():
                    if text_tag(old_slots.get(slot)) != text_tag(new_slots.get(slot)):
                        if slot in new_slots:
                            live_slots[slot] = new_slots[slot]
                        else:
                            live_slots.pop(slot, None)
                player[field] = nbtlib.List[nbtlib.Compound](
                    [live_slots[k] for k in sorted(live_slots)]
                )
            else:
                player[field] = c
            player_dirty = True
    if str(after_player.get("Dimension", "")) != "minecraft:overworld" or any(
        abs(float(after_player["Pos"][axis]) - (meta[key] * 16 + 8)) > 40.1
        for axis, key in ((0, "cx"), (2, "cz"))
    ):
        add(
            "граница поездки",
            None,
            "обычный мир",
            "обычный мир",
            "игрок вышел за пределы выданного участка",
            "manual",
        )

    def be_names(t):
        return {
            (int(v["x"]), int(v["y"]), int(v["z"])): v
            for v in t.get("block_entities", [])
        }

    for cx, cz in meta["chunks"]:
        rel = region_name(cx, cz)
        if rel not in originals:
            originals[rel] = read_region(root, rel)
        records = [
            record(bank.get(rel, b""), cx, cz) for bank in (base, originals, offline)
        ]
        if records[0] == records[2]:
            continue
        if any(v is None for v in records):
            add(
                "chunk",
                [cx * 16, 0, cz * 16],
                "сохранён",
                "есть" if records[1] else "отсутствует",
                "есть" if records[2] else "отсутствует",
                "manual",
            )
            continue
        a, b, c = map(chunk, records)
        for t in (a, b, c):
            if (int(t["xPos"]), int(t["zPos"])) != (cx, cz):
                raise ValueError("Координаты чанка не совпадают.")
        entity_maps = [be_names(t) for t in (a, b, c)]
        modified = False
        for pos in entity_maps[0].keys() | entity_maps[2].keys():
            old, cur, new = [e.get(pos) for e in entity_maps]
            if entity_state(old) != entity_state(new):
                containers = {
                    "minecraft:chest",
                    "minecraft:trapped_chest",
                    "minecraft:barrel",
                }

                def chest_shape(tag):
                    return (
                        text_tag(
                            nbtlib.Compound(
                                {k: v for k, v in tag.items() if k != "Items"}
                            )
                        )
                        if tag is not None
                        else ""
                    )

                ordinary = all(
                    t is not None
                    and str(t.get("id")) in containers
                    and "LootTable" not in t
                    and "Items" in t
                    for t in (old, cur, new)
                )
                if (
                    ordinary
                    and chest_shape(old) == chest_shape(cur) == chest_shape(new)
                    and inventory_safe(old["Items"], new["Items"], True)
                ):
                    mode = (
                        "auto"
                        if text_tag(cur["Items"]) == text_tag(old["Items"])
                        else "conflict"
                    )
                    add(
                        "container",
                        list(pos),
                        *(projected_inventory(t["Items"]) for t in (old, cur, new)),
                        mode,
                    )
                    cur["Items"] = new["Items"]
                    modified = True
                else:
                    # Render these tags as text only. Never copy arbitrary client block NBT.
                    add(
                        "block_entity",
                        list(pos),
                        text_tag(old)[:700],
                        text_tag(cur)[:700],
                        text_tag(new)[:700],
                        "manual",
                    )
        sa, sb, sc = map(sections, (a, b, c))
        for y in sorted(sa.keys() | sc.keys()):
            old_sec, new_sec = sa.get(y), sc.get(y)
            if (
                old_sec is not None
                and new_sec is not None
                and encode(nbtlib.File(old_sec["block_states"]))
                == encode(nbtlib.File(new_sec["block_states"]))
            ):
                continue
            old, cur, new = blocks(old_sec), blocks(sb.get(y)), blocks(new_sec)
            touched = False
            for i, (before, after) in enumerate(zip(old, new)):
                if before == after:
                    continue
                pos = (cx * 16 + i % 16, y * 16 + i // 256, cz * 16 + (i // 16) % 16)
                live = cur[i]
                valid = (
                    y in sb
                    and before in PLAIN
                    and live in PLAIN
                    and after in PLAIN
                    and not any(pos in e for e in entity_maps)
                )
                mode = (
                    "manual" if not valid else "conflict" if live != before else "auto"
                )
                add("block", list(pos), before, live, after, mode)
                if valid:
                    cur[i] = after
                    touched = True
            if touched:
                write_states(sb[y], cur)
                modified = True
        if modified:
            # Minecraft rebuilds these derived values on load; taking the client's
            # light or height maps would also transfer unrelated terrain changes.
            b.pop("Heightmaps", None)
            b["isLightOn"] = nbtlib.Byte(0)
            for s in b["sections"]:
                s.pop("BlockLight", None)
                s.pop("SkyLight", None)
            replacements[rel][index(cx, cz)] = compressed(b)
    writes = {
        rel: replace_records(originals[rel], slots)
        for rel, slots in replacements.items()
    }
    if player_dirty:
        writes[player_file(root, uid).relative_to(root).as_posix()] = gzip.compress(
            encode(player)
        )
    if live_path:
        with zipfile.ZipFile(
            live_path, "w", compression=zipfile.ZIP_DEFLATED
        ) as archive:
            groups = defaultdict(dict)
            for x, z in meta["chunks"]:
                rel = region_name(x, z)
                payload = record(originals[rel], x, z)
                if payload is not None:
                    groups[rel][index(x, z)] = payload
            for rel, slots in groups.items():
                archive.writestr(rel, replace_records(b"", slots))
    return changes, writes


def map_slice(paths, cx, cz, y):
    images = []
    for path in paths:
        with zipfile.ZipFile(path) as archive:
            rel = region_name(cx, cz)
            packet = (
                record(archive.read(rel), cx, cz) if rel in archive.namelist() else None
            )
        section = sections(chunk(packet)).get(y // 16) if packet else None
        start = (y % 16) * 256
        images.append(blocks(section)[start : start + 256])
    palette = sorted(set().union(*images))
    ids = {v: i for i, v in enumerate(palette)}
    return {"palette": palette, "layers": [[ids[v] for v in grid] for grid in images]}
