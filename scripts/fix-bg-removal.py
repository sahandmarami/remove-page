#!/usr/bin/env python3
"""Fix corrupted queue identifiers in bg-removal.ts.

The file was committed with 4 broken identifiers (lost `[` / wrong names):
  queueead++]          -> queue[head++]
  queueTail++] = p;    -> queue[hTail++] = p;
  const cur = queueHead++; -> const cur = queue[hHead++];
  queueTail++] = n;    -> queue[hTail++] = n;

Idempotent: if the file is already correct, nothing changes.
"""
import re
import sys

PATH = "/home/z/my-project/src/lib/cv/bg-removal.ts"

FIXES = [
    (r"queueead\+\+\]", "queue[head++]"),
    (r"queueTail\+\+\]", "queue[hTail++]"),
    (r"queueHead\+\+", "queue[hHead++]"),
    (r"queueead\+\+", "queue[head++]"),
]

with open(PATH, "rb") as f:
    raw = f.read()

text = raw.decode("utf-8")
orig = text
for pat, repl in FIXES:
    text, n = re.subn(pat, repl, text)
    print(f"{pat!r}: {n} replacement(s)")

if text != orig:
    with open(PATH, "wb") as f:
        f.write(text.encode("utf-8"))
    print("WRITTEN")
else:
    print("ALREADY OK")

# verification
bad = [ln for ln in text.splitlines() if re.search(r"queueead|queueTail\+\+\]|(?<![a-zA-Z\[])queueHead\+\+", ln)]
print("remaining bad lines:", bad if bad else "none")
