#!/usr/bin/env python3
"""Minimal Aurora compiler prototype.

This translator handles a restricted subset of Aurora source files:
- Single `module` with a `fn main() -> int` definition.
- `let <ident>: string = "...";` bindings inside `main`.
- `request service print(<ident>);` and `request service exit(<int>);` statements.
- `return <int>;` at function end.

It emits a handcrafted `.aurs` manifest targeting the minimal ISA encoding
captured in `specs/aurora_minimal_isa.md`. The manifest matches the layout used
in `docs/manual_compilation_walkthrough.md` so it can be executed by the Stage 0
interpreter while the full compiler is still under development.
"""
from __future__ import annotations

import argparse
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import List, Optional

# ---------------------------------------------------------------------------
# Data structures
# ---------------------------------------------------------------------------

@dataclass
class StringBinding:
    name: str
    value: str
    register: str
    label: str

@dataclass
class ServiceCall:
    service: str
    argument: str

@dataclass
class ExitCall:
    value: int

@dataclass
class ReturnStmt:
    value: int

@dataclass
class LoopSumIR:
    accumulator: str
    accumulator_init: int
    accumulator_reg: str
    counter: str
    counter_init: int
    counter_reg: str
    exit_var: str
    return_var: str


@dataclass
class ProgramIR:
    kind: str
    string_bindings: List[StringBinding] = field(default_factory=list)
    print_calls: List[ServiceCall] = field(default_factory=list)
    exit_call: Optional[ExitCall] = None
    return_stmt: Optional[ReturnStmt] = None
    loop_sum: Optional[LoopSumIR] = None


# ---------------------------------------------------------------------------
# Parsing helpers (extremely constrained and purpose-built)
# ---------------------------------------------------------------------------

LET_STRING_RE = re.compile(
    r"let\s+(?P<name>[A-Za-z_][A-Za-z0-9_]*)\s*:\s*string\s*=\s*\"(?P<value>.*)\"\s*;"
)
LET_INT_RE = re.compile(
    r"let\s+(?P<name>[A-Za-z_][A-Za-z0-9_]*)\s*:\s*int\s*=\s*(?P<value>-?\d+)\s*;"
)
PRINT_CALL_RE = re.compile(
    r"request\s+service\s+print\s*\(\s*(?P<arg>[A-Za-z_][A-Za-z0-9_]*)\s*\)\s*;"
)
EXIT_CALL_RE = re.compile(
    r"request\s+service\s+exit\s*\(\s*(?P<value>\d+)\s*\)\s*;"
)
EXIT_VAR_RE = re.compile(
    r"request\s+service\s+exit\s*\(\s*(?P<name>[A-Za-z_][A-Za-z0-9_]*)\s*\)\s*;"
)
RETURN_RE = re.compile(r"return\s+(?P<value>\d+)\s*;")
RETURN_VAR_RE = re.compile(r"return\s+(?P<name>[A-Za-z_][A-Za-z0-9_]*)\s*;")
WHILE_COND_RE = re.compile(
    r"while\s+(?P<var>[A-Za-z_][A-Za-z0-9_]*)\s*>\s*0\s*\{"
)
ASSIGN_ADD_RE = re.compile(
    r"(?P<target>[A-Za-z_][A-Za-z0-9_]*)\s*=\s*(?P<lhs>[A-Za-z_][A-Za-z0-9_]*)\s*\+\s*(?P<rhs>[A-Za-z_][A-Za-z0-9_]*)\s*;"
)
ASSIGN_SUB_RE = re.compile(
    r"(?P<target>[A-Za-z_][A-Za-z0-9_]*)\s*=\s*(?P<lhs>[A-Za-z_][A-Za-z0-9_]*)\s*-\s*(?P<rhs>[A-Za-z0-9_]+)\s*;"
)


def parse_source(src: str) -> ProgramIR:
    if "while" in src:
        return parse_loop_sum_program(src)
    return parse_string_program(src)


def parse_string_program(src: str) -> ProgramIR:
    lines = [line.strip() for line in src.splitlines() if line.strip()]

    string_bindings: List[StringBinding] = []
    print_calls: List[ServiceCall] = []
    exit_call: Optional[ExitCall] = None
    return_stmt: Optional[ReturnStmt] = None

    for line in lines:
        if match := LET_STRING_RE.fullmatch(line):
            name = match.group("name")
            value = match.group("value")
            register = "r1"
            label = name
            string_bindings.append(StringBinding(name, value, register, label))
            continue

        if match := PRINT_CALL_RE.fullmatch(line):
            print_calls.append(ServiceCall(service="print", argument=match.group("arg")))
            continue

        if match := EXIT_CALL_RE.fullmatch(line):
            exit_call = ExitCall(value=int(match.group("value")))
            continue

        if match := RETURN_RE.fullmatch(line):
            return_stmt = ReturnStmt(value=int(match.group("value")))
            continue

    if not string_bindings:
        raise ValueError("No string bindings found; MVP compiler only supports string literals for output.")

    if exit_call is None:
        raise ValueError("Missing `request service exit(...)` statement.")

    if return_stmt is None:
        raise ValueError("Missing `return <value>;` statement.")

    return ProgramIR(
        kind="string_print",
        string_bindings=string_bindings,
        print_calls=print_calls,
        exit_call=exit_call,
        return_stmt=return_stmt,
    )


def parse_loop_sum_program(src: str) -> ProgramIR:
    raw_lines = [line.strip() for line in src.splitlines() if line.strip() and not line.strip().startswith("//")]

    registers_in_use = []
    int_bindings: dict[str, tuple[int, str]] = {}
    exit_var: Optional[str] = None
    return_var: Optional[str] = None
    loop_body: Optional[list[str]] = None
    loop_condition_var: Optional[str] = None

    i = 0
    while i < len(raw_lines):
        line = raw_lines[i]

        if line.startswith("module") or line.startswith("fn "):
            i += 1
            continue

        if line == "}":
            i += 1
            continue

        if match := LET_INT_RE.fullmatch(line):
            name = match.group("name")
            value = int(match.group("value"))
            if name in int_bindings:
                raise ValueError(f"Duplicate binding for `{name}`.")
            reg_index = len(registers_in_use) + 1
            if reg_index >= 8:
                raise ValueError("Loop lowering only supports up to 7 GP registers (r1-r7).")
            reg = f"r{reg_index}"
            if reg == "r0":
                raise ValueError("Loop lowering reserves r0 for exit value.")
            registers_in_use.append(reg)
            int_bindings[name] = (value, reg)
            i += 1
            continue

        if match := WHILE_COND_RE.fullmatch(line):
            loop_condition_var = match.group("var")
            if loop_condition_var not in int_bindings:
                raise ValueError("Loop condition references undefined variable.")
            body: list[str] = []
            i += 1
            while i < len(raw_lines) and raw_lines[i] != "}":
                if raw_lines[i]:
                    body.append(raw_lines[i])
                i += 1
            if i == len(raw_lines):
                raise ValueError("Unterminated while loop.")
            loop_body = body
            i += 1  # skip closing brace
            continue

        if match := EXIT_VAR_RE.fullmatch(line):
            exit_var = match.group("name")
            i += 1
            continue

        if match := RETURN_VAR_RE.fullmatch(line):
            return_var = match.group("name")
            i += 1
            continue

        i += 1

    if loop_body is None or loop_condition_var is None:
        raise ValueError("Loop lowering requires a single while-loop.")

    if len(loop_body) != 2:
        raise ValueError("Loop body must contain exactly two statements for MVP lowering.")

    add_stmt, sub_stmt = loop_body
    add_match = ASSIGN_ADD_RE.fullmatch(add_stmt)
    sub_match = ASSIGN_SUB_RE.fullmatch(sub_stmt)

    if add_match is None or sub_match is None:
        raise ValueError("Loop body must match accumulator += counter; counter -= 1; pattern.")

    accumulator = add_match.group("target")
    add_lhs = add_match.group("lhs")
    add_rhs = add_match.group("rhs")

    if add_lhs != accumulator:
        raise ValueError("Accumulator add must use accumulator as lhs.")

    counter = add_rhs

    if counter != loop_condition_var:
        raise ValueError("Add statement must use loop counter as rhs.")

    if sub_match.group("target") != counter:
        raise ValueError("Counter decrement must target loop counter variable.")

    if sub_match.group("lhs") != counter or sub_match.group("rhs") != "1":
        raise ValueError("Counter decrement must subtract literal 1.")

    if accumulator not in int_bindings or counter not in int_bindings:
        raise ValueError("Accumulator and counter must be bound via let statements.")

    if exit_var is None or return_var is None:
        raise ValueError("Loop lowering requires exit and return statements.")

    if exit_var != accumulator or return_var != accumulator:
        raise ValueError("Exit/return must reference accumulator variable.")

    acc_value, acc_reg = int_bindings[accumulator]
    counter_value, counter_reg = int_bindings[counter]

    loop_ir = LoopSumIR(
        accumulator=accumulator,
        accumulator_init=acc_value,
        accumulator_reg=acc_reg,
        counter=counter,
        counter_init=counter_value,
        counter_reg=counter_reg,
        exit_var=exit_var,
        return_var=return_var,
    )

    return ProgramIR(kind="loop_sum", loop_sum=loop_ir)


# ---------------------------------------------------------------------------
# Lowering helpers
# ---------------------------------------------------------------------------

ISA_OPCODE_MOV = 0x01
ISA_OPCODE_ADD = 0x04
ISA_OPCODE_SUB = 0x05
ISA_OPCODE_CMP = 0x06
ISA_OPCODE_JMP = 0x07
ISA_OPCODE_CJMP = 0x08

ISA_OPERAND_LABEL = 0xFE
ISA_OPERAND_IMMEDIATE = 0xFF


def pack_instruction(opcode: int, op0: int, op1: int, op2: int, imm: int) -> str:
    word = (
        ((opcode & 0xFF) << 56)
        | ((op0 & 0xFF) << 48)
        | ((op1 & 0xFF) << 40)
        | ((op2 & 0xFF) << 32)
        | (imm & 0xFFFFFFFF)
    )
    return f"0x{word:016X}"


def encode_mov_label(dest_reg: str, label: str) -> str:
    if dest_reg != "r1":
        raise ValueError("MVP compiler currently supports string literals in r1 only.")
    reg_id = register_to_id(dest_reg)
    word = pack_instruction(ISA_OPCODE_MOV, reg_id, ISA_OPERAND_LABEL, 0, 0)
    return f"bytes {word}  ; mov {dest_reg}, #addr({label})"


def encode_mov_immediate(dest_reg: str, value: int) -> str:
    reg_id = register_to_id(dest_reg)
    if value < -(1 << 31) or value > (1 << 31) - 1:
        raise ValueError("Immediate exceeds 32-bit range for minimal ISA.")
    word = pack_instruction(ISA_OPCODE_MOV, reg_id, ISA_OPERAND_IMMEDIATE, 0, value)
    return f"bytes {word}  ; mov {dest_reg}, #{value}"


def encode_mov_register(dest_reg: str, source_reg: str) -> str:
    word = pack_instruction(ISA_OPCODE_MOV, register_to_id(dest_reg), register_to_id(source_reg), 0, 0)
    return f"bytes {word}  ; mov {dest_reg}, {source_reg}"


def encode_add_reg_reg(dest_reg: str, lhs: str, rhs: str) -> str:
    word = pack_instruction(ISA_OPCODE_ADD, register_to_id(dest_reg), register_to_id(lhs), register_to_id(rhs), 0)
    return f"bytes {word}  ; add {dest_reg}, {lhs}, {rhs}"


def encode_sub_reg_imm(dest_reg: str, lhs: str, value: int) -> str:
    if value < -(1 << 31) or value > (1 << 31) - 1:
        raise ValueError("Immediate exceeds 32-bit range for minimal ISA.")
    word = pack_instruction(ISA_OPCODE_SUB, register_to_id(dest_reg), register_to_id(lhs), ISA_OPERAND_IMMEDIATE, value)
    return f"bytes {word}  ; sub {dest_reg}, {lhs}, #{value}"


def encode_cmp_reg_imm(lhs: str, value: int) -> str:
    if value < -(1 << 31) or value > (1 << 31) - 1:
        raise ValueError("Immediate exceeds 32-bit range for minimal ISA.")
    word = pack_instruction(ISA_OPCODE_CMP, register_to_id(lhs), ISA_OPERAND_IMMEDIATE, 0, value)
    return f"bytes {word}  ; cmp {lhs}, #{value}"


def encode_cjmp_eq(label: str) -> str:
    word = pack_instruction(ISA_OPCODE_CJMP, 0x01, ISA_OPERAND_LABEL, 0, 0)
    return f"bytes {word}  ; cjmp eq, {label}"


def encode_jmp(label: str) -> str:
    word = pack_instruction(ISA_OPCODE_JMP, ISA_OPERAND_LABEL, 0, 0, 0)
    return f"bytes {word}  ; jmp {label}"


def encode_svc(imm: int, comment: str) -> str:
    if imm == 0x01:
        return "bytes 0x0B01010000000000  ; svc 0x01 write(stdout)"
    if imm == 0x02:
        return "bytes 0x0B02000000000000  ; svc 0x02 exit(r0)"
    raise ValueError("Unsupported svc immediate in MVP path.")


def register_to_id(reg: str) -> int:
    if not reg.startswith("r"):
        raise ValueError(f"Unexpected register name: {reg}")
    idx = int(reg[1:])
    if not 0 <= idx <= 7:
        raise ValueError("Register index out of range for minimal ISA (r0-r7)")
    return idx


def lower_to_manifest(ir: ProgramIR) -> List[str]:
    if ir.kind == "string_print":
        return lower_string_program(ir)
    if ir.kind == "loop_sum":
        if ir.loop_sum is None:
            raise ValueError("Loop lowering requires loop metadata.")
        return lower_loop_sum(ir.loop_sum)
    raise ValueError(f"Unsupported program kind `{ir.kind}`.")


def lower_string_program(ir: ProgramIR) -> List[str]:
    lines: List[str] = []

    lines.append("header minimal_isa")
    lines.append("org 0x0000")
    lines.append("label main")

    # Move each string literal into its assigned register ahead of use.
    for binding in ir.string_bindings:
        lines.append(encode_mov_label(binding.register, binding.label))

    # Emit print calls in order.
    for call in ir.print_calls:
        binding = next((b for b in ir.string_bindings if b.name == call.argument), None)
        if binding is None:
            raise ValueError(f"Print argument `{call.argument}` not bound to a string literal.")
        if binding.register != "r1":
            raise ValueError("MVP compiler expects print argument in r1.")
        lines.append(encode_svc(0x01, "write(stdout)"))

    # Ensure return value in r0 matches exit argument.
    if ir.exit_call is None or ir.return_stmt is None:
        raise ValueError("String program lowering requires exit and return statements.")

    if ir.exit_call.value != ir.return_stmt.value:
        raise ValueError("Exit value and return value must match in MVP program.")

    lines.append(encode_mov_immediate("r0", ir.return_stmt.value))

    lines.append(encode_svc(0x02, "exit(r0)"))
    lines.append("halt")

    # Emit string literals as data.
    for binding in ir.string_bindings:
        lines.append(f"label {binding.label}")
        literal = binding.value.replace("\"", "\\\"")
        lines.append(f"ascii \"{literal}\"")
        lines.append("pad 0x0010")

    return lines


def lower_loop_sum(loop_ir: LoopSumIR) -> List[str]:
    if loop_ir.accumulator_reg != "r1" or loop_ir.counter_reg != "r2":
        raise ValueError("Loop lowering currently requires accumulator in r1 and counter in r2.")

    lines: List[str] = []

    lines.append("header minimal_isa")
    lines.append("org 0x0000")
    lines.append("label main")
    lines.append(f"{encode_mov_immediate(loop_ir.accumulator_reg, loop_ir.accumulator_init)}  ; accumulator")
    lines.append(f"{encode_mov_immediate(loop_ir.counter_reg, loop_ir.counter_init)}  ; counter")
    lines.append("label loop")
    lines.append(f"{encode_add_reg_reg(loop_ir.accumulator_reg, loop_ir.accumulator_reg, loop_ir.counter_reg)}  ; accumulator += counter")
    lines.append(f"{encode_sub_reg_imm(loop_ir.counter_reg, loop_ir.counter_reg, 1)}  ; counter--")
    lines.append(f"{encode_cmp_reg_imm(loop_ir.counter_reg, 0)}  ; compare with zero")
    lines.append(f"{encode_cjmp_eq('exit')}  ; if zero -> exit")
    lines.append(f"{encode_jmp('loop')}  ; loop back (placeholder displacement)")
    lines.append("label exit")
    lines.append(f"{encode_mov_register('r0', loop_ir.accumulator_reg)}  ; move result into r0")
    lines.append("bytes 0x0B02000000000000  ; svc 0x02 exit(r0)      ; exit with result")
    lines.append("halt")

    return lines


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def compile_file(source_path: Path, output_path: Path) -> None:
    src = source_path.read_text(encoding="utf-8")
    ir = parse_source(src)
    manifest_lines = lower_to_manifest(ir)
    output_path.write_text("\n".join(manifest_lines) + "\n", encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser(description="Aurora Minimal Compiler MVP (prototype)")
    sub = parser.add_subparsers(dest="command", required=True)

    compile_cmd = sub.add_parser("compile", help="Compile .aur source to .aurs manifest")
    compile_cmd.add_argument("source", type=Path, help="Path to Aurora source (.aur)")
    compile_cmd.add_argument("-o", "--output", type=Path, help="Output manifest path (.aurs)")

    args = parser.parse_args()

    if args.command == "compile":
        source_path: Path = args.source
        output_path: Path
        if args.output:
            output_path = args.output
        else:
            output_path = source_path.with_suffix(".aurs")
        compile_file(source_path, output_path)
        print(f"[aurc-mvp] Wrote manifest to {output_path}")


if __name__ == "__main__":
    main()
