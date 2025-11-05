const { NlpManager } = require('node-nlp');
const path = require('path');
const fs = require('fs');

const MODELS_DIR = path.join(__dirname, 'models'); // -> src/nlp/models
const MODEL_NAME = 'model.nlp';
const MODEL_PATH = path.join(MODELS_DIR, MODEL_NAME);

const manager = new NlpManager({ languages: ['pt'], forceNER: true });

// Somente carrega se o arquivo existir
if (fs.existsSync(MODEL_PATH)) {
  try {
    manager.load(MODEL_PATH);
    console.log('NLP: modelo carregado de', MODEL_PATH);
  } catch (err) {
    console.error('NLP: falha ao carregar modelo:', err);
  }
} else {
  console.log(`NLP: modelo não encontrado em ${MODEL_PATH} — rodando sem modelo treinado.`);
}

// processa a mensagem (funciona mesmo sem modelo salvo)
async function processMessage(message) {
  const msg = String(message || '').trim();
  const res = await manager.process('pt', msg);
  return {
    intent: res.intent,
    score: res.score,
    answer: res.answer || null,
    entities: res.entities || [],
    raw: res
  };
}

module.exports = { processMessage, MODEL_PATH, MODELS_DIR };
