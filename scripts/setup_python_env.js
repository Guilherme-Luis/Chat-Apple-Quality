// scripts/setup_python_env.js
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

function tryCmd(cmd, args = []) {
  try {
    const res = spawnSync(cmd, args, { shell: false, stdio: 'pipe' });
    return res.status === 0;
  } catch (e) {
    return false;
  }
}

function findSystemPython() {
  const candidates = [
    ['py', ['-3', '--version']], // windows py launcher
    ['python', ['--version']],
    ['python3', ['--version']]
  ];
  for (const [cmd, args] of candidates) {
    if (tryCmd(cmd, args)) return cmd;
  }
  return null;
}

function run(cmd, args, opts = {}) {
  console.log(`> ${cmd} ${args.join(' ')}`);
  const res = spawnSync(cmd, args, { stdio: 'inherit', ...opts, shell: false });
  if (res.error) {
    throw res.error;
  }
  if (res.status !== 0) {
    throw new Error(`Command failed: ${cmd} ${args.join(' ')} (exit ${res.status})`);
  }
}

function main() {
  console.log('== Python venv setup script ==');

  const python = findSystemPython();
  if (!python) {
    console.error('Nenhum Python encontrado no PATH. Instale o Python (recomendo 3.8+) e tente novamente.');
    process.exit(1);
  }
  console.log('Python detectado:', python);

  const venvDir = path.resolve('.venv');
  const venvPython = process.platform === 'win32'
    ? path.join(venvDir, 'Scripts', 'python.exe')
    : path.join(venvDir, 'bin', 'python');

  // 1) create venv if not exists
  if (!fs.existsSync(venvDir)) {
    console.log('Criando virtualenv em .venv ...');
    run(python, ['-m', 'venv', '.venv']);
  } else {
    console.log('.venv já existe — pular criação.');
  }

  // 2) ensure pip is present and install requirements
  if (!fs.existsSync('requirements.txt')) {
    console.warn('requirements.txt não encontrado na raiz — pulando pip install. Crie um requirements.txt com as libs Python necessárias.');
    return;
  }

  const pipCmd = venvPython;
  console.log('Instalando dependências Python via:', pipCmd);
  // usar: <venv_python> -m pip install -r requirements.txt
  run(pipCmd, ['-m', 'pip', 'install', '--upgrade', 'pip']);
  run(pipCmd, ['-m', 'pip', 'install', '-r', 'requirements.txt']);

  console.log('== Python venv criado e dependências instaladas com sucesso ==');
}

try {
  main();
} catch (err) {
  console.error('Erro durante setup do Python venv:', err.message || err);
  process.exit(1);
}
