#!/usr/bin/env python3
"""Remap hardcoded dark-theme Tailwind classes to semantic theme tokens."""
import re
from pathlib import Path

BASE = Path("/home/z/my-project/src/components/studio")
FILES = ["sheet-cutter.tsx", "video-studio.tsx", "animator.tsx", "box-canvas.tsx", "mask-editor.tsx"]

# ordered list of (pattern, replacement) — regex with word boundaries
RULES: list[tuple[str, str]] = []

# --- neutral surfaces ---
RULES += [
    (r"bg-slate-950/85", "bg-surface"),
    (r"bg-slate-950/80", "bg-surface"),
    (r"bg-slate-950/75", "bg-surface"),
    (r"bg-slate-950/70", "bg-surface"),
    (r"bg-slate-950/60", "bg-surface"),
    (r"bg-slate-950/55", "bg-surface"),
    (r"bg-slate-950/40", "bg-surface"),
    (r"bg-slate-900/90", "bg-overlay"),
    (r"bg-slate-900/80", "bg-overlay"),
    (r"bg-white/5", "bg-chip"),
    (r"border-white/10", "border-line"),
    (r"border-white/15", "border-line-strong"),
    (r"border-white/20", "border-line-strong"),
    (r"border-white/25", "border-line-strong"),
    (r"border-white/30", "border-line-strong"),
    (r"text-slate-100", "text-foreground"),
    (r"text-slate-200", "text-foreground"),
    (r"text-slate-300", "text-soft"),
    (r"text-slate-400", "text-soft"),
    (r"text-slate-500", "text-faint"),
    (r"text-slate-600", "text-faint"),
]

# --- accent alpha variants: borders / tints ---
for hue in ("violet", "cyan", "fuchsia", "rose"):
    for a in ("25", "30"):
        RULES.append((rf"{hue}-400/{a}", f"{hue}-line"))
    for a in ("40", "50", "60", "70"):
        RULES.append((rf"{hue}-400/{a}", f"{hue}-line-strong"))
    for a in ("10", "15", "20"):
        RULES.append((rf"{hue}-500/{a}", f"{hue}-tint"))
# bg washes on -400 (bg-cyan-400/10 etc.)
for hue in ("violet", "cyan", "fuchsia", "rose"):
    for a in ("10", "15"):
        RULES.append((rf"bg-{hue}-400/{a}", f"bg-{hue}-tint"))

# --- accent plain text colors ---
TEXT_MAP = {
    "text-cyan-300": "text-cyan-ink",
    "text-cyan-200": "text-cyan-ink",
    "text-cyan-100": "text-cyan-ink",
    "text-cyan-400": "text-cyan-ink",
    "text-violet-400": "text-violet-ink",
    "text-violet-300": "text-violet-ink",
    "text-violet-200": "text-violet-ink",
    "text-rose-400": "text-rose-ink",
    "text-rose-300": "text-rose-ink",
    "text-rose-200": "text-rose-ink",
    "text-fuchsia-300": "text-fuchsia-ink",
    "text-emerald-400": "text-emerald-ink",
    "text-emerald-300": "text-emerald-ink",
    "text-emerald-200": "text-emerald-ink",
    "text-emerald-100": "text-emerald-ink",
    "border-cyan-400": "border-cyan-line-strong",
}
RULES += list(TEXT_MAP.items())

total = 0
for fname in FILES:
    p = BASE / fname
    text = p.read_text(encoding="utf-8")
    orig = text
    count = 0
    for pat, rep in RULES:
        # token-safe replace: block only if directly preceded by a letter/digit
        # (allows "-", ":" so hover:/dark:/bg- prefixed tokens are matched too)
        regex = re.compile(rf"(?<![a-zA-Z0-9]){re.escape(pat)}(?![\w-])")
        text, n = regex.subn(rep, text)
        count += n
    if text != orig:
        p.write_text(text, encoding="utf-8")
        print(f"{fname}: {count} replacements")
        total += count
    else:
        print(f"{fname}: no changes")

print(f"TOTAL: {total}")
