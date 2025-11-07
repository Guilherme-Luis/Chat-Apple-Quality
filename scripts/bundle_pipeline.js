const { spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');

function pythonInVenv() {
  const root = process.cwd();
  const isWin = process.platform === 'win32';
  const venvPython = isWin ? path.join(root, '.venv', 'Scripts', 'python.exe') : path.join(root, '.venv', 'bin', 'python3');
  if (fs.existsSync(venvPython)) return venvPython;
  throw new Error('Python not found in .venv. Run `npm run env` first.');
}

function run(cmd, args) {
  console.log(`> ${cmd} ${args.join(' ')}`);
  const r = spawnSync(cmd, args, { stdio: 'inherit' });
  if (r.error) throw r.error;
  if (r.status !== 0) throw new Error('Bundle failed');
}

try {
  const python = pythonInVenv();
  // call python bundler (we provided bundle_pipeline.py earlier)
  if (fs.existsSync('bundle_pipeline.py')) {
    run(python, ['bundle_pipeline.py']);
    console.log('Bundle pipeline finished.');
  } else {
    console.log('bundle_pipeline.py not found — skipping bundle step.');
  }
} catch (err) {
  console.error(err.message || err);
  process.exit(1);
}
