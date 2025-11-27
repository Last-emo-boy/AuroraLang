#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

// Use v2 parser (recursive descent) by default, fallback to v1 if needed
let parser;
try {
  parser = require('./parser_v2');
} catch (e) {
  console.warn('[aurora-pipeline] Warning: parser_v2 not available, using legacy parser');
  parser = require('./parser');
}

const codegen = require('./codegen');
const IR = require('./ir');

// Native code generator (lazy load)
let nativeCompiler = null;
let nativeCompilerWin = null;

function getNativeCompiler() {
  if (!nativeCompiler) {
    nativeCompiler = require('./backend/native_compiler');
  }
  return nativeCompiler;
}

function getNativeCompilerWin() {
  if (!nativeCompilerWin) {
    nativeCompilerWin = require('./backend/native_compiler_win');
  }
  return nativeCompilerWin;
}

function compileFile(inputPath, outputPath) {
  console.log(`[aurora-pipeline] compiling ${inputPath} ...`);
  
  const source = fs.readFileSync(inputPath, 'utf8');
  const irProgram = parser.parseSource(source, inputPath);
  
  // Debug: print IR
  if (process.env.DEBUG_IR) {
    console.log('[DEBUG] IR Program:', JSON.stringify(irProgram, null, 2));
  }
  
  const errors = IR.validateProgram(irProgram);
  if (errors.length > 0) {
    console.error('[aurora-pipeline] IR validation errors:');
    errors.forEach(err => console.error(`  - ${err}`));
    throw new Error('IR validation failed');
  }
  
  const codeGenCtx = codegen.generateProgram(irProgram);
  const manifest = codegen.emitManifest(codeGenCtx, inputPath);
  
  fs.writeFileSync(outputPath, manifest, 'utf8');
  console.log(`[aurora-pipeline] wrote manifest to ${outputPath}`);
}

// Compile directly to native ELF64 (source -> manifest -> native)
function compileToNative(inputPath, outputPath, target = 'linux') {
  const targetName = target === 'windows' ? 'Windows PE64' : 'Linux ELF64';
  console.log(`[aurora-pipeline] compiling ${inputPath} to ${targetName} ...`);
  
  // Step 1: Parse and generate manifest
  const source = fs.readFileSync(inputPath, 'utf8');
  const irProgram = parser.parseSource(source, inputPath);
  
  const errors = IR.validateProgram(irProgram);
  if (errors.length > 0) {
    console.error('[aurora-pipeline] IR validation errors:');
    errors.forEach(err => console.error(`  - ${err}`));
    throw new Error('IR validation failed');
  }
  
  const codeGenCtx = codegen.generateProgram(irProgram);
  const manifest = codegen.emitManifest(codeGenCtx, inputPath);
  
  // Step 2: Compile manifest to native
  let outputBuffer;
  if (target === 'windows') {
    const compiler = getNativeCompilerWin();
    outputBuffer = compiler.compileManifestToWindows(manifest);
  } else {
    const compiler = getNativeCompiler();
    outputBuffer = compiler.compileManifest(manifest);
  }
  
  fs.writeFileSync(outputPath, outputBuffer);
  console.log(`[aurora-pipeline] wrote ${targetName} to ${outputPath} (${outputBuffer.length} bytes)`);
}

function main(argv) {
  const [,, command, inputPath, ...rest] = argv;
  
  if (command !== 'compile' && command !== 'native' && command !== 'native-win') {
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
  let target = 'linux';  // Default target
  
  for (let i = 0; i < rest.length; i += 1) {
    const arg = rest[i];
    if ((arg === '-o' || arg === '--output') && rest[i + 1]) {
      outputPath = rest[i + 1];
      i += 1;
    } else if (arg === '--target' && rest[i + 1]) {
      target = rest[i + 1].toLowerCase();
      i += 1;
    } else if (arg === '-t' && rest[i + 1]) {
      target = rest[i + 1].toLowerCase();
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
    if (command === 'compile') {
      compileFile(inputPath, outputPath);
    } else if (command === 'native') {
      compileToNative(inputPath, outputPath, target);
    } else if (command === 'native-win') {
      // Shortcut for --target=windows
      compileToNative(inputPath, outputPath, 'windows');
    }
  } catch (err) {
    console.error(`[aurora-pipeline] error: ${err.message}`);
    if (process.env.DEBUG) {
      console.error(err.stack);
    }
    process.exitCode = 1;
  }
}

function printUsage() {
  console.error('Usage:');
  console.error('  node pipeline_driver.js compile <input.aur> -o <output.aurs>');
  console.error('  node pipeline_driver.js native <input.aur> -o <output.elf> [--target linux|windows]');
  console.error('  node pipeline_driver.js native-win <input.aur> -o <output.exe>');
  console.error('');
  console.error('Targets:');
  console.error('  linux    - Generate Linux x86-64 ELF64 executable (default)');
  console.error('  windows  - Generate Windows x64 PE64 executable');
}

if (require.main === module) {
  main(process.argv);
}

module.exports = { compileFile, compileToNative };
