// public/script/renderer.js
// Integrado com Electron preload (window.api) e pipeline completo

const messagesEl = document.getElementById('messages');
const inputEl = document.getElementById('user-input');
const sendBtn = document.getElementById('send-btn');
const clearBtn = document.getElementById('clear-btn');
const runPipelineBtn = document.getElementById('run-pipeline-btn');

let DATA = null;
let COLUMNS = [];
let NUMERIC_COLS = [];
let LABEL_COL = 'Quality_encoded';
let MODEL_METRICS = null;

/* ----------------------------
   UI helpers
   ---------------------------- */
function formatTime(d = new Date()) {
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}
function addMessage(who, text) {
    const wrapper = document.createElement('div');
    wrapper.className = `bubble-row ${who}`;
    wrapper.innerHTML = `
    <div class="meta">
      <div class="avatar ${who}">${who === 'you' ? 'Você' : 'Bot'}</div>
      <div class="time">${formatTime()}</div>
    </div>
    <div class="bubble" tabindex="0">${text.replace(/\n/g, '<br>')}</div>
  `;
    messagesEl.appendChild(wrapper);
    messagesEl.scrollTo({ top: messagesEl.scrollHeight, behavior: 'smooth' });
}
function addTyping() {
    if (document.getElementById('typing')) return;
    const el = document.createElement('div');
    el.id = 'typing';
    el.className = 'bubble-row bot';
    el.innerHTML = `
    <div class="meta"><div class="avatar bot">Bot</div><div class="time">${formatTime()}</div></div>
    <div class="bubble typing"><span class="dot"></span><span class="dot"></span><span class="dot"></span></div>`;
    messagesEl.appendChild(el);
}
function removeTyping() {
    const el = document.getElementById('typing');
    if (el) el.remove();
}

/* ----------------------------
   Carregamento de dados via preload
   ---------------------------- */
async function loadProcessedData() {
    try {
        const res = await window.api.getProcessedData();
        if (res.ok && Array.isArray(res.data)) return res.data;
        throw new Error('Retorno inválido de getProcessedData');
    } catch (err) {
        console.error('Erro ao carregar dados:', err);
        throw err;
    }
}

async function loadModelMetrics() {
    try {
        const res = await window.api.getModelMetrics();
        if (res.ok && res.data) return res.data;
    } catch (err) {
        console.warn('Erro ao carregar métricas:', err);
    }
    return null;
}

/* ----------------------------
   Análise do dataset
   ---------------------------- */
function initDatasetStructures(arr) {
    DATA = arr.map(r => {
        const obj = {};
        for (const [k, v] of Object.entries(r)) {
            // Remove espaços e padroniza capitalização
            const key = k.trim();
            // Tenta converter números
            const val = isNaN(parseFloat(v)) ? v : parseFloat(v);
            obj[key] = val;
        }
        return obj;
    });

    COLUMNS = Object.keys(DATA[0] || {});
    NUMERIC_COLS = COLUMNS.filter(c => {
        const sample = DATA.slice(0, 30).map(r => r[c]);
        const nums = sample.filter(v => typeof v === 'number' && !isNaN(v));
        return nums.length >= sample.length * 0.6;
    });
}


/* ----------------------------
   Funções auxiliares
   ---------------------------- */
const mean = arr => arr.reduce((a, b) => a + b, 0) / arr.length;
const round = (v, n = 3) => Math.round(v * 10 ** n) / 10 ** n;
const ucfirst = s => s.charAt(0).toUpperCase() + s.slice(1);

const COL_ALIASES = {
    tamanho: 'Size', peso: 'Weight', doçura: 'Sweetness', doce: 'Sweetness',
    crocância: 'Crunchiness', crocancia: 'Crunchiness', suculência: 'Juiciness',
    suculencia: 'Juiciness', maturação: 'Ripeness', maturacao: 'Ripeness',
    acidez: 'Acidity', qualidade: 'Quality'
};

/* ----------------------------
   Respostas com base nos dados
   ---------------------------- */
function answerFromData(q) {
    q = q.toLowerCase();

    // ---- Contagem de boas e ruins ----
    if (q.includes('quantas') || q.includes('quantos')) {
        const boas = DATA.filter(r => r.Quality_encoded === 1 || r.Quality_encoded === '1').length;
        const ruins = DATA.filter(r => r.Quality_encoded === 0 || r.Quality_encoded === '0').length;
        return `Total: ${DATA.length}\nBoas: ${boas}\nRuins: ${ruins}`;
    }

    // ---- Média de uma coluna ----
    const mediaMatch = q.match(/m[eé]dia de ([\wçãõáéíóú]+)/);
    if (mediaMatch) {
        const entrada = mediaMatch[1].toLowerCase();
        const col = COL_ALIASES[entrada] || ucfirst(entrada);

        // Verifica se a coluna existe
        const colExiste = COLUMNS.includes(col);
        if (!colExiste) {
            // Sugere as mais próximas
            const sugestoes = COLUMNS
                .filter(c => c.toLowerCase().includes(entrada.slice(0, 3)))
                .join(', ');
            const sugTxt = sugestoes ? `\nTalvez você quis dizer: ${sugestoes}` : '';
            return `Coluna '${col}' não encontrada.${sugTxt}\nColunas disponíveis: ${COLUMNS.join(', ')}`;
        }

        // Verifica se é numérica
        if (!NUMERIC_COLS.includes(col)) {
            return `A coluna '${col}' não é numérica.\nColunas numéricas: ${NUMERIC_COLS.join(', ')}`;
        }

        // Calcula a média
        const vals = DATA.map(r => parseFloat(r[col])).filter(v => !isNaN(v));
        return `Média (${col}): ${round(mean(vals), 4)}`;
    }

    // ---- Resumo do dataset ----
    if (q.includes('resumo') || q.includes('estatíst')) {
        return `Dataset: ${DATA.length} linhas, ${COLUMNS.length} colunas.\nNuméricas: ${NUMERIC_COLS.join(', ')}`;
    }

    // ---- Nenhum padrão reconhecido ----
    return `Não entendi.\nExemplos:\n• "Quantas boas"\n• "Média de sweetness"\n• "Resumo do dataset"`;
}

/* ----------------------------
   Respostas sobre os modelos
   ---------------------------- */
function answerFromModels(q) {
    if (!MODEL_METRICS) return null;
    q = q.toLowerCase();

    if (q.includes('melhor modelo')) {
        const m = MODEL_METRICS.best_model;
        return `Melhor modelo: ${m.name} (accuracy média = ${round(m.accuracy_mean, 4)})`;
    }

    for (const [k, v] of Object.entries(MODEL_METRICS.models || {})) {
        if (q.includes(k)) {
            return `${k}: accuracy=${round(v.accuracy_mean, 4)}, f1=${round(v.f1_mean, 4)}`;
        }
    }

    return null;
}

/* ----------------------------
   Fluxo de resposta
   ---------------------------- */
async function getAnswer(q) {
    const mAns = answerFromModels(q);
    if (mAns) return mAns;
    return answerFromData(q);
}

/* ----------------------------
   Envio de mensagem
   ---------------------------- */
async function sendMessage() {
    const question = inputEl.value.trim();
    if (!question) return;

    addMessage('you', question);
    inputEl.value = '';
    addTyping();

    try {
        const ans = await getAnswer(question);
        removeTyping();
        addMessage('bot', ans);
    } catch (err) {
        removeTyping();
        addMessage('bot', 'Erro: ' + err.message);
    }
}

sendBtn.addEventListener('click', sendMessage);
inputEl.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
    }
});

clearBtn.addEventListener('click', () => {
    messagesEl.innerHTML = '';
    addMessage('bot', 'Conversa limpa. Pergunte sobre as maçãs ou os modelos.');
});

/* ----------------------------
   Botão "Executar pipeline"
   ---------------------------- */
runPipelineBtn.addEventListener('click', async () => {
    addMessage('you', 'Executar pipeline');
    addTyping();
    try {
        const res = await window.api.runPipeline();
        removeTyping();
        addMessage('bot', res.ok ? 'Pipeline concluído com sucesso!' : 'Falha ao executar pipeline.');
        MODEL_METRICS = await loadModelMetrics();
        DATA = await loadProcessedData();
        initDatasetStructures(DATA);
    } catch (err) {
        removeTyping();
        addMessage('bot', 'Erro: ' + err.message);
    }
});

/* ----------------------------
   Inicialização
   ---------------------------- */
window.addEventListener('DOMContentLoaded', async () => {
    addMessage('bot', 'Carregando dados processados...');
    try {
        DATA = await loadProcessedData();
        initDatasetStructures(DATA);
        MODEL_METRICS = await loadModelMetrics();
        addMessage('bot', `✅ Dados: ${DATA.length} linhas carregadas.`);
    } catch (err) {
        addMessage('bot', 'Erro ao carregar dados: ' + err.message);
    }

    inputEl.focus();
});