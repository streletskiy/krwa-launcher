"""KRWA offline trips API. Aster remains authoritative for both kinds of identity."""

import asyncio
import contextlib
import hashlib
import json
import math
import os
import re
import secrets
import shutil
import threading
import time
import uuid
from pathlib import Path
from typing import Literal
import zipfile

import httpx
from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.responses import FileResponse
from pydantic import BaseModel

from starlette.responses import Response, StreamingResponse
from merge import can_skip_new, map_slice
import worker
import transfer
from whole import DIMENSIONS, dimension_prefix
from parcel import MAX_UPLOAD, get_player, validate_upload
from store import HOME, audit, db, init, public

ORIGIN = os.environ.get("KRWA_SYNC_ORIGIN", "https://mc.krwa.ru")
AUTH = os.environ.get("KRWA_SYNC_AUTH", "http://127.0.0.1:8089")
API = "/api/offline-worlds"
ASSETS = Path(__file__).parent / "static"
sessions = {}
session_lock = threading.Lock()
upload_slots = threading.BoundedSemaphore(2)


@contextlib.asynccontextmanager
async def lifespan(app):
    init()
    worker.STOP.clear()
    task = threading.Thread(target=worker.loop, daemon=True)
    task.start()
    yield
    worker.STOP.set()
    await asyncio.to_thread(task.join, 260)


app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None, lifespan=lifespan)


@app.middleware("http")
async def response_headers(request, call_next):
    if request.method != "GET" and request.headers.get("origin") not in (
        None,
        "null",
        ORIGIN,
    ):
        return Response(status_code=403)
    result = await call_next(request)
    result.headers["Cache-Control"] = "private, no-store"
    result.headers["X-Content-Type-Options"] = "nosniff"
    result.headers["Referrer-Policy"] = "no-referrer"
    result.headers["Content-Security-Policy"] = (
        "default-src 'self'; script-src 'self'; style-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"
    )
    return result


def player(request: Request):
    scheme, _, token = request.headers.get("authorization", "").partition(" ")
    with session_lock:
        entry = sessions.get(hashlib.sha256(token.encode()).digest())
    if scheme != "Bearer" or not entry or entry[1] < time.time():
        raise HTTPException(401, "Войдите в аккаунт KRWA.")
    return entry[0]


async def admin(request: Request):
    if request.method != "GET" and (
        request.headers.get("origin") != ORIGIN
        or request.headers.get("x-krwa-review") != "1"
    ):
        raise HTTPException(403, "Откройте раздел на сайте KRWA.")
    async with httpx.AsyncClient(timeout=6) as client:
        response = await client.get(
            AUTH + "/api/v1/auth/me",
            headers={"Cookie": request.headers.get("cookie", "")},
        )
    if response.status_code != 200:
        raise HTTPException(401, "Войдите на сайт KRWA как администратор.")
    user = response.json().get("data") or {}
    if user.get("role") != "admin":
        raise HTTPException(403, "Нужна роль администратора.")
    return "admin:" + str(user["id"])


def check_access(con, uid):
    row = con.execute("SELECT state FROM access WHERE uid=?", (uid,)).fetchone()
    if not row or row[0] != "allowed":
        raise HTTPException(403, "Для поездки нужно разрешение администратора.")


def owned(con, tid, uid):
    check_access(con, uid)
    row = con.execute("SELECT * FROM trips WHERE id=? AND uid=?", (tid, uid)).fetchone()
    if not row:
        raise HTTPException(404, "Поездка не найдена.")
    return row


class Login(BaseModel):
    profile: uuid.UUID


@app.post(API + "/session")
async def open_session(body: Login, request: Request):
    auth = request.headers.get("authorization", "")
    if not auth.startswith("Bearer ") or len(auth) > 4096:
        raise HTTPException(401)
    uid = body.profile.hex
    async with httpx.AsyncClient(timeout=8) as client:
        url = AUTH + "/api/yggdrasil/sessionserver/session/minecraft"
        # Aster verifies the selected profile belongs to this game token.
        proof = await client.post(
            url + "/join",
            json={
                "accessToken": auth[7:],
                "selectedProfile": uid,
                "serverId": secrets.token_hex(18),
            },
        )
        if proof.status_code != 204:
            raise HTTPException(401, "Повторите вход в KRWA.")
        info = await client.get(url + "/profile/" + uid)
    if info.status_code != 200 or info.json().get("id", "").replace("-", "") != uid:
        raise HTTPException(401)
    name = info.json()["name"]
    token = secrets.token_urlsafe(32)
    now = time.time()
    with session_lock:
        for key in [k for k, (_, end) in sessions.items() if end <= now]:
            del sessions[key]
        if len(sessions) >= 4096:
            raise HTTPException(429)
        sessions[hashlib.sha256(token.encode()).digest()] = (uid, now + 1800)
    with db() as con:
        con.execute("UPDATE access SET name=? WHERE uid=?", (name, uid))
    return {"token": token, "name": name}


@app.get(API + "/me")
def me(uid=Depends(player)):
    with db() as con:
        a = con.execute("SELECT state,scope FROM access WHERE uid=?", (uid,)).fetchone()
        t = con.execute(
            "SELECT * FROM trips WHERE uid=? ORDER BY rowid DESC LIMIT 1", (uid,)
        ).fetchone()
    return {
        "access": a[0] if a else "none",
        "scope": "world",
        "trip": public(t),
    }


def player_center(uid):
    try:
        p = get_player(worker.WORLD, uid)
        if str(p.get("Dimension")) == "minecraft:overworld":
            return math.floor(float(p["Pos"][0]) / 16), math.floor(
                float(p["Pos"][2]) / 16
            )
    except (OSError, ValueError, KeyError):
        pass
    return None, None


@app.post(API + "/request")
async def request_access(uid=Depends(player)):
    async with httpx.AsyncClient(timeout=7) as client:
        result = await client.get(
            AUTH + "/api/yggdrasil/sessionserver/session/minecraft/profile/" + uid
        )
    if result.status_code != 200:
        raise HTTPException(503, "Профиль временно недоступен.")
    with db() as con:
        con.execute(
            "INSERT OR IGNORE INTO access(uid,name,state,updated,scope) VALUES(?,?, 'pending',?,'world')",
            (uid, result.json()["name"], int(time.time())),
        )
        audit(con, uid, "requested", uid)
    return me(uid)


class Start(BaseModel):
    version: str
    protocol: int = 1


@app.post(API + "/trips")
def start(body: Start, uid=Depends(player)):
    with db() as con:
        con.execute("BEGIN IMMEDIATE")
        check_access(con, uid)
        if body.protocol < 3:
            raise HTTPException(409, "Обновите лаунчер для загрузки полного мира.")
        existing = con.execute(
            "SELECT * FROM trips WHERE uid=? AND state NOT IN ('closed','done','failed')",
            (uid,),
        ).fetchone()
        if existing:
            return public(existing)
        recent = con.execute(
            "SELECT COUNT(*) FROM trips WHERE uid=? AND updated>?",
            (uid, int(time.time()) - 3600),
        ).fetchone()[0]
        if recent >= 4:
            raise HTTPException(429, "За час можно подготовить четыре поездки.")
        if shutil.disk_usage(HOME).free < 2 * 1024**3:
            raise HTTPException(507, "На сервере недостаточно места для новой поездки.")
        if body.version != worker.profile_version():
            raise HTTPException(409, "Сначала обновите сборку KRWA.")
        tid = uuid.uuid4().hex
        (HOME / tid).mkdir(mode=0o700)
        con.execute(
            "INSERT INTO trips(id,uid,state,version,updated) VALUES(?,?,'preparing',?,?)",
            (tid, uid, body.version, int(time.time())),
        )
        audit(con, uid, "started", tid)
        return public(owned(con, tid, uid))


@app.get(API + "/trips/{trip}/download")
def download(trip: uuid.UUID, uid=Depends(player)):
    with db() as con:
        row = owned(con, trip.hex, uid)
    if row["state"] != "ready":
        raise HTTPException(409, "Снимок ещё не готов.")
    return FileResponse(HOME / trip.hex / "base.zip", media_type="application/zip")


@app.get(API + "/trips/{trip}/area")
def trip_area(trip: uuid.UUID, uid=Depends(player)):
    with db() as con:
        row = owned(con, trip.hex, uid)
    if row["state"] != "ready":
        raise HTTPException(409)
    return json.loads((HOME / trip.hex / "area.json").read_text())


def whole_trip(con, tid, uid):
    row = owned(con, tid, uid)
    folder = HOME / tid
    file = folder / "area.json"
    if not file.is_file() or json.loads(file.read_text()).get("scope") != "world":
        raise HTTPException(409, "Эта поездка рассчитана на участок.")
    return row, folder


@app.get(API + "/trips/{trip}/files/{index}")
def world_file(trip: uuid.UUID, index: int, uid=Depends(player)):
    with db() as con:
        row, folder = whole_trip(con, trip.hex, uid)
    if row["state"] != "ready":
        raise HTTPException(409)
    files = json.loads((folder / "area.json").read_text())["files"]
    if not 0 <= index < len(files):
        raise HTTPException(404)
    item = files[index]

    def stream():
        with (
            zipfile.ZipFile(folder / "base.zip") as archive,
            archive.open(item["path"]) as src,
        ):
            while block := src.read(1024 * 1024):
                yield block

    return StreamingResponse(
        stream(),
        media_type="application/octet-stream",
        headers={"Content-Length": str(item["bytes"])},
    )


class Transfer(BaseModel):
    files: list[dict]


@app.post(API + "/trips/{trip}/transfer")
def begin_transfer(trip: uuid.UUID, body: Transfer, uid=Depends(player)):
    with db() as con:
        con.execute("BEGIN IMMEDIATE")
        row, folder = whole_trip(con, trip.hex, uid)
        dimensions = json.loads((folder / "area.json").read_text())["dimensions"]
        try:
            key, parts, total = transfer.manifest(body.files, uid, dimensions)
        except ValueError as exc:
            raise HTTPException(422, str(exc)) from exc
        if row["state"] != "ready":
            if row["digest"] == key:
                return {"key": key, "complete": True}
            raise HTTPException(409)
        stage = folder / "transfer"
        stage.mkdir(exist_ok=True)
        meta = stage / "manifest.json"
        if meta.exists():
            if json.loads(meta.read_text())["key"] != key:
                raise HTTPException(409, "Для поездки уже начата другая отправка.")
        else:
            if shutil.disk_usage(stage).free < 2 * total + 2 * 1024**3:
                raise HTTPException(507, "Недостаточно места для отправки.")
            worker.write_json(meta, {"key": key, "files": body.files})
        missing = [i for i, (h, _) in enumerate(parts) if not (stage / h).is_file()]
    return {"key": key, "missing": missing}


def pending(con, trip, uid, key):
    row, folder = whole_trip(con, trip.hex, uid)
    stage = folder / "transfer"
    meta = stage / "manifest.json"
    if row["state"] != "ready" or not meta.is_file():
        raise HTTPException(409)
    document = json.loads(meta.read_text())
    if document["key"] != key:
        raise HTTPException(409)
    return stage, document["files"]


@app.put(API + "/trips/{trip}/transfer/{key}/{index}")
async def upload_part(
    trip: uuid.UUID, key: str, index: int, request: Request, uid=Depends(player)
):
    with db() as con:
        stage, files = pending(con, trip, uid, key)
    parts = transfer.manifest(files, uid)[1]
    if not 0 <= index < len(parts):
        raise HTTPException(404)
    h, size = parts[index]
    if not upload_slots.acquire(blocking=False):
        raise HTTPException(429)
    temp = stage / (uuid.uuid4().hex + ".part")
    try:
        digest, n = hashlib.sha256(), 0
        with temp.open("xb") as dst:
            async for data in request.stream():
                n += len(data)
                if n > size:
                    raise HTTPException(413)
                dst.write(data)
                digest.update(data)
        if n != size or digest.hexdigest() != h:
            raise HTTPException(422, "Контрольная сумма части не совпала.")
        with db() as con:
            con.execute("BEGIN IMMEDIATE")
            pending(con, trip, uid, key)
            os.replace(temp, stage / h)
        return {"ok": True}
    finally:
        temp.unlink(missing_ok=True)
        upload_slots.release()


@app.post(API + "/trips/{trip}/transfer/{key}/finish")
async def finish_transfer(trip: uuid.UUID, key: str, uid=Depends(player)):
    with db() as con:
        row, folder = whole_trip(con, trip.hex, uid)
        if row["digest"] == key and row["state"] != "ready":
            return public(row)
        stage, files = pending(con, trip, uid, key)
    if not upload_slots.acquire(blocking=False):
        raise HTTPException(429)
    temp = folder / (uuid.uuid4().hex + ".zip.part")
    try:
        try:
            dimensions = json.loads((folder / "area.json").read_text())["dimensions"]
            await asyncio.to_thread(
                transfer.assemble, stage, files, temp, uid, dimensions
            )
        except (ValueError, KeyError, OSError, TypeError) as exc:
            raise HTTPException(
                422, "Отправка неполна или содержит повреждённые чанки."
            ) from exc
        with db() as con:
            con.execute("BEGIN IMMEDIATE")
            row = owned(con, trip.hex, uid)
            if row["digest"] == key and row["state"] != "ready":
                return public(row)
            pending(con, trip, uid, key)
            os.replace(temp, folder / "upload.zip")
            con.execute(
                "UPDATE trips SET digest=?,state='submitted',updated=? WHERE id=?",
                (key, int(time.time()), trip.hex),
            )
            audit(con, uid, "submitted", trip.hex)
            return public(owned(con, trip.hex, uid))
    finally:
        temp.unlink(missing_ok=True)
        upload_slots.release()


@app.put(API + "/trips/{trip}")
async def upload(trip: uuid.UUID, request: Request, uid=Depends(player)):
    tid = trip.hex
    checksum = request.headers.get("x-content-sha256", "")
    if not re.fullmatch("[0-9a-f]{64}", checksum):
        raise HTTPException(400, "Нет контрольной суммы.")
    with db() as con:
        row = owned(con, tid, uid)
        if (HOME / tid / "area.json").is_file() and json.loads(
            (HOME / tid / "area.json").read_text()
        ).get("scope") == "world":
            raise HTTPException(409, "Используйте передачу по частям.")
        if row["digest"] == checksum and row["state"] != "ready":
            return public(row)
        if row["state"] != "ready":
            raise HTTPException(409, "Эта поездка уже отправлена.")
    if not upload_slots.acquire(blocking=False):
        raise HTTPException(429, "Повторите отправку чуть позже.")
    tmp = HOME / tid / ("upload-" + uuid.uuid4().hex + ".part")
    try:
        size = 0
        sha = hashlib.sha256()
        with tmp.open("xb") as f:
            async for block in request.stream():
                size += len(block)
                if size > MAX_UPLOAD:
                    raise HTTPException(413, "Архив слишком большой.")
                sha.update(block)
                f.write(block)
        if sha.hexdigest() != checksum or not size:
            raise HTTPException(400, "Передача прервалась. Повторите отправку.")
        try:
            meta = json.loads((HOME / tid / "area.json").read_text())
            await asyncio.to_thread(validate_upload, tmp, meta)
        except Exception as error:
            raise HTTPException(
                422, "Сохранение не соответствует выданному участку или повреждено."
            ) from error
        with db() as con:
            con.execute("BEGIN IMMEDIATE")
            row = owned(con, tid, uid)
            if row["state"] == "ready":
                os.replace(tmp, HOME / tid / "upload.zip")
                con.execute(
                    "UPDATE trips SET digest=?,state='submitted',updated=? WHERE id=?",
                    (checksum, int(time.time()), tid),
                )
                audit(con, uid, "submitted", tid)
            elif row["digest"] != checksum:
                raise HTTPException(409)
            return public(owned(con, tid, uid))
    finally:
        tmp.unlink(missing_ok=True)
        upload_slots.release()


@app.get("/admin/offline-worlds")
def panel():
    return FileResponse(ASSETS / "admin.html")


@app.get(API + "/assets/{name}")
def assets(name: str):
    if name not in ("admin.css", "admin.js"):
        raise HTTPException(404)
    return FileResponse(ASSETS / name)


@app.get(API + "/admin")
def dashboard(actor=Depends(admin), profile: str | None = None, inbox: bool = False):
    with db() as con:
        if profile is not None and not re.fullmatch(r"[a-fA-F0-9]{32}", profile):
            raise HTTPException(400, "Invalid profile")
        users_sql = "SELECT * FROM access"
        trips_sql = "SELECT t.*,a.name FROM trips t JOIN access a USING(uid)"
        args = ()
        if profile:
            users_sql += " WHERE uid=?"
            trips_sql += " WHERE t.uid=?"
            args = (profile.lower(),)
        elif inbox:
            users_sql += " WHERE state='pending'"
            trips_sql += " WHERE t.state='review'"
        trips_sql += " ORDER BY t.rowid DESC"
        if not profile and not inbox:
            trips_sql += " LIMIT 100"
        users = [
            dict(x) for x in con.execute(users_sql + " ORDER BY updated DESC", args)
        ]
        trips = [dict(x) for x in con.execute(trips_sql, args)]
    return {"users": users, "trips": trips}


class Grant(BaseModel):
    name: str
    scope: Literal["world"] = "world"


@app.post(API + "/admin/grant")
async def grant(body: Grant, actor=Depends(admin)):
    if not re.fullmatch(r"[a-zA-Z0-9_]{1,16}", body.name):
        raise HTTPException(400, "Введите игровой ник.")
    async with httpx.AsyncClient(timeout=7) as client:
        response = await client.post(
            AUTH + "/api/yggdrasil/api/profiles/minecraft", json=[body.name]
        )
    if response.status_code != 200 or not response.json():
        raise HTTPException(404, "Такой профиль KRWA не найден.")
    profile = response.json()[0]
    uid = uuid.UUID(profile["id"]).hex
    cx, cz = None, None
    with worker.MUTEX, db() as con:
        con.execute("BEGIN IMMEDIATE")
        active = con.execute(
            "SELECT id FROM trips WHERE uid=? AND state NOT IN ('closed','done','failed')",
            (uid,),
        ).fetchone()
        if active:
            raise HTTPException(409, "Сначала завершите текущую поездку.")
        con.execute(
            "INSERT INTO access(uid,name,state,updated,cx,cz,scope) VALUES(?,?,'allowed',?,?,?,?) ON CONFLICT(uid) DO UPDATE SET state='allowed',name=excluded.name,updated=excluded.updated,cx=excluded.cx,cz=excluded.cz,scope=excluded.scope",
            (uid, profile["name"], int(time.time()), cx, cz, body.scope),
        )
        audit(con, actor, "allowed:" + body.scope, uid)
    return {"ok": True}


@app.post(API + "/admin/access/{profile}/{decision}")
def decide_access(profile: uuid.UUID, decision: str, actor=Depends(admin)):
    if decision not in ("allowed", "denied"):
        raise HTTPException(400)
    uid = profile.hex
    with worker.MUTEX, db() as con:
        if not con.execute(
            "UPDATE access SET state=?,updated=? WHERE uid=?",
            (decision, int(time.time()), uid),
        ).rowcount:
            raise HTTPException(404)
        if decision == "denied":
            con.execute(
                "UPDATE trips SET state='closed',detail='Доступ отозван' WHERE uid=? AND state NOT IN ('done','closed','failed')",
                (uid,),
            )
        audit(con, actor, decision, uid)
    return {"ok": True}


@app.get(API + "/admin/trips/{trip}")
def review(trip: uuid.UUID, actor=Depends(admin)):
    with db() as con:
        row = con.execute("SELECT * FROM trips WHERE id=?", (trip.hex,)).fetchone()
    if not row:
        raise HTTPException(404)
    folder = HOME / trip.hex

    def load(name, default):
        file = folder / name
        return (
            json.loads(file.read_text(encoding="utf-8")) if file.exists() else default
        )

    return {
        "trip": public(row),
        "area": load("area.json", {}),
        "changes": load("changes.json", []),
    }


@app.get(API + "/admin/trips/{trip}/map")
def preview_map(
    trip: uuid.UUID,
    x: int,
    z: int,
    y: int,
    dimension: str = "minecraft:overworld",
    actor=Depends(admin),
):
    folder = HOME / trip.hex
    if not (folder / "live.zip").is_file() or not -64 <= y <= 319:
        raise HTTPException(404)
    meta = json.loads((folder / "area.json").read_text())
    if dimension not in meta.get("dimensions", DIMENSIONS):
        raise HTTPException(404)
    if meta.get("scope") == "world":
        changes = json.loads((folder / "changes.json").read_text(encoding="utf-8"))
        if not any(
            c.get("dimension") == dimension
            and c["pos"][0] // 16 == x
            and c["pos"][2] // 16 == z
            for c in changes
            if c.get("pos")
        ):
            raise HTTPException(404)
    elif dimension != "minecraft:overworld" or [x, z] not in meta["chunks"]:
        raise HTTPException(404)
    return map_slice(
        [folder / k for k in ("base.zip", "live.zip", "upload.zip")],
        x,
        z,
        y,
        dimension_prefix(dimension),
    )


@app.get(API + "/admin/trips/{trip}/archive/{side}")
def review_archive(trip: uuid.UUID, side: str, actor=Depends(admin)):
    if side not in ("base", "upload", "live"):
        raise HTTPException(404)
    file = HOME / trip.hex / (side + ".zip")
    if not file.is_file():
        raise HTTPException(404)
    return FileResponse(
        file, media_type="application/zip", filename=trip.hex + "-" + side + ".zip"
    )


class Decision(BaseModel):
    fingerprint: str


@app.post(API + "/admin/trips/{trip}/{decision}")
def decide_trip(trip: uuid.UUID, decision: str, body: Decision, actor=Depends(admin)):
    with worker.MUTEX, db() as con:
        con.execute("BEGIN IMMEDIATE")
        row = con.execute("SELECT * FROM trips WHERE id=?", (trip.hex,)).fetchone()
        if not row or row["state"] in ("closed", "done"):
            raise HTTPException(409)
        if row["review"] != body.fingerprint:
            raise HTTPException(409, "Сравнение изменилось. Обновите страницу.")
        skip_new = decision == "accept-existing"
        if decision == "accept" or skip_new:
            file = HOME / trip.hex / "changes.json"
            if row["state"] != "review" or not file.exists():
                raise HTTPException(409)
            changes = json.loads(file.read_text(encoding="utf-8"))
            if (skip_new and not can_skip_new(changes)) or (
                not skip_new and any(c["mode"] == "manual" for c in changes)
            ):
                raise HTTPException(409, "Эти изменения требуют ручного переноса.")
            check_access(con, row["uid"])
            state = "approved"
        elif decision == "revise" and row["state"] == "review" and row["review"]:
            check_access(con, row["uid"])
            con.execute(
                "UPDATE trips SET digest='', detail='Исправьте спорные изменения и отправьте заново.' WHERE id=?",
                (trip.hex,),
            )
            stage = HOME / trip.hex / "transfer"
            if stage.is_dir():
                os.replace(stage, stage.with_name("previous-" + uuid.uuid4().hex))
            state = "ready"
        elif decision == "keep":
            state = "closed"
        else:
            raise HTTPException(400)
        con.execute(
            "UPDATE trips SET state=?,skip_new=?,updated=? WHERE id=?",
            (state, int(skip_new), int(time.time()), trip.hex),
        )
        audit(con, actor, decision, trip.hex)
    return {"ok": True}
