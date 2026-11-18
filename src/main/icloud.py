#!/usr/bin/env python3
"""Holt aus iCloud ausgelagerte Dateien („nur in der Cloud“, Flag dataless) zurück auf den Mac.

Liest macOS eine solche Datei, wartet der Lesevorgang, bis iCloud sie geladen hat. Nacheinander dauert das
pro Datei etwa eine Sekunde; hub.py & Co. blieben dabei hängen. Dieses Skript lädt parallel und meldet
den Fortschritt als JSON-Zeilen:  {"gesamt": n}  {"fertig": k, "gesamt": n}  {"ende": true, …}

  icloud.py <Semesterordner>      alle Lernbereiche des Semesters + Dateien direkt im Semesterordner
  icloud.py --dateien <Pfad> …    nur diese Dateien bzw. Ordner
"""
import json
import os
import stat
import sys
import time
from concurrent.futures import ThreadPoolExecutor

DATALESS = getattr(stat, 'SF_DATALESS', 0x40000000)
AUSLASSEN = {'.venv', 'node_modules', 'video', '.git', '__pycache__'}
GROESSTE = 50 * 1024 * 1024          # Videos u. Ä. lädt nur, wer sie öffnet


def ausgelagert(p):
    try:
        st = os.lstat(p)
    except OSError:
        return False
    return stat.S_ISREG(st.st_mode) and bool(st.st_flags & DATALESS) and st.st_size <= GROESSTE


def durchgehen(wurzel):
    if os.path.isfile(wurzel):
        if ausgelagert(wurzel):
            yield wurzel
        return
    for root, dirs, files in os.walk(wurzel):
        dirs[:] = [d for d in dirs if d not in AUSLASSEN]
        for f in files:
            p = os.path.join(root, f)
            if ausgelagert(p):
                yield p


def lernbereiche(sem, tiefe=3):
    """Ordner „Lernbereich“ bis zu drei Ebenen unter dem Semester (auch <Modul>/<Kurs>/Lernbereich)."""
    gefunden = []
    for root, dirs, _ in os.walk(sem):
        rel = os.path.relpath(root, sem)
        ebene = 0 if rel == '.' else rel.count(os.sep) + 1
        dirs[:] = [d for d in dirs if d not in AUSLASSEN and not d.startswith('.')]
        if os.path.basename(root) == 'Lernbereich':
            gefunden.append(root)
            dirs[:] = []
        elif ebene >= tiefe:
            dirs[:] = []
    return gefunden


def laden(p):
    try:
        with open(p, 'rb') as fh:
            while fh.read(1 << 20):
                pass
        return None
    except OSError as e:
        return f'{p}: {e}'


def main(argv):
    if not argv:
        print(__doc__, file=sys.stderr)
        return 2
    if argv[0] == '--dateien':
        wurzeln = argv[1:]
    else:
        sem = argv[0]
        oben = [os.path.join(sem, f) for f in os.listdir(sem) if os.path.isfile(os.path.join(sem, f))]
        wurzeln = oben + lernbereiche(sem)
    liste = [p for w in wurzeln for p in durchgehen(w)]
    n = len(liste)
    print(json.dumps({'gesamt': n}), flush=True)
    fehler, fertig, zuletzt = [], 0, 0.0
    if n:
        with ThreadPoolExecutor(max_workers=8) as pool:
            for r in pool.map(laden, liste):
                fertig += 1
                if r:
                    fehler.append(r)
                if time.time() - zuletzt > 0.4 or fertig == n:
                    zuletzt = time.time()
                    print(json.dumps({'fertig': fertig, 'gesamt': n}), flush=True)
    rest = sum(1 for p in liste if ausgelagert(p))
    print(json.dumps({'ende': True, 'gesamt': n, 'fertig': fertig - rest, 'fehler': fehler[:5]}), flush=True)
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
