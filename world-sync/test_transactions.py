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
                "INSERT INTO access VALUES(?,?,'allowed',0,-1,0)", (self.uid, "QA")
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
