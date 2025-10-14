#!/usr/bin/env node

/**
 * Aurora Pipeline Test Suite
 * 
 * Automated regression testing for the compiler pipeline.
 * Compiles all examples and verifies output against expected manifests.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const EXAMPLES_DIR = path.join(__dirname, '../examples');
const BUILD_DIR = path.join(__dirname, '../../build');
const DRIVER = path.join(__dirname, 'pipeline_driver.js');

// Test cases: [input file, expected file, match type]
const TEST_CASES = [
  { name: 'hello_world', matchType: 'set' },  // order-independent
  { name: 'loop_sum', matchType: 'exact' },   // exact byte-for-byte match
];

class TestRunner {
  constructor() {
    this.passed = 0;
    this.failed = 0;
    this.results = [];
  }
  
  run() {
    console.log('🧪 Aurora Pipeline Test Suite\n');
    
    // Ensure build directory exists
    if (!fs.existsSync(BUILD_DIR)) {
      fs.mkdirSync(BUILD_DIR, { recursive: true });
    }
    
    for (const testCase of TEST_CASES) {
      this.runTest(testCase);
    }
    
    this.printSummary();
    process.exit(this.failed > 0 ? 1 : 0);
  }
  
  runTest(testCase) {
    const { name, matchType } = testCase;
    const inputFile = path.join(EXAMPLES_DIR, `${name}.aur`);
    const expectedFile = path.join(EXAMPLES_DIR, `${name}_expected.aurs`);
    const outputFile = path.join(BUILD_DIR, `${name}_test.aurs`);
    
    console.log(`▶ Running test: ${name}`);
    
    try {
      // Compile
      execSync(`node "${DRIVER}" compile "${inputFile}" -o "${outputFile}"`, {
        stdio: 'pipe',
        encoding: 'utf8'
      });
      
      // Extract instruction bytes
      const generatedBytes = this.extractBytes(outputFile);
      const expectedBytes = this.extractBytes(expectedFile);
      
      // Compare
      const passed = matchType === 'exact'
        ? this.compareExact(generatedBytes, expectedBytes)
        : this.compareSet(generatedBytes, expectedBytes);
      
      if (passed) {
        console.log(`  ✅ PASS (${generatedBytes.length} instructions)\n`);
        this.passed++;
        this.results.push({ name, status: 'PASS' });
      } else {
        console.log(`  ❌ FAIL`);
        console.log(`     Generated: ${generatedBytes.length} instructions`);
        console.log(`     Expected: ${expectedBytes.length} instructions`);
        this.showDiff(generatedBytes, expectedBytes);
        console.log();
        this.failed++;
        this.results.push({ name, status: 'FAIL' });
      }
    } catch (err) {
      console.log(`  ❌ ERROR: ${err.message}\n`);
      this.failed++;
      this.results.push({ name, status: 'ERROR', error: err.message });
    }
  }
  
  extractBytes(filePath) {
    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.split('\n');
    const bytes = [];
    
    for (const line of lines) {
      if (line.startsWith('bytes ')) {
        // Extract hex value, removing comments
        const hex = line.substring(6).split(';')[0].trim();
        bytes.push(hex);
      }
    }
    
    return bytes;
  }
  
  compareExact(generated, expected) {
    if (generated.length !== expected.length) return false;
    
    for (let i = 0; i < generated.length; i++) {
      if (generated[i] !== expected[i]) return false;
    }
    
    return true;
  }
  
  compareSet(generated, expected) {
    if (generated.length !== expected.length) return false;
    
    const genSorted = [...generated].sort();
    const expSorted = [...expected].sort();
    
    return this.compareExact(genSorted, expSorted);
  }
  
  showDiff(generated, expected) {
    const maxLen = Math.max(generated.length, expected.length);
    
    for (let i = 0; i < maxLen; i++) {
      const gen = generated[i] || '(missing)';
      const exp = expected[i] || '(missing)';
      
      if (gen !== exp) {
        console.log(`     [${i}] ${gen} != ${exp}`);
      }
    }
  }
  
  printSummary() {
    console.log('━'.repeat(60));
    console.log(`\n📊 Test Summary:\n`);
    console.log(`   Total:  ${this.passed + this.failed}`);
    console.log(`   Passed: ${this.passed} ✅`);
    console.log(`   Failed: ${this.failed} ❌`);
    console.log();
    
    if (this.failed === 0) {
      console.log('🎉 All tests passed!');
    } else {
      console.log('💥 Some tests failed. See details above.');
    }
    
    console.log();
  }
}

if (require.main === module) {
  const runner = new TestRunner();
  runner.run();
}

module.exports = { TestRunner };
