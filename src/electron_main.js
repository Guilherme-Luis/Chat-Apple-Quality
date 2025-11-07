// src/electron_main.js
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const fs = require('fs');

function createWindow() {
  const win = new BrowserWindow({
    width: 900,
    height: 780,
    webPreferences: {
      preload: path.join(__dirname, 'script', 'preload.js'),
      contextIsolation: true,
      enableRemoteModule: false,
      nodeIntegration: false
    }
  });

  win.loadFile(path.join(__dirname, '../public/index.html'));
  // win.webContents.openDevTools();
}

// handle run-pipeline request from renderer via preload
ipcMain.handle('run-pipeline', async (event, opts = {}) => {
  // opts can be used to pass flags; simple implementation triggers npm scripts (or node scripts)
  // We'll spawn "npm run start-pipeline" or run scripts individually to stream logs.
  // Here we'll run the three scripts sequentially and stream stdout to renderer.
  const win = BrowserWindow.fromWebContents(event.sender);

  function runScript(cmd, args = []) {
    return new Promise((resolve, reject) => {
      const p = spawn(cmd, args, { shell: true, cwd: process.cwd() });

      p.stdout.on('data', (data) => {
        win.webContents.send('pipeline-log', String(data));
      });
      p.stderr.on('data', (data) => {
        win.webContents.send('pipeline-log', String(data));
      });

      p.on('close', (code) => {
        if (code === 0) resolve(code);
        else reject(new Error(`${cmd} exited with code ${code}`));
      });
    });
  }

  try {
    win.webContents.send('pipeline-log', 'Iniciando pré-processamento...');
    await runScript('node', ['./scripts/run_preprocess.js']);
    win.webContents.send('pipeline-log', 'Pré-processamento finalizado. Iniciando treino...');
    await runScript('node', ['./scripts/run_train.js']);
    win.webContents.send('pipeline-log', 'Treino finalizado. Iniciando pós-processamento...');
    await runScript('node', ['./scripts/run_postprocess.js']);
    win.webContents.send('pipeline-log', 'Pós-processamento finalizado. Tentando bundler...');
    // try bundle (optional)
    if (fs.existsSync(path.join(process.cwd(), 'scripts', 'bundle_pipeline.js'))) {
      await runScript('node', ['./scripts/bundle_pipeline.js']);
      win.webContents.send('pipeline-log', 'Bundle finalizado.');
    } else {
      win.webContents.send('pipeline-log', 'Bundle não encontrado — pulando.');
    }

    return { ok: true, message: 'Pipeline finalizado com sucesso.' };
  } catch (err) {
    win.webContents.send('pipeline-log', `Pipeline falhou: ${err.message || err}`);
    return { ok: false, error: err.message || String(err) };
  }
});

// Optional: allow renderer to request reading of resources files (safe)
ipcMain.handle('read-json', async (event, relPath) => {
  const abs = path.join(process.cwd(), relPath);
  try {
    const txt = await fs.promises.readFile(abs, 'utf8');
    return { ok: true, data: JSON.parse(txt) };
  } catch (err) {
    return { ok: false, error: err.message || String(err) };
  }
});
// Fallback NLP Handler - para evitar erro
ipcMain.handle('nlp-process-fallback', async (event, text) => {
  // lógica simples só para não quebrar
  const response = {
    ok: true,
    result: {
      intent: 'fallback',
      score: 0.0,
      answer: `Não tenho certeza, mas você disse: "${text}"`
    }
  };
  return response;
});

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});