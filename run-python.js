// Run the project's Python scripts on Windows, macOS, and Linux.
const { spawnSync } = require('child_process');

const candidates = process.env.PYTHON
  ? [[process.env.PYTHON, []]]
  : process.platform === 'win32'
    ? [['py', ['-3']], ['python', []], ['python3', []]]
    : [['python3', []], ['python', []]];

for (const [command, prefix] of candidates) {
  const probe = spawnSync(command, [...prefix, '-c', 'import sys; sys.exit(sys.version_info[0] != 3)'], { stdio: 'ignore' });
  if (probe.error || probe.status !== 0) continue;

  const result = spawnSync(command, [...prefix, ...process.argv.slice(2)], { stdio: 'inherit' });
  if (result.error) {
    console.error(result.error.message);
    process.exit(1);
  }
  process.exit(result.status === null ? 1 : result.status);
}

console.error('Python 3 was not found. Install it or set PYTHON to its executable path.');
process.exit(1);
