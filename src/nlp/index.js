// src/nlp/index.js
const { NlpManager } = require('node-nlp');
const path = require('path');
const fs = require('fs');

const MODEL_PATH = path.join(__dirname, 'models', 'model.nlp');

let manager = null;

function buildManager() {
  const m = new NlpManager({ languages: ['pt'], forceNER: true });
  // Exemplos de documentos (intents) — acrescente conforme precisar
  // Contagens / quality
  m.addDocument('pt', 'quantas boas', 'count.quality');
  m.addDocument('pt', 'quantas são boas', 'count.quality');
  m.addDocument('pt', 'conta boas', 'count.quality');
  m.addDocument('pt', 'quantas ruins', 'count.quality');
  m.addDocument('pt', 'quantos bons', 'count.quality');

  // Estatísticas / resumo
  m.addDocument('pt', 'resumo', 'dataset.summary');
  m.addDocument('pt', 'estatísticas', 'dataset.summary');
  m.addDocument('pt', 'tamanho do dataset', 'dataset.summary');
  m.addDocument('pt', 'quantas linhas', 'dataset.summary');

  // Média de coluna
  m.addDocument('pt', 'média de %column%', 'column.mean');
  m.addDocument('pt', 'qual a média de %column%', 'column.mean');
  m.addDocument('pt', 'media de %column%', 'column.mean');

  // Top N
  m.addDocument('pt', 'top %number% por %column%', 'column.topn');
  m.addDocument('pt', 'top %number% %column%', 'column.topn');
  m.addDocument('pt', 'maiores por %column%', 'column.topn');

  // Comparações simples
  m.addDocument('pt', '%column% > %number%', 'column.filter');
  m.addDocument('pt', '%column% >= %number%', 'column.filter');
  m.addDocument('pt', '%column% < %number%', 'column.filter');
  m.addDocument('pt', '%column% <= %number%', 'column.filter');

  // Perguntas abertas
  m.addDocument('pt', 'o que é uma maçã boa', 'apple.what_is_good');
  m.addDocument('pt', 'maçã boa', 'apple.what_is_good');
  m.addDocument('pt', 'como é uma maçã boa', 'apple.what_is_good');

  // Saudações
  m.addDocument('pt', 'oi', 'smalltalk.greet');
  m.addDocument('pt', 'olá', 'smalltalk.greet');
  m.addDocument('pt', 'bom dia', 'smalltalk.greet');

  // Exemplos de respostas rápidas (fallbacks e respostas padrão)
  m.addAnswer('pt', 'smalltalk.greet', 'Olá! Pergunte sobre as maçãs — ex.: "média de sweetness", "top 5 por Juiciness".');
  m.addAnswer('pt', 'dataset.summary', 'Vou buscar o resumo do dataset para você.');
  m.addAnswer('pt', 'count.quality', 'Vou contar as instâncias por qualidade.');
  m.addAnswer('pt', 'apple.what_is_good', 'Aguarde: calcularei a média dos atributos para amostras rotuladas como good.');
  m.addAnswer('pt', 'column.mean', 'Calculando a média dessa coluna...');
  m.addAnswer('pt', 'column.topn', 'Buscando os top {number} por {column}...');
  m.addAnswer('pt', 'column.filter', 'Aplicando filtro na coluna...');

  // Entidades: Columns / números — intent templates acima usam %column% e %number%
  // Podemos adicionar sinônimos como entidades customizadas:
  const columns = ['size', 'tamanho', 'weight', 'peso', 'sweetness', 'doçura', 'doce', 'juiciness', 'suculencia', 'ripeness', 'maturacao', 'acidity', 'acidez', 'crunchiness', 'crocancia'];
  columns.forEach(c => m.addNamedEntityText('COLUMN', c, ['pt'], [c]));

  // Regra para números (node-nlp já tem NER para numbers, mas vamos garantir)
  // deixamos o manager com configurações padrão para NER e números

  return m;
}

async function ensureManager() {
  if (manager) return manager;
  manager = buildManager();

  // se existir arquivo salvo, carrega
  if (fs.existsSync(MODEL_PATH)) {
    try {
      manager.load(MODEL_PATH);
      console.log('NLP: modelo carregado de', MODEL_PATH);
      return manager;
    } catch (e) {
      console.warn('NLP: falha ao carregar modelo salvo — irei treinar novamente.', e);
    }
  }

  // Treina e salva
  console.log('NLP: treinando modelo (pode demorar alguns segundos)...');
  await manager.train();
  manager.save(MODEL_PATH);
  console.log('NLP: treino concluído e modelo salvo em', MODEL_PATH);
  return manager;
}

/**
 * Processa a mensagem e devolve um objeto com:
 *  { intent, score, entities, answer (se houver), nlpRaw }
 */
async function processText(text) {
  const m = await ensureManager();
  const res = await m.process('pt', text);
  // res tem: intent, score, entities, answer, classification
  return {
    intent: res.intent,
    score: res.score,
    answer: res.answer || null,
    entities: res.entities || [],
    nlpRaw: res
  };
}

module.exports = {
  ensureManager,
  processText
};
