// src/preload.js
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // já existente — retorna { ok: true, data } ou { ok:false, error }
  getProcessedData: async () => await ipcRenderer.invoke('get-processed-data'),

  // novo — envia texto para o main rodar o NLP e retorna { ok:true, result } ou { ok:false, error }
  nlpProcess: async (text) => await ipcRenderer.invoke('nlp-process', text),

  // utilitário de debug simples
  ping: async () => await ipcRenderer.invoke('ping')
});

