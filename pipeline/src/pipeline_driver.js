#!/usr/bin/env node

/**
 * Aurora Pipeline Prototype (Stage 1 iteration 1)
 *
 * Minimal CLI that translates the Stage 0 "hello_world" shape into the
 * minimal ISA manifest. Future iterations will extend parsing/IR coverage.
 */

const fs = require('fs');
const path = require('path');

const ISA = {
  OPCODE: {
    NOP: 0x00,
    MOV: 0x01,
    ADD: 0x04,
    SUB: 0x05,
    CMP: 0x06,
    JMP: 0x07,
    CJMP: 0x08,
    CALL: 0x09,
    RET: 0x0a,
    SVC: 0x0b,
    HALT: 0x0c,
  },
  OPERAND: {
    UNUSED: 0x00,
    LABEL: 0xfe,
    IMMEDIATE: 0xff,
  },
};

const REGISTERS = {
  r0: 0,
  r1: 1,
  r2: 2,
  r3: 3,
  r4: 4,
  r5: 5,
  r6: 6,
  r7: 7,
};

function packInstruction(opcode, op0, op1, op2, imm32) {
  const u32 = toUint32(imm32);
  let word = (BigInt(opcode & 0xff) << 56n)
    | (BigInt(op0 & 0xff) << 48n)
    | (BigInt(op1 & 0xff) << 40n)
    | (BigInt(op2 & 0xff) << 32n)
    | BigInt(u32);
  return `0x${word.toString(16).padStart(16, '0').toUpperCase()}`;
}

function toUint32(value) {
  if (!Number.isInteger(value)) {
    throw new Error(`Immediate must be integer, received ${value}`);
  }
  if (value < -0x80000000 || value > 0x7fffffff) {
    throw new Error(`Immediate ${value} exceeds signed 32-bit range`);
  }
  return value >>> 0;
}

function encodeMovLabel(destReg) {
  return packInstruction(ISA.OPCODE.MOV, destReg, ISA.OPERAND.LABEL, ISA.OPERAND.UNUSED, 0);
}

function encodeMovImmediate(destReg, value) {
  return packInstruction(ISA.OPCODE.MOV, destReg, ISA.OPERAND.IMMEDIATE, ISA.OPERAND.UNUSED, value);
}

function emitManifestForStringProgram(ir) {
  const lines = [];
  lines.push('header minimal_isa');
  lines.push('org 0x0000');
  lines.push('label main');
  lines.push(`${bytesLine(encodeMovLabel(REGISTERS.r1))}  ; mov r1, #addr(${ir.binding.name})`);
  lines.push(`${bytesLine(encodeMovImmediate(REGISTERS.r0, ir.exitValue))}  ; mov r0, #${ir.exitValue}`);
  lines.push(`label ${ir.binding.name}`);
  lines.push(`ascii "${escapeString(ir.binding.literal)}"`);
  lines.push('pad 0x0010');
  lines.push('');
  lines.push('label __aur_runtime_print_and_exit');
  lines.push(`${bytesLine(packInstruction(ISA.OPCODE.SVC, 0x01, 0x01, 0x00, 0))}  ; svc 0x01 write(stdout)`);
  lines.push(`${bytesLine(packInstruction(ISA.OPCODE.SVC, 0x02, 0x00, 0x00, 0))}  ; svc 0x02 exit(r0)`);
  lines.push('halt');
  return lines.join('\n');
}

function bytesLine(hexWord) {
  return `bytes ${hexWord}`;
}

function escapeString(lit) {
  return lit.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function parseStringProgram(src) {
  const bindingMatch = src.match(/let\s+([A-Za-z_][A-Za-z0-9_]*)\s*:\s*string\s*=\s*"([\s\S]*?)"\s*;/);
  const printMatch = src.match(/request\s+service\s+print\s*\(\s*([A-Za-z_][A-Za-z0-9_]*)\s*\)\s*;/);
  const exitMatch = src.match(/request\s+service\s+exit\s*\(\s*(\d+)\s*\)\s*;/);
  const returnMatch = src.match(/return\s+(\d+)\s*;/);

  if (!bindingMatch || !printMatch || !exitMatch || !returnMatch) {
    throw new Error('Unsupported program shape: parser could not match Stage 0 string workflow.');
  }

  const bindingName = bindingMatch[1];
  const literal = bindingMatch[2];
  const printTarget = printMatch[1];
  const exitValue = Number.parseInt(exitMatch[1], 10);
  const returnValue = Number.parseInt(returnMatch[1], 10);

  if (printTarget !== bindingName) {
    throw new Error('print argument must reference the declared string binding');
  }
  if (exitValue !== returnValue) {
    throw new Error('exit value must match return value for Stage 0 string program');
  }

  return {
    kind: 'string_program',
    binding: { name: bindingName, literal },
    exitValue,
  };
}

function compileFile(inputPath, outputPath) {
  const source = fs.readFileSync(inputPath, 'utf8');
  const ir = parseStringProgram(source);
  const manifest = emitManifestForStringProgram(ir);
  fs.writeFileSync(outputPath, manifest + '\n', 'utf8');
}

function main(argv) {
  const [,, command, inputPath, ...rest] = argv;
  if (command !== 'compile') {
    printUsage();
    process.exitCode = 1;
    return;
  }
  if (!inputPath) {
    printUsage();
    process.exitCode = 1;
    return;
  }

  let outputPath = null;
  for (let i = 0; i < rest.length; i += 1) {
    const arg = rest[i];
    if ((arg === '-o' || arg === '--output') && rest[i + 1]) {
      outputPath = rest[i + 1];
      i += 1;
    } else {
      console.error(`Unknown argument: ${arg}`);
      printUsage();
      process.exitCode = 1;
      return;
    }
  }

  if (!outputPath) {
    console.error('Output path required (use -o/--output).');
    process.exitCode = 1;
    return;
  }

  try {
    compileFile(inputPath, outputPath);
    console.log(`[aurora-pipeline] wrote manifest to ${path.resolve(outputPath)}`);
  } catch (err) {
    console.error(`aurora-pipeline: ${err.message}`);
    process.exitCode = 1;
  }
}

function printUsage() {
  console.error('Usage: node pipeline/src/pipeline_driver.js compile <input.aur> -o <output.aurs>');
}

if (require.main === module) {
  main(process.argv);
}
