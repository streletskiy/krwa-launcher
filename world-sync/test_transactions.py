import hashlib
import json
import os
import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient

import test_world_sync


class Game:
    running = True
    starts = 0

    def stats(self):
        return {"running": self.running, "online": 0}

    def start(self):
        self.starts += 1
        self.running = True

    def stop(self):
        self.running = False

    def wait(self, state, seconds=240):
        assert self.running is state


class TransactionTest(unittest.TestCase):
    def setUp(self):
        self.fixture = test_world_sync.TripMergeTest()
        self.fixture.setUp()
        self.addCleanup(self.fixture.doCleanups)
        self.root = self.fixture.root
        data = self.root / "private"
        data.mkdir()
        os.environ.setdefault("KRWA_SYNC_DATA", str(data))
        os.environ.setdefault("KRWA_SYNC_WORLD", str(self.root))
        import app
        import store
        import worker

        self.app, self.worker = app, worker
        for module, fields in [
            (app, {"HOME": data}),
            (store, {"HOME": data, "DB": data / "state.db"}),
            (
                worker,
                {
                    "WORLD": self.root,
                    "HOME": data,
                    "MAINT": data / "maintenance.json",
                },
            ),
        ]:
            for key, value in fields.items():
                p = patch.object(module, key, value)
                p.start()
                self.addCleanup(p.stop)
        self.store = store
        store.init()
        self.root.joinpath("session.lock").write_bytes(b"lock")
        self.uid = self.fixture.uid
        self.tid = "a" * 32
        self.job = data / self.tid
        self.job.mkdir()
        self.job.joinpath("base.zip").write_bytes(self.fixture.base.read_bytes())
        self.job.joinpath("area.json").write_text(json.dumps(self.fixture.meta))
        with store.db() as conn:
            conn.execute(
                "INSERT INTO access(uid,name,state,updated,cx,cz) VALUES(?,?,'allowed',0,-1,0)",
                (self.uid, "QA"),
            )
            conn.execute(
                "INSERT INTO trips(id,uid,state,version,updated) VALUES(?,?,'ready','qa',0)",
                (self.tid, self.uid),
            )
        app.app.dependency_overrides[app.player] = lambda: self.uid
        app.app.dependency_overrides[app.admin] = lambda: "admin:qa"
        self.addCleanup(app.app.dependency_overrides.clear)
        self.client = TestClient(app.app)
        self.addCleanup(self.client.close)
        self.game = Game()
        v = patch.object(worker, "profile_version", return_value="qa")
        v.start()
        self.addCleanup(v.stop)

    def state(self):
        with self.store.db() as con:
            return dict(
                con.execute("SELECT * FROM trips WHERE id=?", (self.tid,)).fetchone()
            )

    def send(self):
        self.fixture.upload_edits({0: "minecraft:stone"})
        data = self.fixture.upload.read_bytes()
        self.headers = {"X-Content-SHA256": hashlib.sha256(data).hexdigest()}
        return self.client.put(
            "/api/offline-worlds/trips/" + self.tid, content=data, headers=self.headers
        )

    def test_legacy_recovery_waits_for_a_decision(self):
        self.send()
        trip = self.state()
        saved = self.job / ("recovered-advancements." + trip["digest"] + ".json")
        saved.write_text(
            json.dumps(
                {
                    "DataVersion": 3955,
                    "example:ride": {
                        "criteria": {"boat": "2026-01-01 10:00:00 +0000"},
                        "done": True,
                    },
                }
            )
        )
        self.worker.process(trip, self.game)
        self.assertEqual(self.state()["state"], "review")
        api = "/api/offline-worlds/admin/trips/" + self.tid
        entry = next(
            c
            for c in self.client.get(api).json()["changes"]
            if c["kind"] == "Достижения из копии поездки"
        )
        self.assertEqual(entry["mode"], "conflict")
        accepted = self.client.post(
            api + "/merge",
            json={"fingerprint": self.state()["review"], "player": [entry["key"]]},
        )
        self.assertEqual(accepted.status_code, 200)
        self.worker.process(self.state(), self.game)
        self.assertEqual(self.state()["state"], "done")
        from progress import progress_paths

        self.assertTrue(
            json.loads((self.root / progress_paths(self.uid)[0]).read_text())[
                "example:ride"
            ]["done"]
        )

    def test_whole_world_transfer_and_dimension_review(self):
        import zipfile
        from whole import DIMENSIONS, export_whole

        api = "/api/offline-worlds/trips/" + self.tid
        for prefix in [
            *list(DIMENSIONS.values())[1:],
            "dimensions/example/moon/orbit/",
        ]:
            path = self.root / prefix / self.fixture.rel
            path.parent.mkdir(parents=True)
            path.write_bytes(self.fixture.initial)
        base = self.job / "base.zip"
        base.unlink()
        meta = export_whole(self.root, self.uid, "QA", base)
        (self.job / "area.json").write_text(json.dumps(meta))
        with self.store.db() as con:
            con.execute("UPDATE access SET scope='world' WHERE uid=?", (self.uid,))
        self.assertEqual(
            self.client.post(
                "/api/offline-worlds/trips", json={"version": "qa"}
            ).status_code,
            409,
        )
        files, parts = [], []
        with zipfile.ZipFile(base) as archive:
            for i, item in enumerate(meta["files"]):
                name = item["path"]
                data = self.client.get(api + "/files/" + str(i)).content
                self.assertEqual(hashlib.sha256(data).hexdigest(), item["sha256"])
                self.assertEqual(data, archive.read(name))
                if name.startswith("advancements/"):
                    data = json.dumps(
                        {
                            "DataVersion": 3955,
                            "qa:explore": {
                                "criteria": {"visit": "2026-11-26 10:00:00 +0000"},
                                "done": True,
                            },
                        }
                    ).encode()
                if name.startswith("ftbquests/"):
                    from progress import parse_snbt, encode_tag
                    import nbtlib

                    quest = parse_snbt(data)
                    quest["completed"] = nbtlib.Compound(
                        {"1122334455667788": nbtlib.Long(42)}
                    )
                    data = encode_tag(quest)
                if name.endswith(".mca"):
                    data = self.fixture.edit(data, {0: "minecraft:stone"})
                files.append(
                    {
                        "path": name,
                        "bytes": len(data),
                        "parts": [hashlib.sha256(data).hexdigest()],
                    }
                )
                parts.append(data)
        route = api + "/transfer"
        batch = self.client.post(route, json={"files": files}).json()
        target = route + "/" + batch["key"]
        self.assertEqual(
            self.client.put(target + "/0", content=b"bad").status_code, 422
        )
        for i in batch["missing"]:
            self.assertEqual(
                self.client.put(target + "/" + str(i), content=parts[i]).status_code,
                200,
            )
        self.assertFalse(
            self.client.post(route, json={"files": files}).json()["missing"]
        )
        self.assertEqual(
            self.client.post(target + "/finish").json()["state"], "submitted"
        )
        self.assertTrue(
            self.client.post(route, json={"files": files}).json()["complete"]
        )
        nether = self.root / "DIM-1" / self.fixture.rel
        nether.write_bytes(
            self.fixture.edit(self.fixture.initial, {0: "minecraft:bricks"})
        )
        self.worker.process(self.state(), self.game)
        self.assertEqual(self.state()["state"], "review")
        changes = json.loads((self.job / "changes.json").read_text(encoding="utf-8"))
        self.assertEqual(
            {c["dimension"]: c["mode"] for c in changes if "dimension" in c},
            {
                "minecraft:overworld": "auto",
                "minecraft:the_nether": "conflict",
                "minecraft:the_end": "auto",
                "example:moon/orbit": "auto",
            },
        )
        admin = "/api/offline-worlds/admin/trips/" + self.tid
        img = self.client.get(
            admin + "/map?x=-1&z=0&y=0&dimension=minecraft:the_nether"
        ).json()
        self.assertEqual(
            [img["palette"][layer[0]] for layer in img["layers"]],
            ["minecraft:air", "minecraft:bricks", "minecraft:stone"],
        )
        self.assertEqual(
            self.client.post(
                admin + "/accept", json={"fingerprint": self.state()["review"]}
            ).status_code,
            200,
        )
        self.worker.process(self.state(), self.game)
        self.assertEqual(self.state()["state"], "done")
        from progress import progress_paths, parse_snbt

        adv, quests = progress_paths(self.uid)
        self.assertTrue(json.loads((self.root / adv).read_text())["qa:explore"]["done"])
        self.assertEqual(
            parse_snbt((self.root / quests).read_bytes())["completed"][
                "1122334455667788"
            ],
            42,
        )
        self.client.post("/api/offline-worlds/admin/access/" + self.uid + "/denied")
        self.assertEqual(self.client.get(api + "/files/0").status_code, 403)

    def test_admin_can_keep_new_terrain_and_apply_known_edits(self):
        import zipfile
        from whole import export_whole

        base = self.job / "base.zip"
        base.unlink()
        meta = export_whole(self.root, self.uid, "QA", base)
        (self.job / "area.json").write_text(json.dumps(meta))
        with (
            zipfile.ZipFile(base) as original,
            zipfile.ZipFile(self.job / "upload.zip", "w") as out,
        ):
            out.writestr("level.dat", original.read("level.dat"))
            edited = self.fixture.edit(self.fixture.initial, {0: "minecraft:bricks"})
            out.writestr(self.fixture.rel, edited)
            out.writestr("DIM1/" + self.fixture.rel, edited)
        self.store.set_state(self.tid, "submitted")
        self.worker.process(self.state(), self.game)
        self.assertEqual(self.state()["state"], "review")
        api = "/api/offline-worlds/admin/trips/" + self.tid
        decision = {"fingerprint": self.state()["review"]}
        self.assertEqual(
            self.client.post(api + "/accept", json=decision).status_code, 409
        )
        self.assertEqual(
            self.client.post(api + "/accept-existing", json=decision).status_code, 200
        )
        self.fixture.file.write_bytes(
            self.fixture.edit(self.fixture.initial, {0: "minecraft:stone"})
        )
        self.worker.process(self.state(), self.game)
        self.assertEqual(self.state()["state"], "review")
        self.assertEqual(
            self.client.post(
                api + "/accept-existing", json={"fingerprint": self.state()["review"]}
            ).status_code,
            200,
        )
        self.worker.process(self.state(), self.game)
        self.assertEqual(self.state()["state"], "done")
        self.assertFalse((self.root / "DIM1" / self.fixture.rel).exists())
        self.assertNotEqual(self.fixture.file.read_bytes(), self.fixture.initial)
        self.assertIn("архиве", self.state()["detail"])

    def test_automatic_return_uses_offline_position_and_keeps_overlapping_online_blocks(
        self,
    ):
        import gzip
        import zipfile
        import nbtlib
        from anvil import blocks, chunk, encode, level_data, record, sections
        from whole import export_whole
        from parcel import get_player, player_file

        nether = self.root / "DIM-1" / self.fixture.rel
        nether.parent.mkdir(parents=True)
        nether.write_bytes(self.fixture.initial)
        base = self.job / "base.zip"
        base.unlink()
        meta = export_whole(self.root, self.uid, "QA", base)
        meta["mergePolicy"] = "automatic"
        self.store.write_json(self.job / "area.json", meta)
        with (
            zipfile.ZipFile(base) as src,
            zipfile.ZipFile(self.job / "upload.zip", "w") as out,
        ):
            level = level_data(src.read("level.dat"))
            dest = level["Data"]["Player"]
            dest["Dimension"] = nbtlib.String("minecraft:the_nether")
            dest["Pos"] = nbtlib.List[nbtlib.Double]([-6.25, 4, 3.5])
            dest["Rotation"] = nbtlib.List[nbtlib.Float]([43, -12])
            out.writestr("level.dat", gzip.compress(encode(level)))
            out.writestr(
                self.fixture.rel,
                self.fixture.edit(
                    self.fixture.initial, {0: "minecraft:stone", 1: "minecraft:bricks"}
                ),
            )
        online = get_player(self.root, self.uid)
        online["Pos"] = nbtlib.List[nbtlib.Double]([-12, 3, 5])
        online["FallDistance"] = nbtlib.Float(8)
        player_file(self.root, self.uid).write_bytes(gzip.compress(encode(online)))
        self.fixture.file.write_bytes(
            self.fixture.edit(self.fixture.initial, {0: "minecraft:dirt"})
        )
        self.store.set_state(self.tid, "submitted")
        self.worker.process(self.state(), self.game)
        self.assertEqual(self.state()["state"], "done")
        returned = get_player(self.root, self.uid)
        for key in ("Dimension", "Pos", "Rotation"):
            self.assertEqual(returned[key], dest[key])
        self.assertEqual(float(returned["FallDistance"]), 0)
        terrain = blocks(
            sections(chunk(record(self.fixture.file.read_bytes(), -1, 0)))[0]
        )
        self.assertEqual(terrain[:2], ["minecraft:dirt", "minecraft:bricks"])
        self.assertEqual(
            len(
                [
                    c
                    for c in json.loads((self.job / "changes.json").read_text("utf8"))
                    if c["kind"] == "player_position"
                ]
            ),
            1,
        )

    def test_auto_merge_keeps_live_conflict(self):
        self.fixture.upload_edits({0: "minecraft:stone", 1: "minecraft:bricks"})
        data = self.fixture.upload.read_bytes()
        uri = "/api/offline-worlds/trips/" + self.tid
        self.assertEqual(
            self.client.put(
                uri,
                content=data,
                headers={"X-Content-SHA256": hashlib.sha256(data).hexdigest()},
            ).status_code,
            200,
        )
        self.fixture.file.write_bytes(
            self.fixture.edit(self.fixture.initial, {0: "minecraft:dirt"})
        )
        self.worker.process(self.state(), self.game)
        self.assertEqual(self.state()["state"], "review")
        uri = "/api/offline-worlds/admin/trips/" + self.tid
        choice = {"fingerprint": self.state()["review"], "player": []}
        self.assertEqual(
            self.client.post(
                uri + "/merge", json={**choice, "player": ["unknown"]}
            ).status_code,
            422,
        )
        self.assertEqual(self.client.post(uri + "/merge", json=choice).status_code, 200)
        self.worker.process(self.state(), self.game)
        self.assertEqual(self.state()["state"], "done")
        from anvil import blocks, chunk, record, sections

        live = blocks(sections(chunk(record(self.fixture.file.read_bytes(), -1, 0)))[0])
        self.assertEqual(live[:2], ["minecraft:dirt", "minecraft:bricks"])

    def test_apply_and_repeat(self):
        self.assertEqual(self.send().status_code, 200)
        self.worker.process(self.state(), self.game)
        self.assertEqual(self.state()["state"], "done")
        self.assertEqual(self.game.starts, 1)
        self.assertEqual(
            (self.job / "rollback" / self.fixture.rel).read_bytes(),
            self.fixture.initial,
        )
        reply = self.client.put(
            "/api/offline-worlds/trips/" + self.tid, content=b"", headers=self.headers
        )
        self.assertEqual(reply.json()["state"], "done")
        self.assertFalse(self.worker.MAINT.exists())

    def test_review_rereads_latest_server(self):
        self.send()
        self.fixture.file.write_bytes(
            self.fixture.edit(self.fixture.initial, {0: "minecraft:bricks"})
        )
        self.worker.process(self.state(), self.game)
        s = self.state()
        self.assertEqual(s["state"], "review")
        api = "/api/offline-worlds/admin/trips/" + self.tid
        self.assertEqual(self.client.get(api + "/map?x=-1&z=0&y=0").status_code, 200)
        self.assertEqual(
            self.client.post(
                api + "/accept", json={"fingerprint": "stale"}
            ).status_code,
            409,
        )
        self.assertEqual(
            self.client.post(
                api + "/accept", json={"fingerprint": s["review"]}
            ).status_code,
            200,
        )
        self.fixture.file.write_bytes(
            self.fixture.edit(self.fixture.initial, {0: "minecraft:dirt"})
        )
        self.worker.process(self.state(), self.game)
        self.assertEqual(self.state()["state"], "review")
        self.assertNotEqual(s["review"], self.state()["review"])
        self.assertEqual(
            self.client.post(
                api + "/accept", json={"fingerprint": self.state()["review"]}
            ).status_code,
            200,
        )
        self.worker.process(self.state(), self.game)
        self.assertEqual(self.state()["state"], "done")

    def test_revocation_and_unauthenticated_routes(self):
        self.client.post("/api/offline-worlds/admin/access/" + self.uid + "/denied")
        self.assertEqual(self.send().status_code, 403)
        self.app.app.dependency_overrides.pop(self.app.player)
        self.assertEqual(self.client.get("/api/offline-worlds/me").status_code, 401)

    def test_interrupted_world_write_rolls_back(self):
        self.send()
        saved = self.job / "rollback" / self.fixture.rel
        saved.parent.mkdir(parents=True)
        saved.write_bytes(self.fixture.initial)
        (self.job / "rollback/files.json").write_text(json.dumps([self.fixture.rel]))
        self.fixture.file.write_bytes(b"interrupted")
        self.worker.MAINT.write_text(json.dumps({"id": self.tid, "writing": True}))
        self.game.running = False
        self.worker.recover(self.game)
        self.assertEqual(self.fixture.file.read_bytes(), self.fixture.initial)
        self.assertEqual(self.state()["state"], "failed")
        self.assertTrue(self.game.running)


if __name__ == "__main__":
    unittest.main()
