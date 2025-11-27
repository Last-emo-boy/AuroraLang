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
  
  // Conditional jump rel32
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
  resolve(codeBase, dataBase, iatBase) {
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
      
      if (reloc.type === 'rel32') {
        // Calculate relative offset
        const from = codeBase + reloc.offset + 4;  // After the rel32 field
        const rel = target - from;
        
        // Write rel32
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
