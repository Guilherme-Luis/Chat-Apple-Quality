// src/script/preload.js
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  readJSON: (relativePath) => ipcRenderer.invoke('read-json', relativePath),
  getProcessedData: () => ipcRenderer.invoke('read-json', 'resources/processed_apple_quality.json'),
  getModelMetrics: () => ipcRenderer.invoke('read-json', 'resources/artifacts_models/model_metrics.json'),
  runFullPipeline: () => ipcRenderer.invoke('run-pipeline'),
  onPipelineLog: (cb) => {
    const listener = (event, msg) => cb(msg);
    ipcRenderer.on('pipeline-log', listener);
    return () => ipcRenderer.removeListener('pipeline-log', listener);
  },
  nlpProcess: (text) => ipcRenderer.invoke('nlp-process-fallback', text).catch(() => ({ ok: true, result: { intent: 'fallback', score: 0, answer: null } }))
});
