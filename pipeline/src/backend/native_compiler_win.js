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
};

// Parse .aurs manifest file (reuse from native_compiler.js)
function parseManifest(content) {
  const lines = content.split('\n');
  const instructions = [];
  const labels = new Map();
  const strings = new Map();
  
  for (const line of lines) {
    const trimmed = line.trim();
    
    if (trimmed.startsWith('#') || trimmed === '') continue;
    
    if (trimmed.startsWith('bytes ')) {
      const parts = trimmed.substring(6).split(';');
      const hex = parts[0].trim();
      const comment = parts.slice(1).join(';').trim();
      
      const value = BigInt(hex);
      const instr = {
        type: 'instruction',
        raw: value,
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
        
        if (jmpMatch) {
          instr.jumpTarget = jmpMatch[1];
        } else if (cjmpMatch) {
          instr.jumpTarget = cjmpMatch[1];
        } else if (callMatch) {
          instr.jumpTarget = callMatch[1];
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
  
  return { instructions, labels, strings };
}

// Compile manifest to Windows native code
function compileToWindows(manifest) {
  const encoder = new X86EncoderWin64();
  const { instructions, labels, strings } = manifest;
  
  // Add strings to data section
  const stringLabels = new Map();
  const stringLengths = new Map();
  for (const [name, str] of strings) {
    const label = encoder.addString(str);
    stringLabels.set(name, label);
    stringLengths.set(name, str.length);
  }
  
  // Generate Windows startup code
  // Win64 ABI requires 32-byte shadow space on stack
  // Also need to align stack to 16 bytes
  // Reserve extra space for print syscall (handle, bytesWritten, etc.)
  
  // Entry point - setup stack frame
  // Allocate 72 bytes: 32 shadow + 8 alignment + 32 for locals (print syscall needs handle, bytesWritten)
  encoder.subRspImm(0x48);
  
  // Map instruction indices to code offsets
  const instrOffsets = new Map();
  
  // Track which string is loaded in r1 (for print syscall)
  let lastStringInR1 = null;
  
  // Generate code for each instruction
  for (let i = 0; i < instructions.length; i++) {
    instrOffsets.set(i, encoder.code.length);
    const instr = instructions[i];
    
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
    
    compileInstructionWin64(encoder, instr, stringLabels, stringLengths);
  }
  
  // Record label positions
  for (const [name, offset] of labels) {
    if (instrOffsets.has(offset)) {
      encoder.labels.set(name, instrOffsets.get(offset));
    }
  }
  
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
        encoder.jccRel32(op0, target);
      }
      break;
      
    case OPCODE.CALL:
      if (op0 === 0xFE) {
        const target = instr.jumpTarget || '__pending__';
        encoder.callRel32(target);
      }
      break;
      
    case OPCODE.RET:
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
      
    default:
      encoder.emit(0x90);  // NOP
  }
}

// Compile manifest to Windows PE
function compileManifestToWindows(manifestContent) {
  const manifest = parseManifest(manifestContent);
  
  // Compile to Windows x64
  const { encoder, stringLengths } = compileToWindows(manifest);
  
  // Generate PE64
  const peGen = new PE64Generator();
  
  // Build import data
  const importData = peGen.buildImportData({
    'kernel32.dll': ['ExitProcess', 'GetStdHandle', 'WriteFile']
  });
  
  // Set up import addresses for the encoder
  encoder.setImport('ExitProcess', Number(peGen.imageBase) + importData.functionOffsets['ExitProcess']);
  encoder.setImport('GetStdHandle', Number(peGen.imageBase) + importData.functionOffsets['GetStdHandle']);
  encoder.setImport('WriteFile', Number(peGen.imageBase) + importData.functionOffsets['WriteFile']);
  
  // Resolve relocations
  encoder.resolve(
    peGen.textAddr,
    peGen.dataAddr,
    Number(peGen.imageBase) + peGen.rdataRVA
  );
  
  // Get code and data
  const code = encoder.getCode();
  const data = encoder.getData();
  
  // Generate PE
  return peGen.generate(code, data, {
    'kernel32.dll': ['ExitProcess', 'GetStdHandle', 'WriteFile']
  });
}

// Main compilation function
function compile(inputPath, outputPath) {
  console.log(`[aurora-win] compiling ${inputPath}...`);
  
  const content = fs.readFileSync(inputPath, 'utf8');
  const peBuffer = compileManifestToWindows(content);
  
  fs.writeFileSync(outputPath, peBuffer);
  console.log(`[aurora-win] wrote executable to ${outputPath} (${peBuffer.length} bytes)`);
}

// CLI interface
if (require.main === module) {
  const args = process.argv.slice(2);
  
  if (args.length < 3 || args[1] !== '-o') {
    console.log('Usage: node native_compiler_win.js <input.aurs> -o <output.exe>');
    process.exit(1);
  }
  
  const inputPath = args[0];
  const outputPath = args[2];
  
  try {
    compile(inputPath, outputPath);
  } catch (err) {
    console.error(`[aurora-win] error: ${err.message}`);
    console.error(err.stack);
    process.exit(1);
  }
}

module.exports = { compile, compileManifestToWindows, parseManifest };
