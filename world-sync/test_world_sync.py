"""Regression checks for persistence, three-way decisions, coordinates and admission."""

import gzip
import tempfile
import unittest
import uuid
import zipfile
from pathlib import Path

import nbtlib
from anvil import (
    AIR,
    VERSION,
    blocks,
    chunk,
    compressed,
    encode,
    index,
    record,
    region_name,
    replace_records,
    sections,
    write_states,
)
from merge import map_slice, plan
from parcel import export_world, player_file


class RegionPaddingTest(unittest.TestCase):
    def test_partial_final_sector_requires_every_payload_byte(self):
        from transfer import slots

        first = b"\x03first"
        last = b"\x03last"
        padded = replace_records(b"", {0: first, 1: last})
        short = padded[: 3 * 4096 + 4 + len(last)]
        self.assertEqual(list(slots(short, 0, 0)), [(0, 0), (1, 0)])
        self.assertEqual(record(short, 1, 0), last)
        updated = replace_records(short, {0: b"\x03new"})
        self.assertEqual(len(updated) % 4096, 0)
        self.assertEqual(record(updated, 1, 0), last)
        with self.assertRaises(ValueError):
            record(short[:-1], 1, 0)
        with self.assertRaises(ValueError):
            replace_records(short[:-1], {0: first})


class TripMergeTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.uid = uuid.UUID(int=1).hex
        self.rel = region_name(-1, 0)
        self.file = self.root / self.rel
        self.file.parent.mkdir()
        player = nbtlib.File(
            {
                "Pos": nbtlib.List[nbtlib.Double]([-1, 1, 1]),
                "Dimension": nbtlib.String("minecraft:overworld"),
                "Inventory": nbtlib.List[nbtlib.Compound]([]),
            }
        )
        p = player_file(self.root, self.uid)
        p.parent.mkdir()
        p.write_bytes(gzip.compress(encode(player)))
        self.root.joinpath("level.dat").write_bytes(
            gzip.compress(
                encode(
                    nbtlib.File(
                        {"Data": nbtlib.Compound({"DataVersion": nbtlib.Int(VERSION)})}
                    )
                )
            )
        )
        section = nbtlib.Compound({"Y": nbtlib.Byte(0)})
        write_states(section, [AIR] * 4096)
        body = nbtlib.File(
            {
                "DataVersion": nbtlib.Int(VERSION),
                "xPos": nbtlib.Int(-1),
                "zPos": nbtlib.Int(0),
                "Status": nbtlib.String("minecraft:full"),
                "sections": nbtlib.List[nbtlib.Compound]([section]),
                "block_entities": nbtlib.List[nbtlib.Compound]([]),
            }
        )
        self.initial = replace_records(b"", {index(-1, 0): compressed(body)})
        self.file.write_bytes(self.initial)
        self.base = self.root / "base.zip"
        self.meta = export_world(self.root, self.uid, "QA", self.base)
        self.upload = self.root / "upload.zip"

    def edit(self, region, edits):
        tag = chunk(record(region, -1, 0))
        sec = sections(tag)[0]
        states = blocks(sec)
        for i, k in edits.items():
            states[i] = k
        write_states(sec, states)
        return replace_records(region, {index(-1, 0): compressed(tag)})

    def upload_edits(self, edits):
        with (
            zipfile.ZipFile(self.base) as src,
            zipfile.ZipFile(self.upload, "w") as out,
        ):
            for n in src.namelist():
                out.writestr(
                    n, self.edit(src.read(n), edits) if n == self.rel else src.read(n)
                )

    def test_disjoint_changes_same_chunk(self):
        self.upload_edits({0: "minecraft:stone"})
        self.file.write_bytes(self.edit(self.initial, {1: "minecraft:bricks"}))
        live = self.root / "live.zip"
        changes, writes = plan(
            self.root, self.uid, self.meta, self.base, self.upload, live
        )
        self.assertEqual(
            [(i["mode"], i["pos"]) for i in changes], [("auto", [-16, 0, 0])]
        )
        states = blocks(sections(chunk(record(writes[self.rel], -1, 0)))[0])
        self.assertEqual(states[:2], ["minecraft:stone", "minecraft:bricks"])
        preview = map_slice([self.base, live, self.upload], -1, 0, 0)
        rendered = [
            [preview["palette"][i] for i in grid[:2]] for grid in preview["layers"]
        ]
        self.assertEqual(
            rendered, [[AIR, AIR], [AIR, "minecraft:bricks"], ["minecraft:stone", AIR]]
        )

    def test_conflict_and_unsupported_edits(self):
        self.upload_edits({0: "minecraft:stone", 2: "minecraft:command_block"})
        self.file.write_bytes(self.edit(self.initial, {0: "minecraft:bricks"}))
        changes, _ = plan(self.root, self.uid, self.meta, self.base, self.upload)
        self.assertEqual([x["mode"] for x in changes], ["conflict", "manual"])

    def test_export_excludes_foreign_players_and_zip_escape(self):
        player_file(self.root, uuid.UUID(int=2).hex).write_bytes(b"private")
        with zipfile.ZipFile(self.base) as archive:
            self.assertEqual(set(archive.namelist()), {self.rel, "level.dat"})
        self.upload_edits({})
        with zipfile.ZipFile(self.upload, "a") as out:
            out.writestr("../foreign", b"data")
        with self.assertRaises(ValueError):
            plan(self.root, self.uid, self.meta, self.base, self.upload)

    def test_duplicate_merge_cannot_silently_duplicate_items(self):
        self.upload_edits({0: "minecraft:stone"})
        self.file.write_bytes(self.edit(self.initial, {0: "minecraft:stone"}))
        changes, _ = plan(self.root, self.uid, self.meta, self.base, self.upload)
        self.assertEqual(changes[0]["mode"], "conflict")


if __name__ == "__main__":
    unittest.main()
