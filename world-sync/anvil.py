"""Bounded Anvil/NBT operations for Java Edition 1.21.1 (DataVersion 3955)."""

import io
import re
import struct
import zlib
from pathlib import Path

import nbtlib
import numpy as np

CHUNK_LIMIT = 4 * 1024 * 1024
SECTOR = 4096
AIR = "minecraft:air"
RESOURCE = re.compile(r"[a-z0-9_.-]+:[a-z0-9_./-]{1,140}\Z")
VERSION = 3955


def inflate(data, window=zlib.MAX_WBITS):
    reader = zlib.decompressobj(window)
    result = reader.decompress(data, CHUNK_LIMIT + 1)
    if len(result) > CHUNK_LIMIT or not reader.eof or reader.unused_data:
        raise ValueError("Повреждённые или слишком большие данные мира.")
    return result


def decode(raw):
    # Reject large or deeply nested declarations before nbtlib allocates lists.
    if len(raw) > CHUNK_LIMIT:
        raise ValueError("NBT превышает лимит.")
    view = memoryview(raw)
    pos = 0
    budget = 150000

    def take(n):
        nonlocal pos
        if n < 0 or pos + n > len(view):
            raise ValueError("Некорректная длина NBT.")
        start = pos
        pos += n
        return view[start:pos]

    def string():
        take(int.from_bytes(take(2), "big"))

    def length():
        n = int.from_bytes(take(4), "big", signed=True)
        if n < 0:
            raise ValueError("Отрицательная длина NBT.")
        return n

    def entry(kind, depth):
        nonlocal budget
        budget -= 1
        if depth > 64 or budget < 0:
            raise ValueError("Слишком сложная структура NBT.")
        if 1 <= kind <= 6:
            take((1, 2, 4, 8, 4, 8)[kind - 1])
        elif kind in (7, 11, 12):
            take(length() * {7: 1, 11: 4, 12: 8}[kind])
        elif kind == 8:
            string()
        elif kind == 9:
            child = take(1)[0]
            count = length()
            if count > budget:
                raise ValueError("Слишком длинный список NBT.")
            for _ in range(count):
                entry(child, depth + 1)
        elif kind == 10:
            while True:
                child = take(1)[0]
                if not child:
                    break
                string()
                entry(child, depth + 1)
        else:
            raise ValueError("Неизвестный тип NBT.")

    if take(1)[0] != 10:
        raise ValueError("Ожидался составной NBT.")
    string()
    entry(10, 0)
    if pos != len(raw):
        raise ValueError("Лишние данные в NBT.")
    return nbtlib.File.parse(io.BytesIO(raw))


def encode(tag):
    out = io.BytesIO()
    tag.write(out)
    return out.getvalue()


def level_data(raw):
    obj = decode(inflate(raw, 31))
    if int(obj["Data"]["DataVersion"]) != VERSION:
        raise ValueError("Версия мира отличается от Minecraft 1.21.1.")
    return obj


def region_name(cx, cz, folder="region"):
    return f"{folder}/r.{cx // 32}.{cz // 32}.mca"


def index(cx, cz):
    return cx % 32 + 32 * (cz % 32)


def record_bounds(region, slot):
    if not region:
        return None
    if len(region) < 8192:
        raise ValueError("Неполный заголовок региона.")
    off = 4 * slot
    start = int.from_bytes(region[off : off + 3], "big") * SECTOR
    count = region[off + 3]
    if not start and not count:
        return None
    # Minecraft can leave the final allocated sector physically unpadded.
    allocated = ((len(region) + SECTOR - 1) // SECTOR) * SECTOR
    if (
        start < 8192
        or not count
        or start + count * SECTOR > allocated
        or start + 5 > len(region)
    ):
        raise ValueError("Повреждённое смещение чанка.")
    size = int.from_bytes(region[start : start + 4], "big")
    end = start + 4 + size
    if not size or size + 4 > count * SECTOR or end > len(region):
        raise ValueError("Неполные данные чанка.")
    return start, count, end


def record(region, cx, cz):
    bounds = record_bounds(region, index(cx, cz))
    if bounds is None:
        return None
    start, _, end = bounds
    if end - start < 6:
        raise ValueError("Внешние или повреждённые чанки не поддерживаются.")
    return region[start + 4 : end]


def chunk(tagged):
    method, data = tagged[0], tagged[1:]
    if method in (1, 2):
        data = inflate(data, 31 if method == 1 else 15)
    elif method != 3 or len(data) > CHUNK_LIMIT:
        raise ValueError("Неподдерживаемое сжатие чанка.")
    return decode(data)


def compressed(tag):
    return b"\x02" + zlib.compress(encode(tag), 3)


def replace_records(region, replacements):
    """Repack records without altering unrelated data, including external markers."""
    old = region or bytes(8192)
    if len(old) < 8192:
        raise ValueError("Неполный регион.")
    header = bytearray(old[:8192])
    body = bytearray()
    for slot in range(1024):
        off = slot * 4
        if slot in replacements:
            payload = replacements[slot]
            if payload is None:
                header[off : off + 4] = bytes(4)
                continue
            physical = struct.pack(">I", len(payload)) + payload
            sectors = (len(physical) + SECTOR - 1) // SECTOR
            if sectors > 255:
                raise ValueError("Чанк требует внешнего хранилища.")
            physical += bytes(sectors * SECTOR - len(physical))
        else:
            bounds = record_bounds(old, slot)
            if bounds is None:
                continue
            start, sectors, _ = bounds
            physical = old[start : start + sectors * SECTOR].ljust(
                sectors * SECTOR, b"\0"
            )
        header[off : off + 3] = (2 + len(body) // SECTOR).to_bytes(3, "big")
        header[off + 3] = sectors
        body.extend(physical)
    return bytes(header + body)


def state_key(tag):
    name = str(tag["Name"])
    props = sorted((str(k), str(v)) for k, v in tag.get("Properties", {}).items())
    if not RESOURCE.fullmatch(name) or any(
        not re.fullmatch(r"[a-z0-9_-]{1,64}", x) for pair in props for x in pair
    ):
        raise ValueError("Некорректное состояние блока.")
    return name + ("[" + ",".join(k + "=" + v for k, v in props) + "]" if props else "")


def state_tag(key):
    name, _, props = key.partition("[")
    tag = nbtlib.Compound({"Name": nbtlib.String(name)})
    if props:
        tag["Properties"] = nbtlib.Compound(
            {
                k: nbtlib.String(v)
                for k, v in (s.split("=") for s in props[:-1].split(","))
            }
        )
    return tag


def palette_indices(states):
    palette = states["palette"]
    if not 1 <= len(palette) <= 4096:
        raise ValueError("Некорректная палитра секции.")
    if len(palette) == 1:
        return np.zeros(4096, dtype=np.int16)
    bits = max(4, (len(palette) - 1).bit_length())
    per = 64 // bits
    words = np.asarray(states["data"], dtype=np.uint64)
    if len(words) != (4096 + per - 1) // per:
        raise ValueError("Некорректная длина палитры секции.")
    offsets = np.arange(4096, dtype=np.uint64)
    ids = (
        (words[offsets // per] >> (offsets % per * bits)) & ((1 << bits) - 1)
    ).astype(np.int16)
    if int(ids.max()) >= len(palette):
        raise ValueError("Индекс за пределами палитры.")
    return ids


def write_states(section, states):
    palette = sorted(set(states))
    lookup = {name: i for i, name in enumerate(palette)}
    tag = nbtlib.Compound(
        {"palette": nbtlib.List[nbtlib.Compound]([state_tag(k) for k in palette])}
    )
    if len(palette) > 1:
        bits = max(4, (len(palette) - 1).bit_length())
        per = 64 // bits
        words = [0] * ((4096 + per - 1) // per)
        for i, k in enumerate(states):
            words[i // per] |= lookup[k] << ((i % per) * bits)
        tag["data"] = nbtlib.LongArray(np.array(words, dtype=np.uint64).view(np.int64))
    section["block_states"] = tag


def sections(tag):
    if int(tag["DataVersion"]) != VERSION:
        raise ValueError("Данные чанка требуют обновления перед поездкой.")
    return {int(s["Y"]): s for s in tag["sections"] if "block_states" in s}


def blocks(section):
    if section is None:
        return [AIR] * 4096
    states = section["block_states"]
    palette = [state_key(k) for k in states["palette"]]
    return [palette[i] for i in palette_indices(states)]


def read_region(root, rel):
    path = Path(root) / rel
    if not path.exists():
        return b""
    if path.stat().st_size > 256 * 1024**2:
        raise ValueError("Регион превышает лимит обработки.")
    return path.read_bytes()
