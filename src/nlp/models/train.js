// src/nlp/train.js
const { NlpManager } = require('node-nlp');
const path = require('path');
const fs = require('fs');

const DIR = path.join(__dirname, 'models'); // src/nlp/models
const MODEL_FILE = path.join(DIR, 'model.nlp');

(async () => {
  try {
    if (!fs.existsSync(DIR)) fs.mkdirSync(DIR, { recursive: true });

    const manager = new NlpManager({ languages: ['pt'], forceNER: true });

    // ----- exemplos básicos (adicione quantos quiser) -----
    // saudação
    manager.addDocument('pt', 'oi', 'smalltalk.greet');
    manager.addDocument('pt', 'olá', 'smalltalk.greet');
    manager.addDocument('pt', 'bom dia', 'smalltalk.greet');
    manager.addAnswer('pt', 'smalltalk.greet', 'Olá! Pergunte sobre as maçãs — ex.: "média de sweetness".');

    // contagem quality
    manager.addDocument('pt', 'quantas boas', 'count.quality');
    manager.addDocument('pt', 'quantas são boas', 'count.quality');
    manager.addAnswer('pt', 'count.quality', 'Vou contar as amostras marcadas como good.');

    // média coluna (exemplos com placeholder)
    manager.addDocument('pt', 'média de %column%', 'column.mean');
    manager.addAnswer('pt', 'column.mean', 'Calculando a média dessa coluna...');

    // apple good
    manager.addDocument('pt', 'o que é uma maçã boa', 'apple.what_is_good');
    manager.addAnswer('pt', 'apple.what_is_good', 'Aguarde: calcularei a média dos atributos para amostras rotuladas como good.');

    // treina
    console.log('NLP: iniciando treino (pode demorar alguns segundos)...');
    await manager.train();
    manager.save(MODEL_FILE);
    console.log('NLP: treino concluído. Modelo salvo em:', MODEL_FILE);
    process.stdout.write(JSON.stringify({ status: 'ok', path: MODEL_FILE }));
  } catch (err) {
    console.error('Erro no treino NLP:', err);
    process.exit(1);
  }
})();