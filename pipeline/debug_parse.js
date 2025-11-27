const fs = require('fs');
const manifest = fs.readFileSync('./build/hello_world.aurs', 'utf8');

// Parse using the same logic as native_compiler_win.js
const lines = manifest.split('\n');
for (const line of lines) {
  const trimmed = line.trim();
  if (trimmed.startsWith('string ')) {
    console.log('Found string line:', JSON.stringify(trimmed));
    const startQuote = trimmed.indexOf('"');
    console.log('Start quote pos:', startQuote);
    if (startQuote !== -1) {
      const afterQuote = trimmed.substring(startQuote + 1);
      console.log('After quote:', JSON.stringify(afterQuote));
      console.log('Ends with quote?', afterQuote.endsWith('"'));
      
      let str;
      if (afterQuote.endsWith('"')) {
        str = afterQuote.slice(0, -1);
        str = str
          .replace(/\\n/g, '\n')
          .replace(/\\r/g, '\r')
          .replace(/\\t/g, '\t')
          .replace(/\\\\/g, '\\');
      } else {
        str = afterQuote
          .replace(/\\n/g, '\n')
          .replace(/\\r/g, '\r')
          .replace(/\\t/g, '\t')
          .replace(/\\\\/g, '\\');
        str = str + '\n';
      }
      console.log('Final string:', JSON.stringify(str));
      console.log('String length:', str.length);
    }
  }
}
