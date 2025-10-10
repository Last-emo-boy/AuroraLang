# Seed Script Scaffolding (Aurora Seed DSL)

To avoid reliance on foreign scripting languages, Stage 0 binary generation will be expressed in a bespoke **Aurora Seed DSL**. These `.aurs` manifests enumerate byte placements declaratively; a tiny interpreter written later in Aurora tooling will materialize them into binary files.

## DSL Goals
- Provide deterministic specification of bytes, offsets, and pads.
- Support named labels and address arithmetic without invoking external assemblers.
- Remain human-readable so the hex plan can be audited alongside `specs/stage0_asm_notes.md` and `seed/docs/stage0_layout.md`.

## Core Directives (v0)
- `header <name>`: Opens a logical section for organization.
- `org <hex>`: Sets current write offset (absolute).
- `u8/u16/u32/u64 <hex>`: Emits unsigned value in little-endian.
- `bytes <hex-seq>`: Emits raw byte stream.
- `label <name>`: Captures current offset for later references.
- `ref <name>`: Emits 64-bit little-endian value referencing a label.
- `pad <hex>`: Writes zero bytes until reaching target absolute offset.
- `ascii <string>`: Emits ASCII bytes with optional escaped sequences.

The interpreter will validate offsets and cross-references, ensuring that the resulting binaries match the documented layouts.

## Files
- `linux_stage0.aurs`: ELF64 Stage 0 manifest.
- `windows_stage0.aurs`: PE/COFF Stage 0 manifest.

The current files are **proto-scripts**—they are executable once the Aurora-built interpreter is available. Until then, they serve as authoritative generation contracts.
