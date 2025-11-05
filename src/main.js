// src/main.js (SUBSTITUA TODO O ARQUIVO ATUAL POR ESTE)
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

// IMPORTS: NLP
// Certifique-se que src/nlp/predict.js existe e exporta processMessage
// (caminho relativo ao src/main.js)
let nlpModulePath = path.join(__dirname, 'nlp', 'models', 'predict');
let processMessage = null;
try {
  ({ processMessage } = require(nlpModulePath));
} catch (e) {
  console.warn('Aviso: não foi possível carregar módulo NLP (predict).', e.message || e);
  // processMessage poderá ser carregado dinamicamente no handler
}

let win = null; // referência à janela

// ----------------------------
// Funções: virtualenv + preprocess (Python)
// ----------------------------
function getVenvPython() {
  const PROJECT_ROOT = path.join(__dirname, '..');
  if (process.platform === 'win32') {
    const candidate = path.join(PROJECT_ROOT, '.venv', 'Scripts', 'python.exe');
    if (fs.existsSync(candidate)) return candidate;
  } else {
    const candidate = path.join(PROJECT_ROOT, '.venv', 'bin', 'python');
    if (fs.existsSync(candidate)) return candidate;
  }
  return 'python';
}

function readProcessedJsonIfExists() {
  const jsonPath = path.join(__dirname, '..', 'resources', 'processed_apple_quality.json');
  if (!fs.existsSync(jsonPath)) return null;
  try {
    const raw = fs.readFileSync(jsonPath, 'utf8');
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed;
    if (parsed && Array.isArray(parsed.data)) return parsed.data;
    if (parsed && Array.isArray(parsed.data_sample)) return parsed.data_sample;
    return parsed;
  } catch (err) {
    console.error('Falha ao parsear JSON existente:', err);
    return null;
  }
}

async function runPythonPreprocess() {
  return new Promise((resolve, reject) => {
    const pythonExe = getVenvPython();
    const scriptPath = path.join(__dirname, 'preprocessing.py');

    if (!fs.existsSync(scriptPath)) {
      return reject(new Error(`Script Python não encontrado em: ${scriptPath}`));
    }

    const python = spawn(pythonExe, [scriptPath], { cwd: path.join(__dirname, '..') });

    let stdout = '';
    python.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    python.stderr.on('data', (chunk) => { console.error('[PY STDERR]', chunk.toString()); });

    python.on('close', (code) => {
      if (code !== 0) {
        return reject(new Error(`preprocessing.py finalizou com código ${code}`));
      }
      try {
        const parsed = JSON.parse(stdout);
        if (parsed && parsed.status && String(parsed.status).toLowerCase() === 'sucesso') {
          if (Array.isArray(parsed.data_sample)) return resolve(parsed.data_sample);
          if (Array.isArray(parsed.data)) return resolve(parsed.data);
          return resolve(parsed);
        } else if (Array.isArray(parsed)) {
          return resolve(parsed);
        } else {
          return resolve(parsed);
        }
      } catch (err) {
        return reject(new Error('Falha ao parsear JSON do stdout do Python: ' + err.message + '\nSaída bruta:\n' + stdout));
      }
    });

    python.on('error', (err) => reject(err));
  });
}

let preprocessCache = null;
async function ensurePreprocessedData() {
  const fromFile = readProcessedJsonIfExists();
  if (fromFile) {
    preprocessCache = fromFile;
    console.log('Usando JSON já existente em resources/processed_apple_quality.json');
    return preprocessCache;
  }

  try {
    console.log('Executando preprocessing.py via Node...');
    const res = await runPythonPreprocess();
    preprocessCache = res;
    console.log('Preprocess concluído pelo Python, cache populado.');
    return preprocessCache;
  } catch (err) {
    console.error('Erro ao executar preprocessing.py:', err);
    const recheck = readProcessedJsonIfExists();
    if (recheck) {
      preprocessCache = recheck;
      console.log('Após falha, encontrei JSON em disco e usei ele.');
      return preprocessCache;
    }
    throw err;
  }
}

// ----------------------------
// createWindow (único)
// ----------------------------
function createWindow() {
  if (BrowserWindow.getAllWindows().length > 0) {
    // já existe janela, não cria outra
    console.log('Janela já existente — não criando nova.');
    return;
  }

  console.log('>> Electron: criando janela...');
  win = new BrowserWindow({
    width: 950,
    height: 900,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  const htmlPath = path.join(__dirname, '..', 'public', 'index.html');
  console.log('>> Carregando HTML em:', htmlPath);

  win.loadFile(htmlPath).catch(err => {
    console.error('Erro ao carregar index.html:', err);
  });

  // inicia a leitura/geração dos dados sem bloquear a UI
  ensurePreprocessedData().catch(err => {
    console.error('Falha ao preparar dados processados:', err);
  });
}

// ----------------------------
// IPC: handlers (registrar apenas uma vez)
// ----------------------------
ipcMain.handle('get-processed-data', async () => {
  try {
    if (!preprocessCache) {
      await ensurePreprocessedData();
    }
    return { ok: true, data: preprocessCache };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
});

ipcMain.handle('ping', () => 'pong');

// Registrar nlp-process uma única vez (guard global)
if (!global.__nlp_process_handler_registered) {
  ipcMain.handle('nlp-process', async (event, text) => {
    try {
      // reload dinâmico do módulo predict caso você atualize o modelo em runtime
      try {
        delete require.cache[require.resolve(nlpModulePath)];
      } catch (e) { /* ignore se não estiver no cache */ }

      let pm = null;
      try {
        ({ processMessage: pm } = require(nlpModulePath));
      } catch (e) {
        console.error('NLP: não foi possível carregar predict module dinamicamente:', e.message || e);
        pm = null;
      }

      if (!pm) {
        return { ok: false, error: 'NLP não disponível (predict module ausente ou falhou ao carregar).' };
      }

      const out = await pm(text);
      return { ok: true, result: out };
    } catch (err) {
      console.error('Erro no handler nlp-process:', err);
      return { ok: false, error: String(err) };
    }
  });

  global.__nlp_process_handler_registered = true;
  console.log('IPC: nlp-process handler registrado.');
}

// ----------------------------
// App lifecycle (único)
// ----------------------------
app.whenReady()
  .then(() => {
    createWindow();
    // Se quiser logar quando devtools for aberto, etc.
  })
  .catch(err => console.error('Erro ao iniciar app:', err));

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});