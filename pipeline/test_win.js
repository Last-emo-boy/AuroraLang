// Direct Windows API test
const ffi = require('ffi-napi');
const ref = require('ref-napi');

// This is just to test if Windows APIs work correctly
// Will need native packages installed

console.log("Testing direct console output...");
process.stdout.write("Direct write test\n");
