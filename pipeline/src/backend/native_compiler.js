/**
 * Aurora Manifest to Native Compiler
 * 
 * Compiles .aurs manifest files to native x86-64 Linux executables.
 * 
 * Usage:
 *   node native_compiler.js <input.aurs> -o <output>
 */

const fs = require('fs');
const path = require('path');
const { X86Encoder, OPCODE, COND } = require('./x86_encoder');
const { ELF64Generator } = require('./elf64_generator');

// Linux x86-64 syscall numbers
const SYSCALL = {
  WRITE: 1,
  EXIT: 60,
};

// Parse .aurs manifest file
function parseManifest(content) {
  const lines = content.split('\n');
  const instructions = [];
  const labels = new Map();
  const strings = new Map();
  
  for (const line of lines) {
    const trimmed = line.trim();
    
    // Skip comments and empty lines
    if (trimmed.startsWith('#') || trimmed === '') continue;
    
    // Parse bytes directive
    if (trimmed.startsWith('bytes ')) {
      // Split on ; to separate hex from comment
      const parts = trimmed.substring(6).split(';');
      const hex = parts[0].trim();
      const comment = parts.slice(1).join(';').trim();  // Rejoin in case comment has ;
      
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
      
      // Extract jump target from comment (e.g., "jmp fn_main", "cjmp (negated >), else_0")
      if (comment) {
        // Match "jmp <label>" or "cjmp ..., <label>"
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
    
    // Parse label directive
    if (trimmed.startsWith('label ')) {
      const parts = trimmed.substring(6).split(' ');
      const name = parts[0];
      const offset = parseInt(parts[1], 10);
      labels.set(name, offset);
    }
    
    // Parse string directive
    if (trimmed.startsWith('string ')) {
      // Handle multi-line strings or strings with actual newlines
      // The format is: string "content"
      const startQuote = trimmed.indexOf('"');
      if (startQuote !== -1) {
        // Find the content after the opening quote
        const afterQuote = trimmed.substring(startQuote + 1);
        // Check if it ends with a quote on this line
        if (afterQuote.endsWith('"')) {
          // Single line string
          let str = afterQuote.slice(0, -1);
          // Unescape
          str = str
            .replace(/\\n/g, '\n')
            .replace(/\\r/g, '\r')
            .replace(/\\t/g, '\t')
            .replace(/\\\\/g, '\\');
          strings.set(`str_${strings.size}`, str);
        } else {
          // String continues to next line (actual newline in string)
          // For now, handle the common case of trailing newline
          let str = afterQuote;
          // The closing quote might be on the next iteration - for now just use what we have
          str = str
            .replace(/\\n/g, '\n')
            .replace(/\\r/g, '\r')
            .replace(/\\t/g, '\t')
            .replace(/\\\\/g, '\\');
          strings.set(`str_${strings.size}`, str + '\n'); // Assume newline was split
        }
      }
    }
  }
  
  return { instructions, labels, strings };
}

// Compile manifest to native code
function compileToNative(manifest) {
  const encoder = new X86Encoder();
  const { instructions, labels, strings } = manifest;
  
  // Add strings to data section
  const stringLabels = new Map();
  for (const [name, str] of strings) {
    const label = encoder.addString(str);
    stringLabels.set(name, label);
  }
  
  // ===== STACK FRAME SETUP =====
  // Linux System V ABI requires 16-byte stack alignment
  // We allocate space for spilled registers (similar to Windows)
  const SPILL_SLOTS = 16;  // Support up to 16 spilled variables
  const FRAME_SIZE = SPILL_SLOTS * 8;  // 128 bytes for spill slots
  
  // SUB RSP, FRAME_SIZE
  encoder.emit(0x48, 0x81, 0xEC);  // SUB RSP, imm32
  encoder.emit(FRAME_SIZE & 0xFF);
  encoder.emit((FRAME_SIZE >> 8) & 0xFF);
  encoder.emit((FRAME_SIZE >> 16) & 0xFF);
  encoder.emit((FRAME_SIZE >> 24) & 0xFF);
  
  // Map instruction indices to code offsets
  const instrOffsets = new Map();
  
  // First pass: generate code and record instruction offsets
  for (let i = 0; i < instructions.length; i++) {
    instrOffsets.set(i, encoder.code.length);
    const instr = instructions[i];
    compileInstruction(encoder, instr, stringLabels);
  }
  
  // Record label positions
  for (const [name, offset] of labels) {
    if (instrOffsets.has(offset)) {
      encoder.labels.set(name, instrOffsets.get(offset));
    }
  }
  
  return encoder;
}

// Compile a single Aurora instruction to x86-64
function compileInstruction(encoder, instr, stringLabels) {
  const { opcode, op0, op1, op2, imm32 } = instr;
  
  // Handle signed immediate
  const signedImm = imm32 > 0x7FFFFFFF ? imm32 - 0x100000000 : imm32;
  
  switch (opcode) {
    case OPCODE.NOP:
      encoder.emit(0x90);  // nop
      break;
      
    case OPCODE.MOV:
      if (op1 === 0xFE) {
        // MOV reg, @label (string address)
        // Extract string label from comment (e.g., "mov r1, @str_0 ; message")
        let strName = null;
        if (instr.comment) {
          const match = instr.comment.match(/@(str_\d+)/);
          if (match) {
            strName = match[1];
          }
        }
        
        // Get the corresponding native label
        const nativeLabel = strName && stringLabels.has(strName) 
          ? stringLabels.get(strName) 
          : '_str_0';
        
        // mov reg, imm64 will be patched later
        encoder.movRegImm64(op0, 0);  // Placeholder
        // Record that this needs data relocation
        encoder.relocations.push({
          offset: encoder.code.length - 8,
          label: nativeLabel,
          type: 'abs64'
        });
      } else if (op1 === 0xFF) {
        // MOV reg, #imm
        encoder.movRegImm64(op0, signedImm);
      } else {
        // MOV reg, reg
        encoder.movRegReg(op0, op1);
      }
      break;
      
    case OPCODE.ADD:
      if (op2 === 0xFF) {
        // ADD reg, reg, #imm -> add dst, imm (after mov dst, src)
        if (op0 !== op1) {
          encoder.movRegReg(op0, op1);
        }
        encoder.addRegImm32(op0, signedImm);
      } else {
        // ADD reg, reg, reg
        if (op0 !== op1) {
          encoder.movRegReg(op0, op1);
        }
        encoder.addRegReg(op0, op2);
      }
      break;
      
    case OPCODE.SUB:
      if (op2 === 0xFF) {
        // SUB reg, reg, #imm
        if (op0 !== op1) {
          encoder.movRegReg(op0, op1);
        }
        encoder.subRegImm32(op0, signedImm);
      } else {
        // SUB reg, reg, reg
        if (op0 !== op1) {
          encoder.movRegReg(op0, op1);
        }
        encoder.subRegReg(op0, op2);
      }
      break;
      
    case OPCODE.MUL:
      if (op2 === 0xFF) {
        // MUL reg, reg, #imm
        encoder.imulRegImm32(op0, op1, signedImm);
      } else {
        // MUL reg, reg, reg
        if (op0 !== op1) {
          encoder.movRegReg(op0, op1);
        }
        encoder.imulRegReg(op0, op2);
      }
      break;
      
    case OPCODE.DIV:
      // DIV reg, reg, reg -> reg = reg / reg
      if (op0 !== op1) {
        encoder.movRegReg(op0, op1);
      }
      encoder.idivReg(op0, op2);
      break;
      
    case OPCODE.REM:
      // REM reg, reg, reg -> reg = reg % reg
      if (op0 !== op1) {
        encoder.movRegReg(op0, op1);
      }
      encoder.iremReg(op0, op2);
      break;
      
    case OPCODE.CMP:
      if (op1 === 0xFF) {
        // CMP reg, #imm
        encoder.cmpRegImm32(op0, signedImm);
      } else {
        // CMP reg, reg
        encoder.cmpRegReg(op0, op1);
      }
      break;
      
    case OPCODE.JMP:
      if (op0 === 0xFE) {
        // JMP @label - use jumpTarget from comment
        const target = instr.jumpTarget || '__pending__';
        encoder.jmpRel32(target);
      }
      break;
      
    case OPCODE.CJMP:
      // Conditional jump - use jumpTarget from comment
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
      // System call
      compileSyscall(encoder, op0, op1);
      break;
      
    case OPCODE.HALT:
      // Exit with code 0
      encoder.movRegImm64(0, 0);   // rax = 0 (exit code)
      encoder.movRegImm64(0, 60);  // Actually set syscall number
      // mov rax, 60 (exit syscall)
      encoder.code.splice(-10);  // Remove previous
      encoder.movRegImm64(1, 0);   // rdi = 0 (exit code)
      encoder.emit(0x48, 0xC7, 0xC0, 0x3C, 0x00, 0x00, 0x00);  // mov eax, 60
      encoder.syscall();
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
        encoder.shlRegImm8(op0, signedImm);
      }
      break;
      
    case OPCODE.SHR:
      if (op2 === 0xFF) {
        if (op0 !== op1) encoder.movRegReg(op0, op1);
        encoder.shrRegImm8(op0, signedImm);
      }
      break;
      
    case OPCODE.STORE_STACK:
      // STORE_STACK slot, reg -> [RSP+slot*8], reg
      encoder.movStackReg(op0 * 8, op1);
      break;
      
    case OPCODE.LOAD_STACK:
      // LOAD_STACK reg, slot -> reg, [RSP+slot*8]
      encoder.movRegStack(op0, op1 * 8);
      break;
      
    default:
      console.warn(`Unknown opcode: 0x${opcode.toString(16)}`);
      encoder.emit(0x90);  // nop
  }
}

// Compile Aurora SVC to Linux syscall
function compileSyscall(encoder, serviceCode, op1) {
  switch (serviceCode) {
    case 0x01:  // print
      // Linux write(fd, buf, len)
      // rax = 1 (write), rdi = fd, rsi = buf, rdx = len
      // Aurora: r1 has string address
      
      // mov rax, 1 (write syscall)
      encoder.emit(0x48, 0xC7, 0xC0, 0x01, 0x00, 0x00, 0x00);
      
      // mov rdi, 1 (stdout)
      encoder.emit(0x48, 0xC7, 0xC7, 0x01, 0x00, 0x00, 0x00);
      
      // rsi already has the string address from r1 mapping
      // We need: mov rsi, rdi (Aurora r1 -> x86 rdi, but we need it in rsi)
      // Actually Aurora r1 maps to x86 rdi, so we need to shuffle
      // Let's use r11 as temp
      encoder.emit(0x49, 0x89, 0xFB);  // mov r11, rdi
      encoder.emit(0x4C, 0x89, 0xDE);  // mov rsi, r11
      
      // mov rdx, string_length (we'll use a fixed length for now)
      // For proper implementation, we'd need to calculate string length
      encoder.emit(0x48, 0xC7, 0xC2, 0x10, 0x00, 0x00, 0x00);  // 16 bytes max
      
      encoder.syscall();
      break;
      
    case 0x02:  // exit
      // Linux exit(code)
      // rax = 60, rdi = exit code
      // Aurora: r0 has exit code, maps to rax
      
      // mov rdi, rax (exit code from Aurora r0)
      encoder.emit(0x48, 0x89, 0xC7);  // mov rdi, rax
      
      // mov rax, 60 (exit syscall)
      encoder.emit(0x48, 0xC7, 0xC0, 0x3C, 0x00, 0x00, 0x00);
      
      encoder.syscall();
      break;
      
    case 0x03:  // pause - wait for Enter, show exit code
      // Aurora: r0 has exit code
      // We'll print "Exit code: <num>\nPress Enter to continue..." then read
      
      // Save exit code (rax) to r12
      encoder.emit(0x49, 0x89, 0xC4);  // mov r12, rax
      
      // Print "Exit code: "
      // First, let's print the static prefix
      // For simplicity, we'll print a minimal message
      // In practice, you'd want to convert the number to string
      
      // Write "Exit code: " to stdout
      // We need to add this string to data section - handled by encoder
      
      // For now, let's do a simple version that just waits for Enter
      // mov rax, 0 (read syscall)
      encoder.emit(0x48, 0xC7, 0xC0, 0x00, 0x00, 0x00, 0x00);
      // mov rdi, 0 (stdin)
      encoder.emit(0x48, 0xC7, 0xC7, 0x00, 0x00, 0x00, 0x00);
      // lea rsi, [rsp-8] (buffer on stack)
      encoder.emit(0x48, 0x8D, 0x74, 0x24, 0xF8);
      // mov rdx, 1 (read 1 byte)
      encoder.emit(0x48, 0xC7, 0xC2, 0x01, 0x00, 0x00, 0x00);
      encoder.syscall();
      
      // Restore exit code
      encoder.emit(0x4C, 0x89, 0xE7);  // mov rdi, r12
      
      // exit syscall
      encoder.emit(0x48, 0xC7, 0xC0, 0x3C, 0x00, 0x00, 0x00);  // mov rax, 60
      encoder.syscall();
      break;
      
    case 0x04:  // pause_silent - just wait for Enter
      // read(stdin, buf, 1)
      encoder.emit(0x48, 0xC7, 0xC0, 0x00, 0x00, 0x00, 0x00);  // mov rax, 0
      encoder.emit(0x48, 0xC7, 0xC7, 0x00, 0x00, 0x00, 0x00);  // mov rdi, 0
      encoder.emit(0x48, 0x8D, 0x74, 0x24, 0xF8);              // lea rsi, [rsp-8]
      encoder.emit(0x48, 0xC7, 0xC2, 0x01, 0x00, 0x00, 0x00);  // mov rdx, 1
      encoder.syscall();
      break;
      
    default:
      console.warn(`Unknown service code: 0x${serviceCode.toString(16)}`);
  }
}

// Resolve jump targets
function resolveJumps(encoder, manifest) {
  const { labels } = manifest;
  
  // Build mapping from label name to code offset
  for (const [name, instrIdx] of labels) {
    if (!encoder.labels.has(name)) {
      // Find the code offset for this instruction index
      // This is approximate - we'd need proper tracking
    }
  }
}

// Compile manifest string directly to ELF buffer (for API use)
function compileManifest(manifestContent) {
  const manifest = parseManifest(manifestContent);
  
  // Compile to x86-64
  const encoder = compileToNative(manifest);
  
  // Resolve relocations
  const elfGen = new ELF64Generator();
  encoder.resolve(elfGen.textAddr, elfGen.dataAddr);
  
  // Generate ELF64
  const code = encoder.getCode();
  const data = encoder.getData();
  
  return elfGen.generate(code, data);
}

// Main compilation function
function compile(inputPath, outputPath) {
  console.log(`[aurora-native] compiling ${inputPath}...`);
  
  // Read and parse manifest
  const content = fs.readFileSync(inputPath, 'utf8');
  const manifest = parseManifest(content);
  
  console.log(`[aurora-native] parsed ${manifest.instructions.length} instructions, ${manifest.strings.size} strings`);
  
  // Compile to x86-64
  const encoder = compileToNative(manifest);
  
  // Resolve relocations
  const elfGen = new ELF64Generator();
  encoder.resolve(elfGen.textAddr, elfGen.dataAddr);
  
  // Generate ELF64
  const code = encoder.getCode();
  const data = encoder.getData();
  
  console.log(`[aurora-native] generated ${code.length} bytes of code, ${data.length} bytes of data`);
  
  const elf = elfGen.generate(code, data);
  
  // Write output
  fs.writeFileSync(outputPath, elf);
  fs.chmodSync(outputPath, 0o755);  // Make executable
  
  console.log(`[aurora-native] wrote executable to ${outputPath}`);
}

// CLI interface
if (require.main === module) {
  const args = process.argv.slice(2);
  
  if (args.length < 3 || args[1] !== '-o') {
    console.log('Usage: node native_compiler.js <input.aurs> -o <output>');
    process.exit(1);
  }
  
  const inputPath = args[0];
  const outputPath = args[2];
  
  try {
    compile(inputPath, outputPath);
  } catch (err) {
    console.error(`[aurora-native] error: ${err.message}`);
    process.exit(1);
  }
}

module.exports = { compile, compileManifest, parseManifest, compileToNative };
