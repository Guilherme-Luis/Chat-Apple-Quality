// -----------------------
// FRONTEND CHAT (funcional)
// -----------------------
const messagesEl = document.getElementById('messages');
const inputEl = document.getElementById('user-input');
const sendBtn = document.getElementById('send-btn');
const clearBtn = document.getElementById('clear-btn');

async function enviarPergunta() {
    const pergunta = document.querySelector("#input").value;

    const response = await window.api.nlpProcess(pergunta);

    if (response.ok) {
        console.log("Resposta do NLP:", response.result);
    } else {
        console.error("Erro NLP:", response.error);
    }
}

function formatTime(date = new Date()) {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function smoothScrollToBottom() {
    messagesEl.scrollTo({ top: messagesEl.scrollHeight, behavior: 'smooth' });
}

function createMessageNode(who, text) {
    const wrapper = document.createElement('div');
    wrapper.className = `bubble-row ${who}`;

    const meta = document.createElement('div');
    meta.className = 'meta';
    const avatar = document.createElement('div');
    avatar.className = 'avatar ' + who;
    avatar.textContent = who === 'you' ? 'Você' : 'Bot';
    const time = document.createElement('div');
    time.className = 'time';
    time.textContent = formatTime();
    meta.appendChild(avatar);
    meta.appendChild(time);

    const bubble = document.createElement('div');
    bubble.className = 'bubble';
    bubble.setAttribute('tabindex', '0');
    bubble.setAttribute('role', 'article');

    text.split('\n').forEach(line => {
        const lineDiv = document.createElement('div');
        lineDiv.className = 'line';
        lineDiv.textContent = line;
        bubble.appendChild(lineDiv);
    });

    wrapper.appendChild(meta);
    wrapper.appendChild(bubble);

    bubble.classList.add('pop-in');
    bubble.addEventListener('dblclick', (e) => {
        const text = e.currentTarget.innerText;
        navigator.clipboard?.writeText(text).then(() => {
            e.currentTarget.classList.add('copied');
            setTimeout(() => e.currentTarget.classList.remove('copied'), 900);
        }).catch(() => { /* ignore */ });
    });

    return wrapper;
}

function addMessage(who, text) {
    const node = createMessageNode(who, text);
    messagesEl.appendChild(node);
    smoothScrollToBottom();
}

function addTyping() {
    if (document.getElementById('typing')) return;
    const tpl = document.createElement('div');
    tpl.id = 'typing';
    tpl.className = 'bubble-row bot';
    tpl.innerHTML = `
        <div class="meta"><div class="avatar bot">Bot</div><div class="time">${formatTime()}</div></div>
        <div class="bubble typing"><span class="dot"></span><span class="dot"></span><span class="dot"></span></div>
      `;
    messagesEl.appendChild(tpl);
    smoothScrollToBottom();
}

function removeTyping() {
    const el = document.getElementById('typing');
    if (el) el.remove();
}

// ---------------------------------------
// Dados carregados a partir do preprocess
// ---------------------------------------
let DATA = null;         // array of records
let COLUMNS = [];        // detected columns
let NUMERIC_COLS = [];   // numeric column names
let LABEL_COL = 'Quality'; // default label column

// mapeamentos úteis (pt-br -> coluna no dataset)
const COL_ALIASES = {
    'tamanho': 'Size',
    'size': 'Size',
    'peso': 'Weight',
    'weight': 'Weight',
    'doce': 'Sweetness',
    'doçura': 'Sweetness',
    'sweetness': 'Sweetness',
    'crocancia': 'Crunchiness',
    'crocância': 'Crunchiness',
    'crunchiness': 'Crunchiness',
    'suculencia': 'Juiciness',
    'suculência': 'Juiciness',
    'juiciness': 'Juiciness',
    'maturacao': 'Ripeness',
    'maturação': 'Ripeness',
    'ripeness': 'Ripeness',
    'acidez': 'Acidity',
    'acidity': 'Acidity',
    'qualidade': 'Quality',
    'quality': 'Quality'
};

// tenta carregar os dados do preload API (Electron). Se não existir, tenta fetch relativo.
async function loadProcessedData() {
    // 1) tentar API do preload (recomendado em Electron)
    if (window.api && typeof window.api.getProcessedData === 'function') {
        try {
            const res = await window.api.getProcessedData();
            if (res && res.ok && Array.isArray(res.data)) {
                return res.data;
            }
        } catch (err) {
            console.warn('window.api.getProcessedData falhou:', err);
        }
    }

    // 2) fallback: fetch local JSON (pode não funcionar via file:// dependendo do app)
    try {
        const resp = await fetch('../resources/processed_apple_quality.json');
        if (resp.ok) {
            const json = await resp.json();
            if (Array.isArray(json)) return json;
        }
    } catch (err) {
        console.warn('fetch fallback falhou:', err);
    }

    throw new Error('Não foi possível carregar processed_apple_quality.json (verificar se o preprocess foi executado e se o caminho está correto).');
}

// inicializa estruturas estatísticas simples
function initDatasetStructures(arr) {
    DATA = arr;
    COLUMNS = Object.keys((DATA[0]) || {});
    NUMERIC_COLS = COLUMNS.filter(c => {
        // heurística: valores que são numbers (ou strings parseáveis) em maioria
        const sample = DATA.slice(0, 20).map(r => r[c]).filter(v => v !== null && v !== undefined);
        const numCount = sample.filter(v => typeof v === 'number' || (!isNaN(parseFloat(String(v))))).length;
        return numCount >= Math.max(1, Math.floor(sample.length * 0.6));
    });
    // se existir Quality_encoded, manter label
    if (COLUMNS.includes('Quality')) LABEL_COL = 'Quality';
}

// utilitários estatísticos
function mean(values) {
    const nums = values.map(v => parseFloat(v)).filter(v => !Number.isNaN(v));
    if (!nums.length) return null;
    return nums.reduce((a, b) => a + b, 0) / nums.length;
}
function std(values) {
    const m = mean(values);
    if (m === null) return null;
    const nums = values.map(v => parseFloat(v)).filter(v => !Number.isNaN(v));
    const variance = nums.reduce((s, x) => s + Math.pow(x - m, 2), 0) / nums.length;
    return Math.sqrt(variance);
}

// responde perguntas básicas baseadas no dataset processado
function answerFromData(question) {
    const q = question.trim().toLowerCase();
    const words = q.split(/\s+/);

    // -----------------------------
    // 1) Contagem de Qualidade (good/bad)
    // -----------------------------
    const qualityKeywords = {
        good: ['good', 'boa', 'boas', 'bom', 'bons'],
        bad: ['bad', 'ruim', 'ruins']
    };
    const countTriggers = ['quantas', 'quantos', 'conta', 'contagem', 'total'];
    if (words.some(w => countTriggers.includes(w)) &&
        words.some(w => [...qualityKeywords.good, ...qualityKeywords.bad].includes(w))) {
        const counts = {
            good: DATA.filter(r => qualityKeywords.good.some(k => String(r[LABEL_COL]).toLowerCase().includes(k))).length,
            bad: DATA.filter(r => qualityKeywords.bad.some(k => String(r[LABEL_COL]).toLowerCase().includes(k))).length
        };
        return `Totais:\nGood/Boas: ${counts.good}\nBad/Ruins: ${counts.bad}\n(Total: ${DATA.length})`;
    }

    // -----------------------------
    // 2) Estatísticas gerais / resumo
    // -----------------------------
    const summaryTriggers = ['resumo', 'sumário', 'estatística', 'estatisticas', 'descrição', 'quantas linhas', 'tamanho do dataset', 'quantidade'];
    if (summaryTriggers.some(w => q.includes(w))) {
        const lines = DATA.length;
        const cols = COLUMNS.length;
        return `Dataset processado: ${lines} linhas × ${cols} colunas.\nColunas principais: ${COLUMNS.join(', ')}\nNota: os atributos numéricos foram pré-processados (p.ex. escalonados).`;
    }

    // -----------------------------
    // 3) Média/desvio de coluna
    // -----------------------------
    const mMatch = q.match(/\b(média|media|médias|average)\b.*\bde\s+([^\?]+)/);
    if (mMatch) {
        const colRaw = mMatch[2].trim().split(/\s+/)[0];
        const col = COL_ALIASES[colRaw] || ucfirst(colRaw);
        if (NUMERIC_COLS.includes(col)) {
            const vals = DATA.map(r => r[col]).filter(v => !isNaN(parseFloat(v)));
            const m = mean(vals);
            const s = std(vals);
            return `Média (${col}): ${round(m, 4)}\nDesvio padrão: ${round(s, 4)}\n(Valores escalados pelo preprocessing—StandardScaler)`;
        } else {
            return `Coluna '${colRaw}' não encontrada ou não é numérica. Colunas disponíveis: ${NUMERIC_COLS.join(', ')}`;
        }
    }

    // -----------------------------
    // 4) Top N por coluna
    // -----------------------------
    const topMatch = q.match(/\btop\s*(\d+)\b.*\bpor\s+([^\?]+)/) || q.match(/\b(maiores|melhores|top)\b.*\bpor\s+([^\?]+)/);
    if (topMatch) {
        const n = topMatch[1] ? parseInt(topMatch[1], 10) : 5;
        const colRaw = topMatch[2] ? topMatch[2].trim().split(/\s+/)[0] : null;
        const col = COL_ALIASES[colRaw] || (colRaw ? ucfirst(colRaw) : null);
        if (!col || !NUMERIC_COLS.includes(col)) {
            return `Não entendi a coluna para ordenar. Exemplo: 'top 5 por sweetness'. Colunas numéricas: ${NUMERIC_COLS.join(', ')}`;
        }
        const sorted = DATA.slice().sort((a, b) => (parseFloat(b[col]) || 0) - (parseFloat(a[col]) || 0)).slice(0, n);
        const lines = sorted.map((r, i) => `${i + 1}. ${LABEL_PRETTY(r)} — ${col}: ${round(r[col], 4)}`);
        return `Top ${n} por ${col}:\n` + lines.join('\n') + `\n(Valores escalados pelo preprocessing)`;
    }

    // -----------------------------
    // 5) Filtros compostos (ex: "tamanho > 0.5 e sweetness > 0.3")
    // -----------------------------
    const filterRegex = /\b(tamanho|size|peso|weight|doce|doçura|sweetness|crocancia|crocância|crunchiness|suculencia|suculência|juiciness|maturacao|maturação|ripeness|acidez|acidity)\b.*?(>=|<=|>|<|=)\s*([0-9\.,-]+)/g;
    const filters = [];
    let match;
    while ((match = filterRegex.exec(q)) !== null) {
        const raw = match[1], op = match[2], numRaw = match[3].replace(',', '.');
        const threshold = parseFloat(numRaw);
        const col = COL_ALIASES[raw] || ucfirst(raw);
        if (NUMERIC_COLS.includes(col)) {
            const compFn = {
                '>': (v) => parseFloat(v) > threshold,
                '<': (v) => parseFloat(v) < threshold,
                '>=': (v) => parseFloat(v) >= threshold,
                '<=': (v) => parseFloat(v) <= threshold,
                '=': (v) => parseFloat(v) === threshold
            }[op];
            if (compFn) filters.push({ col, compFn, op, threshold });
        }
    }
    if (filters.length) {
        const matched = DATA.filter(r => filters.every(f => f.compFn(r[f.col])));
        const sample = matched.slice(0, 6).map(r => {
            const vals = filters.map(f => `${f.col}: ${round(r[f.col], 4)}`).join(' | ');
            return `${LABEL_PRETTY(r)} — ${vals}`;
        });
        return `Encontradas ${matched.length} linhas que satisfazem os filtros.\nAmostra:\n${sample.join('\n')}\n(Valores escalados pelo preprocessing)`;
    }

    // -----------------------------
    // 6) Perguntas abertas de qualidade (boas ou ruins)
    // -----------------------------
    const matchedLabel = Object.entries(qualityKeywords).find(([key, kwList]) =>
        words.some(w => kwList.includes(w))
    );

    if (matchedLabel) {
        const [labelKey] = matchedLabel;
        const relevant = DATA.filter(r =>
            qualityKeywords[labelKey].some(k => String(r[LABEL_COL]).toLowerCase().includes(k))
        );
        if (!relevant.length) return `Não foram encontradas amostras para '${labelKey}'.`;

        const avg = {};
        NUMERIC_COLS.forEach(col => avg[col] = round(mean(relevant.map(x => x[col])), 4));
        const lines = Object.entries(avg).map(([k, v]) => `${k}: ${v}`);
        return `Resumo das amostras rotuladas como '${labelKey}' (médias dos atributos — escalados):\n` +
            lines.join('\n') + `\n(Valores escalados pelo preprocessing)`;
    }

    // -----------------------------
    // 7) Fallback
    // -----------------------------
    return `Desculpe — não entendi a pergunta. Exemplos de perguntas que eu entendo:\n` +
        `• "Quantas boas" — contagem por quality\n` +
        `• "Quantas ruins"\n` +
        `• "Média de sweetness"\n` +
        `• "Top 5 por Juiciness"\n` +
        `• "tamanho > 0.5 e sweetness > 0.3"\n\n` +
        `Colunas numéricas disponíveis: ${NUMERIC_COLS.join(', ')}`;
}


// auxiliares
function round(v, n = 3) {
    if (v === null || v === undefined || isNaN(v)) return v;
    const p = Math.pow(10, n);
    return Math.round(v * p) / p;
}
function ucfirst(s) {
    if (!s) return s;
    return s.charAt(0).toUpperCase() + s.slice(1);
}
function LABEL_PRETTY(row) {
    // tenta retornar uma forma curta para identificar a linha (Quality + primeiro numeric)
    const q = row[LABEL_COL] ?? '';
    const firstNum = NUMERIC_COLS.length ? round(row[NUMERIC_COLS[0]], 4) : '';
    return `${q}${firstNum !== '' ? ' / ' + firstNum : ''}`;
}

// -----------------------------
// Expor window.chatAPI.ask para o frontend
// -----------------------------
window.chatAPI = {
    ask: async (question) => {
        if (!DATA) throw new Error('Dados ainda não carregados. Aguarde a inicialização do app.');
        // pequena espera para simular processamento e deixar o typing visível
        await sleep(150);
        return answerFromData(question);
    }
};

function sleep(ms) { return new Promise(res => setTimeout(res, ms)); }

// -----------------------------
// Lógica de envio / eventos
// -----------------------------
async function sendMessage() {
    const question = inputEl.value.trim();
    if (!question) return;
    addMessage('you', question);
    inputEl.value = '';
    inputEl.focus();

    addTyping();
    sendBtn.disabled = true;
    try {
        // 1) pedir ao NLP a intenção
        const nlpRes = await window.api.nlpProcess(question);
        if (!nlpRes.ok) throw new Error(nlpRes.error || 'NLP error');

        // 2) log útil (dev)
        console.log('NLP result', nlpRes.result);

        const intent = nlpRes.result.intent;
        const score = nlpRes.result.score;
        // se confiante em intent e tiver resposta pronta do manager, usa ela
        if (score > 0.75 && nlpRes.result.answer) {
            removeTyping();
            addMessage('bot', nlpRes.result.answer);
        } else {
            // fallback: usa sua função de resposta a partir do dataset
            const resposta = await window.chatAPI.ask(question);
            removeTyping();
            addMessage('bot', resposta);
        }
    } catch (err) {
        removeTyping();
        addMessage('bot', 'Erro: ' + (err?.message || err));
    } finally {
        sendBtn.disabled = false;
    }
}


sendBtn.addEventListener('click', sendMessage);
inputEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
    }
});

clearBtn.addEventListener('click', () => {
    messagesEl.innerHTML = '';
    inputEl.focus();
    addMessage('bot', 'Conversa limpa. Pergunte algo sobre as maçãs.');
});

// ajusta espaço para composer
(function adjustMessagesForComposer() {
    const composerEl = document.getElementById('composer');
    const messagesEl = document.getElementById('messages');
    function recompute() {
        const extra = (composerEl?.offsetHeight ?? 56) + 12;
        messagesEl.style.paddingBottom = extra + 'px';
    }
    recompute();
    window.addEventListener('resize', recompute);

    const input = document.getElementById('user-input');
    input.addEventListener('focus', () => {
        setTimeout(() => messagesEl.scrollTop = messagesEl.scrollHeight, 200);
    });
})();

// -----------------------------
// Inicialização: carregar dados processados
// -----------------------------
window.addEventListener('DOMContentLoaded', async () => {
    addMessage('bot', 'Carregando dados processados... Aguarde um instante.');
    try {
        const arr = await loadProcessedData();
        initDatasetStructures(arr);
        //console.log("Amostra de dados preprocessados:", DATA.slice(0, 5));
        addMessage('bot', `Dados carregados: ${arr.length} linhas. Colunas: ${COLUMNS.join(', ')}.\nNota: valores numéricos foram pré-processados (StandardScaler).`);
        // sugestão inicial mais amigável:
        addMessage('bot', 'Olá! Pergunte sobre as maçãs — ex.: "maçã boa", "média de sweetness", "top 5 por Juiciness", ou "tamanho > 0.5".');
    } catch (err) {
        addMessage('bot', 'Falha ao carregar dados processados: ' + (err?.message || err));
        addMessage('bot', 'Verifique se executou o preprocess e se o arquivo resources/processed_apple_quality.json existe.');
    } finally {
        inputEl.focus();
    }
});