// A camada de comando da sala: o painel de cada agente, a ata da última
// reunião, a memória que a mesa acumulou e a configuração do webhook.
// Tudo que aparece aqui veio de uma rota real — nada é enfeite.
//
// Desde 15/09/2026 tem também o painel 🎯 Coordenar: é por ali que o João dá
// pauta, feedback e demanda pra equipe, e vê o que eles responderam. Ver
// src/direcao.ts.

import { iniciarSala, montarAgentes, falar, reunirNaMesa, encerrarReuniao, mandarPraCasa, conversarNoCorredor } from './sala.js';
import { desenharRetrato } from './sprites.js';

const $ = (id) => document.getElementById(id);
let estado = null;
let ultimaSala = null;
let encenacao = null;   // timers da reencenação em curso

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function agentePorChave(chave) {
  return (estado?.agentes || []).find((a) => a.chave === chave);
}

function abrirPainel(html) {
  $('painelConteudo').innerHTML = html;
  $('painel').classList.add('aberto');
}
$('fecharPainel').onclick = () => $('painel').classList.remove('aberto');

// ── Relógio da próxima reunião ───────────────────────────────────────────

function formatarEspera(iso) {
  const falta = new Date(iso).getTime() - Date.now();
  if (!isFinite(falta)) return '—';
  if (falta <= 0) return 'agora';
  const h = Math.floor(falta / 3600000), m = Math.floor((falta % 3600000) / 60000);
  return h ? `${h}h${String(m).padStart(2, '0')}` : `${m}min`;
}

function tiquetaque() {
  if (estado?.proximaReuniao) {
    $('contagem').textContent = 'próxima reunião automática em ' + formatarEspera(estado.proximaReuniao);
  }
}
setInterval(tiquetaque, 20000);

// ── Encenação: a última reunião replayada em balões sobre os sprites ─────

function pararEncenacao() {
  if (encenacao) encenacao.forEach(clearTimeout);
  encenacao = null;
}

function encenar(falas, { aoTerminar } = {}) {
  pararEncenacao();
  if (!falas?.length) return;
  reunirNaMesa(falas.map((f) => f.chave));
  const timers = [];
  const inicio = 2200;              // tempo pra galera chegar na mesa
  falas.forEach((f, i) => {
    timers.push(setTimeout(() => {
      falar(f.chave, f.texto, 4400);
      $('legenda').innerHTML = `<b>${esc(nomeDe(f.chave))}</b> <span class="rodada">${esc(f.rodada || '')}</span> — ${esc(f.texto)}`;
    }, inicio + i * 4600));
  });
  timers.push(setTimeout(() => {
    encerrarReuniao();
    $('legenda').textContent = '';
    if (aoTerminar) aoTerminar();
  }, inicio + falas.length * 4600 + 1200));
  encenacao = timers;
}

function nomeDe(chave) {
  if (chave === 'joao') return 'João';
  const a = agentePorChave(chave); return a?.pessoa?.nome || a?.nome || chave;
}

// ── Carregamento ─────────────────────────────────────────────────────────

async function carregarEstado() {
  const res = await fetch('/api/estado');
  estado = await res.json();
  montarAgentes(estado.agentes);
  const avisos = [];
  if (!estado.temToken) avisos.push('⚠ AI_PROXY_TOKEN não configurado — os agentes não rodam.');
  if (!estado.webhookConfigurado) avisos.push('⚠ webhook sem URL — clique em ⚙ e cole a do espaço do Google Chat.');
  if (!estado.autoAtivo) avisos.push('⏸ reunião automática desligada no painel.');
  // O que você mandou e ainda não voltou: é isto que some quando ninguém olha.
  const d = estado.direcao || {};
  if (d.tema) avisos.push(`🎯 pauta sua na mesa: "${String(d.tema).slice(0, 70)}"`);
  if (d.demandas) {
    avisos.push(`📋 ${d.demandas} pedido(s) seu(s) na fila` +
      (d.demandasParadas ? ` — ${d.demandasParadas} parado(s) há 3 rodadas ou mais` : ''));
  }
  $('avisos').innerHTML = avisos.map((a) => `<span>${esc(a)}</span>`).join('');
  tiquetaque();
}

async function carregarSala(sessao) {
  const res = await fetch('/api/sala' + (sessao ? '?sessao=' + encodeURIComponent(sessao) : ''));
  ultimaSala = await res.json();
  if (estado && ultimaSala.proximaReuniao) estado.proximaReuniao = ultimaSala.proximaReuniao;
  renderAtaResumida();
  return ultimaSala;
}

function renderAtaResumida() {
  const a = ultimaSala?.ata;
  if (!a) { $('faixaAta').innerHTML = '<i>nenhuma reunião registrada ainda — convoque uma ou espere a automática.</i>'; return; }
  const quando = new Date(a.quando).toLocaleString('pt-BR', { timeZone: 'America/Fortaleza' });
  const reco = (a.recomendacoes || [])[0];
  $('faixaAta').innerHTML =
    `<b>${a.automatica ? '🤖 automática' : '📣 convocada'}</b> · ${esc(quando)} · <b>${esc(a.tema)}</b>` +
    (reco ? ` · 🎯 <b>${esc(String(reco.o_que).slice(0, 110))}</b>` : ' · <i>sem recomendação nesta rodada</i>') +
    ` <button class="link" id="btnVerAta">ver ata</button>` +
    ` <button class="link" id="btnReencenar">reencenar</button>`;
  $('btnVerAta').onclick = mostrarAta;
  $('btnReencenar').onclick = () => encenar(ultimaSala.falas);
}

function mostrarAta() {
  const a = ultimaSala?.ata;
  if (!a) return;
  const lista = (arr, fn) => (arr?.length ? '<ul>' + arr.map(fn).join('') + '</ul>' : '<p class="fraco">—</p>');
  const recos = a.recomendacoes || [];
  const entregas = a.entregas || [];
  abrirPainel(`
    <h2>Ata da reunião</h2>
    <div class="fraco">${esc(a.tema)} · ${esc(new Date(a.quando).toLocaleString('pt-BR', { timeZone: 'America/Fortaleza' }))}</div>
    <p><a class="link-ata" href="/ata?sessao=${encodeURIComponent(a.sessao)}" target="_blank" rel="noopener">📄 abrir a ata completa em página própria</a> — é este link que sai no Google Chat.</p>
    ${a.resumo_curto ? `<p><b>${esc(a.resumo_curto)}</b></p>` : ''}

    <label>🎯 O que a mesa recomenda</label>
    ${recos.length
      ? recos.map((r) => `<div class="item"><b>${esc(r.o_que)}</b><br>
          <span class="fraco">${esc(r.por_que || '')}</span><br>
          <span class="rodada">${esc(nomeDe(r.quem))}${r.ate_quando ? ' · até ' + esc(r.ate_quando) : ''}</span>
          ${r.risco ? `<br><span class="fraco">⚠ ${esc(r.risco)}</span>` : ''}</div>`).join('')
      : '<p class="fraco">Nada recomendado nesta rodada — o dado de hoje não sustentou decisão nova.</p>'}

    ${a.precisamos_de_voce ? `<label>🙋 A mesa precisa de você</label><p>${esc(a.precisamos_de_voce)}</p>` : ''}

    ${entregas.length ? `<label>📮 O que você pediu</label>` + entregas.map((e) => `
      <div class="item">${e.pronta ? '✅' : '🚧'} <b>${esc(e.nome)}</b><br>${esc(e.entrega)}
      ${e.o_que_falta ? `<br><span class="fraco">Falta: ${esc(e.o_que_falta)}</span>` : ''}</div>`).join('') : ''}

    <label>Resumo</label>
    <p>${esc(a.resumo)}</p>
    ${a.placar_vendas ? `<label>🔬 Placar da investigação</label><p>${esc(a.placar_vendas)}</p>` : ''}
    <label>📌 O que passamos a acreditar</label>${lista(a.consenso, (c) => `<li>${esc(c)}</li>`)}
    <label>❌ O que caiu por terra</label>${lista(a.divergencias, (d) => `<li><b>${esc(d.entre)}</b> — ${esc(d.sobre)}<br><span class="fraco">${esc(d.posicoes)}</span></li>`)}
    <label>📋 Quem faz o quê até a próxima</label>${lista(a.acoes, (x) => `<li><b>${esc(nomeDe(x.agente))}</b>: ${esc(x.acao)}</li>`)}

    <label>Achou fraco? Fale com eles</label>
    <textarea id="campoFeedbackAta" placeholder="ex.: essa recomendação é genérica demais, quero número em cima de clube pequeno"></textarea>
    <button class="acao" id="btnFeedbackAta">Mandar feedback pra mesa</button>
    <div id="statusFeedbackAta" class="fraco"></div>

    <label>Webhook</label><p class="fraco">${esc(a.webhook_status || 'não enviado')}</p>
    <label>Transcrição falada</label>
    <div class="transcricao">${(ultimaSala.falas || []).map((f) => `<div><b>${esc(nomeDe(f.chave))}</b> <span class="rodada">${esc(f.rodada)}</span><br>${esc(f.texto)}</div>`).join('')}</div>
  `);
  $('btnFeedbackAta').onclick = async () => {
    const texto = $('campoFeedbackAta').value.trim();
    if (!texto) { $('statusFeedbackAta').textContent = 'escreva o feedback primeiro.'; return; }
    const r = await fetch('/api/direcao', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tipo: 'feedback', texto }),
    });
    const j = await r.json();
    $('statusFeedbackAta').textContent = j.ok
      ? 'mandado ✔ — entra na cabeça deles já na próxima reunião.'
      : 'erro: ' + (j.error || 'falhou');
    if (j.ok) { $('campoFeedbackAta').value = ''; carregarEstado(); }
  };
}

// ── 🎯 Coordenar: a mesa do João ─────────────────────────────────────────
//
// Três coisas, e a diferença entre elas importa: TEMA manda a pauta, FEEDBACK
// corrige o jeito de trabalhar, DEMANDA pede uma entrega com dono e prazo.

function cartaoDirecao(d) {
  const rot = { tema: '🎯 pauta', feedback: '🗣 feedback', demanda: '📋 pedido' };
  const quando = d.criado_em ? new Date(d.criado_em).toLocaleString('pt-BR', { timeZone: 'America/Fortaleza' }) : '';
  const parado = d.tipo === 'demanda' && d.status === 'aberta' && d.rodadas >= 3;
  return `
    <div class="item">
      <span class="rodada">${rot[d.tipo] || d.tipo}</span>
      ${d.status !== 'aberta' ? `<span class="rodada">${esc(d.status)}</span>` : ''}
      ${parado ? '<span class="rodada">⚠ parado</span>' : ''}
      <b>${esc(d.texto)}</b>
      <div class="fraco">
        ${d.para ? 'pra ' + esc(nomeDe(d.para)) + ' · ' : ''}
        ${d.prazo ? 'prazo ' + esc(d.prazo) + ' · ' : ''}
        ${d.rodadas ? d.rodadas + ' rodada(s) · ' : ''}${esc(quando)}
      </div>
      ${d.resposta ? `<div style="margin-top:7px"><span class="fraco">o que a mesa devolveu:</span><br>${esc(d.resposta)}</div>` : ''}
      ${d.status === 'aberta'
        ? `<div style="margin-top:7px">
             <button class="link" data-fechar="${d.id}" data-status="entregue">dar por entregue</button>
             <button class="link" data-fechar="${d.id}" data-status="arquivada">arquivar</button>
           </div>`
        : `<div style="margin-top:7px"><button class="link" data-fechar="${d.id}" data-status="aberta">reabrir</button></div>`}
    </div>`;
}

async function abrirCoordenar() {
  const res = await fetch('/api/direcao');
  const j = await res.json();
  const agentes = j.agentes || [];
  const todas = j.direcao || [];
  const abertas = todas.filter((d) => d.status === 'aberta');
  const fechadas = todas.filter((d) => d.status !== 'aberta');
  const opcoes = ['<option value="">a mesa decide quem faz</option>']
    .concat(agentes.map((a) => `<option value="${esc(a.chave)}">${esc(a.nome)} — ${esc(a.oque)}</option>`)).join('');

  abrirPainel(`
    <h2>🎯 Coordenar a equipe</h2>
    <p class="fraco">Você é o coordenador desta mesa. O que você escrever aqui entra na cabeça deles na
    próxima reunião — e pedido novo seu faz a mesa se reunir de verdade, mesmo que nada tenha mudado lá fora.</p>

    <label>🎯 Pauta da vez</label>
    <p class="fraco">Vira o assunto da reunião, no lugar da pergunta que eles escolheriam sozinhos. Só existe uma:
    uma pauta nova arquiva a anterior.</p>
    <input type="text" id="campoNovoTema" placeholder="ex.: clássico Ceará x Fortaleza — o que a gente sobe até sexta" />
    <button class="acao secundaria" id="btnNovoTema">Definir a pauta</button>

    <label>🗣 Feedback</label>
    <p class="fraco">Correção de rumo. Entra no prompt de todos (ou de um só) e fica lá até você arquivar.</p>
    <textarea id="campoNovoFeedback" placeholder="ex.: as recomendações estão genéricas. quero nome de produto e prazo, não 'explorar oportunidades'"></textarea>
    <select id="campoFeedbackPara"><option value="">pra mesa toda</option>
      ${agentes.map((a) => `<option value="${esc(a.chave)}">só pra ${esc(a.nome)}</option>`).join('')}</select>
    <button class="acao secundaria" id="btnNovoFeedback">Mandar o feedback</button>

    <label>📋 Demanda</label>
    <p class="fraco">Um pedido concreto. Alguém responde na próxima reunião, e a Val cobra a cada rodada até
    você dar por entregue.</p>
    <textarea id="campoNovaDemanda" placeholder="ex.: me dá 3 direções de coleção pro Vozão que não dependam de escudo grande"></textarea>
    <select id="campoDemandaPara">${opcoes}</select>
    <input type="text" id="campoDemandaPrazo" placeholder="prazo (ex.: sexta, 19/09)" />
    <button class="acao" id="btnNovaDemanda">Mandar o pedido</button>
    <div id="statusDirecao" class="fraco"></div>

    <label>Na mesa agora (${abertas.length})</label>
    ${abertas.length ? abertas.map(cartaoDirecao).join('') : '<p class="fraco">Nada em aberto — a mesa está tocando pela pauta que sai do dado.</p>'}

    ${fechadas.length ? `<label>Já fechado (${fechadas.length})</label>${fechadas.slice(0, 15).map(cartaoDirecao).join('')}` : ''}
  `);

  const mandar = async (corpo, limpar) => {
    const st = $('statusDirecao');
    st.textContent = 'mandando…';
    const r = await fetch('/api/direcao', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(corpo),
    });
    const resp = await r.json();
    if (!resp.ok) { st.textContent = 'erro: ' + (resp.error || 'falhou'); return; }
    st.textContent = resp.dono
      ? `mandado ✔ — ${nomeDe(resp.dono)} responde na próxima reunião.`
      : 'mandado ✔ — entra na próxima reunião.';
    limpar.forEach((id) => { $(id).value = ''; });
    await carregarEstado();
    abrirCoordenar();
  };

  $('btnNovoTema').onclick = () => {
    const texto = $('campoNovoTema').value.trim();
    if (!texto) { $('statusDirecao').textContent = 'escreva a pauta.'; return; }
    mandar({ tipo: 'tema', texto }, ['campoNovoTema']);
  };
  $('btnNovoFeedback').onclick = () => {
    const texto = $('campoNovoFeedback').value.trim();
    if (!texto) { $('statusDirecao').textContent = 'escreva o feedback.'; return; }
    mandar({ tipo: 'feedback', texto, para: $('campoFeedbackPara').value }, ['campoNovoFeedback']);
  };
  $('btnNovaDemanda').onclick = () => {
    const texto = $('campoNovaDemanda').value.trim();
    if (!texto) { $('statusDirecao').textContent = 'escreva o pedido.'; return; }
    mandar({ tipo: 'demanda', texto, para: $('campoDemandaPara').value, prazo: $('campoDemandaPrazo').value.trim() },
      ['campoNovaDemanda', 'campoDemandaPrazo']);
  };

  $('painelConteudo').querySelectorAll('button[data-fechar]').forEach((b) => {
    b.onclick = async () => {
      await fetch('/api/direcao/status', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: Number(b.dataset.fechar), status: b.dataset.status }),
      });
      await carregarEstado();
      abrirCoordenar();
    };
  });
}

$('btnDirecao').onclick = abrirCoordenar;

// ── Painel de um agente ──────────────────────────────────────────────────

window.addEventListener('abrir-agente', (ev) => abrirAgente(ev.detail));

async function abrirAgente(chave) {
  const ag = agentePorChave(chave);
  if (!ag) return;
  abrirPainel(`
    <div class="cabecalho-agente">
      <canvas id="retrato"></canvas>
      <div>
        <h2>${esc(ag.pessoa?.nome || ag.nome)}</h2>
        <div class="fraco">${esc(ag.pessoa ? `${ag.pessoa.nomeCompleto}, ${ag.pessoa.idade} — ${ag.pessoa.papel}` : ag.oque)}</div>
        ${ag.opinaEmTudo ? '<span class="selo">opina em tudo</span>' : ''}
      </div>
    </div>
    ${ag.pessoa ? `
    <div class="fraco bloco" style="border-left:3px solid var(--ouro);padding-left:9px;margin:10px 0">
      ${esc(ag.pessoa.deOndeVeio)}<br><br>
      <b>Irrita:</b> ${esc(ag.pessoa.oQueIrrita)}<br>
      <b>Fora do trabalho:</b> ${esc(ag.pessoa.foraDoTrabalho)}
    </div>` : ''}
    <div class="fraco bloco"><b>só ele decide:</b> ${esc(ag.area)}</div>
    <div class="fraco bloco"><b>não decide:</b> ${esc(ag.fora)}</div>
    <div class="fraco bloco"><b>fonte real:</b> ${esc(ag.fonte)}</div>

    <label>Falar direto com ${esc(ag.pessoa?.nome || ag.nome)}</label>
    <textarea id="campoRecadoAgente" placeholder="feedback ou pedido só pra ele(a) — entra na próxima reunião"></textarea>
    <button class="acao secundaria" id="btnFeedbackAgente">Mandar feedback</button>
    <button class="acao secundaria" id="btnDemandaAgente">Pedir uma entrega</button>
    <div id="statusRecadoAgente" class="fraco"></div>

    <label>Dono deste agente</label>
    <input type="text" id="campoDono" value="${esc(ag.dono || '')}" placeholder="seu nome" />
    <button class="acao secundaria" id="btnSalvarDono">Salvar dono</button>

    <label>Instrução ${ag.customizado ? '(editada)' : '(padrão)'}</label>
    <textarea id="campoSystem">${esc(ag.system)}</textarea>
    <button class="acao secundaria" id="btnSalvarPrompt">Salvar instrução</button>

    <label>${ag.modoTexto ? 'Mensagem' : 'Entrada manual (vazio = fonte real ao vivo)'}</label>
    <textarea id="campoEntrada" placeholder="${ag.modoTexto ? esc(ag.exemplo) : 'cole um JSON, ou deixe vazio'}"></textarea>
    <button class="acao" id="btnRodar">▶ Rodar agora</button>
    <button class="acao secundaria" id="btnExemplo">Rodar com o exemplo</button>

    <label>Saída</label>
    <pre class="saida" id="saidaAgente">—</pre>

    <label>O que ele aprendeu</label>
    <div id="memoriaAgente" class="fraco">carregando…</div>

    <label>Recados desta sessão</label>
    <div id="mailboxAgente" class="fraco">carregando…</div>
  `);
  desenharRetrato($('retrato'), ag.paleta, 4);

  const mandarPraEle = async (tipo) => {
    const texto = $('campoRecadoAgente').value.trim();
    if (!texto) { $('statusRecadoAgente').textContent = 'escreva antes.'; return; }
    const r = await fetch('/api/direcao', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tipo, texto, para: chave }),
    });
    const j = await r.json();
    $('statusRecadoAgente').textContent = j.ok ? 'mandado ✔ — ele recebe na próxima reunião.' : 'erro: ' + (j.error || 'falhou');
    if (j.ok) { $('campoRecadoAgente').value = ''; carregarEstado(); }
  };
  $('btnFeedbackAgente').onclick = () => mandarPraEle('feedback');
  $('btnDemandaAgente').onclick = () => mandarPraEle('demanda');

  $('btnSalvarDono').onclick = async () => {
    const dono = $('campoDono').value.trim();
    await fetch('/api/dono', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ agente: chave, dono }) });
    ag.dono = dono;
    $('btnSalvarDono').textContent = 'Dono salvo ✔';
  };
  $('btnSalvarPrompt').onclick = async () => {
    const system = $('campoSystem').value;
    await fetch('/api/prompt', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ agente: chave, system }) });
    ag.system = system; ag.customizado = true;
    $('btnSalvarPrompt').textContent = 'Instrução salva ✔';
  };
  $('btnRodar').onclick = () => rodarAgente(chave, false);
  $('btnExemplo').onclick = () => rodarAgente(chave, true);
  carregarMailbox(chave);
  carregarMemoria(chave);
}

function sessaoAtual() {
  return ($('campoSessao').value || '').trim() || ultimaSala?.ata?.sessao || 'avulso';
}

async function rodarAgente(chave, usarExemplo) {
  const saida = $('saidaAgente');
  saida.textContent = 'rodando…';
  falar(chave, 'pensando…', 60000);
  try {
    const res = await fetch('/api/rodar', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        agente: chave, sessao: sessaoAtual(), usarExemplo,
        entrada: usarExemplo ? '' : ($('campoEntrada')?.value || ''),
        system: $('campoSystem')?.value || '',
      }),
    });
    const j = await res.json();
    saida.textContent = JSON.stringify(j, null, 2);
    const d = j.dados || {};
    const resumo = j.ok
      ? (d.recado || d.texto || d.o_que_eu_faria || d.aposta_que_eu_faria || d.resumo || 'feito ✔')
      : 'travei: ' + j.erro;
    falar(chave, String(resumo), 6000);
    carregarMailbox(chave); carregarMemoria(chave);
  } catch (e) {
    saida.textContent = 'Falha ao chamar /api/rodar: ' + e;
    falar(chave, 'falhou a chamada', 4000);
  }
}

async function carregarMailbox(chave) {
  const res = await fetch('/api/recados?sessao=' + encodeURIComponent(sessaoAtual()));
  const j = await res.json();
  const rel = (j.recados || []).filter((r) => r.de === chave || r.para === chave);
  const box = $('mailboxAgente');
  if (!box) return;
  box.innerHTML = rel.length
    ? rel.map((r) => `<div class="item"><b>${esc(nomeDe(r.de))} → ${esc(nomeDe(r.para))}</b>: ${esc(r.assunto)}<br>${esc(r.pedido)}</div>`).join('')
    : 'sem recados nesta sessão.';
}

async function carregarMemoria(chave) {
  const res = await fetch('/api/memoria?agente=' + encodeURIComponent(chave));
  const j = await res.json();
  const box = $('memoriaAgente');
  if (!box) return;
  const rot = { aprendi: '💡', cobranca: '📌', vendas: '💰' };
  box.innerHTML = (j.memoria || []).length
    ? j.memoria.slice().reverse().map((m) => `<div class="item">${rot[m.tipo] || '•'} ${esc(m.licao)}</div>`).join('')
    : 'ainda não passou por uma reunião — memória vazia.';
}

// ── A sala viva: encena a última conversa de corredor quando está ocioso ──
//
// Sem isto a sala só tinha vida a cada 2 horas. Agora, entre uma reunião e
// outra, dois deles se encontram e conversam — e o texto é o que o backend
// gerou de verdade, não enfeite.

let corredorVisto = 0;
let encenandoCorredor = null;

function encenarCorredor() {
  if (encenacao || encenandoCorredor) return;           // reunião tem prioridade
  const c = (ultimaSala?.conversas || []).find((x) => Number(x.id) > corredorVisto)
    || (ultimaSala?.conversas || [])[0];
  if (!c || !Array.isArray(c.falas) || !c.falas.length) return;
  corredorVisto = Math.max(corredorVisto, Number(c.id) || 0);
  encenandoCorredor = conversarNoCorredor(c.a, c.b, c.falas, () => { encenandoCorredor = null; });
}

// De tempos em tempos, se ninguém está reunido, alguém puxa assunto.
setInterval(() => { if (!encenacao) encenarCorredor(); }, 45000);

// ── Barra de comando ─────────────────────────────────────────────────────

$('btnConvocar').onclick = async () => {
  const tema = $('campoTema').value.trim();
  const status = $('statusBarra');
  status.textContent = 'a mesa está se reunindo… (leva 2 a 5 min: são umas 20 chamadas de IA, a investigação e a ata)';
  reunirNaMesa((estado?.agentes || []).map((a) => a.chave));
  try {
    const res = await fetch('/api/reuniao', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tema, sessao: ($('campoSessao').value || '').trim() || undefined, webhook: $('mandarWebhook').checked }),
    });
    const j = await res.json();
    if (!res.ok) { status.textContent = 'erro: ' + (j.error || 'falhou'); encerrarReuniao(); return; }
    const reco = (j.ata?.recomendacoes || []).length;
    status.textContent = `reunião fechada — ${j.etapas.length} falas, ${reco} recomendação(ões).` + (j.webhook ? ` webhook: ${j.webhook.detalhe}` : '');
    await carregarSala(j.sessao);
    encenar(ultimaSala.falas);
  } catch (e) {
    status.textContent = 'falha ao convocar: ' + e;
    encerrarReuniao();
  }
};

$('btnAutomatica').onclick = async () => {
  const status = $('statusBarra');
  status.textContent = 'rodando a reunião automática à mão (mesmo caminho do cron)…';
  try {
    const res = await fetch('/tasks/reuniao?manual=1', { method: 'POST' });
    const j = await res.json();
    status.textContent = j.ok
      ? `pronta: ${j.tema} · ${j.recomendacoes ?? 0} recomendação(ões) · webhook: ${j.webhook?.detalhe || '—'}`
      : 'erro: ' + (j.error || 'falhou');
    if (j.sessao) { await carregarSala(j.sessao); encenar(ultimaSala.falas); }
  } catch (e) { status.textContent = 'falhou: ' + e; }
};

$('btnMemoria').onclick = async () => {
  const res = await fetch('/api/memoria');
  const j = await res.json();
  const rot = { aprendi: '💡 aprendeu', cobranca: '📌 foi cobrado', vendas: '💰 mediu' };
  abrirPainel(`
    <h2>O que a sala aprendeu</h2>
    <p class="fraco">Cada linha volta pra dentro do prompt do agente na próxima reunião. É isto que faz a mesa não repetir a mesma discussão a cada 2 horas.</p>
    ${(j.memoria || []).length
      ? (j.memoria || []).map((m) => `<div class="item"><b>${esc(nomeDe(m.chave))}</b> <span class="rodada">${esc(rot[m.tipo] || m.tipo)}</span><br>${esc(m.licao)}</div>`).join('')
      : '<p class="fraco">memória vazia — depois da primeira reunião ela enche.</p>'}
  `);
};

$('btnBoletim').onclick = async () => {
  const res = await fetch('/api/boletim');
  const j = await res.json();
  const linhas = j.depoimentos || [];
  abrirPainel(`
    <h2>Boletim semanal</h2>
    <p class="fraco">Uma vez por semana cada agente escreve, em primeira pessoa, como foi a semana dele —
    o que aprendeu, o que a mesa cobrou e o que travou. A instrução manda não vender o próprio peixe.</p>
    ${linhas.length ? `<p><a class="link-ata" href="/boletim?semana=${encodeURIComponent(linhas[0].semana)}" target="_blank" rel="noopener">📄 abrir o boletim completo</a></p>` : ''}
    ${linhas.length
      ? linhas.map((d) => `<div class="item"><b>${esc(nomeDe(d.chave))}</b>
          <span class="rodada">${d.reunioes} reuniões · ${d.licoes} lições · ${d.cobrancas} cobranças · ${d.falhas} falhas</span>
          <br>${esc(d.depoimento)}</div>`).join('')
      : '<p class="fraco">Nenhum boletim ainda — o primeiro sai na segunda de manhã. Dá pra forçar um agora no ⚙ Config.</p>'}
  `);
};

$('btnCorredor').onclick = async () => {
  const res = await fetch('/api/corredor');
  const j = await res.json();
  const lista = j.conversas || [];
  abrirPainel(`
    <h2>Conversas de corredor</h2>
    <p class="fraco">Sem pauta, sem entregável. Dois deles se cruzam entre as reuniões e conversam —
    às vezes sobre trabalho, às vezes não. Quando rende alguma coisa, vira pauta da reunião seguinte.</p>
    ${lista.length ? lista.map((c) => `
      <div class="item">
        <div class="fraco">${esc(new Date(c.quando).toLocaleString('pt-BR', { timeZone: 'America/Fortaleza' }))} · <b>${esc(c.assunto || 'conversa')}</b></div>
        ${(Array.isArray(c.falas) ? c.falas : []).map((f) => `<div style="margin:4px 0"><b>${esc(nomeDe(f.quem))}:</b> ${esc(f.texto)}</div>`).join('')}
        ${c.rendeu ? `<div style="margin-top:6px;color:var(--verde)">↑ rendeu pauta: ${esc(c.rendeu)}</div>` : ''}
      </div>`).join('') : '<p class="fraco">Ninguém conversou ainda — a primeira sai na próxima meia hora.</p>'}
  `);
};

$('btnAtas').onclick = async () => {
  const res = await fetch('/api/atas');
  const j = await res.json();
  const recoDe = (a) => { try { return JSON.parse(a.recomendacoes || '[]'); } catch { return []; } };
  abrirPainel(`
    <h2>Reuniões</h2>
    ${(j.atas || []).length ? (j.atas || []).map((a) => {
      const r = recoDe(a)[0];
      return `
      <div class="item">
        <b>${a.automatica ? '🤖' : '📣'} ${esc(a.tema)}</b>
        <div class="fraco">${esc(new Date(a.quando).toLocaleString('pt-BR', { timeZone: 'America/Fortaleza' }))} · webhook: ${esc(a.webhook_status || '—')}</div>
        ${r ? `<div>🎯 ${esc(r.o_que)}</div>` : `<div class="fraco">sem recomendação</div>`}
        <div>${esc(String(a.resumo_curto || a.resumo || '').slice(0, 200))}</div>
        <button class="link" data-sessao="${esc(a.sessao)}">abrir e reencenar</button>
      </div>`;
    }).join('') : '<p class="fraco">nenhuma reunião ainda.</p>'}
  `);
  $('painelConteudo').querySelectorAll('button[data-sessao]').forEach((b) => {
    b.onclick = async () => { await carregarSala(b.dataset.sessao); encenar(ultimaSala.falas); $('painel').classList.remove('aberto'); };
  });
};

$('btnConfig').onclick = async () => {
  const res = await fetch('/api/config');
  const c = await res.json();
  const sel = (v) => (c.vozao_canal === v ? ' selected' : '');
  // O caminho de entrega do Vozão é o que mais confunde, então a tela diz em
  // texto o que está de fato ligado — em vez de deixar o usuário descobrir no
  // silêncio de uma mensagem que não chegou.
  const temChat = !!(c.vozao_chat_url || c.temVozaoChatPorSecret);
  const temEmail = !!((c.email_para || c.temEmailParaPorSecret) && (c.temResend || c.email_webhook));
  const prontoPara = c.vozao_canal === 'email' ? temEmail : c.vozao_canal === 'ambos' ? (temChat && temEmail) : temChat;
  abrirPainel(`
    <h2>Configuração</h2>
    <label>Webhook do resultado (espaço do Google Chat)</label>
    <input type="text" id="campoWebhook" value="${esc(c.webhook_url)}" placeholder="https://chat.googleapis.com/v1/spaces/..." />
    <p class="fraco">No Google Chat: abra o espaço → nome do espaço → Apps e integrações → Webhooks → Adicionar webhook → copie a URL.
    Se você colar uma URL que não seja do Chat, mando o JSON cru da reunião (serve pra n8n/Make).</p>
    <button class="acao secundaria" id="btnTestarWebhook">Enviar mensagem de teste</button>

    <label>Reunião automática de 2 em 2 horas</label>
    <label class="check"><input type="checkbox" id="campoAuto" ${c.auto_ativo ? 'checked' : ''} /> ligada</label>
    <p class="fraco">Próxima: ${esc(new Date(c.proximaReuniao).toLocaleString('pt-BR', { timeZone: 'America/Fortaleza' }))}</p>

    <label>Tema fixo (opcional)</label>
    <input type="text" id="campoTemaFixo" value="${esc(c.tema_fixo)}" placeholder="vazio = a pauta sai do dado da rodada" />
    <p class="fraco">Vazio é o recomendado. Pra mandar uma pauta na equipe, prefira o 🎯 Coordenar: lá a pauta
    é tratada como ordem sua, aparece pra eles como tal e você consegue arquivar depois.</p>

    <label>Boletim semanal de depoimentos</label>
    <label class="check"><input type="checkbox" id="campoBoletim" ${c.boletim_ativo ? 'checked' : ''} /> ligado (segunda, 9h)</label>
    <button class="acao secundaria" id="btnGerarBoletim">Gerar o boletim agora</button>
    <p class="fraco">São 5 chamadas de IA, leva cerca de 1 minuto.</p>

    <label>⚽ Recado diário do Torcedor (9h)</label>
    <label class="check"><input type="checkbox" id="campoVozao" ${c.vozao_ativo ? 'checked' : ''} /> ligado</label>
    <p class="fraco">Status: ${prontoPara
      ? '<b style="color:var(--verde)">caminho de entrega pronto</b>'
      : '<b style="color:var(--vermelho)">falta o caminho de entrega</b> — sem isso a mensagem não sai'}</p>

    <label>Por onde ele manda</label>
    <select id="campoCanal">
      <option value="chat"${sel('chat')}>Google Chat (espaço)</option>
      <option value="email"${sel('email')}>E-mail</option>
      <option value="ambos"${sel('ambos')}>Os dois</option>
    </select>

    <label>URL do espaço no Chat (o do Rian)</label>
    <input type="text" id="campoVozaoChat" value="${esc(c.vozao_chat_url)}" placeholder="https://chat.googleapis.com/v1/spaces/..." />
    <p class="fraco">${c.temVozaoChatPorSecret && !c.vozao_chat_url
      ? 'Já existe uma URL guardada como secret (por isso o campo aparece vazio). Colar uma aqui substitui a do secret.'
      : 'Crie um espaço com você e o Rian, adicione um webhook nele e cole a URL aqui. É um espaço SEPARADO do das atas.'}</p>

    <label>E-mail de destino</label>
    <input type="text" id="campoEmailPara" value="${esc(c.email_para)}" placeholder="rian.mesquita@gocase.com" />
    <p class="fraco">Caminho de envio de e-mail: ${c.temResend ? '<b>Resend</b> (secret configurado)' : c.email_webhook ? '<b>seu webhook de e-mail</b>' : '<b>nenhum</b> — configure o secret RESEND_API_KEY ou cole a URL abaixo'}.
    Lembrete do Resend: conta sem domínio verificado só entrega no e-mail do dono da conta.</p>
    <input type="text" id="campoEmailWebhook" value="${esc(c.email_webhook)}" placeholder="ou: URL https do seu n8n/Make que envia o e-mail" />
    <input type="text" id="campoEmailDe" value="${esc(c.email_de)}" placeholder="remetente, ex.: Sala de Guerra <sala@seudominio.com>" style="margin-top:6px" />

    <button class="acao secundaria" id="btnTestarVozao">Mandar um Vozão de teste agora</button>

    <button class="acao" id="btnSalvarConfig">Salvar</button>
    <div id="statusConfig" class="fraco"></div>
  `);
  $('btnSalvarConfig').onclick = async () => {
    const r = await fetch('/api/config', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        webhook_url: $('campoWebhook').value.trim(),
        auto_ativo: $('campoAuto').checked,
        tema_fixo: $('campoTemaFixo').value.trim(),
        boletim_ativo: $('campoBoletim').checked,
        email_para: $('campoEmailPara').value.trim(),
        email_webhook: $('campoEmailWebhook').value.trim(),
        email_de: $('campoEmailDe').value.trim(),
        vozao_ativo: $('campoVozao').checked,
        vozao_canal: $('campoCanal').value,
        vozao_chat_url: $('campoVozaoChat').value.trim(),
      }),
    });
    const j = await r.json();
    $('statusConfig').textContent = j.ok ? 'salvo ✔' : 'erro: ' + (j.error || '');
    if (j.ok) carregarEstado();
  };
  $('btnGerarBoletim').onclick = async () => {
    $('statusConfig').textContent = 'os agentes estão escrevendo o depoimento deles…';
    const r = await fetch('/tasks/boletim?manual=1', { method: 'POST' });
    const j = await r.json();
    $('statusConfig').innerHTML = j.ok
      ? `✔ boletim ${esc(j.semana)} pronto — <a class="link-ata" href="/boletim?semana=${encodeURIComponent(j.semana)}" target="_blank" rel="noopener">abrir</a>`
      : '✖ ' + esc(j.error || 'falhou');
  };
  $('btnTestarVozao').onclick = async () => {
    $('statusConfig').textContent = 'o Torcedor está escrevendo…';
    const r = await fetch('/tasks/vozao?manual=1', { method: 'POST' });
    const j = await r.json();
    $('statusConfig').innerHTML = j.ok
      ? `✔ ${esc(j.detalhe)}<br><b>${esc(j.assunto || '')}</b><br>${esc(j.corpo || '')}`
      : '✖ ' + esc(j.detalhe || j.error || 'falhou');
  };
  $('btnTestarWebhook').onclick = async () => {
    $('statusConfig').textContent = 'enviando…';
    const r = await fetch('/api/webhook/testar', { method: 'POST' });
    const j = await r.json();
    $('statusConfig').textContent = (j.ok ? '✔ ' : '✖ ') + j.detalhe;
  };
};

// ── Boot ─────────────────────────────────────────────────────────────────

(async function boot() {
  iniciarSala();
  await carregarEstado();
  const sessaoUrl = new URLSearchParams(location.search).get('sessao');
  if (sessaoUrl) $('campoSessao').value = sessaoUrl;
  await carregarSala(sessaoUrl || undefined);
  if (ultimaSala?.falas?.length) {
    setTimeout(() => encenar(ultimaSala.falas), 1500);
  } else {
    setTimeout(() => { for (const a of estado.agentes) mandarPraCasa(a.chave); }, 500);
  }
  // A sala continua viva sozinha: recarrega a última ata de tempos em tempos
  // pra pegar a reunião que o cron rodou enquanto a aba estava aberta.
  setInterval(async () => {
    const antes = ultimaSala?.ata?.sessao;
    await carregarSala();
    if (ultimaSala?.ata?.sessao && ultimaSala.ata.sessao !== antes) {
      $('statusBarra').textContent = 'a mesa acabou de se reunir sozinha — reencenando.';
      encenar(ultimaSala.falas);
    }
  }, 120000);
})();
