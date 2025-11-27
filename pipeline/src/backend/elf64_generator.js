/**
 * ELF64 Generator for Linux x86-64
 * 
 * Generates minimal ELF64 executables from compiled code.
 * 
 * Memory layout:
 * - 0x400000: ELF header + program headers
 * - 0x401000: .text section (code)
 * - 0x402000: .data section (strings, etc.)
 */

const fs = require('fs');

const ELF = {
  // ELF magic
  MAGIC: [0x7F, 0x45, 0x4C, 0x46],
  
  // ELF class
  CLASS64: 2,
  
  // Data encoding
  DATA2LSB: 1,  // Little endian
  
  // OS/ABI
  OSABI_SYSV: 0,
  
  // Object file type
  ET_EXEC: 2,
  
  // Machine type
  EM_X86_64: 0x3E,
  
  // Segment types
  PT_LOAD: 1,
  
  // Segment flags
  PF_X: 1,
  PF_W: 2,
  PF_R: 4,
};

class ELF64Generator {
  constructor() {
    this.baseAddr = 0x400000;
    this.textAddr = 0x401000;
    this.dataAddr = 0x402000;
    this.pageSize = 0x1000;
  }
  
  // Generate ELF64 header (64 bytes)
  generateElfHeader(entryPoint, phNum) {
    const buf = Buffer.alloc(64);
    let offset = 0;
    
    // e_ident (16 bytes)
    buf.writeUInt8(0x7F, offset++);  // Magic
    buf.write('ELF', offset); offset += 3;
    buf.writeUInt8(ELF.CLASS64, offset++);     // 64-bit
    buf.writeUInt8(ELF.DATA2LSB, offset++);    // Little endian
    buf.writeUInt8(1, offset++);               // ELF version
    buf.writeUInt8(ELF.OSABI_SYSV, offset++);  // OS/ABI
    offset += 8;  // Padding
    
    // e_type (2 bytes)
    buf.writeUInt16LE(ELF.ET_EXEC, offset); offset += 2;
    
    // e_machine (2 bytes)
    buf.writeUInt16LE(ELF.EM_X86_64, offset); offset += 2;
    
    // e_version (4 bytes)
    buf.writeUInt32LE(1, offset); offset += 4;
    
    // e_entry (8 bytes)
    buf.writeBigUInt64LE(BigInt(entryPoint), offset); offset += 8;
    
    // e_phoff (8 bytes) - program header offset (right after ELF header)
    buf.writeBigUInt64LE(64n, offset); offset += 8;
    
    // e_shoff (8 bytes) - no section headers
    buf.writeBigUInt64LE(0n, offset); offset += 8;
    
    // e_flags (4 bytes)
    buf.writeUInt32LE(0, offset); offset += 4;
    
    // e_ehsize (2 bytes) - ELF header size
    buf.writeUInt16LE(64, offset); offset += 2;
    
    // e_phentsize (2 bytes) - program header entry size
    buf.writeUInt16LE(56, offset); offset += 2;
    
    // e_phnum (2 bytes)
    buf.writeUInt16LE(phNum, offset); offset += 2;
    
    // e_shentsize (2 bytes)
    buf.writeUInt16LE(0, offset); offset += 2;
    
    // e_shnum (2 bytes)
    buf.writeUInt16LE(0, offset); offset += 2;
    
    // e_shstrndx (2 bytes)
    buf.writeUInt16LE(0, offset); offset += 2;
    
    return buf;
  }
  
  // Generate program header (56 bytes each)
  generateProgramHeader(type, flags, offset, vaddr, filesz, memsz) {
    const buf = Buffer.alloc(56);
    let off = 0;
    
    // p_type (4 bytes)
    buf.writeUInt32LE(type, off); off += 4;
    
    // p_flags (4 bytes)
    buf.writeUInt32LE(flags, off); off += 4;
    
    // p_offset (8 bytes)
    buf.writeBigUInt64LE(BigInt(offset), off); off += 8;
    
    // p_vaddr (8 bytes)
    buf.writeBigUInt64LE(BigInt(vaddr), off); off += 8;
    
    // p_paddr (8 bytes) - same as vaddr for x86-64
    buf.writeBigUInt64LE(BigInt(vaddr), off); off += 8;
    
    // p_filesz (8 bytes)
    buf.writeBigUInt64LE(BigInt(filesz), off); off += 8;
    
    // p_memsz (8 bytes)
    buf.writeBigUInt64LE(BigInt(memsz), off); off += 8;
    
    // p_align (8 bytes)
    buf.writeBigUInt64LE(BigInt(this.pageSize), off); off += 8;
    
    return buf;
  }
  
  // Generate complete ELF64 executable
  generate(code, data, entryOffset = 0) {
    const parts = [];
    
    // Calculate sizes and offsets
    const headerSize = 64 + 56 * 2;  // ELF header + 2 program headers
    const textFileOffset = this.pageSize;  // Align to page
    const dataFileOffset = textFileOffset + Math.ceil(code.length / this.pageSize) * this.pageSize;
    
    const entryPoint = this.textAddr + entryOffset;
    
    // ELF header
    parts.push(this.generateElfHeader(entryPoint, 2));
    
    // Program header for .text (code)
    parts.push(this.generateProgramHeader(
      ELF.PT_LOAD,
      ELF.PF_R | ELF.PF_X,
      textFileOffset,
      this.textAddr,
      code.length,
      code.length
    ));
    
    // Program header for .data
    parts.push(this.generateProgramHeader(
      ELF.PT_LOAD,
      ELF.PF_R | ELF.PF_W,
      dataFileOffset,
      this.dataAddr,
      data.length,
      data.length
    ));
    
    // Pad to text section
    const headerBuf = Buffer.concat(parts);
    const textPadding = Buffer.alloc(textFileOffset - headerBuf.length);
    
    // Pad code to page boundary
    const codePadding = Buffer.alloc(dataFileOffset - textFileOffset - code.length);
    
    // Combine all parts
    return Buffer.concat([
      headerBuf,
      textPadding,
      code,
      codePadding,
      data
    ]);
  }
}

module.exports = { ELF64Generator };
