#!/usr/bin/env python3
"""Utility helpers for Aurora manifests.

Currently supports:
- Parsing `.aurs` files containing `org`, `pad`, `bytes`, `u16/u32/u64`, `label`.
- Emitting two reports: label address table and call/jump immediates.
- Optionally writing a raw binary blob for the processed manifest.

Usage:
    python manifest_analyzer.py path/to/manifest.aurs [--bin output.bin]
"""
from __future__ import annotations

import argparse
import re
from pathlib import Path
from typing import Dict, List, Tuple

HEX_RE = re.compile(r"^0[xX]([0-9A-Fa-f]+)$")


def parse_hex(token: str) -> int:
    match = HEX_RE.match(token)
    if not match:
        raise ValueError(f"Expected hex literal, got {token!r}")
    return int(match.group(1), 16)


def chunks(data: bytes, size: int) -> List[bytes]:
    return [data[i : i + size] for i in range(0, len(data), size)]


def analyze_manifest(path: Path) -> Tuple[bytearray, Dict[str, int], List[Tuple[int, bytes]]]:
    binary = bytearray()
    labels: Dict[str, int] = {}
    byte_runs: List[Tuple[int, bytes]] = []  # (start_offset, bytes)

    current_offset = 0

    with path.open("r", encoding="utf-8") as handle:
        for raw_line in handle:
            line = raw_line.split("#", 1)[0].strip()
            if not line:
                continue

            tokens = line.split()
            directive = tokens[0]

            def ensure_length(target: int) -> None:
                if target > len(binary):
                    binary.extend([0] * (target - len(binary)))

            if directive == "org":
                if len(tokens) != 2:
                    raise ValueError(f"Invalid org directive: {raw_line.strip()}")
                current_offset = parse_hex(tokens[1])
                ensure_length(current_offset)
            elif directive == "pad":
                if len(tokens) != 2:
                    raise ValueError(f"Invalid pad directive: {raw_line.strip()}")
                pad_len = parse_hex(tokens[1])
                ensure_length(current_offset + pad_len)
                current_offset += pad_len
            elif directive == "label":
                if len(tokens) != 2:
                    raise ValueError(f"Invalid label directive: {raw_line.strip()}")
                label = tokens[1]
                labels[label] = current_offset
            elif directive == "bytes":
                if len(tokens) != 2:
                    raise ValueError(f"Invalid bytes directive: {raw_line.strip()}")
                hex_blob = tokens[1]
                if not hex_blob.startswith("0x") and not hex_blob.startswith("0X"):
                    raise ValueError(f"bytes directive must use 0x prefix: {raw_line.strip()}")
                data = bytes.fromhex(hex_blob[2:])
                ensure_length(current_offset)
                ensure_length(current_offset + len(data))
                binary[current_offset : current_offset + len(data)] = data
                byte_runs.append((current_offset, data))
                current_offset += len(data)
            elif directive in {"u16", "u32", "u64"}:
                if len(tokens) != 2:
                    raise ValueError(f"Invalid {directive} directive: {raw_line.strip()}")
                value = parse_hex(tokens[1])
                size = {"u16": 2, "u32": 4, "u64": 8}[directive]
                data = value.to_bytes(size, byteorder="little")
                ensure_length(current_offset)
                ensure_length(current_offset + size)
                binary[current_offset : current_offset + size] = data
                byte_runs.append((current_offset, data))
                current_offset += size
            elif directive == "header":
                # Metadata; no effect on offset.
                continue
            elif directive == "ref":
                # Data manifests may include ref entries (treated as 8 bytes placeholder for now).
                # They do not contribute to the binary until resolved, so skip from code analyzer.
                continue
            else:
                raise ValueError(f"Unsupported directive {directive!r} in {raw_line.strip()}")

    return binary, labels, byte_runs


def find_control_transfers(byte_runs: List[Tuple[int, bytes]]) -> List[Tuple[int, str, int]]:
    transfers: List[Tuple[int, str, int]] = []  # (offset, mnemonic, imm32)
    for start, data in byte_runs:
        i = 0
        while i < len(data):
            opcode = data[i]
            if opcode in (0xE8, 0xE9):
                if i + 4 >= len(data):
                    break
                disp = int.from_bytes(data[i + 1 : i + 5], byteorder="little", signed=True)
                # Filter out obvious false positives (e.g., immediates embedded in other opcodes).
                if abs(disp) > 0x100000:
                    i += 1
                    continue
                mnemonic = "call" if opcode == 0xE8 else "jmp"
                transfers.append((start + i, mnemonic, disp))
                i += 5
            else:
                i += 1
    return transfers


def main() -> None:
    parser = argparse.ArgumentParser(description="Analyze Aurora manifest offsets")
    parser.add_argument("manifest", type=Path)
    parser.add_argument("--bin", type=Path, help="Optional output path for raw binary dump")
    args = parser.parse_args()

    binary, labels, byte_runs = analyze_manifest(args.manifest)
    transfers = find_control_transfers(byte_runs)

    print("Labels:\n--------")
    for name, offset in sorted(labels.items(), key=lambda item: item[1]):
        print(f"{name:24s} 0x{offset:04X}")

    print("\nControl Transfers:\n-------------------")
    for offset, mnemonic, disp in transfers:
        if disp == 0:
            status = "pending"
        else:
            status = f"disp=0x{disp & 0xFFFFFFFF:08X} ({disp})"
        print(f"0x{offset:04X} {mnemonic:4s} {status}")

    if args.bin:
        args.bin.parent.mkdir(parents=True, exist_ok=True)
        args.bin.write_bytes(binary)
        print(f"\nWrote binary image to {args.bin}")


if __name__ == "__main__":
    main()
