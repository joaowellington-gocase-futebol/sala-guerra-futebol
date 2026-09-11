// O Escritório: 9 bonequinhos andando pela sala, cada um com sua mesa,
// convergindo pra Mesa de Reunião quando trocam recado de verdade (via AI
// Proxy) ou durante uma "Convocar reunião". Sem motor de jogo — só posição
// alvo + transition de CSS, e uma classe "falando" que abre um balão com o
// texto real trocado.

const DESKS = {
  tendencias:   { x: 12, y: 20, icone: '📈', avatar: '/avatars/tendencias.jpg' },
  diretorarte:  { x: 30, y: 10, icone: '🎨', avatar: '/avatars/diretorarte.jpg' },
  avaliador:    { x: 70, y: 10, icone: '💰', avatar: '/avatars/avaliador.jpg' },
  torcedor:     { x: 88, y: 20, icone: '🖤', avatar: '/avatars/torcedor.jpg' },
  concorrencia: { x: 90, y: 55, icone: '🔎', avatar: '/avatars/concorrencia.jpg' },
  redator:      { x: 88, y: 88, icone: '✍️', avatar: '/avatars/redator.jpg' },
  contador:     { x: 55, y: 90, icone: '🧮', avatar: '/avatars/contador.jpg' },
  fiscal:       { x: 12, y: 60, icone: '🚨', avatar: '/avatars/fiscal.jpg' },
  motivacional: { x: 10, y: 66, icone: '💬', avatar: '/avatars/motivacional.jpg' },
};
const MESA_REUNIAO = { x: 50, y: 50 };

window.SalaDeGuerra = { estado: null, sessaoAtual: () => (document.getElementById('sessaoReuniao').value.trim() || 'avulso') };

let ultimoRecadoId = 0;

function criarMesas() {
  const piso = document.getElementById('escritorio');
  for (const [chave, d] of Object.entries(DESKS)) {
    if (chave === 'motivacional') continue; // usa o cantinho, já desenhado no HTML
    const mesa = document.createElement('div');
    mesa.className = 'mesa';
    mesa.style.left = d.x + '%';
    mesa.style.top = d.y + '%';
    mesa.innerHTML = `<div class="icone-mesa">${d.icone}</div><div class="rotulo">${chave}</div>`;
    piso.appendChild(mesa);
  }
}

function criarBonequinhos(agentes) {
  const piso = document.getElementById('escritorio');
  for (const ag of agentes) {
    const d = DESKS[ag.chave];
    if (!d) continue;
    const el = document.createElement('div');
    el.className = 'bonequinho';
    el.id = 'boneco-' + ag.chave;
    el.style.left = d.x + '%';
    el.style.top = d.y + '%';
    el.dataset.chave = ag.chave;
    el.dataset.baseX = d.x;
    el.dataset.baseY = d.y;
    el.innerHTML = `
      <div class="balao"></div>
      <div class="avatar" style="background-image:url('${d.avatar}')"></div>
      <div class="nome-tag">${ag.nome}</div>
    `;
    el.addEventListener('click', () => window.MesaDeTrabalho.abrir(ag.chave));
    piso.appendChild(el);
  }
}

function mover(chave, xPct, yPct) {
  const el = document.getElementById('boneco-' + chave);
  if (!el) return;
  el.classList.add('andando');
  el.style.left = xPct + '%';
  el.style.top = yPct + '%';
  window.clearTimeout(el._paradaTimer);
  el._paradaTimer = window.setTimeout(() => el.classList.remove('andando'), 1900);
}

function voltarPraMesa(chave) {
  const el = document.getElementById('boneco-' + chave);
  if (!el) return;
  mover(chave, Number(el.dataset.baseX), Number(el.dataset.baseY));
}

function falar(chave, texto, ms = 4200) {
  const el = document.getElementById('boneco-' + chave);
  if (!el) return;
  const balao = el.querySelector('.balao');
  balao.textContent = texto.length > 90 ? texto.slice(0, 90) + '…' : texto;
  el.classList.add('falando');
  window.clearTimeout(el._falaTimer);
  el._falaTimer = window.setTimeout(() => el.classList.remove('falando'), ms);
}

/** Dois agentes se encontram na Mesa de Reunião, trocam um "balão" e voltam pra mesa deles. */
window.encontroNaMesaDeReuniao = function encontroNaMesaDeReuniao(deChave, paraChave, textoDe, textoPara) {
  mover(deChave, MESA_REUNIAO.x - 6, MESA_REUNIAO.y);
  mover(paraChave, MESA_REUNIAO.x + 6, MESA_REUNIAO.y);
  window.setTimeout(() => {
    if (textoDe) falar(deChave, textoDe);
    if (textoPara) falar(paraChave, textoPara);
  }, 1850);
  window.setTimeout(() => { voltarPraMesa(deChave); voltarPraMesa(paraChave); }, 6200);
};

/** Passeio ambiente: de vez em quando um agente anda até perto da própria mesa (vida na sala). */
function passeioAmbiente() {
  const chaves = Object.keys(DESKS);
  const chave = chaves[Math.floor(Math.random() * chaves.length)];
  const el = document.getElementById('boneco-' + chave);
  if (!el || el.classList.contains('falando')) return;
  const baseX = Number(el.dataset.baseX), baseY = Number(el.dataset.baseY);
  const dx = (Math.random() - 0.5) * 10, dy = (Math.random() - 0.5) * 10;
  mover(chave, Math.min(94, Math.max(6, baseX + dx)), Math.min(94, Math.max(6, baseY + dy)));
  window.setTimeout(() => voltarPraMesa(chave), 3800);
}
setInterval(passeioAmbiente, 5000);

async function pollRecados() {
  try {
    const sessao = window.SalaDeGuerra.sessaoAtual();
    const res = await fetch('/api/recados?sessao=' + encodeURIComponent(sessao));
    const j = await res.json();
    const recados = (j.recados || []).slice().reverse(); // mais antigo primeiro
    for (const r of recados) {
      const idAprox = r.quando + '|' + r.de + '|' + r.para;
      if (window._recadosVistos && window._recadosVistos.has(idAprox)) continue;
      window._recadosVistos = window._recadosVistos || new Set();
      window._recadosVistos.add(idAprox);
      if (!DESKS[r.de] || !DESKS[r.para]) continue;
      window.encontroNaMesaDeReuniao(r.de, r.para, r.assunto, 'recebido ✔');
    }
  } catch { /* silencioso — não trava a sala por um poll perdido */ }
}
setInterval(pollRecados, 8000);

async function carregarEstado() {
  try {
    const res = await fetch('/api/estado');
    const estado = await res.json();
    window.SalaDeGuerra.estado = estado;
    criarBonequinhos(estado.agentes);
    document.getElementById('statusToken').textContent = estado.temToken
      ? '' : '⚠ AI_PROXY_TOKEN não configurado — os agentes não vão conseguir rodar até você configurar o secret.';
    return estado;
  } catch (e) {
    document.getElementById('statusToken').textContent = '⚠ Não consegui falar com /api/estado: ' + e;
  }
}

criarMesas();
carregarEstado();
