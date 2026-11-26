import contextlib
import hashlib
import json
import os
import sqlite3
import time
from pathlib import Path

HOME = Path(os.environ["KRWA_SYNC_DATA"]).resolve()
HOME.mkdir(parents=True, exist_ok=True)
DB = HOME / "trips.sqlite3"


@contextlib.contextmanager
def db():
    con = sqlite3.connect(DB, timeout=15)
    con.row_factory = sqlite3.Row
    try:
        with con:
            yield con
    finally:
        con.close()


def init():
    with db() as con:
        con.executescript("""
        CREATE TABLE IF NOT EXISTS access (
            uid TEXT PRIMARY KEY, name TEXT NOT NULL, state TEXT NOT NULL, updated INTEGER NOT NULL, cx INTEGER, cz INTEGER);
        CREATE TABLE IF NOT EXISTS trips (
            id TEXT PRIMARY KEY, uid TEXT NOT NULL, state TEXT NOT NULL, version TEXT NOT NULL,
            updated INTEGER NOT NULL, detail TEXT DEFAULT '', digest TEXT DEFAULT '', review TEXT DEFAULT '');
        CREATE UNIQUE INDEX IF NOT EXISTS one_trip ON trips(uid) WHERE state NOT IN ('done','closed','failed');
        CREATE TABLE IF NOT EXISTS audit (at INTEGER, actor TEXT, event TEXT, target TEXT);
        """)
        if "scope" not in {r[1] for r in con.execute("PRAGMA table_info(access)")}:
            con.execute(
                "ALTER TABLE access ADD COLUMN scope TEXT NOT NULL DEFAULT 'world'"
            )

        con.execute(
            "UPDATE access SET scope='world',cx=NULL,cz=NULL WHERE scope!='world'"
        )
        if "skip_new" not in {r[1] for r in con.execute("PRAGMA table_info(trips)")}:
            con.execute(
                "ALTER TABLE trips ADD COLUMN skip_new INTEGER NOT NULL DEFAULT 0"
            )


def audit(con, actor, event, target):
    con.execute(
        "INSERT INTO audit VALUES(?,?,?,?)", (int(time.time()), actor, event, target)
    )


def set_state(trip, state, detail="", review=""):
    with db() as con:
        con.execute(
            "UPDATE trips SET state=?,detail=?,review=?,updated=? WHERE id=?",
            (state, detail, review, int(time.time()), trip),
        )


def write_file(path, data):
    tmp = path.with_suffix(path.suffix + ".next")
    with tmp.open("wb") as stream:
        stream.write(data)
        stream.flush()
        os.fsync(stream.fileno())
    os.replace(tmp, path)


def write_json(path, obj):
    write_file(
        path, json.dumps(obj, ensure_ascii=False, separators=(",", ":")).encode()
    )


def digest(data):
    return hashlib.sha256(data).hexdigest()


def public(row):
    return (
        {
            k: row[k]
            for k in (
                "id",
                "uid",
                "state",
                "version",
                "updated",
                "detail",
                "digest",
                "review",
            )
        }
        if row
        else None
    )
