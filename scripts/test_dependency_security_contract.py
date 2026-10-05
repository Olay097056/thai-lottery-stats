from __future__ import annotations

import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SECURITY_FLOORS = {
    "anyio": (4, 14, 2),
    "soupsieve": (2, 9, 0),
    "urllib3": (2, 8, 0),
}


def parse_requirement_floors(path: Path) -> dict[str, tuple[int, ...]]:
    floors: dict[str, tuple[int, ...]] = {}
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.split("#", 1)[0].strip()
        match = re.match(r"^([A-Za-z0-9_.-]+)\s*>=\s*([0-9]+(?:\.[0-9]+)*)", line)
        if not match:
            continue
        package = match.group(1).lower().replace("_", "-")
        version = tuple(int(part) for part in match.group(2).split("."))
        floors[package] = max(floors.get(package, ()), version)
    return floors


class DependencySecurityContractTests(unittest.TestCase):
    def _assert_security_floors(self, filename: str) -> None:
        floors = parse_requirement_floors(ROOT / filename)
        for package, expected in SECURITY_FLOORS.items():
            with self.subTest(requirements=filename, package=package):
                self.assertIn(package, floors, f"{filename} must set a security floor for {package}")
                self.assertGreaterEqual(floors[package], expected)

    def test_api_requirements_keep_vulnerability_fixes(self) -> None:
        self._assert_security_floors("requirements-api.txt")

    def test_legacy_requirements_keep_vulnerability_fixes(self) -> None:
        self._assert_security_floors("requirements.txt")


if __name__ == "__main__":
    unittest.main()
