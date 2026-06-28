"""
Rebuilds analyzer.py by removing predict_prize1 v1-v4 functions.
Keeps: everything up to predict_numbers, shared helpers, predict_prize1_ultimate+.

Run with: python _rebuild_analyzer.py [--dry-run]
"""
import sys

DRY_RUN = "--dry-run" in sys.argv

SRC = "analyzer.py"

with open(SRC, "r", encoding="utf-8") as f:
    lines = f.readlines()

total = len(lines)
print("Input: " + str(total) + " lines")

# --- Print boundary lines for verification ---
targets = {429, 430, 431, 432, 604, 605, 606, 607,
           610, 611, 751, 752, 753, 754, 810, 811, 812, 813,
           1097, 1098, 1099, 1174, 1175, 1176, 1177, 1178,
           1330, 1331, 1332, 1333, 1334}
for i, line in enumerate(lines, 1):
    if i in targets:
        print(str(i) + ": " + repr(line[:90]))

if DRY_RUN:
    print("\\n--- DRY RUN: no file written ---")
    sys.exit(0)

# --- Verify key boundaries ---
assert "return result.head(top_n) if top_n else result" in lines[428], "line 429 check failed"
assert "def predict_prize1(" in lines[431], "line 432 check failed"
assert "def _p1_pos_digit_scores" in lines[610], "line 611 check failed"
assert "def _p1_trigram_matrix" in lines[1098], "line 1099 check failed"
assert "def predict_prize1_ultimate" in lines[1333], "line 1334 check failed"

dashes = "─" * 77
section_header = (
    "\n\n"
    "# " + dashes + "\n"
    "# predict_prize1_ultimate — shared helper functions (positional, pair, trigram)\n"
    "# " + dashes + "\n"
    "\n"
)

# Keep lines 1-429   (idx 0-428): predict_numbers and everything before v1
# Keep lines 611-753 (idx 610-752): _p1_pos_digit_scores, _p1_pair_matrix, _p1_digitsum_dist
# Keep lines 1099-1177 (idx 1098-1176): _p1_trigram_matrix, _beam_front3_v4
# Keep lines 1333-EOF (idx 1332-): blank + predict_prize1_ultimate onwards

part1 = lines[0:429]
part2 = lines[610:753]
part3 = lines[1098:1177]
part4 = lines[1332:]

new_lines = part1 + [section_header] + part2 + part3 + part4

print("Output: " + str(len(new_lines)) + " lines")

with open(SRC, "w", encoding="utf-8", newline="\n") as f:
    f.writelines(new_lines)

print("Done.")
