const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

function run(cmd, args, opts = {}) {
  console.log(`> ${cmd} ${args.join(' ')}`);
  const r = spawnSync(cmd, args, { stdio: 'inherit', shell: false, ...opts });
  if (r.error) throw r.error;
  if (r.status !== 0) {
    throw new Error(`Command failed: ${cmd} ${args.join(' ')} (exit ${r.status})`);
  }
}

function whichPython() {
  const candidates = ['python', 'python3'];
  for (const c of candidates) {
    try {
      const r = spawnSync(c, ['--version'], { encoding: 'utf8' });
      if (r.status === 0) return c;
    } catch (e) {}
  }
  throw new Error('Python not found in PATH. Please install Python 3.8+ and ensure "python" or "python3" is on PATH.');
}

function main() {
  const root = process.cwd();
  const venvDir = path.join(root, '.venv');
  const pythonCmd = whichPython();

  // Create venv if not exists
  if (!fs.existsSync(venvDir)) {
    console.log('Creating Python venv (.venv)...');
    run(pythonCmd, ['-m', 'venv', '.venv']);
  } else {
    console.log('.venv already exists — skipping venv creation.');
  }

  // Determine python executable inside venv
  const isWin = process.platform === 'win32';
  const venvPython = isWin ? path.join(venvDir, 'Scripts', 'python.exe') : path.join(venvDir, 'bin', 'python3');
  if (!fs.existsSync(venvPython)) {
    // fallback: on some systems the venv python is 'python'
    const alt = isWin ? path.join(venvDir, 'Scripts', 'python') : path.join(venvDir, 'bin', 'python');
    if (fs.existsSync(alt)) {
      // use alt
      console.log('Using alternate python in venv:', alt);
    } else {
      throw new Error('Python executable not found in .venv after creation.');
    }
  }

  // Install requirements
  console.log('Installing Python dependencies from requirements.txt into .venv ...');
  run(venvPython, ['-m', 'pip', 'install', '--upgrade', 'pip']);
  run(venvPython, ['-m', 'pip', 'install', '-r', 'requirements.txt']);

  console.log('Python environment ready (inside .venv).');
}

try {
  main();
} catch (err) {
  console.error('Error during setup_python_env:', err.message || err);
  process.exit(1);
}
