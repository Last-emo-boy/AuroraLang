#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const parser = require('./parser');
const codegen = require('./codegen');
const IR = require('./ir');

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
  } catch (err) {
    console.error(`[aurora-pipeline] error: ${err.message}`);
    if (process.env.DEBUG) {
      console.error(err.stack);
    }
    process.exitCode = 1;
  }
}

function printUsage() {
  console.error('Usage: node pipeline/src/pipeline_driver.js compile <input.aur> -o <output.aurs>');
}

if (require.main === module) {
  main(process.argv);
}

module.exports = { compileFile };
