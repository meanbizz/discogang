#!/usr/bin/env python3
"""Apply an anchored-replacement edit script.

Usage: python3 apply_edits.py edits.txt [--dry-run]
"""
import sys, pathlib

MARKERS = ("<<<FILE", "<<<OLD", "<<<NEW", "<<<CREATE", "<<<WRITE", "<<<DELETE", "<<<END")


def parse(text):
    edits, cur, section, buf = [], None, None, []

    def flush():
        if section and cur is not None:
            cur[section] = "\n".join(buf)

    for lineno, line in enumerate(text.splitlines(), 1):
        head = line.split(" ", 1)[0]
        if head not in MARKERS:
            buf.append(line)
            continue
        flush()
        buf = []
        if head == "<<<FILE":
            if cur is not None:
                sys.exit(f"line {lineno}: previous block missing <<<END")
            parts = line.split(" ", 1)
            if len(parts) < 2 or not parts[1].strip():
                sys.exit(f"line {lineno}: <<<FILE needs a path")
            cur, section = {"file": parts[1].strip(), "op": "replace"}, None
        elif cur is None:
            sys.exit(f"line {lineno}: {head} outside a <<<FILE block")
        elif head == "<<<OLD":
            section = "old"
        elif head == "<<<NEW":
            section = "new"
        elif head == "<<<CREATE":
            cur["op"], section = "create", "new"
        elif head == "<<<WRITE":
            cur["op"], section = "write", "new"
        elif head == "<<<DELETE":
            cur["op"], section = "delete", None
        elif head == "<<<END":
            edits.append(cur)
            cur, section = None, None
    if cur is not None:
        sys.exit("unterminated block: missing <<<END")
    return edits


def main():
    argv = sys.argv[1:]
    dry = "--dry-run" in argv
    files = [a for a in argv if not a.startswith("-")]
    if len(files) != 1:
        sys.exit("usage: apply_edits.py <edits.txt> [--dry-run]")

    planned = {}  # path -> new contents, or None to delete

    for i, e in enumerate(parse(pathlib.Path(files[0]).read_text(encoding="utf-8")), 1):
        path = pathlib.Path(e["file"])
        key = str(path)

        if e["op"] == "delete":
            planned[key] = None
            continue

        if e["op"] in ("create", "write"):
            body = e.get("new", "")
            if body and not body.endswith("\n"):
                body += "\n"
            if e["op"] == "create" and path.exists() \
                    and path.read_text(encoding="utf-8") != body:
                sys.exit(f"edit {i}: {path} exists with different content")
            planned[key] = body
            continue

        if key in planned:
            text = planned[key]
            if text is None:
                sys.exit(f"edit {i}: {path} was deleted by an earlier edit")
        elif path.exists():
            text = path.read_text(encoding="utf-8")
        else:
            sys.exit(f"edit {i}: {path} not found")

        old, new = e.get("old", ""), e.get("new", "")
        if not old:
            sys.exit(f"edit {i}: empty <<<OLD anchor for {path}")

        count = text.count(old)
        if count == 1:
            planned[key] = text.replace(old, new, 1)
        elif count == 0 and new and new in text:
            print(f"edit {i}: already applied in {path} - skipping")
            planned[key] = text
        elif count == 0:
            sys.exit(f"edit {i}: anchor not found in {path}:\n{old}")
        else:
            sys.exit(f"edit {i}: anchor matches {count}x in {path}; needs more context")

    # Nothing is written until every edit validates.
    for key, text in planned.items():
        path = pathlib.Path(key)
        verb = "delete" if text is None else ("create" if not path.exists() else "update")
        if dry:
            print(f"[dry-run] would {verb} {path}")
            continue
        if text is None:
            path.unlink(missing_ok=True)
        else:
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(text, encoding="utf-8")
        print(f"{verb}d {path}")


if __name__ == "__main__":
    main()
