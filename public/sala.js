// A salinha. Um canvas de 400x240 "pixels de arte" ampliado em escala inteira
// (nunca fracionária — é isso que mantém o pixel quadrado e o visual 16-bit),
// com o cenário desenhado em retângulos e os 10 agentes andando por cima.
//
// A sala é uma ENCENAÇÃO do que o backend fez de verdade: as falas vêm de
// /api/sala (a última reunião gravada), não de um texto decorativo. Quando não
// há reunião rolando, os agentes tocam a vida do escritório — vão ao bebedouro,
// passam na mesa do colega, voltam pra sua.

import { desenharBoneco, TAMANHO_BONECO } from './sprites.js';

const L = 400, ALT = 240;          // resolução lógica ("pixels de arte")
const CHAO_Y = 72;                 // onde a parede termina e o piso começa
const MESA = { x: 200, y: 152, rx: 52, ry: 24 };

// Onde cada agente "mora" na sala, e pra onde olha parado.
// Cinco pessoas, não dez. Com menos gente a sala respira: cada um tem seu
// canto, e a mesa do meio deixou de ser um amontoado.
export const CASAS = {
  olheiro:    { x: 64,  y: 108, olhar: 'lado',  mesa: 'tv' },
  criacao:    { x: 138, y: 96,  olhar: 'cima',  mesa: 'prancheta' },
  marketeiro: { x: 268, y: 96,  olhar: 'cima',  mesa: 'quadro' },
  analista:   { x: 344, y: 120, olhar: 'lado',  mesa: 'cofre' },
  produtor:   { x: 300, y: 212, olhar: 'baixo', mesa: 'monitor' },
};

// Pontos de passeio: é o que dá a sensação de escritório vivo em vez de
// bonecos parados esperando comando.
const PONTOS_DE_INTERESSE = [
  { x: 186, y: 196, nome: 'bebedouro' },
  { x: 330, y: 84,  nome: 'café' },
  { x: 148, y: 200, nome: 'planta' },
  { x: 240, y: 110, nome: 'quadro tático' },
];

const cores = {
  paredeA: '#2e2a44', paredeB: '#353052', rodape: '#1b1830',
  pisoA: '#4a5d52', pisoB: '#42544a', tapete: '#7a2f3a', tapeteB: '#8f3a45',
  madeira: '#8a5a32', madeiraEsc: '#6b4526', metal: '#8892a6', metalEsc: '#5c6579',
  tela: '#7fd7ff', telaEsc: '#2a6b8a', planta: '#3f8f4a', plantaEsc: '#2c6b35',
  ceu: '#7fc9ff', ceuEsc: '#5aa8e6', gramado: '#3f8f4a', linha: '#eaf4ea',
  preto: '#141018', branco: '#f2f0f5', ouro: '#ffcc33',
};

// O brasão do squad, pendurado na parede da sala. Carregado como SVG e
// desenhado pequeno COM suavização — reduzir um escudo cheio de detalhe a 34px
// com pixelate vira ruído; aqui a pixelaria é do cenário, não do brasão.
const brasao = new Image();
let brasaoPronto = false;
brasao.onload = () => { brasaoPronto = true; };
brasao.onerror = () => { brasaoPronto = false; };
brasao.src = '/squad-patch.svg';

let ctx, canvas, escala = 2;
const agentes = new Map();          // chave -> estado de animação
let tempo = 0;
let modoReuniao = false;
const camada = () => document.getElementById('camadaUi');

// ── Cenário ──────────────────────────────────────────────────────────────

function r(x, y, w, h, cor) { ctx.fillStyle = cor; ctx.fillRect(x, y, w, h); }

function desenharParede() {
  r(0, 0, L, CHAO_Y, cores.paredeA);
  for (let y = 0; y < CHAO_Y; y += 8) {
    for (let x = (y / 8) % 2 ? 0 : 8; x < L; x += 16) r(x, y, 15, 7, cores.paredeB);
  }
  r(0, CHAO_Y - 6, L, 6, cores.rodape);

  janela(28, 14);
  janela(330, 14);
  quadroTatico(150, 10);
  relogio(300, 30);
  brasaoNaParede(112, 32);
  flamulas();
}

function janela(x, y) {
  r(x - 2, y - 2, 48, 42, cores.rodape);
  r(x, y, 44, 38, cores.ceu);
  r(x, y + 26, 44, 12, cores.ceuEsc);
  r(x + 6, y + 6, 10, 5, cores.branco);       // nuvem
  r(x + 10, y + 4, 12, 5, cores.branco);
  r(x + 21, y, 2, 38, cores.rodape);          // caixilho
  r(x, y + 18, 44, 2, cores.rodape);
}

// O quadro tático é um campinho — é o detalhe que diz "aqui é futebol" sem texto.
function quadroTatico(x, y) {
  r(x - 3, y - 3, 106, 52, cores.madeiraEsc);
  r(x, y, 100, 46, cores.gramado);
  for (let i = 0; i < 100; i += 12) r(x + i, y, 6, 46, '#46994f');
  ctx.strokeStyle = cores.linha; ctx.lineWidth = 1;
  ctx.strokeRect(x + 3.5, y + 3.5, 93, 39);
  ctx.beginPath(); ctx.moveTo(x + 50.5, y + 3); ctx.lineTo(x + 50.5, y + 43); ctx.stroke();
  ctx.beginPath(); ctx.arc(x + 50.5, y + 23, 8, 0, Math.PI * 2); ctx.stroke();
  ctx.strokeRect(x + 3.5, y + 13.5, 10, 19);
  ctx.strokeRect(x + 86.5, y + 13.5, 10, 19);
  r(x + 30, y + 18, 3, 3, '#ff4d4d');          // as pecinhas do esquema
  r(x + 44, y + 30, 3, 3, '#ff4d4d');
  r(x + 62, y + 14, 3, 3, '#4fa3e0');
  r(x + 70, y + 28, 3, 3, '#4fa3e0');
}

function brasaoNaParede(x, y) {
  r(x - 22, y - 22, 44, 44, cores.madeiraEsc);   // moldura
  r(x - 20, y - 20, 40, 40, '#0e1a2a');          // fundo, o mesmo azul do brasão
  r(x - 20, y - 20, 40, 2, '#1b2b45');           // luz no topo da moldura
  if (brasaoPronto) {
    ctx.imageSmoothingEnabled = true;
    try { ctx.drawImage(brasao, x - 18, y - 18, 36, 36); } catch { /* svg ainda não rasterizou */ }
    ctx.imageSmoothingEnabled = false;
  }
}

function relogio(x, y) {
  r(x - 11, y - 11, 22, 22, cores.metalEsc);
  r(x - 9, y - 9, 18, 18, cores.branco);
  const m = new Date();
  const ang = ((m.getHours() % 12) + m.getMinutes() / 60) * (Math.PI / 6) - Math.PI / 2;
  const angM = m.getMinutes() * (Math.PI / 30) - Math.PI / 2;
  ctx.strokeStyle = cores.preto; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(ang) * 4, y + Math.sin(ang) * 4); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(angM) * 7, y + Math.sin(angM) * 7); ctx.stroke();
}

function flamulas() {
  const cor = ['#ffcc33', '#e0473c', '#4fa3e0', '#3ecf8e', '#b64ec8'];
  for (let i = 0; i < 20; i++) {
    const x = 6 + i * 20, y = 2 + (i % 2 ? 2 : 0);
    ctx.fillStyle = cor[i % cor.length];
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + 10, y); ctx.lineTo(x + 5, y + 9); ctx.fill();
  }
  r(0, 1, L, 1, '#1b1830');
}

function desenharPiso() {
  for (let y = CHAO_Y; y < ALT; y += 14) {
    for (let x = 0; x < L; x += 20) {
      r(x, y, 20, 14, ((x / 20 + y / 14) | 0) % 2 ? cores.pisoA : cores.pisoB);
    }
  }
  // tapete da mesa de reunião
  r(MESA.x - 84, MESA.y - 44, 168, 88, cores.tapete);
  r(MESA.x - 78, MESA.y - 38, 156, 76, cores.tapeteB);
  r(MESA.x - 70, MESA.y - 32, 140, 64, cores.tapete);
}

function mesaDeReuniao() {
  ctx.fillStyle = cores.madeiraEsc;
  ctx.beginPath(); ctx.ellipse(MESA.x, MESA.y + 4, MESA.rx, MESA.ry, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = cores.madeira;
  ctx.beginPath(); ctx.ellipse(MESA.x, MESA.y, MESA.rx, MESA.ry, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#9c6a3c';
  ctx.beginPath(); ctx.ellipse(MESA.x, MESA.y - 2, MESA.rx - 10, MESA.ry - 8, 0, 0, Math.PI * 2); ctx.fill();
  // bola no centro da mesa: é uma sala de guerra do futebol, afinal
  r(MESA.x - 4, MESA.y - 5, 8, 8, cores.branco);
  r(MESA.x - 2, MESA.y - 3, 4, 4, cores.preto);
  r(MESA.x - 20, MESA.y - 2, 10, 6, '#f2f0f5');   // papelada
  r(MESA.x + 12, MESA.y - 1, 9, 5, '#dfe3ea');
}

function movel(tipo, x, y) {
  switch (tipo) {
    case 'monitor':
      r(x - 14, y - 26, 28, 12, cores.madeiraEsc);
      r(x - 10, y - 40, 20, 15, cores.metalEsc);
      r(x - 8, y - 38, 16, 11, cores.tela);
      r(x - 8, y - 32, 16, 5, cores.telaEsc);
      r(x - 2, y - 26, 4, 2, cores.metal);
      break;
    case 'prancheta':
      r(x - 14, y - 26, 28, 12, cores.madeiraEsc);
      r(x - 9, y - 42, 18, 18, cores.branco);
      r(x - 9, y - 42, 18, 3, cores.metal);
      r(x - 6, y - 36, 12, 2, '#b64ec8');
      r(x - 6, y - 32, 9, 2, '#4fa3e0');
      break;
    case 'tv':
      r(x - 16, y - 26, 32, 12, cores.madeiraEsc);
      r(x - 14, y - 44, 28, 19, cores.preto);
      r(x - 12, y - 42, 24, 15, cores.gramado);
      r(x - 12, y - 35, 24, 1, cores.linha);
      r(x - 1, y - 36, 2, 2, cores.branco);
      break;
    case 'quadro':
      r(x - 14, y - 26, 28, 12, cores.madeiraEsc);
      r(x - 12, y - 44, 24, 19, '#f6f4ef');
      r(x - 9, y - 40, 16, 2, '#e0473c');
      r(x - 9, y - 36, 12, 2, '#ff9f43');
      r(x - 9, y - 32, 18, 2, '#4fa3e0');
      break;
    case 'cofre':
      r(x - 13, y - 24, 26, 22, cores.metalEsc);
      r(x - 10, y - 21, 20, 16, cores.metal);
      ctx.strokeStyle = cores.ouro; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(x, y - 13, 5, 0, Math.PI * 2); ctx.stroke();
      r(x - 1, y - 18, 2, 10, cores.ouro);
      break;
    case 'sofa':
      r(x - 22, y - 20, 44, 18, '#3c4a7a');
      r(x - 22, y - 26, 44, 8, '#4a5a92');
      r(x - 24, y - 22, 5, 16, '#33406b');
      r(x + 19, y - 22, 5, 16, '#33406b');
      r(x - 12, y - 18, 10, 6, '#5a6aa8');
      break;
  }
}

function planta(x, y) {
  r(x - 5, y - 8, 10, 9, '#a4552f');
  r(x - 5, y - 9, 10, 3, '#c26a3d');
  r(x - 1, y - 20, 2, 12, cores.plantaEsc);
  r(x - 8, y - 22, 7, 5, cores.planta);
  r(x + 1, y - 25, 8, 6, cores.planta);
  r(x - 6, y - 28, 6, 5, cores.plantaEsc);
}

function bebedouro(x, y) {
  r(x - 6, y - 16, 12, 16, cores.metal);
  r(x - 7, y - 32, 14, 17, '#9fd8f5');
  r(x - 7, y - 26, 14, 11, '#6fc3ea');
  r(x - 3, y - 12, 6, 3, cores.metalEsc);
}

function cafeteira(x, y) {
  r(x - 9, y - 6, 18, 6, cores.madeiraEsc);
  r(x - 7, y - 20, 14, 15, '#2b2b38');
  r(x - 5, y - 17, 10, 7, '#6b4526');
  r(x - 5, y - 9, 10, 3, '#c0392b');
}

function desenharCenario() {
  desenharParede();
  desenharPiso();
  planta(26, 232); planta(376, 230); planta(148, 206);
  bebedouro(186, 200);
  cafeteira(330, 88);
  for (const c of Object.values(CASAS)) movel(c.mesa, c.x, c.y);
  // O sofá fica como canto de descanso da agência, sem dono — a sala não é só
  // posto de trabalho.
  movel('sofa', 104, 210);
  mesaDeReuniao();
}

// ── Agentes ──────────────────────────────────────────────────────────────

function novoAgente(ag) {
  const casa = CASAS[ag.chave];
  return {
    chave: ag.chave, nome: ag.pessoa?.nome || ag.nome, paleta: ag.paleta, emConversa: false,
    x: casa.x, y: casa.y, alvoX: casa.x, alvoY: casa.y,
    dir: casa.olhar, virado: false, frame: 0, andando: false,
    falaAte: 0, texto: '', proximoPasseio: performance.now() + 3000 + Math.random() * 9000,
  };
}

export function montarAgentes(lista) {
  agentes.clear();
  camada().innerHTML = '';
  for (const ag of lista) {
    if (!CASAS[ag.chave]) continue;
    const a = novoAgente(ag);
    agentes.set(ag.chave, a);

    const tag = document.createElement('div');
    tag.className = 'tag-nome';
    // Nome de gente, não cargo: é "Téo", não "Olheiro".
    tag.textContent = ag.pessoa?.nome || ag.nome;
    tag.dataset.chave = ag.chave;
    tag.title = ag.pessoa ? `${ag.pessoa.nomeCompleto} — ${ag.pessoa.papel}` : (ag.oque || '');
    tag.onclick = () => window.dispatchEvent(new CustomEvent('abrir-agente', { detail: ag.chave }));
    camada().appendChild(tag);
    a.elTag = tag;

    const balao = document.createElement('div');
    balao.className = 'balao';
    balao.dataset.chave = ag.chave;
    camada().appendChild(balao);
    a.elBalao = balao;
  }
}

function irPara(a, x, y) { a.alvoX = x; a.alvoY = Math.max(CHAO_Y + 14, Math.min(ALT - 6, y)); }

export function mandarPraCasa(chave) {
  const a = agentes.get(chave); if (!a) return;
  const c = CASAS[chave];
  irPara(a, c.x, c.y);
}

export function falar(chave, texto, ms = 5200) {
  const a = agentes.get(chave); if (!a) return;
  a.texto = String(texto || '');
  a.falaAte = performance.now() + ms;
}

/** Todo mundo em volta da mesa — o começo de uma reunião. */
export function reunirNaMesa(chaves) {
  modoReuniao = true;
  const lista = chaves.filter((c) => agentes.has(c));
  lista.forEach((chave, i) => {
    const ang = (i / lista.length) * Math.PI * 2 - Math.PI / 2;
    irPara(agentes.get(chave), MESA.x + Math.cos(ang) * (MESA.rx + 22), MESA.y + Math.sin(ang) * (MESA.ry + 20));
  });
}

export function encerrarReuniao() {
  modoReuniao = false;
  for (const chave of agentes.keys()) mandarPraCasa(chave);
}

/**
 * Dois deles se encontram e conversam de verdade: andam até um ponto entre as
 * duas mesas e trocam falas, uma de cada vez. É a conversa de corredor que o
 * backend gerou — não é enfeite, o texto é o mesmo que está gravado.
 */
export function conversarNoCorredor(aChave, bChave, falas, aoTerminar) {
  const a = agentes.get(aChave), b = agentes.get(bChave);
  if (!a || !b || !falas?.length || modoReuniao) return null;

  const meioX = (a.x + b.x) / 2, meioY = (a.y + b.y) / 2;
  irPara(a, meioX - 11, meioY);
  irPara(b, meioX + 11, meioY);
  a.emConversa = true; b.emConversa = true;

  const timers = [];
  const chegada = 2000;
  falas.forEach((f, i) => {
    timers.push(window.setTimeout(() => {
      falar(f.quem, f.texto, 4200);
      const el = document.getElementById('legenda');
      if (el) el.textContent = f.texto;
    }, chegada + i * 4400));
  });
  timers.push(window.setTimeout(() => {
    a.emConversa = false; b.emConversa = false;
    mandarPraCasa(aChave); mandarPraCasa(bChave);
    const el = document.getElementById('legenda');
    if (el) el.textContent = '';
    if (aoTerminar) aoTerminar();
  }, chegada + falas.length * 4400 + 1500));
  return timers;
}

/** Dois agentes se cruzam pra trocar uma ideia — a vida entre reuniões. */
function passeio(a, agora) {
  if (modoReuniao || a.emConversa || a.falaAte > agora) return;
  a.proximoPasseio = agora + 6000 + Math.random() * 14000;
  const sorte = Math.random();
  if (sorte < 0.35) {
    const p = PONTOS_DE_INTERESSE[(Math.random() * PONTOS_DE_INTERESSE.length) | 0];
    irPara(a, p.x + (Math.random() * 16 - 8), p.y + 8);
    window.setTimeout(() => { if (!modoReuniao) mandarPraCasa(a.chave); }, 7000);
  } else if (sorte < 0.55) {
    const outros = [...agentes.values()].filter((o) => o.chave !== a.chave);
    const alvo = outros[(Math.random() * outros.length) | 0];
    if (!alvo) return;
    irPara(a, alvo.x + 20, alvo.y + 2);
    window.setTimeout(() => { if (!modoReuniao) mandarPraCasa(a.chave); }, 8000);
  } else {
    const c = CASAS[a.chave];
    irPara(a, c.x + (Math.random() * 20 - 10), c.y + (Math.random() * 12 - 6));
  }
}

function passo(a, dt, agora) {
  const dx = a.alvoX - a.x, dy = a.alvoY - a.y;
  const dist = Math.hypot(dx, dy);
  if (dist > 1.2) {
    const v = 26 * dt;                            // px de arte por segundo
    a.x += (dx / dist) * Math.min(v, dist);
    a.y += (dy / dist) * Math.min(v, dist);
    a.andando = true;
    if (Math.abs(dx) > Math.abs(dy)) { a.dir = 'lado'; a.virado = dx < 0; }
    else { a.dir = dy > 0 ? 'baixo' : 'cima'; }
    a.frame = Math.floor(agora / 140) % 4;
  } else {
    a.andando = false;
    a.frame = 0;
    if (!modoReuniao && !a.emConversa && agora > a.proximoPasseio) passeio(a, agora);
    if (modoReuniao) { a.dir = a.y < MESA.y ? 'baixo' : 'cima'; }
  }
}

function posicionarUi(a, agora) {
  const rect = canvas.getBoundingClientRect();
  const px = a.x * escala, py = a.y * escala;
  a.elTag.style.transform = `translate(${px}px, ${py + 4}px)`;
  const falando = a.falaAte > agora && a.texto;
  a.elBalao.classList.toggle('visivel', !!falando);
  if (falando) {
    if (a.elBalao.textContent !== a.texto) a.elBalao.textContent = a.texto;
    a.elBalao.style.transform = `translate(${px}px, ${py - TAMANHO_BONECO.altura * escala - 10}px)`;
  }
  void rect;
}

function laco(t) {
  const agora = t;
  const dt = Math.min(0.05, (agora - tempo) / 1000) || 0;
  tempo = agora;

  ctx.imageSmoothingEnabled = false;
  desenharCenario();

  const ordenados = [...agentes.values()].sort((a, b) => a.y - b.y);
  for (const a of ordenados) {
    passo(a, dt, agora);
    // sombra: um oval achatado é o que "cola" o boneco no chão
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.beginPath(); ctx.ellipse(a.x, a.y + 1, 7, 3, 0, 0, Math.PI * 2); ctx.fill();
    desenharBoneco(ctx, a.paleta, a.dir, a.andando ? a.frame : 0,
      Math.round(a.x - TAMANHO_BONECO.largura / 2), Math.round(a.y - TAMANHO_BONECO.altura), a.virado);
    if (a.falaAte > agora) {
      // pisca uma marquinha sobre quem está com a palavra
      const pisca = Math.floor(agora / 250) % 2;
      if (pisca) r(Math.round(a.x) - 1, Math.round(a.y - TAMANHO_BONECO.altura) - 5, 3, 3, cores.ouro);
    }
    posicionarUi(a, agora);
  }

  requestAnimationFrame(laco);
}

function ajustarEscala() {
  // Mede o container EXTERNO, nunca o pai imediato: a moldura se ajusta ao
  // canvas, então perguntar a largura a ela daria zero (dependência circular)
  // e o canvas nasceria do tamanho de um selo.
  const wrap = document.querySelector('.sala-wrap');
  const disponivel = Math.max(160, (wrap?.clientWidth || window.innerWidth) - 44);
  escala = Math.max(1, Math.min(4, Math.floor(disponivel / L)));
  if (disponivel < L) escala = disponivel / L;   // telas estreitas: aceita fracionário pra caber
  canvas.width = L; canvas.height = ALT;
  canvas.style.width = L * escala + 'px';
  canvas.style.height = ALT * escala + 'px';
  camada().style.width = L * escala + 'px';
  camada().style.height = ALT * escala + 'px';
}

export function iniciarSala() {
  canvas = document.getElementById('sala');
  ctx = canvas.getContext('2d');
  ajustarEscala();
  window.addEventListener('resize', ajustarEscala);
  tempo = performance.now();
  requestAnimationFrame(laco);
}

export function agentesNaSala() { return agentes; }
