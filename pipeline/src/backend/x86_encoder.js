/**
 * Aurora x86-64 Backend
 * 
 * Compiles Aurora ISA instructions to x86-64 machine code.
 * Generates ELF64 executables for Linux.
 * 
 * Aurora ISA to x86-64 mapping:
 * - MOV (0x01) -> mov reg, imm64 / mov reg, reg
 * - ADD (0x04) -> add reg, reg / add reg, imm32
 * - SUB (0x05) -> sub reg, reg / sub reg, imm32
 * - MUL (0x0D) -> imul reg, reg
 * - DIV (0x0E) -> idiv (uses rax/rdx)
 * - CMP (0x06) -> cmp reg, reg / cmp reg, imm32
 * - JMP (0x07) -> jmp rel32
 * - CJMP (0x08) -> jcc rel32
 * - CALL (0x09) -> call rel32
 * - RET (0x0A) -> ret
 * - SVC (0x0B) -> syscall (Linux)
 * 
 * Register mapping (Aurora -> x86-64):
 * r0 -> rax (return value, syscall number)
 * r1 -> rdi (first arg)
 * r2 -> rsi (second arg)
 * r3 -> rdx (third arg)
 * r4 -> rcx
 * r5 -> r8
 * r6 -> r9  (temp)
 * r7 -> r10 (temp)
 */

const fs = require('fs');

// Aurora ISA opcodes
const OPCODE = {
  NOP: 0x00,
  MOV: 0x01,
  PUSH: 0x02,   // Push register to stack (for spilling)
  POP: 0x03,    // Pop from stack to register
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
  STORE_STACK: 0x16,  // Store reg to [RSP+offset]
  LOAD_STACK: 0x17,   // Load reg from [RSP+offset]
};

// CJMP condition codes
const COND = {
  EQ: 0x01,  // je
  NEQ: 0x02, // jne
  LT: 0x03,  // jl
  LEQ: 0x04, // jle
  GT: 0x05,  // jg
  GEQ: 0x06, // jge
};

// Aurora register to x86-64 register encoding
const REG_MAP = {
  0: 0,   // r0 -> rax
  1: 7,   // r1 -> rdi
  2: 6,   // r2 -> rsi
  3: 2,   // r3 -> rdx
  4: 1,   // r4 -> rcx
  5: 8,   // r5 -> r8
  6: 9,   // r6 -> r9
  7: 10,  // r7 -> r10
};

// x86-64 instruction encoding helpers
class X86Encoder {
  constructor() {
    this.code = [];
    this.labels = new Map();      // label name -> offset
    this.relocations = [];        // {offset, label, type}
    this.dataSection = [];
    this.dataLabels = new Map();  // label name -> data offset
  }
  
  // REX prefix for 64-bit operations
  rex(w = 1, r = 0, x = 0, b = 0) {
    return 0x40 | (w << 3) | (r << 2) | (x << 1) | b;
  }
  
  // ModR/M byte
  modrm(mod, reg, rm) {
    return (mod << 6) | ((reg & 7) << 3) | (rm & 7);
  }
  
  // Emit bytes
  emit(...bytes) {
    for (const b of bytes) {
      this.code.push(b & 0xFF);
    }
  }
  
  // Emit 32-bit immediate (little-endian)
  emitImm32(value) {
    this.emit(
      value & 0xFF,
      (value >> 8) & 0xFF,
      (value >> 16) & 0xFF,
      (value >> 24) & 0xFF
    );
  }
  
  // Emit 64-bit immediate (little-endian)
  emitImm64(value) {
    // Handle BigInt or number
    const v = BigInt(value);
    for (let i = 0; i < 8; i++) {
      this.emit(Number((v >> BigInt(i * 8)) & 0xFFn));
    }
  }
  
  // Record label at current offset
  label(name) {
    this.labels.set(name, this.code.length);
  }
  
  // Record relocation for later patching
  relocation(label, type = 'rel32') {
    this.relocations.push({
      offset: this.code.length,
      label,
      type
    });
    // Emit placeholder
    if (type === 'rel32') {
      this.emitImm32(0);
    }
  }
  
  // MOV reg, imm64
  movRegImm64(reg, imm) {
    const r = REG_MAP[reg];
    // REX.W + B8+rd + imm64
    this.emit(this.rex(1, 0, 0, r >= 8 ? 1 : 0));
    this.emit(0xB8 + (r & 7));
    this.emitImm64(imm);
  }
  
  // MOV reg, reg
  movRegReg(dst, src) {
    const d = REG_MAP[dst];
    const s = REG_MAP[src];
    // REX.W + 89 /r (mov r/m64, r64)
    this.emit(this.rex(1, s >= 8 ? 1 : 0, 0, d >= 8 ? 1 : 0));
    this.emit(0x89);
    this.emit(this.modrm(3, s, d));
  }
  
  // ADD reg, reg
  addRegReg(dst, src) {
    const d = REG_MAP[dst];
    const s = REG_MAP[src];
    // REX.W + 01 /r
    this.emit(this.rex(1, s >= 8 ? 1 : 0, 0, d >= 8 ? 1 : 0));
    this.emit(0x01);
    this.emit(this.modrm(3, s, d));
  }
  
  // ADD reg, imm32
  addRegImm32(reg, imm) {
    const r = REG_MAP[reg];
    // REX.W + 81 /0 id
    this.emit(this.rex(1, 0, 0, r >= 8 ? 1 : 0));
    this.emit(0x81);
    this.emit(this.modrm(3, 0, r));
    this.emitImm32(imm);
  }
  
  // SUB reg, reg
  subRegReg(dst, src) {
    const d = REG_MAP[dst];
    const s = REG_MAP[src];
    // REX.W + 29 /r
    this.emit(this.rex(1, s >= 8 ? 1 : 0, 0, d >= 8 ? 1 : 0));
    this.emit(0x29);
    this.emit(this.modrm(3, s, d));
  }
  
  // SUB reg, imm32
  subRegImm32(reg, imm) {
    const r = REG_MAP[reg];
    // REX.W + 81 /5 id
    this.emit(this.rex(1, 0, 0, r >= 8 ? 1 : 0));
    this.emit(0x81);
    this.emit(this.modrm(3, 5, r));
    this.emitImm32(imm);
  }
  
  // IMUL reg, reg (result in first reg)
  imulRegReg(dst, src) {
    const d = REG_MAP[dst];
    const s = REG_MAP[src];
    // REX.W + 0F AF /r
    this.emit(this.rex(1, d >= 8 ? 1 : 0, 0, s >= 8 ? 1 : 0));
    this.emit(0x0F, 0xAF);
    this.emit(this.modrm(3, d, s));
  }
  
  // IMUL reg, imm32 (three-operand form: dst = src * imm)
  imulRegImm32(dst, src, imm) {
    const d = REG_MAP[dst];
    const s = REG_MAP[src];
    // REX.W + 69 /r id
    this.emit(this.rex(1, d >= 8 ? 1 : 0, 0, s >= 8 ? 1 : 0));
    this.emit(0x69);
    this.emit(this.modrm(3, d, s));
    this.emitImm32(imm);
  }
  
  // CMP reg, reg
  cmpRegReg(lhs, rhs) {
    const l = REG_MAP[lhs];
    const r = REG_MAP[rhs];
    // REX.W + 39 /r
    this.emit(this.rex(1, r >= 8 ? 1 : 0, 0, l >= 8 ? 1 : 0));
    this.emit(0x39);
    this.emit(this.modrm(3, r, l));
  }
  
  // CMP reg, imm32
  cmpRegImm32(reg, imm) {
    const r = REG_MAP[reg];
    // REX.W + 81 /7 id
    this.emit(this.rex(1, 0, 0, r >= 8 ? 1 : 0));
    this.emit(0x81);
    this.emit(this.modrm(3, 7, r));
    this.emitImm32(imm);
  }
  
  // JMP rel32
  jmpRel32(label) {
    // E9 cd
    this.emit(0xE9);
    this.relocation(label, 'rel32');
  }
  
  // Jcc rel32 (conditional jump)
  jccRel32(cond, label) {
    // 0F 8x cd
    const opcodes = {
      [COND.EQ]: 0x84,   // je
      [COND.NEQ]: 0x85,  // jne
      [COND.LT]: 0x8C,   // jl
      [COND.LEQ]: 0x8E,  // jle
      [COND.GT]: 0x8F,   // jg
      [COND.GEQ]: 0x8D,  // jge
    };
    this.emit(0x0F, opcodes[cond]);
    this.relocation(label, 'rel32');
  }
  
  // CALL rel32
  callRel32(label) {
    // E8 cd
    this.emit(0xE8);
    this.relocation(label, 'rel32');
  }
  
  // RET
  ret() {
    this.emit(0xC3);
  }
  
  // SYSCALL
  syscall() {
    this.emit(0x0F, 0x05);
  }
  
  // AND reg, reg
  andRegReg(dst, src) {
    const d = REG_MAP[dst];
    const s = REG_MAP[src];
    // REX.W + 21 /r
    this.emit(this.rex(1, s >= 8 ? 1 : 0, 0, d >= 8 ? 1 : 0));
    this.emit(0x21);
    this.emit(this.modrm(3, s, d));
  }
  
  // AND reg, imm32
  andRegImm32(reg, imm) {
    const r = REG_MAP[reg];
    // REX.W + 81 /4 id
    this.emit(this.rex(1, 0, 0, r >= 8 ? 1 : 0));
    this.emit(0x81);
    this.emit(this.modrm(3, 4, r));
    this.emitImm32(imm);
  }
  
  // OR reg, reg
  orRegReg(dst, src) {
    const d = REG_MAP[dst];
    const s = REG_MAP[src];
    // REX.W + 09 /r
    this.emit(this.rex(1, s >= 8 ? 1 : 0, 0, d >= 8 ? 1 : 0));
    this.emit(0x09);
    this.emit(this.modrm(3, s, d));
  }
  
  // OR reg, imm32
  orRegImm32(reg, imm) {
    const r = REG_MAP[reg];
    // REX.W + 81 /1 id
    this.emit(this.rex(1, 0, 0, r >= 8 ? 1 : 0));
    this.emit(0x81);
    this.emit(this.modrm(3, 1, r));
    this.emitImm32(imm);
  }
  
  // XOR reg, reg
  xorRegReg(dst, src) {
    const d = REG_MAP[dst];
    const s = REG_MAP[src];
    // REX.W + 31 /r
    this.emit(this.rex(1, s >= 8 ? 1 : 0, 0, d >= 8 ? 1 : 0));
    this.emit(0x31);
    this.emit(this.modrm(3, s, d));
  }
  
  // XOR reg, imm32
  xorRegImm32(reg, imm) {
    const r = REG_MAP[reg];
    // REX.W + 81 /6 id
    this.emit(this.rex(1, 0, 0, r >= 8 ? 1 : 0));
    this.emit(0x81);
    this.emit(this.modrm(3, 6, r));
    this.emitImm32(imm);
  }
  
  // SHL reg, imm8
  shlRegImm8(reg, imm) {
    const r = REG_MAP[reg];
    // REX.W + C1 /4 ib
    this.emit(this.rex(1, 0, 0, r >= 8 ? 1 : 0));
    this.emit(0xC1);
    this.emit(this.modrm(3, 4, r));
    this.emit(imm & 0x3F);
  }
  
  // SHR reg, imm8
  shrRegImm8(reg, imm) {
    const r = REG_MAP[reg];
    // REX.W + C1 /5 ib
    this.emit(this.rex(1, 0, 0, r >= 8 ? 1 : 0));
    this.emit(0xC1);
    this.emit(this.modrm(3, 5, r));
    this.emit(imm & 0x3F);
  }
  
  // PUSH reg
  pushReg(reg) {
    const r = REG_MAP[reg];
    if (r >= 8) {
      this.emit(0x41); // REX.B
    }
    this.emit(0x50 + (r & 7));
  }
  
  // POP reg
  popReg(reg) {
    const r = REG_MAP[reg];
    if (r >= 8) {
      this.emit(0x41); // REX.B
    }
    this.emit(0x58 + (r & 7));
  }
  
  // MOV [RSP+offset], reg - Store register to stack
  movStackReg(offset, srcReg) {
    const src = REG_MAP[srcReg];
    // REX.W + 89 /r with SIB for RSP-based addressing
    // MOV [RSP+disp8/32], reg
    this.emit(this.rex(1, src >= 8 ? 1 : 0, 0, 0));
    this.emit(0x89);
    
    if (offset === 0) {
      // [RSP] requires SIB byte: mod=00, rm=100, SIB=24 (base=RSP, index=none)
      this.emit(this.modrm(0, src & 7, 4));
      this.emit(0x24); // SIB: scale=0, index=RSP(none), base=RSP
    } else if (offset >= -128 && offset <= 127) {
      // [RSP+disp8] requires SIB byte
      this.emit(this.modrm(1, src & 7, 4));
      this.emit(0x24); // SIB
      this.emit(offset & 0xFF);
    } else {
      // [RSP+disp32] requires SIB byte
      this.emit(this.modrm(2, src & 7, 4));
      this.emit(0x24); // SIB
      this.emit(offset & 0xFF);
      this.emit((offset >> 8) & 0xFF);
      this.emit((offset >> 16) & 0xFF);
      this.emit((offset >> 24) & 0xFF);
    }
  }
  
  // MOV reg, [RSP+offset] - Load register from stack
  movRegStack(destReg, offset) {
    const dest = REG_MAP[destReg];
    // REX.W + 8B /r with SIB for RSP-based addressing
    this.emit(this.rex(1, dest >= 8 ? 1 : 0, 0, 0));
    this.emit(0x8B);
    
    if (offset === 0) {
      this.emit(this.modrm(0, dest & 7, 4));
      this.emit(0x24); // SIB
    } else if (offset >= -128 && offset <= 127) {
      this.emit(this.modrm(1, dest & 7, 4));
      this.emit(0x24); // SIB
      this.emit(offset & 0xFF);
    } else {
      this.emit(this.modrm(2, dest & 7, 4));
      this.emit(0x24); // SIB
      this.emit(offset & 0xFF);
      this.emit((offset >> 8) & 0xFF);
      this.emit((offset >> 16) & 0xFF);
      this.emit((offset >> 24) & 0xFF);
    }
  }
  
  // IDIV - Signed divide RDX:RAX by reg, quotient in RAX, remainder in RDX
  // destAurora = destAurora / divisorAurora
  idivReg(destAurora, divisorAurora) {
    const destX86 = REG_MAP[destAurora];
    const divisorX86 = REG_MAP[divisorAurora];
    
    // We need:
    // 1. RAX = dividend (destAurora)
    // 2. RDX = 0 (sign extended, but we use 0 for unsigned-like behavior)
    // 3. IDIV divisor
    // 4. Result (quotient) in RAX -> move to dest
    
    // Use R11 as temp to avoid conflicts
    const R11 = 11;
    
    // Save divisor to R11 if it would be clobbered
    if (divisorX86 === 0 || divisorX86 === 2) { // RAX or RDX
      // MOV R11, divisor
      this.emit(this.rex(1, 1, 0, divisorX86 >= 8 ? 1 : 0));
      this.emit(0x8B);
      this.emit(this.modrm(3, R11 & 7, divisorX86 & 7));
    }
    
    // MOV RAX, dest (if not already RAX)
    if (destX86 !== 0) {
      this.emit(this.rex(1, 0, 0, destX86 >= 8 ? 1 : 0));
      this.emit(0x8B);
      this.emit(this.modrm(3, 0, destX86 & 7));
    }
    
    // XOR RDX, RDX (clear for unsigned division)
    this.emit(0x48);
    this.emit(0x31);
    this.emit(0xD2);
    
    // IDIV (divisor or R11)
    let actualDivisor = divisorX86;
    if (divisorX86 === 0 || divisorX86 === 2) {
      actualDivisor = R11;
    }
    
    // REX.W + F7 /7
    this.emit(this.rex(1, 0, 0, actualDivisor >= 8 ? 1 : 0));
    this.emit(0xF7);
    this.emit(this.modrm(3, 7, actualDivisor & 7));
    
    // MOV dest, RAX (if dest is not RAX)
    if (destX86 !== 0) {
      this.emit(this.rex(1, destX86 >= 8 ? 1 : 0, 0, 0));
      this.emit(0x8B);
      this.emit(this.modrm(3, destX86 & 7, 0));
    }
  }
  
  // IREM - Signed remainder: destAurora = destAurora % divisorAurora
  iremReg(destAurora, divisorAurora) {
    const destX86 = REG_MAP[destAurora];
    const divisorX86 = REG_MAP[divisorAurora];
    
    const R11 = 11;
    
    // Save divisor to R11 if it would be clobbered
    if (divisorX86 === 0 || divisorX86 === 2) {
      this.emit(this.rex(1, 1, 0, divisorX86 >= 8 ? 1 : 0));
      this.emit(0x8B);
      this.emit(this.modrm(3, R11 & 7, divisorX86 & 7));
    }
    
    // MOV RAX, dest
    if (destX86 !== 0) {
      this.emit(this.rex(1, 0, 0, destX86 >= 8 ? 1 : 0));
      this.emit(0x8B);
      this.emit(this.modrm(3, 0, destX86 & 7));
    }
    
    // XOR RDX, RDX
    this.emit(0x48);
    this.emit(0x31);
    this.emit(0xD2);
    
    // IDIV
    let actualDivisor = divisorX86;
    if (divisorX86 === 0 || divisorX86 === 2) {
      actualDivisor = R11;
    }
    
    this.emit(this.rex(1, 0, 0, actualDivisor >= 8 ? 1 : 0));
    this.emit(0xF7);
    this.emit(this.modrm(3, 7, actualDivisor & 7));
    
    // MOV dest, RDX (remainder is in RDX)
    if (destX86 !== 2) {
      this.emit(this.rex(1, destX86 >= 8 ? 1 : 0, 0, 0));
      this.emit(0x8B);
      this.emit(this.modrm(3, destX86 & 7, 2)); // src = RDX
    }
  }
  
  // Add string to data section, return label
  addString(str) {
    const label = `_str_${this.dataLabels.size}`;
    this.dataLabels.set(label, this.dataSection.length);
    for (let i = 0; i < str.length; i++) {
      this.dataSection.push(str.charCodeAt(i));
    }
    this.dataSection.push(0); // null terminator
    return label;
  }
  
  // Resolve all relocations
  resolve(codeBase, dataBase) {
    for (const reloc of this.relocations) {
      let target;
      if (this.labels.has(reloc.label)) {
        target = codeBase + this.labels.get(reloc.label);
      } else if (this.dataLabels.has(reloc.label)) {
        target = dataBase + this.dataLabels.get(reloc.label);
      } else {
        throw new Error(`Undefined label: ${reloc.label}`);
      }
      
      if (reloc.type === 'rel32') {
        // Calculate relative offset (from end of instruction)
        const from = codeBase + reloc.offset + 4;
        const rel = target - from;
        
        // Patch the placeholder
        this.code[reloc.offset] = rel & 0xFF;
        this.code[reloc.offset + 1] = (rel >> 8) & 0xFF;
        this.code[reloc.offset + 2] = (rel >> 16) & 0xFF;
        this.code[reloc.offset + 3] = (rel >> 24) & 0xFF;
      }
    }
  }
  
  getCode() {
    return Buffer.from(this.code);
  }
  
  getData() {
    return Buffer.from(this.dataSection);
  }
}

module.exports = { X86Encoder, OPCODE, COND, REG_MAP };
