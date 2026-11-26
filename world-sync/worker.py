"""Serialize work under Crafty's stopped world lock, with durable file rollback."""

import hashlib
import importlib.util
import json
import logging
import os
import tempfile
import threading
import time
import zipfile
from pathlib import Path

import portalocker
from merge import can_skip_new, plan
from whole import export_whole
from store import HOME, audit, db, digest, set_state, write_file, write_json

log = logging.getLogger("world-sync")
WORLD = Path(os.environ["KRWA_SYNC_WORLD"]).resolve()
MAINT = HOME / "maintenance.json"
MUTEX = threading.RLock()
STOP = threading.Event()


def profile_version():
    path = Path(os.environ["KRWA_SYNC_DISTRIBUTION"])
    index = json.loads(path.read_text(encoding="utf-8-sig"))
    return next(
        s["version"] for s in index["servers"] if s["id"] == "krwa-aeronautics-1.21.1"
    )


class Crafty:
    def __init__(self):
        spec = importlib.util.spec_from_file_location(
            "crafty_api", os.environ["KRWA_SYNC_CRAFTY_HELPER"]
        )
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        self.call = module.request
        self.route = "/servers/" + os.environ["KRWA_SYNC_CRAFTY_ID"]

    def command(self, text):
        reply = self.call("POST", self.route + "/stdin", text)
        if reply.get("status") != "ok":
            raise RuntimeError("Crafty не принял команду сохранения.")

    def stats(self):
        return self.call("GET", self.route + "/stats")["data"]

    def start(self):
        self.call("POST", self.route + "/action/start_server")

    def stop(self):
        self.command("stop")

    def wait(self, running, seconds=240):
        deadline = time.monotonic() + seconds
        while time.monotonic() < deadline:
            if self.stats().get("running") is running:
                return
            time.sleep(2)
        raise RuntimeError("Crafty не подтвердил состояние сервера.")


def wait_feedback(logfile, start, endings, timeout=30):
    deadline = time.monotonic() + timeout
    with logfile.open("rb") as stream:
        stream.seek(start)
        tail = b""
        while time.monotonic() < deadline:
            incoming = stream.read(256 * 1024)
            if incoming:
                lines = (tail + incoming).split(b"\n")
                tail = lines.pop()[-8192:]
                for line in lines:
                    # Only console feedback. A player's chat contains its own prefix.
                    message = (
                        line.decode("utf8", "replace").rstrip().partition("]: ")[2]
                    )
                    for ending in endings:
                        if message == ending:
                            return ending
            else:
                time.sleep(0.15)
    raise RuntimeError("Нет подтверждения Minecraft в журнале сохранения.")


def contents(path):
    with zipfile.ZipFile(path) as archive:
        result = {}
        for name in archive.namelist():
            with archive.open(name) as stream:
                result[name] = hashlib.file_digest(stream, "sha256").digest()
        return result


def snapshot(trip, access, craft, job):
    logfile = WORLD.parent / "logs" / "latest.log"
    offset = logfile.stat().st_size
    craft.command("save-all flush")
    wait_feedback(logfile, offset, ("Saved the game", "Saved the world"), 90)
    first, second = job / "base.next", job / "verification.next"
    previous = None
    try:
        # Successive captures must agree on every exported byte. A busy parcel
        # can change between reads, while other parts of the server keep saving.
        for candidate in (first, second, first):
            candidate.unlink(missing_ok=True)
            meta = export_whole(WORLD, trip["uid"], access["name"], candidate)
            current = meta["files"]
            if current == previous:
                os.replace(candidate, job / "base.zip")
                write_json(job / "area.json", meta)
                set_state(trip["id"], "ready")
                return
            previous = current
        raise ValueError(
            "Участок менялся во время чтения. Повторите подготовку снимка."
        )
    finally:
        first.unlink(missing_ok=True)
        second.unlink(missing_ok=True)


def session_lock():
    # Minecraft's DirectoryLock uses an OS-level file lock on this file.
    return portalocker.Lock(
        str(WORLD / "session.lock"),
        mode="r+b",
        timeout=1,
        flags=portalocker.LOCK_EX | portalocker.LOCK_NB,
    )


def restore_files(job):
    manifest = job / "rollback" / "files.json"
    if not manifest.exists():
        return
    entries = json.loads(manifest.read_text())
    for rel in entries:
        if isinstance(entries, dict) and not entries[rel]:
            (WORLD / rel).unlink(missing_ok=True)
        else:
            write_file(WORLD / rel, (job / "rollback" / rel).read_bytes())


def recover(craft):
    if not MAINT.exists():
        return
    marker = json.loads(MAINT.read_text())
    with db() as con:
        row = con.execute(
            "SELECT state FROM trips WHERE id=?", (marker["id"],)
        ).fetchone()
    if not row:
        raise RuntimeError("Поездка для восстановления не найдена.")
    if marker.get("phase") == "stopping" and craft.stats().get("running") is True:
        craft.wait(False, 90)
    if marker.get("writing") and row["state"] != "done":
        if craft.stats().get("running") is not False:
            raise RuntimeError("Восстановление ждёт остановленного мира.")
        with session_lock():
            restore_files(HOME / marker["id"])
        set_state(
            marker["id"], "failed", "Запись прервалась. Исходные файлы восстановлены."
        )
    if craft.stats().get("running") is False:
        if not marker.get("start_sent"):
            marker["start_sent"] = True
            write_json(MAINT, marker)
            craft.start()
        craft.wait(True)
    MAINT.unlink()


def process(trip, craft):
    tid, uid = trip["id"], trip["uid"]
    job = HOME / tid
    with db() as con:
        access = con.execute(
            "SELECT name,state,cx,cz,scope FROM access WHERE uid=?", (uid,)
        ).fetchone()
    if not access or access["state"] != "allowed":
        set_state(tid, "closed", "Доступ отозван.")
        return
    if profile_version() != trip["version"]:
        set_state(
            tid,
            "review",
            "Сборка сервера изменилась. Автоматический перенос остановлен.",
        )
        return
    stats = craft.stats()
    if stats.get("running") is True and trip["state"] == "preparing":
        snapshot(trip, access, craft, job)
        return
    if stats.get("running") is not True or str(stats.get("online")) != "0":
        return
    write_json(MAINT, {"id": tid, "writing": False, "phase": "stopping"})
    # Never signal stop twice on a timeout. Recovery verifies observed state.
    craft.stop()
    craft.wait(False)
    write_json(MAINT, {"id": tid, "writing": False, "phase": "stopped"})
    try:
        with (
            session_lock(),
            tempfile.TemporaryDirectory(dir=job, prefix="merge-") as staging,
        ):
            meta = json.loads((job / "area.json").read_text())
            selection = trip["selection"] if trip["state"] == "approved" else None
            if selection is not None:
                meta["choices"] = set(json.loads(selection))
            changes, writes = plan(
                WORLD,
                uid,
                meta,
                job / "base.zip",
                job / "upload.zip",
                job / "live.next",
                staging=Path(staging),
            )
            os.replace(job / "live.next", job / "live.zip")
            fingerprint = digest(
                json.dumps(changes, ensure_ascii=False, sort_keys=True).encode()
            )
            write_json(job / "changes.json", changes)
            unsupported = any(c["mode"] == "manual" for c in changes)
            conflicts = any(c["mode"] == "conflict" for c in changes)
            approved = trip["state"] == "approved" and fingerprint == trip["review"]
            skip_new = approved and trip["skip_new"] and can_skip_new(changes)
            selective = selection is not None and approved
            if (
                (selection is not None and not approved)
                or (unsupported and not skip_new and not selective)
                or (conflicts and not approved)
            ):
                set_state(
                    tid, "review", "Требуется решение администратора.", fingerprint
                )
                return
            # A revocation and an apply are serialized by the same mutex. Recovery
            # only starts the server after all old files or all new files exist.
            backup = job / "rollback"
            backup.mkdir(exist_ok=True)
            existed = {rel: (WORLD / rel).exists() for rel in writes}
            for rel in writes:
                if not existed[rel]:
                    continue
                saved = backup / rel
                saved.parent.mkdir(parents=True, exist_ok=True)
                write_file(saved, (WORLD / rel).read_bytes())
            write_json(backup / "files.json", existed)
            write_json(MAINT, {"id": tid, "writing": True})
            try:
                for rel, data in writes.items():
                    (WORLD / rel).parent.mkdir(parents=True, exist_ok=True)
                    write_file(
                        WORLD / rel,
                        data.read_bytes() if isinstance(data, Path) else data,
                    )
                with db() as con:
                    con.execute(
                        "UPDATE trips SET state='done',detail=?,review=?,updated=? WHERE id=?",
                        (
                            f"Применено совместимых изменений: {sum(c['mode'] == 'auto' for c in changes)}, выбранных конфликтов: {len(meta['choices'])}. Остальные изменения сохранены в архиве."
                            if selective
                            else "Новые чанки оставлены в архиве для ручного переноса."
                            if skip_new
                            else "",
                            fingerprint,
                            int(time.time()),
                            tid,
                        ),
                    )
                    audit(con, "worker", "applied", tid)
            except Exception:
                restore_files(job)
                raise
    finally:
        # Keep the durable marker on failure. Startup retries recovery before jobs.
        recover(craft)


def loop():
    craft = Crafty()
    while not STOP.is_set():
        try:
            with MUTEX:
                recover(craft)
                with db() as con:
                    trip = con.execute(
                        "SELECT * FROM trips WHERE state IN ('preparing','submitted','approved') ORDER BY updated LIMIT 1"
                    ).fetchone()
                if (
                    trip
                    and trip["state"] != "preparing"
                    and str(craft.stats().get("online")) != "0"
                ):
                    with db() as con:
                        trip = con.execute(
                            "SELECT * FROM trips WHERE state='preparing' ORDER BY updated LIMIT 1"
                        ).fetchone()
                if trip:
                    try:
                        process(trip, craft)
                    except Exception as err:
                        if MAINT.exists():
                            raise
                        log.exception("Trip validation failed %s", trip["id"])
                        set_state(
                            trip["id"],
                            "failed",
                            str(err)[:200]
                            if isinstance(err, ValueError)
                            else "Не удалось обработать поездку. Исходная копия сохранена.",
                        )
        except Exception:
            log.exception("World worker waiting for recovery")
        STOP.wait(12)
