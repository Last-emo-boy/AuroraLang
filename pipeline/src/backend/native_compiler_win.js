/**
 * Aurora Manifest to Native Windows Compiler
 * 
 * Compiles .aurs manifest files to native Windows x64 executables.
 * Uses kernel32.dll imports for I/O and process control.
 * 
 * Usage:
 *   node native_compiler_win.js <input.aurs> -o <output.exe>
 */

const fs = require('fs');
const path = require('path');
const { X86EncoderWin64 } = require('./x86_encoder_win64');
const { PE64Generator } = require('./pe64_generator');

// Debug levels
const DEBUG_LEVEL = {
  NONE: 0,      // No debug output
  BASIC: 1,     // Basic compilation info
  VERBOSE: 2,   // Instruction-level output
  TRACE: 3      // Full trace with hex dumps
};

// Global debug level (set via CLI)
let debugLevel = DEBUG_LEVEL.NONE;

// Debug logging helpers
function debugLog(level, ...args) {
  if (debugLevel >= level) {
    console.log('[debug]', ...args);
  }
}

function debugBasic(...args) { debugLog(DEBUG_LEVEL.BASIC, ...args); }
function debugVerbose(...args) { debugLog(DEBUG_LEVEL.VERBOSE, ...args); }
function debugTrace(...args) { debugLog(DEBUG_LEVEL.TRACE, ...args); }

// Aurora ISA opcodes
const OPCODE = {
  NOP: 0x00,
  MOV: 0x01,
  PUSH: 0x02,
  POP: 0x03,
  ADD: 0x04,
  SUB: 0x05,
  CMP: 0x06,
  JMP: 0x07,
  CJMP: 0x08,
  CALL: 0x09,
  RET: 0x0A,
  SVC: 0x0B,
  HALT: 0x0C,
  MUL: 0x0D,
  DIV: 0x0E,
  REM: 0x0F,
  AND: 0x10,
  OR: 0x11,
  XOR: 0x12,
  NOT: 0x13,
  SHL: 0x14,
  SHR: 0x15,
  STORE_STACK: 0x16,
  LOAD_STACK: 0x17,
  // Array operations
  ARRAY_ALLOC: 0x18,
  ARRAY_STORE: 0x19,
  ARRAY_LOAD: 0x1A,
  // Floating point operations
  FMOV: 0x20,
  FADD: 0x21,
  FSUB: 0x22,
  FMUL: 0x23,
  FDIV: 0x24,
  FCMP: 0x25,
  FLOAD: 0x26,
  FSTORE: 0x27,
  CVTSI2SD: 0x28,
  CVTSD2SI: 0x29,
  FSQRT: 0x2A,
  FABS: 0x2B,
  FNEG: 0x2C,
  FFLOOR: 0x2D,
  FCEIL: 0x2E,
  // Thread operations
  SPAWN: 0x30,
  JOIN: 0x31,
  // Atomic/shared memory operations
  ATOMIC_LOAD: 0x32,
  ATOMIC_STORE: 0x33,
  ATOMIC_ADD: 0x34,
  ATOMIC_FADD: 0x35,
};

// Parse .aurs manifest file (reuse from native_compiler.js)
function parseManifest(content) {
  const lines = content.split('\n');
  const instructions = [];
  const labels = new Map();
  const strings = new Map();
  const sharedVars = new Map();  // Map id to { name, initialValue }
  let stackSize = 0x58;  // Default: 88 bytes (32 shadow + 56 locals)
  
  for (const line of lines) {
    const trimmed = line.trim();
    
    if (trimmed.startsWith('#') || trimmed === '') continue;
    
    // Parse stack_size directive
    if (trimmed.startsWith('stack_size ')) {
      stackSize = parseInt(trimmed.substring(11).trim(), 10);
      // Codegen already ensures proper alignment (16n+8 for Win64)
      // Just ensure minimum of 88 bytes (0x58)
      stackSize = Math.max(stackSize, 0x58);
      continue;
    }
    
    // Parse shared variable declarations: shared <id> <name> <initialValue>
    if (trimmed.startsWith('shared ')) {
      const parts = trimmed.substring(7).split(' ');
      const id = parseInt(parts[0], 10);
      const name = parts[1];
      const initialValue = parts[2] ? parseInt(parts[2], 10) : 0;
      sharedVars.set(id, { name, initialValue });
      continue;
    }
    
    if (trimmed.startsWith('bytes ')) {
      const parts = trimmed.substring(6).split(';');
      const hex = parts[0].trim();
      const comment = parts.slice(1).join(';').trim();
      
      const value = BigInt(hex);
      const instr = {
        type: 'instruction',
        raw: value,
        bytes: hex,  // Keep the hex string for float data parsing
        opcode: Number((value >> 56n) & 0xFFn),
        op0: Number((value >> 48n) & 0xFFn),
        op1: Number((value >> 40n) & 0xFFn),
        op2: Number((value >> 32n) & 0xFFn),
        imm32: Number(value & 0xFFFFFFFFn),
        comment: comment,
        jumpTarget: null,
      };
      
      if (comment) {
        const jmpMatch = comment.match(/^jmp\s+(\w+)/);
        const cjmpMatch = comment.match(/cjmp.*,\s*(\w+)/);
        const callMatch = comment.match(/^call\s+(\w+)/);
        const spawnMatch = comment.match(/^spawn\s+r\d+,\s*(\w+)/);
        
        if (jmpMatch) {
          instr.jumpTarget = jmpMatch[1];
        } else if (cjmpMatch) {
          instr.jumpTarget = cjmpMatch[1];
        } else if (callMatch) {
          instr.jumpTarget = callMatch[1];
        } else if (spawnMatch) {
          instr.jumpTarget = `fn_${spawnMatch[1]}`;
        }
      }
      
      instructions.push(instr);
    }
    
    if (trimmed.startsWith('label ')) {
      const parts = trimmed.substring(6).split(' ');
      const name = parts[0];
      const offset = parseInt(parts[1], 10);
      labels.set(name, offset);
    }
    
    if (trimmed.startsWith('string ')) {
      const startQuote = trimmed.indexOf('"');
      if (startQuote !== -1) {
        const afterQuote = trimmed.substring(startQuote + 1);
        if (afterQuote.endsWith('"')) {
          let str = afterQuote.slice(0, -1);
          str = str
            .replace(/\\n/g, '\n')
            .replace(/\\r/g, '\r')
            .replace(/\\t/g, '\t')
            .replace(/\\\\/g, '\\');
          strings.set(`str_${strings.size}`, str);
        } else {
          let str = afterQuote
            .replace(/\\n/g, '\n')
            .replace(/\\r/g, '\r')
            .replace(/\\t/g, '\t')
            .replace(/\\\\/g, '\\');
          strings.set(`str_${strings.size}`, str + '\n');
        }
      }
    }
  }
  
  return { instructions, labels, strings, sharedVars, stackSize };
}

// Compile manifest to Windows native code
function compileToWindows(manifest, options = {}) {
  const level = options.debugLevel || DEBUG_LEVEL.NONE;
  const encoder = new X86EncoderWin64();
  const { instructions, labels, strings, sharedVars, stackSize } = manifest;
  
  // Add strings to data section
  const stringLabels = new Map();
  const stringLengths = new Map();
  for (const [name, str] of strings) {
    const label = encoder.addString(str);
    stringLabels.set(name, label);
    stringLengths.set(name, str.length);
    debugVerbose(`String: ${name} -> ${label} (${str.length} chars)`);
  }
  
  // Add shared variables to data section
  const sharedLabels = new Map();  // Map shared ID to label
  for (const [id, info] of sharedVars) {
    const label = encoder.addSharedVar(id.toString(), info.initialValue);
    sharedLabels.set(id, label);
    debugVerbose(`Shared var: ${id} -> ${label} (initial: ${info.initialValue})`);
  }
  
  // Generate Windows startup code
  // Win64 ABI requires 32-byte shadow space on stack
  // Also need to align stack to 16 bytes
  // Reserve extra space for print syscall (handle, bytesWritten, etc.) and thread handles
  
  // Entry point - setup stack frame
  // Use stack size from manifest (default 88 bytes: 32 shadow + 56 for locals)
  const effectiveStackSize = stackSize || 0x58;
  debugBasic(`Stack frame size: ${effectiveStackSize} bytes (0x${effectiveStackSize.toString(16)})`);
  encoder.subRspImm(effectiveStackSize);
  
  // Map instruction indices to code offsets
  const instrOffsets = new Map();
  
  // Track which string is loaded in r1 (for print syscall)
  let lastStringInR1 = null;
  
  // Track if last comparison was float (for correct CJMP generation)
  let lastCompareWasFloat = false;
  
  // Build reverse map: instruction index -> function label name (for non-main functions)
  const funcEntryPoints = new Map();
  for (const [name, offset] of labels) {
    if (name.startsWith('fn_') && name !== 'fn_main') {
      funcEntryPoints.set(offset, name);
      debugBasic(`Function: ${name} at instruction ${offset}`);
    }
  }
  
  debugBasic(`Compiling ${instructions.length} instructions...`);
  
  // Generate code for each instruction
  for (let i = 0; i < instructions.length; i++) {
    // Check if this is a non-main function entry point
    // If so, insert a function prologue
    if (funcEntryPoints.has(i)) {
      instrOffsets.set(i, encoder.code.length);
      // Function prologue for thread functions
      encoder.subRspImm(effectiveStackSize);
      debugVerbose(`  [${i}] Function prologue (sub rsp, 0x${effectiveStackSize.toString(16)})`);
    } else {
      instrOffsets.set(i, encoder.code.length);
    }
    
    const instr = instructions[i];
    
    // Debug output for each instruction
    if (level >= DEBUG_LEVEL.VERBOSE) {
      const opName = Object.keys(OPCODE).find(k => OPCODE[k] === instr.opcode) || `0x${instr.opcode.toString(16)}`;
      debugVerbose(`  [${i}] ${opName} op0=${instr.op0} op1=${instr.op1} op2=${instr.op2} imm32=${instr.imm32}${instr.comment ? ' ; ' + instr.comment : ''}`);
    }
    
    // Track comparison type
    if (instr.opcode === OPCODE.CMP) {
      lastCompareWasFloat = false;
    } else if (instr.opcode === OPCODE.FCMP) {
      lastCompareWasFloat = true;
    }
    
    // Pass float compare flag to instruction
    instr._lastCompareWasFloat = lastCompareWasFloat;
    
    // Track MOV r1, @str_X instructions
    if (instr.opcode === OPCODE.MOV && instr.op0 === 1 && instr.op1 === 0xFE) {
      if (instr.comment) {
        const match = instr.comment.match(/@(str_\d+)/);
        if (match) {
          lastStringInR1 = match[1];
        }
      }
    }
    
    // Pass tracked string info to SVC handler
    instr._lastStringInR1 = lastStringInR1;
    
    // Handle FMOV with immediate float (op1 === 0xFF means next word is float data)
    if (instr.opcode === OPCODE.FMOV && instr.op1 === 0xFF && i + 1 < instructions.length) {
      const nextInstr = instructions[i + 1];
      if (nextInstr && nextInstr.bytes) {
        // Pass the float data to the instruction
        instr._floatDataBytes = nextInstr.bytes;
        compileInstructionWin64(encoder, instr, stringLabels, stringLengths);
        // Skip the float data instruction but record its offset for label resolution
        i++;
        instrOffsets.set(i, encoder.code.length);
        continue;
      }
    }
    
    compileInstructionWin64(encoder, instr, stringLabels, stringLengths);
  }
  
  // Record label positions
  for (const [name, offset] of labels) {
    if (instrOffsets.has(offset)) {
      encoder.labels.set(name, instrOffsets.get(offset));
    }
  }
  
  debugBasic(`Generated ${encoder.code.length} bytes of code`);
  
  return { encoder, stringLengths };
}

// Compile a single Aurora instruction to Windows x64
function compileInstructionWin64(encoder, instr, stringLabels, stringLengths) {
  const { opcode, op0, op1, op2, imm32 } = instr;
  const signedImm = imm32 > 0x7FFFFFFF ? imm32 - 0x100000000 : imm32;
  
  switch (opcode) {
    case OPCODE.NOP:
      encoder.emit(0x90);
      break;
      
    case OPCODE.PUSH:
      // Push register to stack (for spilling)
      encoder.pushReg(op0);
      break;
      
    case OPCODE.POP:
      // Pop from stack to register (for reloading)
      encoder.popReg(op0);
      break;
      
    case OPCODE.STORE_STACK:
      // Store register to [RSP+offset]
      encoder.movStackReg(signedImm, op0);
      break;
      
    case OPCODE.LOAD_STACK:
      // Load register from [RSP+offset]
      encoder.movRegStack(op0, signedImm);
      break;
      
    case OPCODE.MOV:
      if (op1 === 0xFE) {
        // MOV reg, @label (string address)
        let strName = null;
        if (instr.comment) {
          const match = instr.comment.match(/@(str_\d+)/);
          if (match) strName = match[1];
        }
        
        const nativeLabel = strName && stringLabels.has(strName) 
          ? stringLabels.get(strName) 
          : '_str_0';
        
        encoder.movRegImm64(op0, 0);  // Placeholder
        encoder.relocations.push({
          offset: encoder.code.length - 8,
          label: nativeLabel,
          type: 'abs64'
        });
      } else if (op1 === 0xFF) {
        encoder.movRegImm64(op0, signedImm);
      } else {
        encoder.movRegReg(op0, op1);
      }
      break;
      
    case OPCODE.ADD:
      if (op2 === 0xFF) {
        if (op0 !== op1) encoder.movRegReg(op0, op1);
        encoder.addRegImm32(op0, signedImm);
      } else {
        if (op0 !== op1) encoder.movRegReg(op0, op1);
        encoder.addRegReg(op0, op2);
      }
      break;
      
    case OPCODE.SUB:
      if (op2 === 0xFF) {
        if (op0 !== op1) encoder.movRegReg(op0, op1);
        encoder.subRegImm32(op0, signedImm);
      } else {
        if (op0 !== op1) encoder.movRegReg(op0, op1);
        encoder.subRegReg(op0, op2);
      }
      break;
      
    case OPCODE.MUL:
      if (op2 === 0xFF) {
        encoder.imulRegImm32(op0, op1, signedImm);
      } else {
        if (op0 !== op1) encoder.movRegReg(op0, op1);
        encoder.imulRegReg(op0, op2);
      }
      break;
      
    case OPCODE.DIV:
      if (op2 === 0xFF) {
        // DIV reg, reg, imm - not directly supported, use temp register
        // Move imm to temp (r7), then divide
        encoder.movRegImm64(7, signedImm);  // r7 = imm
        if (op0 !== op1) encoder.movRegReg(op0, op1);
        encoder.idivReg(op0, 7);
      } else {
        if (op0 !== op1) encoder.movRegReg(op0, op1);
        encoder.idivReg(op0, op2);
      }
      break;
      
    case OPCODE.REM:
      if (op2 === 0xFF) {
        // REM reg, reg, imm - use temp register
        encoder.movRegImm64(7, signedImm);  // r7 = imm
        if (op0 !== op1) encoder.movRegReg(op0, op1);
        encoder.iremReg(op0, 7);
      } else {
        if (op0 !== op1) encoder.movRegReg(op0, op1);
        encoder.iremReg(op0, op2);
      }
      break;
      
    case OPCODE.CMP:
      if (op1 === 0xFF) {
        encoder.cmpRegImm32(op0, signedImm);
      } else {
        encoder.cmpRegReg(op0, op1);
      }
      break;
      
    case OPCODE.JMP:
      if (op0 === 0xFE) {
        const target = instr.jumpTarget || '__pending__';
        encoder.jmpRel32(target);
      }
      break;
      
    case OPCODE.CJMP:
      {
        const target = instr.jumpTarget || '__pending__';
        // Use float-specific conditional jumps if last comparison was FCMP
        // UCOMISD sets CF/ZF flags differently than integer CMP
        if (instr._lastCompareWasFloat) {
          encoder.jccFloatRel32(op0, target);
        } else {
          encoder.jccRel32(op0, target);
        }
      }
      break;
      
    case OPCODE.CALL:
      if (op0 === 0xFE) {
        const target = instr.jumpTarget || '__pending__';
        encoder.callRel32(target);
      }
      break;
      
    case OPCODE.RET:
      // Function epilogue - restore stack before return
      encoder.addRspImm(effectiveStackSize);
      encoder.ret();
      break;
      
    case OPCODE.SVC:
      compileSyscallWin64(encoder, op0, op1, stringLengths, instr);
      break;
      
    case OPCODE.HALT:
      // ExitProcess(exitCode)
      // RCX = exit code (from r0)
      // Aurora r0 maps to RAX in Win64, need to move it to RCX
      encoder.movRegReg(1, 0);  // RCX = RAX (exit code from r0)
      encoder.callImport('ExitProcess');
      break;
      
    case OPCODE.AND:
      if (op2 === 0xFF) {
        if (op0 !== op1) encoder.movRegReg(op0, op1);
        encoder.andRegImm32(op0, signedImm);
      } else {
        if (op0 !== op1) encoder.movRegReg(op0, op1);
        encoder.andRegReg(op0, op2);
      }
      break;
      
    case OPCODE.OR:
      if (op2 === 0xFF) {
        if (op0 !== op1) encoder.movRegReg(op0, op1);
        encoder.orRegImm32(op0, signedImm);
      } else {
        if (op0 !== op1) encoder.movRegReg(op0, op1);
        encoder.orRegReg(op0, op2);
      }
      break;
      
    case OPCODE.XOR:
      if (op2 === 0xFF) {
        if (op0 !== op1) encoder.movRegReg(op0, op1);
        encoder.xorRegImm32(op0, signedImm);
      } else {
        if (op0 !== op1) encoder.movRegReg(op0, op1);
        encoder.xorRegReg(op0, op2);
      }
      break;
      
    case OPCODE.SHL:
      if (op2 === 0xFF) {
        if (op0 !== op1) encoder.movRegReg(op0, op1);
        encoder.shlRegImm8(op0, signedImm & 0x3F);
      }
      break;
      
    case OPCODE.SHR:
      if (op2 === 0xFF) {
        if (op0 !== op1) encoder.movRegReg(op0, op1);
        encoder.shrRegImm8(op0, signedImm & 0x3F);
      }
      break;
    
    case OPCODE.ARRAY_ALLOC:
      // No-op at runtime - array slots already allocated in stack frame
      break;
    
    case OPCODE.ARRAY_LOAD:
      // ARRAY_LOAD dest_reg, base_slot, index_reg
      // Load value from [RSP + 32 + (base_slot + index_reg) * 8]
      // op0 = dest_reg, op1 = base_slot, op2 = index_reg
      {
        const destReg = op0;
        const baseSlot = op1;
        const indexReg = op2;
        
        // Address calculation: [RSP + indexReg*8 + 32 + baseSlot*8]
        const baseOffset = 32 + baseSlot * 8;
        
        // Map Aurora registers to x64 registers
        const destRegEnc = encoder.mapReg(destReg);
        const indexRegEnc = encoder.mapReg(indexReg);
        
        // If indexReg is the same as destReg, we need a different approach
        if (indexReg === destReg) {
          // Use R11 as temp (scratch register in Win64, maps from Aurora r6)
          // But r6 maps to R11, so check if that's what we're using
          // Let's use a simpler approach: calculate address step by step
          
          // 1. Calculate index * 8 into dest
          encoder.shlRegImm8(destReg, 3);  // destReg = index * 8
          // 2. Add base offset
          encoder.addRegImm32(destReg, baseOffset);  // destReg = index * 8 + baseOffset
          // 3. Add RSP
          // MOV temp, RSP; ADD destReg, temp - but we don't have temp
          // Alternative: LEA destReg, [RSP + destReg]
          const destRegX64 = destRegEnc;
          // REX.W LEA r, [RSP + r]
          // 48 8D 04 04 for LEA RAX, [RSP + RAX] (if both are 0-7)
          let rex = 0x48;
          if (destRegX64 > 7) rex |= 0x05;  // REX.R and REX.B
          encoder.emit(rex);
          encoder.emit(0x8D);  // LEA
          // ModRM: mod=00, reg=dest, r/m=100 (SIB)
          encoder.emit(0x04 | ((destRegX64 & 7) << 3));
          // SIB: scale=00 (1), index=dest, base=RSP
          encoder.emit(0x04 | ((destRegX64 & 7) << 3));
          
          // 4. Load from [destReg]
          rex = 0x48;
          if (destRegX64 > 7) rex |= 0x05;  // REX.R and REX.B
          encoder.emit(rex);
          encoder.emit(0x8B);  // MOV
          encoder.emit((destRegX64 & 7) << 3 | (destRegX64 & 7));  // ModRM: mod=00, reg=dest, r/m=dest
        } else {
          // MOV dest, [RSP + indexReg*8 + baseOffset]
          // Use SIB addressing: base=RSP, index=indexReg, scale=8
          
          // REX prefix: W=1, R=dest>7, X=index>7, B=0 (RSP base is 4)
          let rex = 0x48;
          if (destRegEnc > 7) rex |= 0x04;  // REX.R
          if (indexRegEnc > 7) rex |= 0x02; // REX.X
          encoder.emit(rex);
          
          encoder.emit(0x8B);  // MOV r64, r/m64
          // ModRM: mod=10 (disp32), reg=dest, r/m=100 (SIB)
          encoder.emit(0x84 | ((destRegEnc & 7) << 3));
          // SIB: scale=11 (8), index=indexReg, base=100 (RSP)
          encoder.emit(0xC4 | ((indexRegEnc & 7) << 3));
          // disp32
          encoder.emit(baseOffset & 0xFF);
          encoder.emit((baseOffset >> 8) & 0xFF);
          encoder.emit((baseOffset >> 16) & 0xFF);
          encoder.emit((baseOffset >> 24) & 0xFF);
        }
      }
      break;
    
    case OPCODE.ARRAY_STORE:
      // ARRAY_STORE base_slot, index_reg, value_reg
      // Store value_reg to [RSP + 32 + (base_slot + index_reg) * 8]
      // op0 = base_slot, op1 = index_reg, op2 = value_reg
      {
        const baseSlot = op0;
        const indexReg = op1;
        const valueReg = op2;
        const baseOffset = 32 + baseSlot * 8;
        
        // Map Aurora registers to x64 registers
        const valueRegEnc = encoder.mapReg(valueReg);
        const indexRegEnc = encoder.mapReg(indexReg);
        
        // MOV [RSP + indexReg*8 + baseOffset], valueReg
        // REX prefix: W=1, R=value>7, X=index>7, B=0 (RSP base)
        let rex = 0x48;
        if (valueRegEnc > 7) rex |= 0x04;  // REX.R
        if (indexRegEnc > 7) rex |= 0x02;  // REX.X
        encoder.emit(rex);
        
        encoder.emit(0x89);  // MOV r/m64, r64
        // ModRM: mod=10 (disp32), reg=value, r/m=100 (SIB)
        encoder.emit(0x84 | ((valueRegEnc & 7) << 3));
        // SIB: scale=11 (8), index=indexReg, base=100 (RSP)
        encoder.emit(0xC4 | ((indexRegEnc & 7) << 3));
        // disp32
        encoder.emit(baseOffset & 0xFF);
        encoder.emit((baseOffset >> 8) & 0xFF);
        encoder.emit((baseOffset >> 16) & 0xFF);
        encoder.emit((baseOffset >> 24) & 0xFF);
      }
      break;
    
    // ========================
    // Floating Point Instructions
    // ========================
    
    case OPCODE.FMOV:
      // FMOV dest_xmm, src_xmm or FMOV dest_xmm, imm64
      if (op1 === 0xFF && instr._floatDataBytes) {
        // Float immediate mode: float data was passed via _floatDataBytes
        const floatBytes = BigInt(instr._floatDataBytes);
        const buffer = Buffer.alloc(8);
        buffer.writeBigUInt64LE(floatBytes);
        const floatValue = buffer.readDoubleLE(0);
        encoder.movsdRegImm(op0, floatValue);
      } else if (op1 < 8 && op1 !== 0) {
        // Register to register
        encoder.movsdRegReg(op0, op1);
      } else if (op1 !== 0x00 && op1 !== 0xFF) {
        // Old immediate float value encoded in instruction (fallback)
        let floatValue = 0.0;
        if (instr.comment) {
          const match = instr.comment.match(/fmov xmm\d+, ([\d.e+-]+)/i);
          if (match) {
            floatValue = parseFloat(match[1]);
          }
        }
        encoder.movsdRegImm(op0, floatValue);
      } else if (op1 === 0 || (op1 < 8)) {
        // Register to register where source is xmm0
        encoder.movsdRegReg(op0, op1);
      }
      break;
    
    case OPCODE.FADD:
      // FADD dest_xmm, src1_xmm, src2_xmm
      // For SSE, we need: MOVSD dest, src1; ADDSD dest, src2
      if (op0 !== op1) {
        encoder.movsdRegReg(op0, op1);
      }
      encoder.addsdRegReg(op0, op2);
      break;
    
    case OPCODE.FSUB:
      // FSUB dest_xmm, src1_xmm, src2_xmm
      if (op0 !== op1) {
        encoder.movsdRegReg(op0, op1);
      }
      encoder.subsdRegReg(op0, op2);
      break;
    
    case OPCODE.FMUL:
      // FMUL dest_xmm, src1_xmm, src2_xmm
      if (op0 !== op1) {
        encoder.movsdRegReg(op0, op1);
      }
      encoder.mulsdRegReg(op0, op2);
      break;
    
    case OPCODE.FDIV:
      // FDIV dest_xmm, src1_xmm, src2_xmm
      if (op0 !== op1) {
        encoder.movsdRegReg(op0, op1);
      }
      encoder.divsdRegReg(op0, op2);
      break;
    
    case OPCODE.FCMP:
      // FCMP xmm1, xmm2
      encoder.ucomisdRegReg(op0, op1);
      break;
    
    case OPCODE.FLOAD:
      // FLOAD dest_xmm, [RSP+offset]
      encoder.movsdRegStack(op0, signedImm);
      break;
    
    case OPCODE.FSTORE:
      // FSTORE [RSP+offset], src_xmm
      encoder.movsdStackReg(signedImm, op0);
      break;
    
    case OPCODE.CVTSI2SD:
      // CVTSI2SD dest_xmm, src_reg
      encoder.cvtsi2sdXmmReg(op0, op1);
      break;
    
    case OPCODE.CVTSD2SI:
      // CVTSD2SI dest_reg, src_xmm
      encoder.cvttsd2siRegXmm(op0, op1);
      break;
    
    case OPCODE.FSQRT:
      // FSQRT dest_xmm, src_xmm
      // sqrtsd xmm_dest, xmm_src
      encoder.sqrtsdXmmXmm(op0, op1);
      break;
    
    case OPCODE.FABS:
      // FABS dest_xmm, src_xmm - absolute value
      encoder.fabsXmmXmm(op0, op1);
      break;
    
    case OPCODE.FNEG:
      // FNEG dest_xmm, src_xmm - negate
      encoder.fnegXmmXmm(op0, op1);
      break;
    
    case OPCODE.FFLOOR:
      // FFLOOR dest_xmm, src_xmm - floor (toward -inf)
      encoder.ffloorXmmXmm(op0, op1);
      break;
    
    case OPCODE.FCEIL:
      // FCEIL dest_xmm, src_xmm - ceil (toward +inf)
      encoder.fceilXmmXmm(op0, op1);
      break;
    
    case OPCODE.SPAWN:
      // SPAWN dest_reg, func_label
      // Windows CreateThread:
      //   HANDLE CreateThread(
      //     LPSECURITY_ATTRIBUTES lpThreadAttributes,  // RCX = NULL
      //     SIZE_T dwStackSize,                        // RDX = 0 (default)
      //     LPTHREAD_START_ROUTINE lpStartAddress,     // R8 = func addr
      //     LPVOID lpParameter,                        // R9 = NULL
      //     DWORD dwCreationFlags,                     // [rsp+0x20] = 0
      //     LPDWORD lpThreadId                         // [rsp+0x28] = NULL
      //   );
      // Returns: HANDLE in RAX
      {
        const destReg = op0;
        const funcLabel = instr.jumpTarget || '__pending__';
        
        // Strategy: Use high stack space to save volatile registers
        // Stack layout (0x58 bytes allocated at function entry):
        //   [rsp+0x00 - 0x1F] : shadow space (32 bytes) - reserved for callee
        //   [rsp+0x20]        : 5th param for CreateThread
        //   [rsp+0x28]        : 6th param for CreateThread
        //   [rsp+0x30]        : save r1 (RCX)
        //   [rsp+0x38]        : save r2 (RDX)
        //   [rsp+0x40]        : save r3 (R8)
        //   [rsp+0x48]        : save r4 (R9)
        //   [rsp+0x50]        : alignment/reserved
        
        // Save r1-r4 to stack at safe locations
        encoder.emit(0x48, 0x89, 0x4C, 0x24, 0x30);  // mov [rsp+0x30], rcx
        encoder.emit(0x48, 0x89, 0x54, 0x24, 0x38);  // mov [rsp+0x38], rdx
        encoder.emit(0x4C, 0x89, 0x44, 0x24, 0x40);  // mov [rsp+0x40], r8
        encoder.emit(0x4C, 0x89, 0x4C, 0x24, 0x48);  // mov [rsp+0x48], r9
        
        // Set up arguments for CreateThread
        encoder.movRegImm64(1, 0);  // RCX = 0 (NULL lpThreadAttributes)
        encoder.movRegImm64(2, 0);  // RDX = 0 (default stack size)
        
        // R8 = function address (use LEA with RIP-relative addressing)
        encoder.emit(0x4C, 0x8D, 0x05);  // lea r8, [rip+disp32]
        encoder.relocations.push({
          offset: encoder.code.length,
          label: funcLabel,
          type: 'rel32',
        });
        encoder.emit(0, 0, 0, 0);  // placeholder
        
        encoder.movRegImm64(4, 0);  // R9 = 0 (NULL lpParameter)
        
        // 5th param: dwCreationFlags = 0 at [rsp+0x20]
        encoder.emit(0x48, 0xC7, 0x44, 0x24, 0x20, 0x00, 0x00, 0x00, 0x00);
        
        // 6th param: lpThreadId = NULL at [rsp+0x28]
        encoder.emit(0x48, 0xC7, 0x44, 0x24, 0x28, 0x00, 0x00, 0x00, 0x00);
        
        encoder.callImport('CreateThread');
        
        // RAX now contains the thread handle
        // Move handle to destination register
        if (destReg !== 0) {
          encoder.movRegReg(destReg, 0);  // dest = RAX
        }
        
        // Restore saved registers (except destReg if it was saved)
        // Only restore if destReg is not that register
        if (destReg !== 1) {
          encoder.emit(0x48, 0x8B, 0x4C, 0x24, 0x30);  // mov rcx, [rsp+0x30]
        }
        if (destReg !== 2) {
          encoder.emit(0x48, 0x8B, 0x54, 0x24, 0x38);  // mov rdx, [rsp+0x38]
        }
        if (destReg !== 3) {
          encoder.emit(0x4C, 0x8B, 0x44, 0x24, 0x40);  // mov r8, [rsp+0x40]
        }
        if (destReg !== 4) {
          encoder.emit(0x4C, 0x8B, 0x4C, 0x24, 0x48);  // mov r9, [rsp+0x48]
        }
      }
      break;
    
    case OPCODE.JOIN:
      // JOIN handle_reg
      // Windows WaitForSingleObject(handle, INFINITE):
      //   DWORD WaitForSingleObject(
      //     HANDLE hHandle,     // RCX = handle
      //     DWORD dwMilliseconds // RDX = INFINITE (0xFFFFFFFF)
      //   );
      {
        const handleReg = op0;
        
        // Save ALL volatile registers that might hold thread handles
        // r1->RCX, r2->RDX, r3->R8, r4->R9 can all hold handles from SPAWN
        // We save them to stack to preserve them across the API call
        // Stack slots: [rsp+0x30]=RCX, [rsp+0x38]=RDX, [rsp+0x40]=R8, [rsp+0x48]=R9
        encoder.emit(0x48, 0x89, 0x4C, 0x24, 0x30);  // mov [rsp+0x30], rcx
        encoder.emit(0x48, 0x89, 0x54, 0x24, 0x38);  // mov [rsp+0x38], rdx
        encoder.emit(0x4C, 0x89, 0x44, 0x24, 0x40);  // mov [rsp+0x40], r8
        encoder.emit(0x4C, 0x89, 0x4C, 0x24, 0x48);  // mov [rsp+0x48], r9
        
        // Move handle to RCX if not already there
        if (handleReg !== 1) {
          encoder.movRegReg(1, handleReg);  // RCX = handle
        }
        
        // RDX = INFINITE (0xFFFFFFFF)
        encoder.movRegImm64(2, 0xFFFFFFFF);
        
        encoder.callImport('WaitForSingleObject');
        
        // Restore saved registers (except the handleReg, as its handle is now "joined")
        // Restore r1 if it wasn't the joined handle
        if (handleReg !== 1) {
          encoder.emit(0x48, 0x8B, 0x4C, 0x24, 0x30);  // mov rcx, [rsp+0x30]
        }
        // Restore r2 if it wasn't the joined handle
        if (handleReg !== 2) {
          encoder.emit(0x48, 0x8B, 0x54, 0x24, 0x38);  // mov rdx, [rsp+0x38]
        }
        // Restore r3 (R8) if it wasn't the joined handle
        if (handleReg !== 3) {
          encoder.emit(0x4C, 0x8B, 0x44, 0x24, 0x40);  // mov r8, [rsp+0x40]
        }
        // Restore r4 (R9) if it wasn't the joined handle
        if (handleReg !== 4) {
          encoder.emit(0x4C, 0x8B, 0x4C, 0x24, 0x48);  // mov r9, [rsp+0x48]
        }
      }
      break;
    
    case OPCODE.ATOMIC_LOAD:
      // ATOMIC_LOAD dest_reg, shared_var_id
      // Load value from shared variable atomically
      {
        const destReg = op0;
        const sharedId = op1;
        const sharedLabel = `_shared_${sharedId}`;
        
        // Load address of shared variable into a temp register (use r7/RBX)
        encoder.leaRegRipLabel(7, sharedLabel);
        // Load value atomically (simple MOV is atomic for aligned 64-bit on x64)
        encoder.movRegMem64(destReg, 7);
      }
      break;
    
    case OPCODE.ATOMIC_STORE:
      // ATOMIC_STORE shared_var_id, src_reg
      // Store value to shared variable atomically
      {
        const sharedId = op0;
        const srcReg = op1;
        const sharedLabel = `_shared_${sharedId}`;
        
        // Load address of shared variable into a temp register (use r7/RBX)
        encoder.leaRegRipLabel(7, sharedLabel);
        // Use LOCK XCHG for atomic store
        encoder.lockXchgMem64Reg(7, srcReg);
      }
      break;
    
    case OPCODE.ATOMIC_ADD:
      // ATOMIC_ADD shared_var_id, src_reg
      // Atomically add src_reg to shared variable
      {
        const sharedId = op0;
        const srcReg = op1;
        const sharedLabel = `_shared_${sharedId}`;
        
        // Load address of shared variable into a temp register (use r7/RBX)
        encoder.leaRegRipLabel(7, sharedLabel);
        // Use LOCK XADD for atomic add
        encoder.lockXaddMem64Reg(7, srcReg);
      }
      break;
    
    case OPCODE.ATOMIC_FADD:
      // ATOMIC_FADD shared_var_id, fX
      // Atomically add float from fX to shared variable using CAS loop
      // Algorithm:
      //   LEA RBX, [shared_var]   ; Address in RBX (r7)
      //   loop:
      //     MOV RAX, [RBX]        ; Load current value into RAX (r0)
      //     MOVQ XMM1, RAX        ; Convert to XMM1 (temp)
      //     ADDSD XMM1, XMMsrc    ; Add the value from source XMM
      //     MOVQ RCX, XMM1        ; New value to RCX (r1)
      //     LOCK CMPXCHG [RBX], RCX  ; If [RBX]==RAX, store RCX in [RBX]
      //     JNE loop              ; Retry if failed
      {
        const sharedId = op0;
        const srcXmm = op1;  // Aurora float register f0-f7
        const sharedLabel = `_shared_${sharedId}`;
        
        // Load address of shared variable into r7 (RBX)
        encoder.leaRegRipLabel(7, sharedLabel);
        
        // Record loop start
        const loopStart = encoder.currentOffset();
        
        // MOV RAX, [RBX] - Load current value into RAX (Aurora r0)
        encoder.movRegMem64(0, 7);  // r0 = [r7]
        
        // MOVQ XMM1, RAX - Convert integer bits to XMM1 (temp float)
        // 66 48 0F 6E C8 - MOVQ xmm1, rax
        encoder.emit(0x66, 0x48, 0x0F, 0x6E, 0xC8);
        
        // ADDSD XMM1, XMMsrc - Add source float value
        // Map srcXmm (Aurora f0-f7) to actual XMM register
        // Aurora f0-f7 map to XMM0-XMM7
        // ADDSD xmm1, xmmsrc: F2 0F 58 C8+src
        encoder.emit(0xF2, 0x0F, 0x58, 0xC8 + srcXmm);
        
        // MOVQ RCX, XMM1 - Get result as integer in RCX (Aurora r1)
        // 66 48 0F 7E C9 - MOVQ rcx, xmm1
        encoder.emit(0x66, 0x48, 0x0F, 0x7E, 0xC9);
        
        // LOCK CMPXCHG [RBX], RCX - Try to store new value
        // If [RBX]==RAX, store RCX; else load [RBX] into RAX
        encoder.lockCmpxchgMem64Reg(7, 1);  // r7=[RBX], r1=RCX
        
        // JNE loop - If ZF=0 (exchange failed), retry
        const jumpOffset = encoder.currentOffset();
        const rel8 = loopStart - (jumpOffset + 2);  // +2 for JNE instruction length
        encoder.jneRel8(rel8);
      }
      break;
      
    default:
      encoder.emit(0x90);  // NOP for unhandled
  }
}

// Compile Aurora SVC to Windows API calls
function compileSyscallWin64(encoder, svcNum, arg, stringLengths, instr) {
  switch (svcNum) {
    case 0x01:  // print
      // Windows WriteFile:
      //   HANDLE hFile = GetStdHandle(STD_OUTPUT_HANDLE)
      //   BOOL WriteFile(hFile, lpBuffer, nNumberOfBytesToWrite, lpNumberOfBytesWritten, lpOverlapped)
      //
      // Win64 ABI: RCX, RDX, R8, R9, then stack
      // Shadow space (32 bytes) and local space already allocated at function entry
      // 
      // Stack layout (72 bytes allocated at entry):
      //   [rsp+0x00 - 0x1F] : shadow space (32 bytes)
      //   [rsp+0x20]        : 5th param (lpOverlapped)
      //   [rsp+0x28]        : bytesWritten
      //   [rsp+0x30]        : saved handle
      //   [rsp+0x38]        : saved buffer pointer
      //   [rsp+0x40]        : (alignment padding)
      //
      // Aurora r1 has the string pointer (in Win64 mapping: r1 -> RCX)
      
      // Get string length from tracked string in r1
      let strLen = 4;  // Default
      if (instr && instr._lastStringInR1) {
        const strName = instr._lastStringInR1;
        if (stringLengths.has(strName)) {
          strLen = stringLengths.get(strName);
        }
      }
      
      // Save buffer pointer to stack (Aurora r1 -> RCX in Win64 mapping)
      encoder.emit(0x48, 0x89, 0x4C, 0x24, 0x38);  // mov [rsp+0x38], rcx
      
      // GetStdHandle(-11) to get STDOUT
      encoder.movRegImm64(1, -11);  // RCX = -11 (STD_OUTPUT_HANDLE)
      encoder.callImport('GetStdHandle');
      // RAX = handle
      
      // Save handle to stack
      encoder.emit(0x48, 0x89, 0x44, 0x24, 0x30);  // mov [rsp+0x30], rax
      
      // WriteFile(handle, buffer, len, &bytesWritten, NULL)
      // RCX = handle
      encoder.emit(0x48, 0x8B, 0x4C, 0x24, 0x30);  // mov rcx, [rsp+0x30]
      // RDX = buffer (from saved location)
      encoder.emit(0x48, 0x8B, 0x54, 0x24, 0x38);  // mov rdx, [rsp+0x38]
      // R8 = length
      encoder.movRegImm64(3, strLen);  // R8 = length
      // R9 = &bytesWritten (rsp+0x28)
      encoder.emit(0x4C, 0x8D, 0x4C, 0x24, 0x28);  // lea r9, [rsp+0x28]
      // [RSP+0x20] = NULL (lpOverlapped, 5th param)
      encoder.emit(0x48, 0xC7, 0x44, 0x24, 0x20, 0x00, 0x00, 0x00, 0x00);  // mov qword [rsp+0x20], 0
      
      encoder.callImport('WriteFile');
      
      // No stack cleanup needed - space was allocated at entry
      break;
      
    case 0x02:  // exit
      // ExitProcess(exitCode)
      // RCX = exit code
      // Aurora r0 -> RAX, but ExitProcess expects RCX
      // Shadow space already allocated at function entry (sub rsp, 0x28)
      encoder.movRegReg(1, 0);  // RCX = RAX (exit code from r0)
      encoder.callImport('ExitProcess');
      // No cleanup needed - ExitProcess doesn't return
      break;
    
    case 0x03:  // pause - Wait for Enter, show exit code
      // Save exit code (RAX) to [rsp+0x40]
      encoder.emit(0x48, 0x89, 0x44, 0x24, 0x40);  // mov [rsp+0x40], rax
      
      // Print "Exit code: "
      // GetStdHandle(-11) for STDOUT
      encoder.movRegImm64(1, -11);  // RCX = STD_OUTPUT_HANDLE
      encoder.callImport('GetStdHandle');
      encoder.emit(0x48, 0x89, 0x44, 0x24, 0x30);  // mov [rsp+0x30], rax (save handle)
      
      // WriteFile for "Exit code: "
      encoder.emit(0x48, 0x8B, 0x4C, 0x24, 0x30);  // mov rcx, [rsp+0x30] (handle)
      encoder.movRegImm64(2, 0);  // RDX = placeholder for string addr
      encoder.relocations.push({
        offset: encoder.code.length - 8,
        label: '_exit_code_str',
        type: 'abs64'
      });
      encoder.movRegImm64(3, 12);  // R8 = 12 ("Exit code: " length)
      encoder.emit(0x4C, 0x8D, 0x4C, 0x24, 0x28);  // lea r9, [rsp+0x28]
      encoder.emit(0x48, 0xC7, 0x44, 0x24, 0x20, 0x00, 0x00, 0x00, 0x00);  // mov qword [rsp+0x20], 0
      encoder.callImport('WriteFile');
      
      // Convert exit code to decimal string using division loop
      // Buffer for digits at [rsp+0x50] (up to 20 digits + newline)
      // RAX = number to convert
      encoder.emit(0x48, 0x8B, 0x44, 0x24, 0x40);  // mov rax, [rsp+0x40]
      
      // R10 = buffer end pointer (we build string backwards)
      encoder.emit(0x4C, 0x8D, 0x54, 0x24, 0x5E);  // lea r10, [rsp+0x5E] (buffer + 14)
      encoder.emit(0x41, 0xC6, 0x02, 0x0A);        // mov byte [r10], 0x0A (newline at end)
      
      // R11 = digit count
      encoder.emit(0x4D, 0x31, 0xDB);              // xor r11, r11
      
      // divisor = 10 in RCX for later
      encoder.emit(0x48, 0xC7, 0xC1, 0x0A, 0x00, 0x00, 0x00);  // mov rcx, 10
      
      // Loop: divide by 10, store remainder as digit
      const loopStart = encoder.code.length;
      encoder.emit(0x49, 0xFF, 0xCA);              // dec r10 (move pointer back)
      encoder.emit(0x49, 0xFF, 0xC3);              // inc r11 (count digits)
      encoder.emit(0x48, 0x31, 0xD2);              // xor rdx, rdx (clear high bits for div)
      encoder.emit(0x48, 0xF7, 0xF1);              // div rcx (rax = rax/10, rdx = rax%10)
      encoder.emit(0x48, 0x83, 0xC2, 0x30);        // add rdx, '0' (convert to ASCII)
      encoder.emit(0x41, 0x88, 0x12);              // mov [r10], dl (store digit)
      encoder.emit(0x48, 0x85, 0xC0);              // test rax, rax
      // jnz back to loop
      const loopOffset = loopStart - (encoder.code.length + 2);
      encoder.emit(0x75, loopOffset & 0xFF);       // jnz loop
      
      // R10 now points to first digit, R11 = digit count
      // Add 1 for newline
      encoder.emit(0x49, 0xFF, 0xC3);              // inc r11
      
      // WriteFile for the number
      encoder.emit(0x48, 0x8B, 0x4C, 0x24, 0x30);  // mov rcx, [rsp+0x30] (handle)
      encoder.emit(0x4C, 0x89, 0xD2);              // mov rdx, r10 (buffer start)
      encoder.emit(0x4D, 0x89, 0xD8);              // mov r8, r11 (length)
      encoder.emit(0x4C, 0x8D, 0x4C, 0x24, 0x28);  // lea r9, [rsp+0x28]
      encoder.emit(0x48, 0xC7, 0x44, 0x24, 0x20, 0x00, 0x00, 0x00, 0x00);
      encoder.callImport('WriteFile');
      
      // Print "Press Enter to continue..."
      encoder.emit(0x48, 0x8B, 0x4C, 0x24, 0x30);  // mov rcx, [rsp+0x30] (handle)
      encoder.movRegImm64(2, 0);  // RDX = placeholder
      encoder.relocations.push({
        offset: encoder.code.length - 8,
        label: '_press_enter_str',
        type: 'abs64'
      });
      encoder.movRegImm64(3, 27);  // R8 = 27 ("Press Enter to continue..." length)
      encoder.emit(0x4C, 0x8D, 0x4C, 0x24, 0x28);  // lea r9, [rsp+0x28]
      encoder.emit(0x48, 0xC7, 0x44, 0x24, 0x20, 0x00, 0x00, 0x00, 0x00);  // mov qword [rsp+0x20], 0
      encoder.callImport('WriteFile');
      
      // Wait for Enter key using ReadConsoleA
      encoder.movRegImm64(1, -10);  // RCX = STD_INPUT_HANDLE
      encoder.callImport('GetStdHandle');
      encoder.emit(0x48, 0x89, 0xC1);  // mov rcx, rax (handle)
      encoder.emit(0x48, 0x8D, 0x54, 0x24, 0x48);  // lea rdx, [rsp+0x48] (buffer)
      encoder.movRegImm64(3, 2);  // R8 = 2
      encoder.emit(0x4C, 0x8D, 0x4C, 0x24, 0x28);  // lea r9, [rsp+0x28]
      encoder.emit(0x48, 0xC7, 0x44, 0x24, 0x20, 0x00, 0x00, 0x00, 0x00);
      encoder.callImport('ReadConsoleA');
      
      // Restore exit code to RAX for HALT
      encoder.emit(0x48, 0x8B, 0x44, 0x24, 0x40);  // mov rax, [rsp+0x40]
      break;
      
    case 0x04:  // pause_silent - Just wait for Enter, no message
      // Save exit code
      encoder.emit(0x48, 0x89, 0x44, 0x24, 0x40);  // mov [rsp+0x40], rax
      
      // GetStdHandle(-10) for STDIN
      encoder.movRegImm64(1, -10);  // RCX = STD_INPUT_HANDLE
      encoder.callImport('GetStdHandle');
      encoder.emit(0x48, 0x89, 0xC1);  // mov rcx, rax (handle)
      encoder.emit(0x48, 0x8D, 0x54, 0x24, 0x48);  // lea rdx, [rsp+0x48] (buffer)
      encoder.movRegImm64(3, 2);  // R8 = 2
      encoder.emit(0x4C, 0x8D, 0x4C, 0x24, 0x28);  // lea r9, [rsp+0x28]
      encoder.emit(0x48, 0xC7, 0x44, 0x24, 0x20, 0x00, 0x00, 0x00, 0x00);  // mov qword [rsp+0x20], 0
      encoder.callImport('ReadConsoleA');
      
      // Restore exit code
      encoder.emit(0x48, 0x8B, 0x44, 0x24, 0x40);  // mov rax, [rsp+0x40]
      break;
      
    case 0x05:  // print_int - Print integer from r0 (RAX)
      // Save ALL volatile registers that might be needed after this call
      // Aurora r0-r5 = RAX, RCX, RDX, R8, R9, R10 + callee-saved R11, R12, R13, R14, R15
      encoder.emit(0x51);                          // push rcx (r1)
      encoder.emit(0x52);                          // push rdx (r2)
      encoder.emit(0x41, 0x50);                    // push r8 (r3)
      encoder.emit(0x41, 0x51);                    // push r9 (r4)
      encoder.emit(0x41, 0x52);                    // push r10 (r5)
      encoder.emit(0x41, 0x53);                    // push r11
      encoder.emit(0x41, 0x54);                    // push r12
      encoder.emit(0x41, 0x55);                    // push r13
      encoder.emit(0x41, 0x56);                    // push r14
      encoder.emit(0x41, 0x57);                    // push r15
      encoder.emit(0x48, 0x83, 0xEC, 0x48);        // sub rsp, 0x48 (72 bytes: 32 shadow + 24 buffer + 16 align)
      
      // Save original value in safe place (after all pushes)
      encoder.emit(0x49, 0x89, 0xC4);              // mov r12, rax (save print value)
      
      // Get STDOUT handle
      encoder.movRegImm64(1, -11);                 // RCX = STD_OUTPUT_HANDLE (-11)
      encoder.callImport('GetStdHandle');
      encoder.emit(0x48, 0x89, 0x44, 0x24, 0x38);  // mov [rsp+0x38], rax (save handle)
      
      // Prepare for conversion
      encoder.emit(0x4C, 0x89, 0xE0);              // mov rax, r12 (restore value)
      
      // R14 = buffer end pointer at [rsp+0x30+7] = [rsp+0x37]
      encoder.emit(0x4C, 0x8D, 0x74, 0x24, 0x37);  // lea r14, [rsp+0x37]
      encoder.emit(0x41, 0xC6, 0x06, 0x0A);        // mov byte [r14], 0x0A (newline)
      
      // R13 = digit count (1 for newline)
      encoder.emit(0x41, 0xBD, 0x01, 0x00, 0x00, 0x00);  // mov r13d, 1
      
      // R15 = sign flag: 0=positive, 1=negative
      encoder.emit(0x45, 0x31, 0xFF);              // xor r15d, r15d
      encoder.emit(0x48, 0x85, 0xC0);              // test rax, rax
      encoder.emit(0x79, 0x06);                    // jns is_positive (+6 bytes)
      encoder.emit(0x48, 0xF7, 0xD8);              // neg rax
      encoder.emit(0x41, 0xB7, 0x01);              // mov r15b, 1
      
      // is_positive: divisor = 10 in RCX
      encoder.emit(0x48, 0xC7, 0xC1, 0x0A, 0x00, 0x00, 0x00);  // mov rcx, 10
      
      // Loop: divide by 10, store remainder as digit
      const printIntLoopStart5 = encoder.code.length;
      encoder.emit(0x49, 0xFF, 0xCE);              // dec r14
      encoder.emit(0x49, 0xFF, 0xC5);              // inc r13
      encoder.emit(0x48, 0x31, 0xD2);              // xor rdx, rdx
      encoder.emit(0x48, 0xF7, 0xF1);              // div rcx (rax = rax/10, rdx = rax%10)
      encoder.emit(0x48, 0x83, 0xC2, 0x30);        // add rdx, '0'
      encoder.emit(0x41, 0x88, 0x16);              // mov [r14], dl
      encoder.emit(0x48, 0x85, 0xC0);              // test rax, rax
      const printIntLoopOffset5 = printIntLoopStart5 - (encoder.code.length + 2);
      encoder.emit(0x75, printIntLoopOffset5 & 0xFF);  // jnz loop
      
      // Add minus sign if negative
      encoder.emit(0x45, 0x84, 0xFF);              // test r15b, r15b
      encoder.emit(0x74, 0x0A);                    // jz skip_minus (+10 bytes: 3+3+4)
      encoder.emit(0x49, 0xFF, 0xCE);              // dec r14 (3 bytes)
      encoder.emit(0x49, 0xFF, 0xC5);              // inc r13 (3 bytes)
      encoder.emit(0x41, 0xC6, 0x06, 0x2D);        // mov byte [r14], '-' (4 bytes)
      // skip_minus:
      
      // WriteFile(handle, buffer, length, &written, 0)
      encoder.emit(0x48, 0x8B, 0x4C, 0x24, 0x38);  // mov rcx, [rsp+0x38] (handle)
      encoder.emit(0x4C, 0x89, 0xF2);              // mov rdx, r14 (buffer)
      encoder.emit(0x4D, 0x89, 0xE8);              // mov r8, r13 (length)
      encoder.emit(0x4C, 0x8D, 0x4C, 0x24, 0x28);  // lea r9, [rsp+0x28] (written)
      encoder.emit(0x48, 0xC7, 0x44, 0x24, 0x20, 0x00, 0x00, 0x00, 0x00);  // mov qword [rsp+0x20], 0
      encoder.callImport('WriteFile');
      
      // Restore all registers
      encoder.emit(0x48, 0x83, 0xC4, 0x48);        // add rsp, 0x48
      encoder.emit(0x41, 0x5F);                    // pop r15
      encoder.emit(0x41, 0x5E);                    // pop r14
      encoder.emit(0x41, 0x5D);                    // pop r13
      encoder.emit(0x41, 0x5C);                    // pop r12
      encoder.emit(0x41, 0x5B);                    // pop r11
      encoder.emit(0x41, 0x5A);                    // pop r10 (r5)
      encoder.emit(0x41, 0x59);                    // pop r9 (r4)
      encoder.emit(0x41, 0x58);                    // pop r8 (r3)
      encoder.emit(0x5A);                          // pop rdx (r2)
      encoder.emit(0x59);                          // pop rcx (r1)
      break;
      
    case 0x06:  // input_int - Read integer from stdin, return in r0 (RAX)
      // Save callee-saved registers
      encoder.emit(0x41, 0x54);                    // push r12
      encoder.emit(0x41, 0x55);                    // push r13
      encoder.emit(0x48, 0x83, 0xEC, 0x48);        // sub rsp, 0x48 (72 bytes: 32 shadow + 24 buffer + 16 align)
      
      // Get STDIN handle
      encoder.movRegImm64(1, -10);                 // RCX = STD_INPUT_HANDLE
      encoder.callImport('GetStdHandle');
      encoder.emit(0x49, 0x89, 0xC4);              // mov r12, rax (save handle)
      
      // ReadFile(handle, buffer, bufsize, bytesRead, overlapped)
      encoder.emit(0x4C, 0x89, 0xE1);              // mov rcx, r12 (handle)
      encoder.emit(0x48, 0x8D, 0x54, 0x24, 0x30);  // lea rdx, [rsp+0x30] (buffer at 0x30-0x43, 20 bytes)
      encoder.emit(0x41, 0xB8, 0x14, 0x00, 0x00, 0x00);  // mov r8d, 20 (buffer size)
      encoder.emit(0x4C, 0x8D, 0x4C, 0x24, 0x28);  // lea r9, [rsp+0x28] (bytes read)
      encoder.emit(0x48, 0xC7, 0x44, 0x24, 0x20, 0x00, 0x00, 0x00, 0x00);  // mov qword [rsp+0x20], 0 (lpOverlapped)
      encoder.callImport('ReadFile');
      
      // Parse string to integer - buffer at [rsp+0x30]
      encoder.emit(0x48, 0x8D, 0x74, 0x24, 0x30);  // lea rsi, [rsp+0x30]
      encoder.emit(0x48, 0x31, 0xC0);              // xor rax, rax (accumulator = 0)
      encoder.emit(0x45, 0x31, 0xED);              // xor r13d, r13d (negative flag = 0)
      
      // Check for leading minus sign
      encoder.emit(0x48, 0x31, 0xC9);              // xor rcx, rcx
      encoder.emit(0x8A, 0x0E);                    // mov cl, [rsi]
      encoder.emit(0x80, 0xF9, 0x2D);              // cmp cl, '-'
      encoder.emit(0x75, 0x06);                    // jne skip_neg_flag (+6 bytes: 3+3)
      encoder.emit(0x41, 0xB5, 0x01);              // mov r13b, 1 (3 bytes)
      encoder.emit(0x48, 0xFF, 0xC6);              // inc rsi (3 bytes)
      // skip_neg_flag:
      
      // Parse loop - count bytes carefully
      // Loop body: mov cl,[rsi](2) + cmp(3) + jb(2) + cmp(3) + ja(2) + sub(3) + imul(4) + movzx(4) + add(3) + inc(3) + jmp(2) = 31 bytes
      // We need jb to skip rest of loop (after jb) to end_parse
      const inputLoopStart6 = encoder.code.length;
      encoder.emit(0x8A, 0x0E);                    // mov cl, [rsi] (2)
      encoder.emit(0x80, 0xF9, 0x30);              // cmp cl, '0' (3)
      // jb end_parse: skip 3+2+3+4+4+3+3+2 = 24 bytes after this
      encoder.emit(0x72, 0x18);                    // jb end_parse (+24)
      encoder.emit(0x80, 0xF9, 0x39);              // cmp cl, '9' (3)
      // ja end_parse: skip 3+4+4+3+3+2 = 19 bytes after this
      encoder.emit(0x77, 0x13);                    // ja end_parse (+19)
      encoder.emit(0x80, 0xE9, 0x30);              // sub cl, '0' (3)
      encoder.emit(0x48, 0x6B, 0xC0, 0x0A);        // imul rax, rax, 10 (4)
      encoder.emit(0x48, 0x0F, 0xB6, 0xC9);        // movzx rcx, cl (4)
      encoder.emit(0x48, 0x01, 0xC8);              // add rax, rcx (3)
      encoder.emit(0x48, 0xFF, 0xC6);              // inc rsi (3)
      const inputLoopOffset6 = inputLoopStart6 - (encoder.code.length + 2);
      encoder.emit(0xEB, inputLoopOffset6 & 0xFF); // jmp loop (2)
      
      // end_parse: Apply negative if needed
      encoder.emit(0x45, 0x84, 0xED);              // test r13b, r13b
      encoder.emit(0x74, 0x03);                    // jz skip_negate
      encoder.emit(0x48, 0xF7, 0xD8);              // neg rax
      // skip_negate:
      
      // Restore stack and registers - result in RAX
      encoder.emit(0x48, 0x83, 0xC4, 0x48);        // add rsp, 0x48
      encoder.emit(0x41, 0x5D);                    // pop r13
      encoder.emit(0x41, 0x5C);                    // pop r12
      break;
      
    case 0x07:  // print_float - Print float from xmm6 (temp register)
      // Save registers (8 pushes = 64 bytes)
      encoder.emit(0x53);                          // push rbx (callee-saved)
      encoder.emit(0x51);                          // push rcx
      encoder.emit(0x52);                          // push rdx
      encoder.emit(0x41, 0x50);                    // push r8
      encoder.emit(0x41, 0x54);                    // push r12
      encoder.emit(0x41, 0x55);                    // push r13
      encoder.emit(0x41, 0x56);                    // push r14
      encoder.emit(0x41, 0x57);                    // push r15
      // sub rsp, 0x88 = 136 bytes: 32 shadow + 32 buffer + 64 xmm save + 8 scratch
      // 8 pushes (64) + 0x88 (136) = 200 bytes, 200 mod 16 = 8 ✓ (correct for call)
      encoder.emit(0x48, 0x81, 0xEC, 0x88, 0x00, 0x00, 0x00);  // sub rsp, 0x88
      
      // Save xmm0-xmm5 to preserve caller's float variables
      // Layout: [rsp+0x20-0x27] = written, [rsp+0x28-0x3F] = buffer scratch
      //         [rsp+0x40-0x47] = handle, [rsp+0x48-0x4F] = input value
      //         [rsp+0x50-0x57] = xmm0, [rsp+0x58-0x5F] = xmm1
      //         [rsp+0x60-0x67] = xmm2, [rsp+0x68-0x6F] = xmm3
      //         [rsp+0x70-0x77] = xmm4, [rsp+0x78-0x7F] = xmm5
      encoder.emit(0xF2, 0x0F, 0x11, 0x44, 0x24, 0x50);  // movsd [rsp+0x50], xmm0
      encoder.emit(0xF2, 0x0F, 0x11, 0x4C, 0x24, 0x58);  // movsd [rsp+0x58], xmm1
      encoder.emit(0xF2, 0x0F, 0x11, 0x54, 0x24, 0x60);  // movsd [rsp+0x60], xmm2
      encoder.emit(0xF2, 0x0F, 0x11, 0x5C, 0x24, 0x68);  // movsd [rsp+0x68], xmm3
      encoder.emit(0xF2, 0x0F, 0x11, 0x64, 0x24, 0x70);  // movsd [rsp+0x70], xmm4
      encoder.emit(0xF2, 0x0F, 0x11, 0x6C, 0x24, 0x78);  // movsd [rsp+0x78], xmm5
      
      // Copy xmm6 (input) to xmm0 for processing: movsd xmm0, xmm6
      encoder.emit(0xF2, 0x0F, 0x10, 0xC6);
      // Save input value to [rsp+0x48]
      encoder.emit(0xF2, 0x0F, 0x11, 0x44, 0x24, 0x48);  // movsd [rsp+0x48], xmm0
      
      // Get STDOUT handle first
      encoder.movRegImm64(1, -11);
      encoder.callImport('GetStdHandle');
      encoder.emit(0x48, 0x89, 0x44, 0x24, 0x40);  // mov [rsp+0x40], rax (handle)
      
      // Restore xmm0 (the input value): movsd xmm0, [rsp+0x48]
      encoder.emit(0xF2, 0x0F, 0x10, 0x44, 0x24, 0x48);
      
      // Check sign and save in r15
      encoder.emit(0x66, 0x0F, 0x50, 0xC0);        // movmskpd eax, xmm0
      encoder.emit(0x41, 0x89, 0xC7);              // mov r15d, eax
      
      // Make absolute using AND with 0x7FFFFFFFFFFFFFFF
      encoder.emit(0x48, 0xB8, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0x7F);
      encoder.emit(0x48, 0x89, 0x44, 0x24, 0x28);  // mov [rsp+0x28], rax (scratch)
      encoder.emit(0xF2, 0x0F, 0x10, 0x4C, 0x24, 0x28);  // movsd xmm1, [rsp+0x28]
      encoder.emit(0x66, 0x0F, 0x54, 0xC1);        // andpd xmm0, xmm1
      
      // Get integer part: r12 = truncate(xmm0)
      encoder.emit(0xF2, 0x4C, 0x0F, 0x2C, 0xE0);  // cvttsd2si r12, xmm0
      
      // Get fractional: xmm0 = abs_value - int_part
      encoder.emit(0xF2, 0x49, 0x0F, 0x2A, 0xCC);  // cvtsi2sd xmm1, r12
      encoder.emit(0xF2, 0x0F, 0x5C, 0xC1);        // subsd xmm0, xmm1
      
      // Multiply by 1e9 = 0x41CDCD6500000000 (9 decimal places, safe for int64)
      // LE bytes: 00 00 00 00 65 CD CD 41
      encoder.emit(0x48, 0xB8, 0x00, 0x00, 0x00, 0x00, 0x65, 0xCD, 0xCD, 0x41);
      encoder.emit(0x48, 0x89, 0x44, 0x24, 0x28);  // use scratch space at 0x28
      encoder.emit(0xF2, 0x0F, 0x10, 0x4C, 0x24, 0x28);
      encoder.emit(0xF2, 0x0F, 0x59, 0xC1);        // mulsd xmm0, xmm1
      
      // r13 = round(frac * 1e9)
      encoder.emit(0xF2, 0x4C, 0x0F, 0x2D, 0xE8);  // cvtsd2si r13, xmm0
      
      // Buffer at [rsp+0x20] to [rsp+0x3F] = 32 bytes
      // Point r14 at end: [rsp+0x3F]
      encoder.emit(0x4C, 0x8D, 0x74, 0x24, 0x3F);  // lea r14, [rsp+0x3F]
      encoder.emit(0x41, 0xC6, 0x06, 0x0A);        // mov byte [r14], '\n'
      encoder.emit(0xBB, 0x01, 0x00, 0x00, 0x00);  // mov ebx, 1 (char count)
      
      // Write 9 fractional digits
      encoder.emit(0x48, 0xC7, 0xC1, 0x0A, 0x00, 0x00, 0x00);  // mov rcx, 10
      encoder.emit(0x41, 0xB0, 0x09);              // mov r8b, 9
      // frac_loop: 27 bytes total
      const floop = encoder.code.length;
      encoder.emit(0x49, 0xFF, 0xCE);              // dec r14 (3)
      encoder.emit(0xFF, 0xC3);                    // inc ebx (2)
      encoder.emit(0x4C, 0x89, 0xE8);              // mov rax, r13 (3)
      encoder.emit(0x48, 0x31, 0xD2);              // xor rdx, rdx (3)
      encoder.emit(0x48, 0xF7, 0xF1);              // div rcx (3)
      encoder.emit(0x49, 0x89, 0xC5);              // mov r13, rax (3)
      encoder.emit(0x80, 0xC2, 0x30);              // add dl, '0' (3)
      encoder.emit(0x41, 0x88, 0x16);              // mov [r14], dl (3)
      encoder.emit(0x41, 0xFE, 0xC8);              // dec r8b (3)
      const fback = floop - (encoder.code.length + 2);
      encoder.emit(0x75, fback & 0xFF);            // jnz frac_loop (2)
      
      // Decimal point
      encoder.emit(0x49, 0xFF, 0xCE);              // dec r14
      encoder.emit(0xFF, 0xC3);                    // inc ebx
      encoder.emit(0x41, 0xC6, 0x06, 0x2E);        // mov byte [r14], '.'
      
      // Integer part
      encoder.emit(0x4C, 0x89, 0xE0);              // mov rax, r12
      // int_loop: 20 bytes
      const iloop = encoder.code.length;
      encoder.emit(0x49, 0xFF, 0xCE);              // dec r14 (3)
      encoder.emit(0xFF, 0xC3);                    // inc ebx (2)
      encoder.emit(0x48, 0x31, 0xD2);              // xor rdx, rdx (3)
      encoder.emit(0x48, 0xF7, 0xF1);              // div rcx (3)
      encoder.emit(0x80, 0xC2, 0x30);              // add dl, '0' (3)
      encoder.emit(0x41, 0x88, 0x16);              // mov [r14], dl (3)
      encoder.emit(0x48, 0x85, 0xC0);              // test rax, rax (3)
      const iback = iloop - (encoder.code.length + 2);
      encoder.emit(0x75, iback & 0xFF);            // jnz int_loop (2)
      
      // Minus sign if negative
      encoder.emit(0x41, 0xF6, 0xC7, 0x01);        // test r15b, 1 (4)
      encoder.emit(0x74, 0x09);                    // jz skip_sign (+9: 3+2+4)
      encoder.emit(0x49, 0xFF, 0xCE);              // dec r14 (3)
      encoder.emit(0xFF, 0xC3);                    // inc ebx (2)
      encoder.emit(0x41, 0xC6, 0x06, 0x2D);        // mov byte [r14], '-' (4)
      // skip_sign:
      
      // WriteFile(handle, buffer, length, &written, 0)
      encoder.emit(0x48, 0x8B, 0x4C, 0x24, 0x40);  // mov rcx, [rsp+0x40] (handle)
      encoder.emit(0x4C, 0x89, 0xF2);              // mov rdx, r14 (buffer)
      encoder.emit(0x41, 0x89, 0xD8);              // mov r8d, ebx (length)
      encoder.emit(0x4C, 0x8D, 0x4C, 0x24, 0x20);  // lea r9, [rsp+0x20] (&written)
      encoder.emit(0x48, 0xC7, 0x44, 0x24, 0x20, 0x00, 0x00, 0x00, 0x00);
      encoder.callImport('WriteFile');
      
      // Restore xmm0-xmm5 (caller's float variables)
      encoder.emit(0xF2, 0x0F, 0x10, 0x44, 0x24, 0x50);  // movsd xmm0, [rsp+0x50]
      encoder.emit(0xF2, 0x0F, 0x10, 0x4C, 0x24, 0x58);  // movsd xmm1, [rsp+0x58]
      encoder.emit(0xF2, 0x0F, 0x10, 0x54, 0x24, 0x60);  // movsd xmm2, [rsp+0x60]
      encoder.emit(0xF2, 0x0F, 0x10, 0x5C, 0x24, 0x68);  // movsd xmm3, [rsp+0x68]
      encoder.emit(0xF2, 0x0F, 0x10, 0x64, 0x24, 0x70);  // movsd xmm4, [rsp+0x70]
      encoder.emit(0xF2, 0x0F, 0x10, 0x6C, 0x24, 0x78);  // movsd xmm5, [rsp+0x78]
      
      // Restore all GP registers (8 pops to match 8 pushes)
      encoder.emit(0x48, 0x81, 0xC4, 0x88, 0x00, 0x00, 0x00);  // add rsp, 0x88
      encoder.emit(0x41, 0x5F);                    // pop r15
      encoder.emit(0x41, 0x5E);                    // pop r14
      encoder.emit(0x41, 0x5D);                    // pop r13
      encoder.emit(0x41, 0x5C);                    // pop r12
      encoder.emit(0x41, 0x58);                    // pop r8
      encoder.emit(0x5A);                          // pop rdx
      encoder.emit(0x59);                          // pop rcx
      encoder.emit(0x5B);                          // pop rbx
      break;
      
    default:
      encoder.emit(0x90);  // NOP
  }
}

// Compile manifest to Windows PE
function compileManifestToWindows(manifestContent, options = {}) {
  const level = options.debugLevel || DEBUG_LEVEL.NONE;
  
  debugBasic('Parsing manifest...');
  const manifest = parseManifest(manifestContent);
  debugBasic(`Found ${manifest.instructions.length} instructions, ${manifest.strings.size} strings, ${manifest.labels.size} labels`);
  if (manifest.sharedVars && manifest.sharedVars.size > 0) {
    debugBasic(`Found ${manifest.sharedVars.size} shared variables`);
  }
  
  // Compile to Windows x64
  debugBasic('Compiling to x64...');
  const { encoder, stringLengths } = compileToWindows(manifest, { debugLevel: level });
  
  // Add builtin strings for pause functionality
  encoder.dataLabels.set('_exit_code_str', encoder.dataSection.length);
  const exitCodeStr = 'Exit code: ';
  for (let i = 0; i < exitCodeStr.length; i++) {
    encoder.dataSection.push(exitCodeStr.charCodeAt(i));
  }
  encoder.dataSection.push(0);  // null terminator
  
  encoder.dataLabels.set('_press_enter_str', encoder.dataSection.length);
  const pressEnterStr = 'Press Enter to continue...';
  for (let i = 0; i < pressEnterStr.length; i++) {
    encoder.dataSection.push(pressEnterStr.charCodeAt(i));
  }
  encoder.dataSection.push(0);  // null terminator
  
  // Generate PE64
  debugBasic('Generating PE64...');
  const peGen = new PE64Generator();
  
  // Build import data - include all required Windows API functions
  const importFunctions = [
    'ExitProcess', 
    'GetStdHandle', 
    'WriteFile', 
    'ReadFile',
    'ReadConsoleA',
    'CreateThread',
    'WaitForSingleObject',
    'CloseHandle'
  ];
  
  const importData = peGen.buildImportData({
    'kernel32.dll': importFunctions
  });
  
  // Set up import addresses for the encoder
  for (const func of importFunctions) {
    encoder.setImport(func, Number(peGen.imageBase) + importData.functionOffsets[func]);
  }
  
  // Resolve relocations
  debugBasic('Resolving relocations...');
  encoder.resolve(
    peGen.textAddr,
    peGen.dataAddr,
    Number(peGen.imageBase) + peGen.rdataRVA,
    level >= DEBUG_LEVEL.TRACE  // Enable encoder debug at trace level
  );
  
  // Get code and data
  const code = encoder.getCode();
  const data = encoder.getData();
  
  debugBasic(`Code size: ${code.length} bytes`);
  debugBasic(`Data size: ${data.length} bytes`);
  
  if (level >= DEBUG_LEVEL.TRACE) {
    debugTrace('Code hex dump (first 256 bytes):');
    const hexDump = Buffer.from(code.slice(0, 256)).toString('hex').match(/.{1,32}/g);
    hexDump?.forEach((line, i) => debugTrace(`  ${(i*16).toString(16).padStart(4, '0')}: ${line}`));
  }
  
  // Generate PE
  return peGen.generate(code, data, {
    'kernel32.dll': importFunctions
  });
}

// Main compilation function
function compile(inputPath, outputPath, options = {}) {
  const level = options.debugLevel || DEBUG_LEVEL.NONE;
  
  if (level >= DEBUG_LEVEL.BASIC) {
    console.log(`[aurora-win] compiling ${inputPath}...`);
    console.log(`[aurora-win] debug level: ${level}`);
  } else {
    console.log(`[aurora-win] compiling ${inputPath}...`);
  }
  
  const content = fs.readFileSync(inputPath, 'utf8');
  const peBuffer = compileManifestToWindows(content, { debugLevel: level });
  
  fs.writeFileSync(outputPath, peBuffer);
  console.log(`[aurora-win] wrote executable to ${outputPath} (${peBuffer.length} bytes)`);
}

// Parse debug level from string
function parseDebugLevel(value) {
  if (value === undefined || value === true || value === '') {
    return DEBUG_LEVEL.BASIC;  // --debug without value means basic
  }
  const num = parseInt(value, 10);
  if (isNaN(num)) {
    // Try parsing as level name
    const upper = String(value).toUpperCase();
    if (DEBUG_LEVEL.hasOwnProperty(upper)) {
      return DEBUG_LEVEL[upper];
    }
    return DEBUG_LEVEL.BASIC;
  }
  return Math.max(0, Math.min(num, DEBUG_LEVEL.TRACE));
}

// CLI interface
if (require.main === module) {
  const args = process.argv.slice(2);
  
  // Parse options
  let inputPath = null;
  let outputPath = null;
  let cliDebugLevel = DEBUG_LEVEL.NONE;
  
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    
    if (arg === '-o' && i + 1 < args.length) {
      outputPath = args[++i];
    } else if (arg === '--debug') {
      cliDebugLevel = DEBUG_LEVEL.BASIC;
    } else if (arg.startsWith('--debug=')) {
      cliDebugLevel = parseDebugLevel(arg.substring(8));
    } else if (arg === '-d') {
      cliDebugLevel = DEBUG_LEVEL.BASIC;
    } else if (arg.startsWith('-d') && arg.length === 3) {
      // -d1, -d2, -d3
      cliDebugLevel = parseDebugLevel(arg.substring(2));
    } else if (arg === '--help' || arg === '-h') {
      console.log('Aurora Native Compiler for Windows x64');
      console.log('');
      console.log('Usage: node native_compiler_win.js <input.aurs> -o <output.exe> [options]');
      console.log('');
      console.log('Options:');
      console.log('  -o <file>      Output executable path');
      console.log('  --debug, -d    Enable basic debug output (level 1)');
      console.log('  --debug=N      Set debug level (0=none, 1=basic, 2=verbose, 3=trace)');
      console.log('  -dN            Short form for debug level (e.g., -d2)');
      console.log('  --help, -h     Show this help');
      console.log('');
      console.log('Debug Levels:');
      console.log('  0 (none)     - No debug output');
      console.log('  1 (basic)    - Compilation phases, function names');
      console.log('  2 (verbose)  - Instruction-level output');
      console.log('  3 (trace)    - Full trace with hex dumps');
      process.exit(0);
    } else if (!inputPath && !arg.startsWith('-')) {
      inputPath = arg;
    }
  }
  
  // Set global debug level
  debugLevel = cliDebugLevel;
  
  if (!inputPath || !outputPath) {
    console.log('Usage: node native_compiler_win.js <input.aurs> -o <output.exe> [--debug[=N]]');
    console.log('Use --help for more options.');
    process.exit(1);
  }
  
  try {
    compile(inputPath, outputPath, { debugLevel: cliDebugLevel });
  } catch (err) {
    console.error(`[aurora-win] error: ${err.message}`);
    console.error(err.stack);
    process.exit(1);
  }
}

module.exports = { compile, compileManifestToWindows, parseManifest, DEBUG_LEVEL };
