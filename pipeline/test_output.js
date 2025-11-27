// Test Windows console output
// This will use Node.js built-in capabilities to verify the Windows API behavior

const { spawn } = require('child_process');

// Create a simple test that prints to stdout
process.stdout.write("Direct stdout test\n");

// Also verify our hello_world.exe
const child = spawn('.\\build\\hello_world.exe', [], {
  cwd: __dirname,
  stdio: ['inherit', 'inherit', 'inherit']
});

child.on('close', (code) => {
  console.log(`hello_world.exe exited with code ${code}`);
});
