/**
 * PE64 (Portable Executable) Generator for Windows x64
 * 
 * Generates Windows x64 executables from Aurora machine code.
 * Uses minimal imports from kernel32.dll for I/O and process control.
 */

class PE64Generator {
  constructor() {
    // Memory layout for Windows PE
    this.imageBase = 0x140000000n;  // Default for 64-bit PE
    this.sectionAlignment = 0x1000; // 4KB page alignment
    this.fileAlignment = 0x200;     // 512 byte file alignment
    
    // Section RVAs (Relative Virtual Addresses)
    this.textRVA = 0x1000;   // .text section
    this.rdataRVA = 0x2000;  // .rdata section (imports, strings)
    this.dataRVA = 0x3000;   // .data section
    
    // Virtual addresses
    this.textAddr = Number(this.imageBase) + this.textRVA;
    this.rdataAddr = Number(this.imageBase) + this.rdataRVA;
    this.dataAddr = Number(this.imageBase) + this.dataRVA;
  }
  
  // Align value up to alignment boundary
  align(value, alignment) {
    return Math.ceil(value / alignment) * alignment;
  }
  
  // Generate complete PE64 executable
  generate(code, data, imports) {
    // Build import data first to know sizes
    const importData = this.buildImportData(imports || this.getDefaultImports());
    
    // Calculate sizes
    const headerSize = 0x200;  // DOS header + PE header + section headers
    const textSize = this.align(code.length || 1, this.fileAlignment);
    const rdataSize = this.align(importData.length || 1, this.fileAlignment);
    const dataSize = this.align(data.length || 1, this.fileAlignment);
    
    // Total file size
    const totalSize = headerSize + textSize + rdataSize + dataSize;
    const buffer = Buffer.alloc(totalSize);
    let offset = 0;
    
    // ========================
    // DOS Header (64 bytes)
    // ========================
    offset = this.writeDOSHeader(buffer, offset);
    
    // ========================
    // PE Signature + COFF Header (24 bytes)
    // ========================
    const peOffset = 0x80;  // PE header starts at 0x80
    offset = peOffset;
    offset = this.writePESignature(buffer, offset);
    offset = this.writeCOFFHeader(buffer, offset, 3);  // 3 sections
    
    // ========================
    // Optional Header (PE32+ = 240 bytes)
    // ========================
    offset = this.writeOptionalHeader(buffer, offset, {
      codeSize: textSize,
      dataSize: dataSize,
      entryPoint: this.textRVA,  // Entry point is start of .text
      codeBase: this.textRVA,
      imageSize: this.align(this.dataRVA + this.sectionAlignment, this.sectionAlignment),
      headerSize: headerSize,
      importRVA: this.rdataRVA,
      importSize: importData.iatSize || 0,
    });
    
    // ========================
    // Section Headers (40 bytes each)
    // ========================
    // .text section
    offset = this.writeSectionHeader(buffer, offset, {
      name: '.text',
      virtualSize: code.length,
      virtualAddress: this.textRVA,
      rawDataSize: textSize,
      rawDataPointer: headerSize,
      characteristics: 0x60000020,  // CODE | EXECUTE | READ
    });
    
    // .rdata section
    offset = this.writeSectionHeader(buffer, offset, {
      name: '.rdata',
      virtualSize: importData.length,
      virtualAddress: this.rdataRVA,
      rawDataSize: rdataSize,
      rawDataPointer: headerSize + textSize,
      characteristics: 0x40000040,  // INITIALIZED_DATA | READ
    });
    
    // .data section
    offset = this.writeSectionHeader(buffer, offset, {
      name: '.data',
      virtualSize: data.length,
      virtualAddress: this.dataRVA,
      rawDataSize: dataSize,
      rawDataPointer: headerSize + textSize + rdataSize,
      characteristics: 0xC0000040,  // INITIALIZED_DATA | READ | WRITE
    });
    
    // ========================
    // Section Data
    // ========================
    // .text section
    let dataOffset = headerSize;
    if (code.length > 0) {
      code.copy(buffer, dataOffset);
    }
    dataOffset += textSize;
    
    // .rdata section (imports)
    if (importData.length > 0) {
      importData.copy(buffer, dataOffset);
    }
    dataOffset += rdataSize;
    
    // .data section
    if (data.length > 0) {
      data.copy(buffer, dataOffset);
    }
    
    return buffer;
  }
  
  // Write DOS Header
  writeDOSHeader(buffer, offset) {
    // DOS MZ signature
    buffer.write('MZ', offset);
    offset += 2;
    
    // DOS header fields (mostly zeros for modern PE)
    buffer.writeUInt16LE(0x90, offset);   // e_cblp: Bytes on last page
    offset += 2;
    buffer.writeUInt16LE(0x03, offset);   // e_cp: Pages in file
    offset += 2;
    buffer.writeUInt16LE(0x00, offset);   // e_crlc: Relocations
    offset += 2;
    buffer.writeUInt16LE(0x04, offset);   // e_cparhdr: Size of header in paragraphs
    offset += 2;
    buffer.writeUInt16LE(0x00, offset);   // e_minalloc
    offset += 2;
    buffer.writeUInt16LE(0xFFFF, offset); // e_maxalloc
    offset += 2;
    buffer.writeUInt16LE(0x00, offset);   // e_ss
    offset += 2;
    buffer.writeUInt16LE(0xB8, offset);   // e_sp
    offset += 2;
    buffer.writeUInt16LE(0x00, offset);   // e_csum
    offset += 2;
    buffer.writeUInt16LE(0x00, offset);   // e_ip
    offset += 2;
    buffer.writeUInt16LE(0x00, offset);   // e_cs
    offset += 2;
    buffer.writeUInt16LE(0x40, offset);   // e_lfarlc: Offset to relocation table
    offset += 2;
    buffer.writeUInt16LE(0x00, offset);   // e_ovno: Overlay number
    offset += 2;
    
    // Reserved words (8 bytes)
    offset += 8;
    
    buffer.writeUInt16LE(0x00, offset);   // e_oemid
    offset += 2;
    buffer.writeUInt16LE(0x00, offset);   // e_oeminfo
    offset += 2;
    
    // Reserved words (20 bytes)
    offset += 20;
    
    // e_lfanew: Offset to PE header (at offset 0x3C)
    buffer.writeUInt32LE(0x80, offset);   // PE header at 0x80
    offset += 4;
    
    // DOS stub program (optional, we skip it)
    // Pad to PE header offset
    return 0x80;
  }
  
  // Write PE Signature
  writePESignature(buffer, offset) {
    buffer.write('PE\0\0', offset);
    return offset + 4;
  }
  
  // Write COFF Header (20 bytes)
  writeCOFFHeader(buffer, offset, numSections) {
    buffer.writeUInt16LE(0x8664, offset);      // Machine: AMD64
    offset += 2;
    buffer.writeUInt16LE(numSections, offset); // NumberOfSections
    offset += 2;
    buffer.writeUInt32LE(0, offset);           // TimeDateStamp
    offset += 4;
    buffer.writeUInt32LE(0, offset);           // PointerToSymbolTable
    offset += 4;
    buffer.writeUInt32LE(0, offset);           // NumberOfSymbols
    offset += 4;
    buffer.writeUInt16LE(240, offset);         // SizeOfOptionalHeader (PE32+)
    offset += 2;
    // Characteristics: EXECUTABLE_IMAGE | LARGE_ADDRESS_AWARE
    buffer.writeUInt16LE(0x0022, offset);
    offset += 2;
    return offset;
  }
  
  // Write Optional Header (PE32+ format, 240 bytes)
  writeOptionalHeader(buffer, offset, params) {
    // PE32+ Magic
    buffer.writeUInt16LE(0x020B, offset);
    offset += 2;
    
    // Linker version
    buffer.writeUInt8(14, offset);   // Major
    offset += 1;
    buffer.writeUInt8(0, offset);    // Minor
    offset += 1;
    
    buffer.writeUInt32LE(params.codeSize, offset);     // SizeOfCode
    offset += 4;
    buffer.writeUInt32LE(params.dataSize, offset);     // SizeOfInitializedData
    offset += 4;
    buffer.writeUInt32LE(0, offset);                    // SizeOfUninitializedData
    offset += 4;
    buffer.writeUInt32LE(params.entryPoint, offset);   // AddressOfEntryPoint
    offset += 4;
    buffer.writeUInt32LE(params.codeBase, offset);     // BaseOfCode
    offset += 4;
    
    // ImageBase (64-bit for PE32+)
    buffer.writeBigUInt64LE(this.imageBase, offset);
    offset += 8;
    
    buffer.writeUInt32LE(this.sectionAlignment, offset); // SectionAlignment
    offset += 4;
    buffer.writeUInt32LE(this.fileAlignment, offset);    // FileAlignment
    offset += 4;
    
    // OS Version
    buffer.writeUInt16LE(6, offset);   // Major (Windows Vista+)
    offset += 2;
    buffer.writeUInt16LE(0, offset);   // Minor
    offset += 2;
    
    // Image Version
    buffer.writeUInt16LE(0, offset);
    offset += 2;
    buffer.writeUInt16LE(0, offset);
    offset += 2;
    
    // Subsystem Version
    buffer.writeUInt16LE(6, offset);   // Major
    offset += 2;
    buffer.writeUInt16LE(0, offset);   // Minor
    offset += 2;
    
    buffer.writeUInt32LE(0, offset);   // Win32VersionValue (reserved)
    offset += 4;
    
    buffer.writeUInt32LE(params.imageSize, offset);    // SizeOfImage
    offset += 4;
    buffer.writeUInt32LE(params.headerSize, offset);   // SizeOfHeaders
    offset += 4;
    buffer.writeUInt32LE(0, offset);                    // CheckSum
    offset += 4;
    
    buffer.writeUInt16LE(3, offset);   // Subsystem: CONSOLE
    offset += 2;
    // DllCharacteristics: NX_COMPAT | TERMINAL_SERVER_AWARE
    // NOT using DYNAMIC_BASE (ASLR) because we use absolute addresses for string references
    buffer.writeUInt16LE(0x8100, offset);
    offset += 2;
    
    // Stack/Heap sizes (64-bit values for PE32+)
    buffer.writeBigUInt64LE(0x100000n, offset);  // SizeOfStackReserve (1MB)
    offset += 8;
    buffer.writeBigUInt64LE(0x1000n, offset);    // SizeOfStackCommit (4KB)
    offset += 8;
    buffer.writeBigUInt64LE(0x100000n, offset);  // SizeOfHeapReserve (1MB)
    offset += 8;
    buffer.writeBigUInt64LE(0x1000n, offset);    // SizeOfHeapCommit (4KB)
    offset += 8;
    
    buffer.writeUInt32LE(0, offset);   // LoaderFlags
    offset += 4;
    buffer.writeUInt32LE(16, offset);  // NumberOfRvaAndSizes
    offset += 4;
    
    // Data Directories (16 entries, 8 bytes each = 128 bytes)
    // Only Import Directory is used for our minimal PE
    
    // Export Directory
    buffer.writeUInt32LE(0, offset); offset += 4;
    buffer.writeUInt32LE(0, offset); offset += 4;
    
    // Import Directory
    buffer.writeUInt32LE(params.importRVA, offset); offset += 4;
    buffer.writeUInt32LE(params.importSize, offset); offset += 4;
    
    // Resource, Exception, Certificate, Base Relocation, Debug, Architecture,
    // Global Ptr, TLS, Load Config, Bound Import, IAT, Delay Import, CLR Runtime, Reserved
    for (let i = 0; i < 14; i++) {
      buffer.writeUInt32LE(0, offset); offset += 4;
      buffer.writeUInt32LE(0, offset); offset += 4;
    }
    
    return offset;
  }
  
  // Write Section Header (40 bytes)
  writeSectionHeader(buffer, offset, section) {
    // Name (8 bytes, null-padded)
    const nameBuffer = Buffer.alloc(8);
    nameBuffer.write(section.name);
    nameBuffer.copy(buffer, offset);
    offset += 8;
    
    buffer.writeUInt32LE(section.virtualSize, offset);      // VirtualSize
    offset += 4;
    buffer.writeUInt32LE(section.virtualAddress, offset);   // VirtualAddress
    offset += 4;
    buffer.writeUInt32LE(section.rawDataSize, offset);      // SizeOfRawData
    offset += 4;
    buffer.writeUInt32LE(section.rawDataPointer, offset);   // PointerToRawData
    offset += 4;
    buffer.writeUInt32LE(0, offset);  // PointerToRelocations
    offset += 4;
    buffer.writeUInt32LE(0, offset);  // PointerToLinenumbers
    offset += 4;
    buffer.writeUInt16LE(0, offset);  // NumberOfRelocations
    offset += 2;
    buffer.writeUInt16LE(0, offset);  // NumberOfLinenumbers
    offset += 2;
    buffer.writeUInt32LE(section.characteristics, offset);  // Characteristics
    offset += 4;
    
    return offset;
  }
  
  // Get default imports for Aurora runtime
  getDefaultImports() {
    return {
      'kernel32.dll': [
        'ExitProcess',
        'GetStdHandle',
        'WriteFile',
        'CreateThread',
        'WaitForSingleObject',
        'CloseHandle',
      ]
    };
  }
  
  // Build import data structure
  buildImportData(imports) {
    // For simplicity, we'll create a minimal import structure
    // that only imports from kernel32.dll
    
    const dllName = 'kernel32.dll';
    const functions = imports[dllName] || ['ExitProcess', 'GetStdHandle', 'WriteFile'];
    
    // Calculate sizes
    // Import Directory Entry: 20 bytes per DLL + 20 bytes null terminator
    // Import Lookup Table (ILT): 8 bytes per function + 8 bytes null terminator
    // Import Address Table (IAT): same as ILT
    // Hint/Name Table: 2 bytes hint + function name + null + padding
    // DLL name string
    
    const numFunctions = functions.length;
    const iltSize = (numFunctions + 1) * 8;
    const iatSize = (numFunctions + 1) * 8;
    
    // Calculate string offsets
    let stringOffset = 40 + iltSize + iatSize;  // After IDT + ILT + IAT
    
    // DLL name
    const dllNameOffset = stringOffset;
    stringOffset += dllName.length + 1;  // +1 for null
    stringOffset = this.align(stringOffset, 2);
    
    // Function hints/names
    const hintNameOffsets = [];
    for (const func of functions) {
      hintNameOffsets.push(stringOffset);
      stringOffset += 2 + func.length + 1;  // 2 bytes hint + name + null
      stringOffset = this.align(stringOffset, 2);
    }
    
    const totalSize = stringOffset;
    const buffer = Buffer.alloc(totalSize);
    let offset = 0;
    
    // Import Directory Table (one entry + null terminator)
    // Entry for kernel32.dll
    const iltRVA = this.rdataRVA + 40;  // After IDT
    const iatRVA = this.rdataRVA + 40 + iltSize;  // After ILT
    const dllNameRVA = this.rdataRVA + dllNameOffset;
    
    buffer.writeUInt32LE(iltRVA, offset);           // OriginalFirstThunk (ILT RVA)
    offset += 4;
    buffer.writeUInt32LE(0, offset);                // TimeDateStamp
    offset += 4;
    buffer.writeUInt32LE(0, offset);                // ForwarderChain
    offset += 4;
    buffer.writeUInt32LE(dllNameRVA, offset);       // Name RVA
    offset += 4;
    buffer.writeUInt32LE(iatRVA, offset);           // FirstThunk (IAT RVA)
    offset += 4;
    
    // Null terminator entry
    offset += 20;
    
    // Import Lookup Table (ILT)
    for (let i = 0; i < numFunctions; i++) {
      const hintNameRVA = this.rdataRVA + hintNameOffsets[i];
      buffer.writeBigUInt64LE(BigInt(hintNameRVA), offset);
      offset += 8;
    }
    // Null terminator
    offset += 8;
    
    // Import Address Table (IAT) - same structure as ILT
    for (let i = 0; i < numFunctions; i++) {
      const hintNameRVA = this.rdataRVA + hintNameOffsets[i];
      buffer.writeBigUInt64LE(BigInt(hintNameRVA), offset);
      offset += 8;
    }
    // Null terminator
    offset += 8;
    
    // DLL name string
    buffer.write(dllName, dllNameOffset);
    
    // Hint/Name entries
    for (let i = 0; i < functions.length; i++) {
      const entryOffset = hintNameOffsets[i];
      buffer.writeUInt16LE(i, entryOffset);  // Hint (ordinal index)
      buffer.write(functions[i], entryOffset + 2);
    }
    
    // Store IAT offset for code generation (used by native_compiler)
    buffer.iatRVA = iatRVA;
    buffer.iatSize = 40;  // Size of Import Directory Table
    
    // Store function offsets for easy lookup
    buffer.functionOffsets = {};
    for (let i = 0; i < functions.length; i++) {
      buffer.functionOffsets[functions[i]] = iatRVA + i * 8;
    }
    
    return buffer;
  }
}

module.exports = { PE64Generator };
