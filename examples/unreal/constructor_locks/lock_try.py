"""Try to change the asset files from outside the editor and print what Windows says (plain Python 3, run with -I).

  python -I lock_try.py <Content/Lock folder>
For each .uasset in the folder, in this order: open it for writing without truncating, rename it and rename it back, overwrite it with
its own bytes, delete it. Prints a JSON list of { file, op, ok, error_type, error_text }. The delete is the last step: the file is gone
afterwards when it succeeds.
"""
import json
import os
import sys

folder = sys.argv[1]
results = []


def attempt(name, op, fn):
    entry = {"file": name, "op": op, "ok": True}
    try:
        fn()
    except OSError as exc:
        entry.update(ok=False, error_type=type(exc).__name__, error_text=str(exc))
    results.append(entry)


for name in sorted(n for n in os.listdir(folder) if n.endswith(".uasset")):
    path = os.path.join(folder, name)
    moved = path + ".moved"

    def open_write():
        with open(path, "r+b"):
            pass

    def rename_and_back():
        os.replace(path, moved)
        os.replace(moved, path)

    def overwrite():
        with open(path, "rb") as fh:
            data = fh.read()
        with open(path, "wb") as fh:
            fh.write(data)

    attempt(name, "open_for_write", open_write)
    attempt(name, "rename_and_back", rename_and_back)
    attempt(name, "overwrite", overwrite)
    attempt(name, "delete", lambda: os.remove(path))
print(json.dumps(results))
