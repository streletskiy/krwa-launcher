import gzip
import hashlib
import tempfile
import unittest
from pathlib import Path

import nbtlib as nbt

from anvil import VERSION, compressed, encode, index, replace_records
from assemblies import plan as plan_assemblies
from vehicles import entities, plan_entities


class Files(dict):
    def namelist(self):
        return list(self)

    def read(self, name):
        return self[name]


def entity(kind, number, x):
    return nbt.Compound(
        {
            "id": nbt.String("minecraft:" + kind),
            "UUID": nbt.IntArray([0, 0, 0, number]),
            "Pos": nbt.List[nbt.Double]([x, 64, 2]),
            "Motion": nbt.List[nbt.Double]([0, 0, 0]),
            "Rotation": nbt.List[nbt.Float]([0, 0]),
        }
    )


def region(x, *items):
    tag = nbt.File(
        {
            "DataVersion": nbt.Int(VERSION),
            "Position": nbt.IntArray([x, 0]),
            "Entities": nbt.List[nbt.Compound](items),
        }
    )
    return replace_records(b"", {index(x, 0): compressed(tag)})


def sable_sector(sector, tag):
    data = gzip.compress(encode(nbt.File(tag)), mtime=0)
    length = (len(data) + 5 + sector - 1) // sector
    buf = bytearray(4096 + length * sector)
    buf[:4] = ((4096 // sector << 8) | length).to_bytes(4, "big")
    buf[4096:4100] = (len(data) + 1).to_bytes(4, "big")
    buf[4101 : 4101 + len(data)] = data
    return bytes(buf)


class VehicleTest(unittest.TestCase):
    def test_move_create_destroy_across_dimensions_and_keep_server_mob(self):
        source = "entities/r.0.0.mca"
        target = "DIM-1/entities/r.1.0.mca"
        dims = ["minecraft:overworld", "minecraft:the_nether"]
        base = Files(
            {source: region(0, entity("boat", 1, 2), entity("minecart", 2, 3))}
        )
        after = Files(
            {target: region(32, entity("boat", 1, 514), entity("chest_boat", 3, 515))}
        )
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            loc = root / source
            loc.parent.mkdir()
            mob = entity("cow", 4, 5)
            loc.write_bytes(
                region(0, entity("boat", 1, 2), entity("minecart", 2, 3), mob)
            )
            changes, writes = plan_entities(
                root,
                {"dimensions": dims},
                base,
                after,
                {source: loc},
                set(after),
                {source},
            )
            self.assertEqual([c["mode"] for c in changes], ["auto"] * 3)
            found, all_ids = entities(writes, writes.__getitem__, dims)
            self.assertEqual(sorted(v[0] for v in found.values()), [dims[1]] * 2)
            self.assertEqual(len(all_ids), 3)
            loc.write_bytes(
                region(0, entity("boat", 1, 4), entity("minecart", 2, 3), mob)
            )
            changes, writes = plan_entities(
                root,
                {"dimensions": dims, "choices": set()},
                base,
                after,
                {source: loc},
                set(after),
                {source},
            )
            self.assertEqual(
                sorted(c["mode"] for c in changes), ["auto", "auto", "conflict"]
            )
            found, _ = entities(writes, writes.__getitem__, dims)
            self.assertEqual(sorted(v[0] for v in found.values()), sorted(dims))

    def test_sable_requires_intact_storage_and_explicit_choice(self):
        dim = "minecraft:overworld"
        holding = "sublevels/r.0.0.slvlr"
        storage = "sublevels/r.0.0.0.slvls"
        occupancy = "data/sable_sub_level_occupancy.dat"

        def vec(axes):
            return nbt.Compound({a: nbt.Double(1) for a in axes})

        ship = {
            "uuid": nbt.IntArray([1, 2, 3, 4]),
            "plot": nbt.Compound(
                {
                    "plot_x": nbt.Int(0),
                    "plot_z": nbt.Int(0),
                    "log_size": nbt.Int(7),
                    "chunks": nbt.Compound(),
                }
            ),
            "pose": nbt.Compound(
                {
                    "position": vec("xyz"),
                    "rotation_point": vec("xyz"),
                    "orientation": vec("xyzw"),
                }
            ),
            "world_bounds": nbt.Compound(
                {k + a: nbt.Double(1) for k in ("min", "max") for a in "XYZ"}
            ),
        }
        base = Files({holding: bytes(4096)})
        new = Files(
            {
                holding: sable_sector(128, {"pointers": nbt.IntArray([0])}),
                storage: sable_sector(4096, ship),
                occupancy: gzip.compress(
                    encode(
                        nbt.File(
                            {
                                "data": nbt.Compound(
                                    {"sub_level_occupancy": nbt.LongArray([1])}
                                )
                            }
                        )
                    )
                ),
            }
        )
        meta = {
            "dimensions": [dim],
            "files": [
                {"path": holding, "sha256": hashlib.sha256(base[holding]).hexdigest()}
            ],
            "choices": set(),
        }
        with tempfile.TemporaryDirectory() as tmp:
            live = Path(tmp) / "holding"
            live.write_bytes(base[holding])

            def make():
                return plan_assemblies(
                    meta, base, new, {holding: live}, set(new), set()
                )

            changes, writes = make()
            self.assertEqual(changes[0]["mode"], "conflict")
            self.assertFalse(writes)
            meta["choices"] = {"Сборки Create Aeronautics|" + dim}
            self.assertEqual(make()[1], dict(new))
            live.write_bytes(new[holding])
            self.assertEqual(make()[0][0]["mode"], "manual")
            self.assertFalse(make()[1])
            live.write_bytes(base[holding])
            del new[occupancy]
            self.assertEqual(make()[0][0]["mode"], "manual")
            self.assertFalse(make()[1])
