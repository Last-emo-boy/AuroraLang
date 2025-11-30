/**
 * x86-64 Encoder for Windows (Win64 ABI)
 * 
 * Windows x64 calling convention:
 *   - First 4 integer args: RCX, RDX, R8, R9
 *   - Return value: RAX
 *   - Caller allocates shadow space (32 bytes) before call
 *   - Stack must be 16-byte aligned before CALL instruction
 * 
 * Register mapping for Aurora on Windows:
 *   r0 -> RAX (return value)
 *   r1 -> RCX (1st arg / general)
 *   r2 -> RDX (2nd arg / general)
 *   r3 -> R8  (3rd arg / general)
 *   r4 -> R9  (4th arg / general)
 *   r5 -> R10 (general)
 *   r6 -> R11 (temp)
 *   r7 -> RBX (temp, callee-saved)
 */

// x86-64 register encoding for Windows
const WIN64_REG = {
  RAX: 0,
  RCX: 1,
  RDX: 2,
  RBX: 3,
  RSP: 4,
  RBP: 5,
  RSI: 6,
  RDI: 7,
  R8:  8,
  R9:  9,
  R10: 10,
  R11: 11,
  R12: 12,
  R13: 13,
  R14: 14,
  R15: 15,
};

// Aurora register to Windows x64 register mapping
const AURORA_TO_WIN64 = [
  WIN64_REG.RAX,  // r0 -> RAX (return value)
  WIN64_REG.RCX,  // r1 -> RCX (1st arg)
  WIN64_REG.RDX,  // r2 -> RDX (2nd arg)
  WIN64_REG.R8,   // r3 -> R8  (3rd arg)
  WIN64_REG.R9,   // r4 -> R9  (4th arg)
  WIN64_REG.R10,  // r5 -> R10 (general)
  WIN64_REG.R11,  // r6 -> R11 (temp)
  WIN64_REG.RBX,  // r7 -> RBX (callee-saved temp)
];

class X86EncoderWin64 {
  constructor() {
    this.code = [];
    this.labels = new Map();
    this.relocations = [];
    this.dataSection = [];
    this.dataLabels = new Map();
    this.imports = new Map();  // Map import name to IAT offset
  }
  
  // Map Aurora register to Windows x64 register
  mapReg(auroraReg) {
    if (auroraReg < 0 || auroraReg > 7) {
      throw new Error(`Invalid Aurora register: r${auroraReg}`);
    }
    return AURORA_TO_WIN64[auroraReg];
  }
  
  // Emit raw bytes
  emit(...bytes) {
    this.code.push(...bytes);
  }
  
  // Get REX prefix for 64-bit operations
  rex(w, r, x, b) {
    return 0x40 | (w ? 8 : 0) | (r ? 4 : 0) | (x ? 2 : 0) | (b ? 1 : 0);
  }
  
  // Get ModR/M byte
  modrm(mod, reg, rm) {
    return ((mod & 3) << 6) | ((reg & 7) << 3) | (rm & 7);
  }
  
  // ========================
  // MOV Instructions
  // ========================
  
  // MOV reg, imm64
  movRegImm64(destAurora, imm64) {
    const dest = this.mapReg(destAurora);
    const rexByte = this.rex(1, 0, 0, dest >= 8);
    this.emit(rexByte);
    this.emit(0xB8 + (dest & 7));  // MOV r64, imm64
    // Write 64-bit immediate
    const value = BigInt(imm64);
    for (let i = 0; i < 8; i++) {
      this.emit(Number((value >> BigInt(i * 8)) & 0xFFn));
    }
  }
  
  // MOV reg, reg
  movRegReg(destAurora, srcAurora) {
    const dest = this.mapReg(destAurora);
    const src = this.mapReg(srcAurora);
    const rexByte = this.rex(1, src >= 8, 0, dest >= 8);
    this.emit(rexByte);
    this.emit(0x89);  // MOV r/m64, r64
    this.emit(this.modrm(3, src & 7, dest & 7));
  }
  
  // ========================
  // Arithmetic Instructions
  // ========================
  
  // ADD reg, reg
  addRegReg(destAurora, srcAurora) {
    const dest = this.mapReg(destAurora);
    const src = this.mapReg(srcAurora);
    const rexByte = this.rex(1, src >= 8, 0, dest >= 8);
    this.emit(rexByte);
    this.emit(0x01);  // ADD r/m64, r64
    this.emit(this.modrm(3, src & 7, dest & 7));
  }
  
  // ADD reg, imm32
  addRegImm32(destAurora, imm32) {
    const dest = this.mapReg(destAurora);
    const rexByte = this.rex(1, 0, 0, dest >= 8);
    this.emit(rexByte);
    if (imm32 >= -128 && imm32 <= 127) {
      this.emit(0x83);  // ADD r/m64, imm8
      this.emit(this.modrm(3, 0, dest & 7));
      this.emit(imm32 & 0xFF);
    } else {
      this.emit(0x81);  // ADD r/m64, imm32
      this.emit(this.modrm(3, 0, dest & 7));
      this.emitImm32(imm32);
    }
  }
  
  // SUB reg, reg
  subRegReg(destAurora, srcAurora) {
    const dest = this.mapReg(destAurora);
    const src = this.mapReg(srcAurora);
    const rexByte = this.rex(1, src >= 8, 0, dest >= 8);
    this.emit(rexByte);
    this.emit(0x29);  // SUB r/m64, r64
    this.emit(this.modrm(3, src & 7, dest & 7));
  }
  
  // SUB reg, imm32
  subRegImm32(destAurora, imm32) {
    const dest = this.mapReg(destAurora);
    const rexByte = this.rex(1, 0, 0, dest >= 8);
    this.emit(rexByte);
    if (imm32 >= -128 && imm32 <= 127) {
      this.emit(0x83);  // SUB r/m64, imm8
      this.emit(this.modrm(3, 5, dest & 7));
      this.emit(imm32 & 0xFF);
    } else {
      this.emit(0x81);  // SUB r/m64, imm32
      this.emit(this.modrm(3, 5, dest & 7));
      this.emitImm32(imm32);
    }
  }
  
  // IMUL reg, reg
  imulRegReg(destAurora, srcAurora) {
    const dest = this.mapReg(destAurora);
    const src = this.mapReg(srcAurora);
    const rexByte = this.rex(1, dest >= 8, 0, src >= 8);
    this.emit(rexByte);
    this.emit(0x0F, 0xAF);  // IMUL r64, r/m64
    this.emit(this.modrm(3, dest & 7, src & 7));
  }
  
  // IMUL reg, reg, imm32
  imulRegImm32(destAurora, srcAurora, imm32) {
    const dest = this.mapReg(destAurora);
    const src = this.mapReg(srcAurora);
    const rexByte = this.rex(1, dest >= 8, 0, src >= 8);
    this.emit(rexByte);
    if (imm32 >= -128 && imm32 <= 127) {
      this.emit(0x6B);  // IMUL r64, r/m64, imm8
      this.emit(this.modrm(3, dest & 7, src & 7));
      this.emit(imm32 & 0xFF);
    } else {
      this.emit(0x69);  // IMUL r64, r/m64, imm32
      this.emit(this.modrm(3, dest & 7, src & 7));
      this.emitImm32(imm32);
    }
  }
  
  // IDIV - Signed division: RAX = RDX:RAX / divisor, RDX = remainder
  // destAurora receives quotient, divisorAurora is the divisor
  // Caller must ensure dividend is in destAurora (moved to RAX)
  idivReg(destAurora, divisorAurora) {
    const dest = this.mapReg(destAurora);
    const divisor = this.mapReg(divisorAurora);
    
    // Choose a temp register that's not dest, divisor, RAX, or RDX
    // Options: RBX(3), RSI(6), RDI(7), R10(10), R11(11), etc.
    let tempReg = WIN64_REG.R10;  // Default to R10
    if (dest === WIN64_REG.R10 || divisor === WIN64_REG.R10) {
      tempReg = WIN64_REG.R11;
    }
    if (dest === tempReg || divisor === tempReg) {
      tempReg = WIN64_REG.RBX;  // Last resort
    }
    
    let actualDivisor = divisor;
    
    // If divisor is RDX or RAX, save it to temp first (they get clobbered)
    if (divisor === WIN64_REG.RDX || divisor === WIN64_REG.RAX) {
      // MOV temp, divisor
      this.emit(this.rex(1, tempReg >= 8, 0, divisor >= 8));
      this.emit(0x8B);
      this.emit(this.modrm(3, tempReg & 7, divisor & 7));
      actualDivisor = tempReg;
    }
    
    // Save RDX (we'll clobber it with CQO)
    this.emit(0x52);  // PUSH RDX
    
    // Move dividend to RAX if not already there
    if (dest !== WIN64_REG.RAX) {
      // MOV RAX, dest
      this.emit(this.rex(1, 0, 0, dest >= 8));
      this.emit(0x8B);  // MOV r64, r/m64
      this.emit(this.modrm(3, WIN64_REG.RAX & 7, dest & 7));
    }
    
    // Sign-extend RAX into RDX:RAX (CQO instruction)
    this.emit(0x48, 0x99);  // CQO
    
    // IDIV r/m64
    this.emit(this.rex(1, 0, 0, actualDivisor >= 8));
    this.emit(0xF7);  // IDIV r/m64
    this.emit(this.modrm(3, 7, actualDivisor & 7));
    
    // Quotient is now in RAX, move to dest if needed
    if (dest !== WIN64_REG.RAX) {
      // MOV dest, RAX
      this.emit(this.rex(1, dest >= 8, 0, 0));
      this.emit(0x8B);  // MOV r64, r/m64
      this.emit(this.modrm(3, dest & 7, WIN64_REG.RAX & 7));
    }
    
    // Restore RDX
    this.emit(0x5A);  // POP RDX
  }
  
  // IDIV for remainder - same as idiv but returns RDX (remainder)
  iremReg(destAurora, divisorAurora) {
    const dest = this.mapReg(destAurora);
    const divisor = this.mapReg(divisorAurora);
    
    // Choose a temp register that's not dest, divisor, RAX, or RDX
    let tempReg = WIN64_REG.R10;
    if (dest === WIN64_REG.R10 || divisor === WIN64_REG.R10) {
      tempReg = WIN64_REG.R11;
    }
    if (dest === tempReg || divisor === tempReg) {
      tempReg = WIN64_REG.RBX;
    }
    
    let actualDivisor = divisor;
    
    // If divisor is RDX or RAX, save it to temp first (they get clobbered)
    if (divisor === WIN64_REG.RDX || divisor === WIN64_REG.RAX) {
      // MOV temp, divisor
      this.emit(this.rex(1, tempReg >= 8, 0, divisor >= 8));
      this.emit(0x8B);
      this.emit(this.modrm(3, tempReg & 7, divisor & 7));
      actualDivisor = tempReg;
    }
    
    // Move dividend to RAX if not already there
    if (dest !== WIN64_REG.RAX) {
      // MOV RAX, dest
      this.emit(this.rex(1, 0, 0, dest >= 8));
      this.emit(0x8B);  // MOV r64, r/m64
      this.emit(this.modrm(3, WIN64_REG.RAX & 7, dest & 7));
    }
    
    // Sign-extend RAX into RDX:RAX (CQO instruction)
    this.emit(0x48, 0x99);  // CQO
    
    // IDIV r/m64
    this.emit(this.rex(1, 0, 0, actualDivisor >= 8));
    this.emit(0xF7);  // IDIV r/m64
    this.emit(this.modrm(3, 7, actualDivisor & 7));
    
    // Remainder is in RDX, move to dest
    if (dest !== WIN64_REG.RDX) {
      // MOV dest, RDX
      this.emit(this.rex(1, dest >= 8, 0, 0));
      this.emit(0x8B);  // MOV r64, r/m64
      this.emit(this.modrm(3, dest & 7, WIN64_REG.RDX & 7));
    }
  }
  
  // ========================
  // Comparison Instructions
  // ========================
  
  // CMP reg, reg
  cmpRegReg(aAurora, bAurora) {
    const a = this.mapReg(aAurora);
    const b = this.mapReg(bAurora);
    const rexByte = this.rex(1, b >= 8, 0, a >= 8);
    this.emit(rexByte);
    this.emit(0x39);  // CMP r/m64, r64
    this.emit(this.modrm(3, b & 7, a & 7));
  }
  
  // CMP reg, imm32
  cmpRegImm32(regAurora, imm32) {
    const reg = this.mapReg(regAurora);
    const rexByte = this.rex(1, 0, 0, reg >= 8);
    this.emit(rexByte);
    if (imm32 >= -128 && imm32 <= 127) {
      this.emit(0x83);  // CMP r/m64, imm8
      this.emit(this.modrm(3, 7, reg & 7));
      this.emit(imm32 & 0xFF);
    } else {
      this.emit(0x81);  // CMP r/m64, imm32
      this.emit(this.modrm(3, 7, reg & 7));
      this.emitImm32(imm32);
    }
  }
  
  // ========================
  // Bitwise Instructions
  // ========================
  
  // AND reg, reg
  andRegReg(destAurora, srcAurora) {
    const dest = this.mapReg(destAurora);
    const src = this.mapReg(srcAurora);
    const rexByte = this.rex(1, src >= 8, 0, dest >= 8);
    this.emit(rexByte);
    this.emit(0x21);  // AND r/m64, r64
    this.emit(this.modrm(3, src & 7, dest & 7));
  }
  
  // AND reg, imm32
  andRegImm32(destAurora, imm32) {
    const dest = this.mapReg(destAurora);
    const rexByte = this.rex(1, 0, 0, dest >= 8);
    this.emit(rexByte);
    this.emit(0x81);  // AND r/m64, imm32
    this.emit(this.modrm(3, 4, dest & 7));
    this.emitImm32(imm32);
  }
  
  // OR reg, reg
  orRegReg(destAurora, srcAurora) {
    const dest = this.mapReg(destAurora);
    const src = this.mapReg(srcAurora);
    const rexByte = this.rex(1, src >= 8, 0, dest >= 8);
    this.emit(rexByte);
    this.emit(0x09);  // OR r/m64, r64
    this.emit(this.modrm(3, src & 7, dest & 7));
  }
  
  // OR reg, imm32
  orRegImm32(destAurora, imm32) {
    const dest = this.mapReg(destAurora);
    const rexByte = this.rex(1, 0, 0, dest >= 8);
    this.emit(rexByte);
    this.emit(0x81);  // OR r/m64, imm32
    this.emit(this.modrm(3, 1, dest & 7));
    this.emitImm32(imm32);
  }
  
  // XOR reg, reg
  xorRegReg(destAurora, srcAurora) {
    const dest = this.mapReg(destAurora);
    const src = this.mapReg(srcAurora);
    const rexByte = this.rex(1, src >= 8, 0, dest >= 8);
    this.emit(rexByte);
    this.emit(0x31);  // XOR r/m64, r64
    this.emit(this.modrm(3, src & 7, dest & 7));
  }
  
  // XOR reg, imm32
  xorRegImm32(destAurora, imm32) {
    const dest = this.mapReg(destAurora);
    const rexByte = this.rex(1, 0, 0, dest >= 8);
    this.emit(rexByte);
    this.emit(0x81);  // XOR r/m64, imm32
    this.emit(this.modrm(3, 6, dest & 7));
    this.emitImm32(imm32);
  }
  
  // SHL reg, imm8
  shlRegImm8(destAurora, imm8) {
    const dest = this.mapReg(destAurora);
    const rexByte = this.rex(1, 0, 0, dest >= 8);
    this.emit(rexByte);
    this.emit(0xC1);  // SHL r/m64, imm8
    this.emit(this.modrm(3, 4, dest & 7));
    this.emit(imm8 & 0x3F);
  }
  
  // SHR reg, imm8
  shrRegImm8(destAurora, imm8) {
    const dest = this.mapReg(destAurora);
    const rexByte = this.rex(1, 0, 0, dest >= 8);
    this.emit(rexByte);
    this.emit(0xC1);  // SHR r/m64, imm8
    this.emit(this.modrm(3, 5, dest & 7));
    this.emit(imm8 & 0x3F);
  }
  
  // ========================
  // Control Flow Instructions
  // ========================
  
  // JMP rel32 (with label)
  jmpRel32(label) {
    this.emit(0xE9);  // JMP rel32
    this.relocations.push({
      offset: this.code.length,
      label: label,
      type: 'rel32',
    });
    this.emit(0, 0, 0, 0);  // Placeholder
  }
  
  // Conditional jump rel32 (for integer comparisons using SF/OF flags)
  jccRel32(condition, label) {
    // Condition codes for Jcc:
    // 0x01: eq (ZF=1)
    // 0x02: ne (ZF=0)
    // 0x03: lt (SF!=OF)
    // 0x04: le (ZF=1 or SF!=OF)
    // 0x05: gt (ZF=0 and SF=OF)
    // 0x06: ge (SF=OF)
    const ccMap = {
      0x01: 0x84,  // JE/JZ
      0x02: 0x85,  // JNE/JNZ
      0x03: 0x8C,  // JL/JNGE
      0x04: 0x8E,  // JLE/JNG
      0x05: 0x8F,  // JG/JNLE
      0x06: 0x8D,  // JGE/JNL
    };
    
    const opcode = ccMap[condition] || 0x84;
    this.emit(0x0F, opcode);  // Jcc rel32
    this.relocations.push({
      offset: this.code.length,
      label: label,
      type: 'rel32',
    });
    this.emit(0, 0, 0, 0);  // Placeholder
  }
  
  // Conditional jump rel32 for float comparisons (uses CF/ZF from UCOMISD)
  // UCOMISD sets: ZF=1 if equal, CF=1 if less than, CF=0 & ZF=0 if greater than
  jccFloatRel32(condition, label) {
    // Map Aurora condition codes to unsigned/float comparison jumps
    // 0x01: eq -> JE (ZF=1) -> 0x84
    // 0x02: ne -> JNE (ZF=0) -> 0x85
    // 0x03: lt -> JB (CF=1) -> 0x82
    // 0x04: le -> JBE (CF=1 or ZF=1) -> 0x86
    // 0x05: gt -> JA (CF=0 and ZF=0) -> 0x87
    // 0x06: ge -> JAE (CF=0) -> 0x83
    const ccMap = {
      0x01: 0x84,  // JE/JZ (same as integer)
      0x02: 0x85,  // JNE/JNZ (same as integer)
      0x03: 0x82,  // JB/JNAE (below - for unsigned/float)
      0x04: 0x86,  // JBE/JNA (below or equal)
      0x05: 0x87,  // JA/JNBE (above - for unsigned/float)
      0x06: 0x83,  // JAE/JNB (above or equal)
    };
    
    const opcode = ccMap[condition] || 0x84;
    this.emit(0x0F, opcode);  // Jcc rel32
    this.relocations.push({
      offset: this.code.length,
      label: label,
      type: 'rel32',
    });
    this.emit(0, 0, 0, 0);  // Placeholder
  }
  
  // CALL [rip+disp32] - call through IAT
  callImport(importName) {
    // FF 15 xx xx xx xx = CALL [RIP + disp32]
    this.emit(0xFF, 0x15);
    this.relocations.push({
      offset: this.code.length,
      label: `__imp_${importName}`,
      type: 'rel32',
    });
    this.emit(0, 0, 0, 0);  // Placeholder
  }
  
  // CALL rel32
  callRel32(label) {
    this.emit(0xE8);  // CALL rel32
    this.relocations.push({
      offset: this.code.length,
      label: label,
      type: 'rel32',
    });
    this.emit(0, 0, 0, 0);  // Placeholder
  }
  
  // RET
  ret() {
    this.emit(0xC3);
  }
  
  // ========================
  // Stack Instructions (for Win64 ABI)
  // ========================
  
  // SUB RSP, imm8/32 (allocate stack space)
  subRspImm(imm) {
    this.emit(this.rex(1, 0, 0, 0));
    if (imm >= -128 && imm <= 127) {
      this.emit(0x83);  // SUB r/m64, imm8
      this.emit(this.modrm(3, 5, WIN64_REG.RSP));
      this.emit(imm & 0xFF);
    } else {
      this.emit(0x81);  // SUB r/m64, imm32
      this.emit(this.modrm(3, 5, WIN64_REG.RSP));
      this.emitImm32(imm);
    }
  }
  
  // ADD RSP, imm8/32 (deallocate stack space)
  addRspImm(imm) {
    this.emit(this.rex(1, 0, 0, 0));
    if (imm >= -128 && imm <= 127) {
      this.emit(0x83);  // ADD r/m64, imm8
      this.emit(this.modrm(3, 0, WIN64_REG.RSP));
      this.emit(imm & 0xFF);
    } else {
      this.emit(0x81);  // ADD r/m64, imm32
      this.emit(this.modrm(3, 0, WIN64_REG.RSP));
      this.emitImm32(imm);
    }
  }
  
  // PUSH reg
  pushReg(regAurora) {
    const reg = this.mapReg(regAurora);
    if (reg >= 8) {
      this.emit(0x41);  // REX.B
    }
    this.emit(0x50 + (reg & 7));
  }
  
  // POP reg
  popReg(regAurora) {
    const reg = this.mapReg(regAurora);
    if (reg >= 8) {
      this.emit(0x41);  // REX.B
    }
    this.emit(0x58 + (reg & 7));
  }
  
  // MOV [RSP+offset], reg64 - Store register to stack slot
  movStackReg(offset, srcAurora) {
    const src = this.mapReg(srcAurora);
    // REX.W prefix + MOV r/m64, r64 (opcode 0x89)
    this.emit(this.rex(1, src >= 8, 0, 0));
    this.emit(0x89);
    if (offset === 0) {
      // ModR/M: [RSP] with SIB byte
      this.emit(this.modrm(0, src & 7, 4));  // mod=00, rm=100 (SIB follows)
      this.emit(0x24);  // SIB: scale=00, index=100 (none), base=100 (RSP)
    } else if (offset >= -128 && offset <= 127) {
      // ModR/M: [RSP+disp8] with SIB byte
      this.emit(this.modrm(1, src & 7, 4));  // mod=01 (disp8), rm=100 (SIB follows)
      this.emit(0x24);  // SIB: scale=00, index=100 (none), base=100 (RSP)
      this.emit(offset & 0xFF);
    } else {
      // ModR/M: [RSP+disp32] with SIB byte
      this.emit(this.modrm(2, src & 7, 4));  // mod=10 (disp32), rm=100 (SIB follows)
      this.emit(0x24);  // SIB: scale=00, index=100 (none), base=100 (RSP)
      this.emitImm32(offset);
    }
  }
  
  // MOV reg64, [RSP+offset] - Load register from stack slot
  movRegStack(destAurora, offset) {
    const dest = this.mapReg(destAurora);
    // REX.W prefix + MOV r64, r/m64 (opcode 0x8B)
    this.emit(this.rex(1, dest >= 8, 0, 0));
    this.emit(0x8B);
    if (offset === 0) {
      // ModR/M: [RSP] with SIB byte
      this.emit(this.modrm(0, dest & 7, 4));  // mod=00, rm=100 (SIB follows)
      this.emit(0x24);  // SIB: scale=00, index=100 (none), base=100 (RSP)
    } else if (offset >= -128 && offset <= 127) {
      // ModR/M: [RSP+disp8] with SIB byte
      this.emit(this.modrm(1, dest & 7, 4));  // mod=01 (disp8), rm=100 (SIB follows)
      this.emit(0x24);  // SIB: scale=00, index=100 (none), base=100 (RSP)
      this.emit(offset & 0xFF);
    } else {
      // ModR/M: [RSP+disp32] with SIB byte
      this.emit(this.modrm(2, dest & 7, 4));  // mod=10 (disp32), rm=100 (SIB follows)
      this.emit(0x24);  // SIB: scale=00, index=100 (none), base=100 (RSP)
      this.emitImm32(offset);
    }
  }
  
  // ========================
  // Floating Point Instructions (SSE2)
  // XMM registers: xmm0-xmm7 (use same number as Aurora xmm index)
  // ========================
  
  // MOVSD xmm, xmm - move scalar double
  movsdRegReg(destXmm, srcXmm) {
    // F2 0F 10 /r  MOVSD xmm1, xmm2
    this.emit(0xF2);
    if (destXmm >= 8 || srcXmm >= 8) {
      this.emit(this.rex(0, destXmm >= 8, 0, srcXmm >= 8));
    }
    this.emit(0x0F, 0x10);
    this.emit(this.modrm(3, destXmm & 7, srcXmm & 7));
  }
  
  // MOVSD xmm, [rsp+offset] - load double from stack
  movsdRegStack(destXmm, offset) {
    // F2 0F 10 /r  MOVSD xmm1, m64
    this.emit(0xF2);
    if (destXmm >= 8) {
      this.emit(this.rex(0, destXmm >= 8, 0, 0));
    }
    this.emit(0x0F, 0x10);
    this.emit(this.modrm(2, destXmm & 7, 4));  // mod=10, rm=100 (SIB)
    this.emit(0x24);  // SIB: base=RSP
    this.emitImm32(offset);
  }
  
  // MOVSD [rsp+offset], xmm - store double to stack
  movsdStackReg(offset, srcXmm) {
    // F2 0F 11 /r  MOVSD m64, xmm1
    this.emit(0xF2);
    if (srcXmm >= 8) {
      this.emit(this.rex(0, srcXmm >= 8, 0, 0));
    }
    this.emit(0x0F, 0x11);
    this.emit(this.modrm(2, srcXmm & 7, 4));  // mod=10, rm=100 (SIB)
    this.emit(0x24);  // SIB: base=RSP
    this.emitImm32(offset);
  }
  
  // Load immediate double into XMM via stack
  // Uses RIP-relative or stack-based loading
  movsdRegImm(destXmm, floatValue) {
    // Store the float in data section and load from there
    // For simplicity, we'll use a stack-based approach:
    // 1. Store imm64 to stack using integer ops
    // 2. Load from stack to XMM
    const buffer = Buffer.alloc(8);
    buffer.writeDoubleLE(floatValue, 0);
    const lo = buffer.readUInt32LE(0);
    const hi = buffer.readUInt32LE(4);
    
    // Use R11 as temp (Aurora r6)
    // MOV R11, imm64
    this.emit(0x49, 0xBB);  // REX.WB MOV R11, imm64
    for (let i = 0; i < 8; i++) {
      this.emit(buffer[i]);
    }
    
    // MOV [RSP+tempOffset], R11 - use a temp location in stack
    const tempOffset = 0x70;  // Use offset 112 as temp
    this.emit(0x4C, 0x89, 0x5C, 0x24, tempOffset);  // MOV [RSP+0x70], R11
    
    // MOVSD xmm, [RSP+tempOffset]
    this.movsdRegStack(destXmm, tempOffset);
  }
  
  // ADDSD xmm, xmm - add scalar double
  addsdRegReg(destXmm, srcXmm) {
    // F2 0F 58 /r  ADDSD xmm1, xmm2
    this.emit(0xF2);
    if (destXmm >= 8 || srcXmm >= 8) {
      this.emit(this.rex(0, destXmm >= 8, 0, srcXmm >= 8));
    }
    this.emit(0x0F, 0x58);
    this.emit(this.modrm(3, destXmm & 7, srcXmm & 7));
  }
  
  // SUBSD xmm, xmm - subtract scalar double
  subsdRegReg(destXmm, srcXmm) {
    // F2 0F 5C /r  SUBSD xmm1, xmm2
    this.emit(0xF2);
    if (destXmm >= 8 || srcXmm >= 8) {
      this.emit(this.rex(0, destXmm >= 8, 0, srcXmm >= 8));
    }
    this.emit(0x0F, 0x5C);
    this.emit(this.modrm(3, destXmm & 7, srcXmm & 7));
  }
  
  // MULSD xmm, xmm - multiply scalar double
  mulsdRegReg(destXmm, srcXmm) {
    // F2 0F 59 /r  MULSD xmm1, xmm2
    this.emit(0xF2);
    if (destXmm >= 8 || srcXmm >= 8) {
      this.emit(this.rex(0, destXmm >= 8, 0, srcXmm >= 8));
    }
    this.emit(0x0F, 0x59);
    this.emit(this.modrm(3, destXmm & 7, srcXmm & 7));
  }
  
  // DIVSD xmm, xmm - divide scalar double
  divsdRegReg(destXmm, srcXmm) {
    // F2 0F 5E /r  DIVSD xmm1, xmm2
    this.emit(0xF2);
    if (destXmm >= 8 || srcXmm >= 8) {
      this.emit(this.rex(0, destXmm >= 8, 0, srcXmm >= 8));
    }
    this.emit(0x0F, 0x5E);
    this.emit(this.modrm(3, destXmm & 7, srcXmm & 7));
  }
  
  // UCOMISD xmm, xmm - compare unordered scalar doubles
  ucomisdRegReg(xmm1, xmm2) {
    // 66 0F 2E /r  UCOMISD xmm1, xmm2
    this.emit(0x66);
    if (xmm1 >= 8 || xmm2 >= 8) {
      this.emit(this.rex(0, xmm1 >= 8, 0, xmm2 >= 8));
    }
    this.emit(0x0F, 0x2E);
    this.emit(this.modrm(3, xmm1 & 7, xmm2 & 7));
  }
  
  // CVTSI2SD xmm, r64 - convert 64-bit int to double
  cvtsi2sdXmmReg(destXmm, srcReg) {
    // F2 REX.W 0F 2A /r  CVTSI2SD xmm, r64
    this.emit(0xF2);
    const srcX64 = this.mapReg ? this.mapReg(srcReg) : srcReg;
    this.emit(this.rex(1, destXmm >= 8, 0, srcX64 >= 8));
    this.emit(0x0F, 0x2A);
    this.emit(this.modrm(3, destXmm & 7, srcX64 & 7));
  }
  
  // CVTSD2SI r64, xmm - convert double to 64-bit int (truncate)
  cvtsd2siRegXmm(destReg, srcXmm) {
    // F2 REX.W 0F 2D /r  CVTSD2SI r64, xmm
    this.emit(0xF2);
    const destX64 = this.mapReg ? this.mapReg(destReg) : destReg;
    this.emit(this.rex(1, destX64 >= 8, 0, srcXmm >= 8));
    this.emit(0x0F, 0x2D);
    this.emit(this.modrm(3, destX64 & 7, srcXmm & 7));
  }
  
  // CVTTSD2SI r64, xmm - convert double to 64-bit int (truncate toward zero)
  cvttsd2siRegXmm(destReg, srcXmm) {
    // F2 REX.W 0F 2C /r  CVTTSD2SI r64, xmm
    this.emit(0xF2);
    const destX64 = this.mapReg ? this.mapReg(destReg) : destReg;
    this.emit(this.rex(1, destX64 >= 8, 0, srcXmm >= 8));
    this.emit(0x0F, 0x2C);
    this.emit(this.modrm(3, destX64 & 7, srcXmm & 7));
  }
  
  // SQRTSD xmm1, xmm2 - square root of double
  sqrtsdXmmXmm(destXmm, srcXmm) {
    // F2 0F 51 /r  SQRTSD xmm1, xmm2/m64
    this.emit(0xF2);
    if (destXmm >= 8 || srcXmm >= 8) {
      this.emit(this.rex(0, destXmm >= 8, 0, srcXmm >= 8));
    }
    this.emit(0x0F, 0x51);
    this.emit(this.modrm(3, destXmm & 7, srcXmm & 7));
  }
  
  // FABS - absolute value using ANDPD with mask to clear sign bit
  // Load mask from memory, then ANDPD
  fabsXmmXmm(destXmm, srcXmm) {
    // First move src to dest if different
    if (destXmm !== srcXmm) {
      this.movsdRegReg(destXmm, srcXmm);
    }
    // ANDPD with constant mask 0x7FFFFFFFFFFFFFFF (clear sign bit)
    // 66 0F 54 /r  ANDPD xmm1, xmm2/m128
    // We need the mask in memory. Use RIP-relative addressing to a data section constant.
    // For now, use a register-based approach: load mask, then ANDPD
    // Alternative: emit inline constant and use RIP-relative
    
    // Simple approach: Use ANDPD with RIP-relative memory reference
    // We'll need to add the abs_mask constant to data section
    const maskLabel = '__fabs_mask';
    if (!this.dataLabels.has(maskLabel)) {
      // Add mask constant: 0x7FFFFFFFFFFFFFFF (for low 64-bit), 0x7FFFFFFFFFFFFFFF (for high)
      while (this.dataSection.length % 16 !== 0) {
        this.dataSection.push(0);
      }
      this.dataLabels.set(maskLabel, this.dataSection.length);
      // 128-bit mask (16 bytes) - clear sign bits for both doubles
      const maskBytes = [0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0x7F,  // low qword
                         0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0x7F]; // high qword
      for (const b of maskBytes) {
        this.dataSection.push(b);
      }
    }
    
    // 66 0F 54 /r  ANDPD xmm, m128
    this.emit(0x66);
    if (destXmm >= 8) {
      this.emit(this.rex(0, destXmm >= 8, 0, 0));
    }
    this.emit(0x0F, 0x54);
    // ModR/M: mod=00, reg=dest, rm=101 (RIP-relative)
    this.emit(this.modrm(0, destXmm & 7, 5));
    // Add relocation for mask address
    this.relocations.push({
      offset: this.code.length,
      type: 'rip_relative_data',
      label: maskLabel
    });
    this.emitImm32(0); // placeholder for disp32
  }
  
  // FNEG - negate using XORPD with sign bit mask
  fnegXmmXmm(destXmm, srcXmm) {
    // First move src to dest if different
    if (destXmm !== srcXmm) {
      this.movsdRegReg(destXmm, srcXmm);
    }
    
    // XORPD with constant mask 0x8000000000000000 (flip sign bit)
    const maskLabel = '__fneg_mask';
    if (!this.dataLabels.has(maskLabel)) {
      while (this.dataSection.length % 16 !== 0) {
        this.dataSection.push(0);
      }
      this.dataLabels.set(maskLabel, this.dataSection.length);
      // 128-bit mask - flip sign bits
      const maskBytes = [0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x80,  // low qword
                         0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x80]; // high qword
      for (const b of maskBytes) {
        this.dataSection.push(b);
      }
    }
    
    // 66 0F 57 /r  XORPD xmm, m128
    this.emit(0x66);
    if (destXmm >= 8) {
      this.emit(this.rex(0, destXmm >= 8, 0, 0));
    }
    this.emit(0x0F, 0x57);
    this.emit(this.modrm(0, destXmm & 7, 5));
    this.relocations.push({
      offset: this.code.length,
      type: 'rip_relative_data',
      label: maskLabel
    });
    this.emitImm32(0);
  }
  
  // ROUNDSD - round double with mode (SSE4.1)
  // mode: 0x09 = floor (toward -inf), 0x0A = ceil (toward +inf), 0x0B = trunc, 0x0C = nearest
  roundsdXmmXmm(destXmm, srcXmm, mode) {
    // 66 0F 3A 0B /r ib  ROUNDSD xmm1, xmm2/m64, imm8
    this.emit(0x66);
    if (destXmm >= 8 || srcXmm >= 8) {
      this.emit(this.rex(0, destXmm >= 8, 0, srcXmm >= 8));
    }
    this.emit(0x0F, 0x3A, 0x0B);
    this.emit(this.modrm(3, destXmm & 7, srcXmm & 7));
    this.emit(mode);
  }
  
  // Floor (round toward -infinity)
  ffloorXmmXmm(destXmm, srcXmm) {
    this.roundsdXmmXmm(destXmm, srcXmm, 0x09);
  }
  
  // Ceil (round toward +infinity)
  fceilXmmXmm(destXmm, srcXmm) {
    this.roundsdXmmXmm(destXmm, srcXmm, 0x0A);
  }

  // Add float constant to data section (8-byte aligned)
  addFloatConst(label, value) {
    // Align to 8 bytes
    while (this.dataSection.length % 8 !== 0) {
      this.dataSection.push(0);
    }
    this.dataLabels.set(label, this.dataSection.length);
    const buffer = Buffer.alloc(8);
    buffer.writeDoubleLE(value, 0);
    for (let i = 0; i < 8; i++) {
      this.dataSection.push(buffer[i]);
    }
    return label;
  }
  
  // ========================
  // Helper Functions
  // ========================
  
  emitImm32(value) {
    const v = value >>> 0;  // Convert to unsigned
    this.emit(v & 0xFF);
    this.emit((v >> 8) & 0xFF);
    this.emit((v >> 16) & 0xFF);
    this.emit((v >> 24) & 0xFF);
  }
  
  // Define a label at current position
  defineLabel(name) {
    this.labels.set(name, this.code.length);
  }
  
  // Add string to data section
  addString(str) {
    const label = `_str_${this.dataLabels.size}`;
    this.dataLabels.set(label, this.dataSection.length);
    for (let i = 0; i < str.length; i++) {
      this.dataSection.push(str.charCodeAt(i));
    }
    this.dataSection.push(0);  // null terminator
    return label;
  }
  
  // Add shared variable to data section (8-byte aligned for atomic operations)
  addSharedVar(name, initialValue = 0) {
    // Align to 8 bytes
    while (this.dataSection.length % 8 !== 0) {
      this.dataSection.push(0);
    }
    const label = `_shared_${name}`;
    this.dataLabels.set(label, this.dataSection.length);
    // Store 64-bit value
    const value = BigInt(initialValue);
    for (let i = 0; i < 8; i++) {
      this.dataSection.push(Number((value >> BigInt(i * 8)) & 0xFFn));
    }
    return label;
  }
  
  // Generate LOCK XADD instruction (atomic add and return old value)
  // LOCK XADD [RBX], RAX - atomically adds RAX to [RBX], stores old value in RAX
  lockXaddMem64Reg(memReg, srcReg) {
    const memWin = this.mapReg(memReg);
    const srcWin = this.mapReg(srcReg);
    // LOCK prefix
    this.emit(0xF0);
    // REX.W for 64-bit
    this.emit(this.rex(1, srcWin >= 8, 0, memWin >= 8));
    // 0F C1 /r - XADD r/m64, r64
    this.emit(0x0F, 0xC1);
    this.emit(this.modrm(0, srcWin & 7, memWin & 7));  // mod=00 for [reg]
  }
  
  // Generate MOV to memory with address in register
  // MOV [destMemReg], srcReg
  movMemReg64(destMemReg, srcReg) {
    const destWin = this.mapReg(destMemReg);
    const srcWin = this.mapReg(srcReg);
    this.emit(this.rex(1, srcWin >= 8, 0, destWin >= 8));
    this.emit(0x89);  // MOV r/m64, r64
    this.emit(this.modrm(0, srcWin & 7, destWin & 7));
  }
  
  // Generate MOV from memory with address in register
  // MOV destReg, [srcMemReg]
  movRegMem64(destReg, srcMemReg) {
    const destWin = this.mapReg(destReg);
    const srcWin = this.mapReg(srcMemReg);
    this.emit(this.rex(1, destWin >= 8, 0, srcWin >= 8));
    this.emit(0x8B);  // MOV r64, r/m64
    this.emit(this.modrm(0, destWin & 7, srcWin & 7));
  }
  
  // Generate LOCK XCHG for atomic store
  // LOCK XCHG [RBX], RAX
  lockXchgMem64Reg(memReg, srcReg) {
    const memWin = this.mapReg(memReg);
    const srcWin = this.mapReg(srcReg);
    // LOCK prefix
    this.emit(0xF0);
    // REX.W for 64-bit
    this.emit(this.rex(1, srcWin >= 8, 0, memWin >= 8));
    // 87 /r - XCHG r/m64, r64
    this.emit(0x87);
    this.emit(this.modrm(0, srcWin & 7, memWin & 7));
  }
  
  // Generate LOCK CMPXCHG instruction for atomic compare-and-swap
  // LOCK CMPXCHG [memReg], newReg
  // Compare RAX with [memReg], if equal store newReg in [memReg], else load [memReg] into RAX
  // Returns: ZF=1 if exchange happened, ZF=0 otherwise
  lockCmpxchgMem64Reg(memReg, newReg) {
    const memWin = this.mapReg(memReg);
    const newWin = this.mapReg(newReg);
    // LOCK prefix
    this.emit(0xF0);
    // REX.W for 64-bit
    this.emit(this.rex(1, newWin >= 8, 0, memWin >= 8));
    // 0F B1 /r - CMPXCHG r/m64, r64
    this.emit(0x0F, 0xB1);
    this.emit(this.modrm(0, newWin & 7, memWin & 7));  // mod=00 for [reg]
  }
  
  // JNE rel8 - jump if not equal (ZF=0), short form
  jneRel8(rel8) {
    this.emit(0x75, rel8 & 0xFF);
  }
  
  // Return current code offset for calculating relative jumps
  currentOffset() {
    return this.code.length;
  }
  
  // LEA reg, [RIP+disp32] - load effective address of label
  // Used to get address of data section variables
  leaRegRipLabel(destAurora, label) {
    const dest = this.mapReg(destAurora);
    // REX.W prefix for 64-bit
    this.emit(this.rex(1, dest >= 8, 0, 0));
    // 8D /r - LEA r64, m
    this.emit(0x8D);
    // ModR/M: mod=00, reg=dest, rm=101 (RIP-relative)
    this.emit(this.modrm(0, dest & 7, 5));
    // RIP-relative displacement
    this.relocations.push({
      offset: this.code.length,
      label: label,
      type: 'rel32',
    });
    this.emit(0, 0, 0, 0);  // Placeholder for 32-bit displacement
  }
  
  // Set import table address
  setImport(name, rva) {
    this.imports.set(name, rva);
  }
  
  // Get code as buffer
  getCode() {
    return Buffer.from(this.code);
  }
  
  // Get data as buffer
  getData() {
    return Buffer.from(this.dataSection);
  }
  
  // Resolve relocations
  resolve(codeBase, dataBase, iatBase, debug = false) {
    if (debug) {
      console.log(`[resolve] codeBase=0x${codeBase.toString(16)}, dataBase=0x${dataBase.toString(16)}`);
      console.log(`[resolve] labels:`, [...this.labels.entries()]);
      console.log(`[resolve] dataLabels:`, [...this.dataLabels.entries()]);
      console.log(`[resolve] relocations count: ${this.relocations.length}`);
    }
    
    for (const reloc of this.relocations) {
      let target;
      
      if (reloc.label.startsWith('__imp_')) {
        // IAT import
        const importName = reloc.label.substring(6);
        if (!this.imports.has(importName)) {
          throw new Error(`Undefined import: ${importName}`);
        }
        target = this.imports.get(importName);
      } else if (this.labels.has(reloc.label)) {
        // Code label
        target = codeBase + this.labels.get(reloc.label);
      } else if (this.dataLabels.has(reloc.label)) {
        // Data label
        target = dataBase + this.dataLabels.get(reloc.label);
      } else {
        throw new Error(`Undefined label: ${reloc.label}`);
      }
      
      if (debug) {
        console.log(`[resolve] label=${reloc.label}, target=0x${target.toString(16)}, offset=${reloc.offset}, type=${reloc.type}`);
      }
      
      if (reloc.type === 'rel32' || reloc.type === 'rip_relative_data') {
        // Calculate relative offset from RIP (which is after the disp32 field)
        const from = codeBase + reloc.offset + 4;  // After the rel32/disp32 field
        const rel = target - from;
        
        // Write rel32/disp32
        this.code[reloc.offset] = rel & 0xFF;
        this.code[reloc.offset + 1] = (rel >> 8) & 0xFF;
        this.code[reloc.offset + 2] = (rel >> 16) & 0xFF;
        this.code[reloc.offset + 3] = (rel >> 24) & 0xFF;
      } else if (reloc.type === 'abs64') {
        // Write absolute 64-bit address
        const value = BigInt(target);
        for (let i = 0; i < 8; i++) {
          this.code[reloc.offset + i] = Number((value >> BigInt(i * 8)) & 0xFFn);
        }
      }
    }
  }
}

module.exports = { X86EncoderWin64, WIN64_REG };
