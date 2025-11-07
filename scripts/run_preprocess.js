const { spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');

function pythonInVenv() {
  const root = process.cwd();
  const isWin = process.platform === 'win32';
  const venvPython = isWin ? path.join(root, '.venv', 'Scripts', 'python.exe') : path.join(root, '.venv', 'bin', 'python3');
  if (fs.existsSync(venvPython)) return venvPython;
  // fallback
  if (fs.existsSync(path.join(root, '.venv', 'bin', 'python'))) return path.join(root, '.venv', 'bin', 'python');
  if (fs.existsSync(path.join(root, '.venv', 'Scripts', 'python'))) return path.join(root, '.venv', 'Scripts', 'python');
  throw new Error('Python not found in .venv. Run `npm run env` first.');
}

function run(cmd, args) {
  console.log(`> ${cmd} ${args.join(' ')}`);
  const r = spawnSync(cmd, args, { stdio: 'inherit' });
  if (r.error) throw r.error;
  if (r.status !== 0) throw new Error('Preprocess failed');
}

try {
  const python = pythonInVenv();
  // adjust args as needed; we run preprocess_pipeline.py
  run(python, ['src/preprocess_pipeline.py', '--input', 'resources/apple_quality.csv', '--out-dir', 'resources']);
  console.log('Preprocessing finished.');
} catch (err) {
  console.error(err.message || err);
  process.exit(1);
}
