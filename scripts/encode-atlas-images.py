#!/usr/bin/env python3
"""
XOR-encode atlas plate binaries for static hosting (.atlasbin).

Only files whose contents begin with the standard FFD8FF marker are encoded
(common lossy-compressed raster export format). Other files in the folder are
ignored.

The key in atlas_xor_key.hex must match ATLAS_IMAGE_XOR_KEY_HEX in
assets/js/brain-atlas-common.js (same bytes, hex string).

Usage:
  python3 scripts/encode-atlas-images.py rat-brain-atlas/images
  python3 scripts/encode-atlas-images.py mouse-brain-atlas/images
  python3 scripts/encode-atlas-images.py rat-brain-atlas/images mouse-brain-atlas/images

Options:
  --delete-source   Remove each source file after writing .atlasbin
"""

from __future__ import annotations

import argparse
import pathlib
import sys

# Start-of-image marker (first three bytes of the usual plate export format).
_PLATE_MAGIC = b"\xff\xd8\xff"


def load_key(key_path: pathlib.Path) -> bytes:
    raw = key_path.read_text().strip().split()
    if not raw:
        sys.exit(f"Empty key file: {key_path}")
    hx = raw[0]
    if len(hx) % 2 != 0:
        sys.exit("Key hex must have an even number of characters")
    try:
        return bytes.fromhex(hx)
    except ValueError as e:
        sys.exit(f"Invalid hex in key file: {e}")


def xor_bytes(data: bytes, key: bytes) -> bytes:
    if not key:
        sys.exit("Key must be non-empty")
    return bytes(b ^ key[i % len(key)] for i, b in enumerate(data))


def is_encodable_plate_file(path: pathlib.Path) -> bool:
    if path.suffix.lower() == ".atlasbin":
        return False
    try:
        data = path.read_bytes()
    except OSError:
        return False
    return len(data) >= 3 and data[:3] == _PLATE_MAGIC


def encode_dir(directory: pathlib.Path, key: bytes, delete_source: bool) -> int:
    if not directory.is_dir():
        print(f"Skip (not a directory): {directory}", file=sys.stderr)
        return 0
    count = 0
    for path in sorted(directory.iterdir()):
        if not path.is_file():
            continue
        if not is_encodable_plate_file(path):
            continue
        data = path.read_bytes()
        out = path.parent / (path.stem + ".atlasbin")
        out.write_bytes(xor_bytes(data, key))
        print(f"Wrote {out} ({len(data)} bytes)")
        count += 1
        if delete_source:
            path.unlink()
            print(f"  deleted {path.name}")
    return count


def main() -> None:
    parser = argparse.ArgumentParser(description="Encode atlas plates to XOR .atlasbin files")
    parser.add_argument(
        "directories",
        nargs="+",
        type=pathlib.Path,
        help="Folders containing plate source files (any filename; encodable by content signature)",
    )
    parser.add_argument(
        "--delete-source",
        action="store_true",
        help="Remove each source file after successful encode",
    )
    parser.add_argument(
        "--key",
        type=pathlib.Path,
        default=None,
        help="Path to atlas_xor_key.hex (default: scripts/atlas_xor_key.hex next to this script)",
    )
    args = parser.parse_args()

    script_dir = pathlib.Path(__file__).resolve().parent
    key_path = args.key or (script_dir / "atlas_xor_key.hex")
    if not key_path.is_file():
        sys.exit(f"Missing key file: {key_path}")
    key = load_key(key_path)

    total = 0
    for d in args.directories:
        d = d.resolve()
        total += encode_dir(d, key, args.delete_source)

    if total == 0:
        print("No encodable plate files found.", file=sys.stderr)
        sys.exit(1)
    print(f"Done. Encoded {total} file(s).")


if __name__ == "__main__":
    main()
