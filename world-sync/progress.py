"""Personal Minecraft advancements and a player's view of FTB team progress."""

import copy
import json
import re
import uuid
from datetime import datetime

import nbtlib

QUEST_FIELDS = (
    "task_progress",
    "started",
    "completed",
    "repeatable",
    "completion_count",
    "claimed_rewards",
)
ID = re.compile(r"[0-9a-fA-F]{16}")
RESOURCE = re.compile(r"[a-z0-9_.-]+:[a-z0-9_./-]+")
MAX_BYTES = 16 * 1024**2


def progress_paths(uid):
    if not uid:
        return ()
    key = str(uuid.UUID(uid))
    return f"advancements/{key}.json", f"ftbquests/{key}.snbt"


def read_file(root, rel, default):
    file = root / rel
    if not file.resolve().is_relative_to(root.resolve()) or file.is_symlink():
        raise ValueError("Некорректный путь прогресса.")
    if not file.exists():
        return default
    if file.stat().st_size > MAX_BYTES:
        raise ValueError("Файл прогресса слишком велик.")
    return file.read_bytes()


def parse_snbt(raw):
    # FTB writes one member per line without the commas used by vanilla SNBT.
    lines = [s.strip() for s in raw.decode("utf-8-sig").splitlines() if s.strip()]
    if not lines:
        raise ValueError("Пустой файл квестов.")
    parts = [lines[0]]
    for prev, line in zip(lines, lines[1:]):
        if prev[-1] not in "[{," and line[0] not in "]},":
            parts.append(",")
        parts.append(line)
    tag = nbtlib.parse_nbt("".join(parts))
    if not isinstance(tag, nbtlib.Compound):
        raise ValueError("Некорректный файл квестов.")
    return tag


def team_for(root, uid):
    key = str(uuid.UUID(uid))
    for f in sorted((root / "ftbteams/party").glob("*.snbt")):
        tag = parse_snbt(read_file(root, f.relative_to(root), b"{}"))
        if key == str(tag.get("owner")) or key in tag.get("ranks", {}):
            return str(uuid.UUID(f.stem))
    return key


def blank_quests(uid, name):
    return nbtlib.Compound(
        version=nbtlib.Int(1),
        uuid=nbtlib.String(uuid.UUID(uid).hex),
        name=nbtlib.String(name),
    )


def encode_tag(tag):
    return nbtlib.serialize_tag(tag, indent=2).encode("utf-8")


def snapshot_progress(root, uid, name):
    adv, quest = progress_paths(uid)
    team = team_for(root, uid)
    raw = read_file(root, f"ftbquests/{team}.snbt", b"{}")
    shared = parse_snbt(raw)
    personal = blank_quests(uid, name)
    for k in ("lock", "rewards_blocked", *QUEST_FIELDS):
        if k in shared:
            personal[k] = copy.deepcopy(shared[k])
    claims = personal.get("claimed_rewards", {})
    for k in list(claims):
        if not own_claim(k, uid):
            del claims[k]
    return {
        adv: read_file(root, adv, b'{"DataVersion":3955}'),
        quest: encode_tag(personal),
    }, team


def own_claim(key, uid):
    owner, _, reward = key.partition(":")
    return owner in (uuid.UUID(uid).hex, "0" * 32) and ID.fullmatch(reward)


def advancements(raw):
    data = json.loads(raw)
    if not isinstance(data, dict) or type(data.get("DataVersion")) is not int:
        raise ValueError("Некорректная версия достижений.")
    for key, entry in data.items():
        if key == "DataVersion":
            continue
        if (
            not RESOURCE.fullmatch(key)
            or not isinstance(entry, dict)
            or not isinstance(entry.get("criteria"), dict)
            or type(entry.get("done")) is not bool
        ):
            raise ValueError("Некорректная запись достижения.")
        for criterion, stamp in entry["criteria"].items():
            if not isinstance(criterion, str) or not isinstance(stamp, str):
                raise ValueError("Некорректный критерий достижения.")
            datetime.strptime(stamp, "%Y-%m-%d %H:%M:%S %z")
    return data


def plan_progress(root, uid, team, rel, base, remote):
    adv, quest = progress_paths(uid)
    changed = 0
    collision = False
    if rel == adv:
        old, new = map(advancements, (base, remote))
        live = advancements(read_file(root, adv, b'{"DataVersion":3955}'))
        if old["DataVersion"] != new["DataVersion"]:
            raise ValueError("Версия достижений изменилась.")
        for key, incoming in new.items():
            if key == "DataVersion":
                continue
            before = old.get(key, {}).get("criteria", {})
            current = live.get(key, {}).get("criteria", {})
            additions = incoming["criteria"].keys() - before.keys() - current.keys()
            if additions:
                record = live.setdefault(key, {"criteria": {}, "done": False})
                record["criteria"].update(
                    {k: incoming["criteria"][k] for k in additions}
                )
                record["done"] |= (
                    incoming["done"]
                    and incoming["criteria"].keys() <= record["criteria"].keys()
                )
                changed += len(additions)
        target, payload, kind = (
            adv,
            json.dumps(live, ensure_ascii=False).encode(),
            "advancements",
        )
    elif rel == quest:
        old, new = map(parse_snbt, (base, remote))
        if str(new.get("uuid")) != uuid.UUID(uid).hex:
            raise ValueError("Прогресс квестов принадлежит другому игроку.")
        if team_for(root, uid) != team:
            return [
                dict(
                    kind="quests",
                    pos=None,
                    before=team,
                    live="Состав команды изменился",
                    after="Прогресс поездки",
                    mode="manual",
                )
            ], {}
        target = f"ftbquests/{team}.snbt"
        live = parse_snbt(
            read_file(
                root, target, encode_tag(blank_quests(team, str(old.get("name", ""))))
            )
        )
        for field in QUEST_FIELDS:
            before, incoming = old.get(field, {}), new.get(field, {})
            if not isinstance(incoming, (dict, nbtlib.Compound)):
                raise ValueError("Некорректный раздел квестов.")
            for key, value in incoming.items():
                if before.get(key) == value:
                    continue
                if (
                    not (
                        own_claim(key, uid)
                        if field == "claimed_rewards"
                        else ID.fullmatch(key)
                    )
                    or not isinstance(value, (nbtlib.Long, nbtlib.Int))
                    or int(value) < 0
                ):
                    raise ValueError("Некорректная запись прогресса квеста.")
                current = live.setdefault(field, nbtlib.Compound())
                if current.get(key) != before.get(key) and key in current:
                    if field == "claimed_rewards" and key not in before:
                        collision = True
                    elif current[key] == value or field in ("started", "completed"):
                        continue
                    elif field in ("task_progress", "completion_count") and int(
                        value
                    ) >= int(before.get(key, 0)):
                        value = max(value, current[key])
                    else:
                        collision = True
                if key not in current or current[key] != value or collision:
                    current[key] = value
                    changed += 1
            # Repeated quests may clear task state. Apply only a matching baseline.
            if field not in ("claimed_rewards", "completion_count"):
                for key in before.keys() - incoming.keys():
                    current = live.get(field, {})
                    if key in current:
                        if current[key] != before[key]:
                            collision = True
                        del current[key]
                        changed += 1
        payload, kind = encode_tag(live), "quests"
    else:
        raise ValueError("Чужой файл прогресса.")
    if not changed:
        return [], {}
    change = dict(
        kind=kind,
        pos=None,
        before="Исходный снимок",
        live="Сервер",
        after=f"Изменено записей: {changed}",
        mode="manual" if collision else "auto",
    )
    return [change], {target: payload}
