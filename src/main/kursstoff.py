#!/usr/bin/python3
"""Kursstoff für die Sprechstunde (src/main/sprechstunde.js): alle Themen eines Kurses mit Stand und der Text aller
erledigten Lektionen plus Referenzseiten (Glossar …), als JSON. Rechnet nichts selbst, nutzt ueben.py der Skill.

  kursstoff.py <SCRIPTS> <WS>   → {"themen": [...], "lektionen": [...], "referenz": [...]}
"""
import json, re, sys, html
from pathlib import Path

sys.dont_write_bytecode = True
sys.path.insert(0, sys.argv[1])
import ueben as U  # noqa: E402

ws = Path(sys.argv[2])
themen = []
for t in U.stand(ws):
    k = t["key"]
    titel = t["titles"][0] if re.fullmatch(r"L\d+", k) and t["titles"] else k.replace("-", " ")
    themen.append({"thema": k, "titel": titel, "lektionen": [U.kurz_id(x) for x in t["lessons"]], "faellig": bool(t["faellig"]),
                   "luecke": bool(t["luecke"]), "fach": t["fach"], "zuletzt": t["zuletzt"], "ak": bool(t["ak"])})

lektionen = []
for l in U.erledigt(ws):
    if not l["file"]:
        continue
    src = l["file"].read_text(errors="ignore")
    p = U.Auszug(None); p.feed(src)
    lektionen.append({"id": U.kurz_id(l["id"]), "titel": l["title"],
                      "themen": list(dict.fromkeys(re.findall(r'data-topic="([^"]+)"', src))), "text": p.text()})

referenz = []
ref = ws / "reference"
if ref.is_dir():
    for f in sorted(ref.glob("*.html")):
        p = U.Auszug(None); p.feed(f.read_text(errors="ignore"))
        referenz.append({"titel": f.stem.replace("-", " "), "text": p.text()})
    for f in sorted(ref.glob("*.md")):
        referenz.append({"titel": f.stem.replace("-", " "), "text": f.read_text(errors="ignore")})

print(json.dumps({"themen": themen, "lektionen": lektionen, "referenz": referenz}, ensure_ascii=False))
