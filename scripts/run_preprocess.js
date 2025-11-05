// scripts/run_preprocess.js
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

function exists(p) {
  try { return fs.existsSync(p); } catch (e) { return false; }
}

function findPythonInVenv() {
  const venvDir = path.resolve('.venv');
  if (!exists(venvDir)) return null;
  const p = process.platform === 'win32'
    ? path.join(venvDir, 'Scripts', 'python.exe')
    : path.join(venvDir, 'bin', 'python');
  return exists(p) ? p : null;
}

function findSystemPython() {
  const candidates = [
    ['py', ['-3', '--version']],
    ['python', ['--version']],
    ['python3', ['--version']]
  ];
  const { spawnSync } = require('child_process');
  for (const [cmd, args] of candidates) {
    try {
      const res = spawnSync(cmd, args, { stdio: 'pipe' });
      if (res.status === 0) return cmd;
    } catch (e) { /* ignore */ }
  }
  return null;
}

function run(cmd, args) {
  console.log(`> ${cmd} ${args.join(' ')}`);
  const res = spawnSync(cmd, args, { stdio: 'inherit' });
  if (res.error) throw res.error;
  if (res.status !== 0) {
    throw new Error(`Command failed: ${cmd} ${args.join(' ')} (exit ${res.status})`);
  }
}

function main() {
  console.log('== Executando preprocessing ==');

  const venvPython = findPythonInVenv();
  const python = venvPython || findSystemPython();

  if (!python) {
    console.error('Nenhum Python encontrado (nem em .venv nem no sistema). Execute manualmente a criação do venv ou instale o Python.');
    process.exit(1);
  }

  console.log('Usando Python em:', python);
  const scriptPath = path.join('src', 'preprocessing.py');

  if (!exists(scriptPath)) {
    console.warn(`Script de preprocessing não encontrado em ${scriptPath}. Pulando.`);
    return;
  }

  // argumentos padrão; se quiser alterar, modifique aqui.
  const args = [scriptPath, '--input', 'resources/apple_quality.csv', '--out-dir', 'resources'];
  // Se quiser permitir passar args via variável de ambiente PREPROCESS_ARGS:
  if (process.env.PREPROCESS_ARGS) {
    const extra = process.env.PREPROCESS_ARGS.split(' ').filter(Boolean);
    args.push(...extra);
  }

  run(python, args);

  console.log('== Preprocessing finalizado ==');
}

try {
  main();
} catch (err) {
  console.error('Erro no preprocessing:', err.message || err);
  process.exit(1);
}
