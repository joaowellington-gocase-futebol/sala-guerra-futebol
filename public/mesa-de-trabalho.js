// A "mesa de trabalho": painel lateral de um agente (instrução editável,
// rodar, ver saída, mailbox) + a barra de "Convocar reunião".
// Mesmo espírito da Fábrica de Térmicos: dá pra ajustar a instrução na tela,
// sem deploy — só clicar em Rodar de novo pra ver a diferença.

window.MesaDeTrabalho = { chaveAberta: null };

function agentePorChave(chave) {
  return (window.SalaDeGuerra.estado?.agentes || []).find((a) => a.chave === chave);
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

window.MesaDeTrabalho.abrir = function abrir(chave) {
  const ag = agentePorChave(chave);
  if (!ag) return;
  window.MesaDeTrabalho.chaveAberta = chave;

  const painel = document.getElementById('painelLateral');
  const conteudo = document.getElementById('painelConteudo');
  conteudo.innerHTML = `
    <h2>${escapeHtml(ag.nome)}</h2>
    <span class="badge">área: ${escapeHtml(ag.area)}</span>
    <div style="font-size:11px;color:var(--texto-fraco);margin-bottom:6px">
      <b>não decide:</b> ${escapeHtml(ag.fora)}
    </div>
    <div style="font-size:11px;color:var(--texto-fraco);margin-bottom:8px">
      <b>fonte real:</b> ${escapeHtml(ag.fonte)}
    </div>

    <label>Dono deste agente</label>
    <input type="text" id="campoDono" value="${escapeHtml(ag.dono || '')}" placeholder="seu nome" />
    <button class="acao" id="btnSalvarDono" style="margin-top:6px">Salvar dono</button>

    <label>Instrução do agente ${ag.customizado ? '(editada)' : '(padrão)'}</label>
    <textarea id="campoSystem">${escapeHtml(ag.system)}</textarea>
    <button class="acao" id="btnSalvarPrompt">Salvar instrução</button>

    ${ag.modoTexto ? '' : `<label>Entrada manual (deixe vazio para usar a fonte real ao vivo, ou o exemplo se a fonte falhar)</label>
    <textarea id="campoEntrada" placeholder="cole um JSON, ou deixe vazio"></textarea>`}
    ${ag.modoTexto ? `<label>Mensagem</label><textarea id="campoEntrada" placeholder="${escapeHtml(ag.exemplo)}"></textarea>` : ''}

    <button class="acao" id="btnRodar">▶ Rodar agora</button>
    <button class="acao" id="btnExemplo" style="background:var(--borda);color:var(--texto)">Rodar com o exemplo</button>

    <label>Saída</label>
    <pre class="saida" id="saidaAgente">—</pre>

    <label>Mailbox desta sessão</label>
    <div id="mailboxAgente" style="font-size:11px;color:var(--texto-fraco)">carregando…</div>
  `;
  painel.hidden = false;

  document.getElementById('btnSalvarDono').onclick = () => salvarDono(chave);
  document.getElementById('btnSalvarPrompt').onclick = () => salvarPrompt(chave);
  document.getElementById('btnRodar').onclick = () => rodarAgente(chave, false);
  document.getElementById('btnExemplo').onclick = () => rodarAgente(chave, true);

  carregarMailbox(chave);
};

document.getElementById('fecharPainel').onclick = () => {
  document.getElementById('painelLateral').hidden = true;
  window.MesaDeTrabalho.chaveAberta = null;
};

async function salvarDono(chave) {
  const dono = document.getElementById('campoDono').value.trim();
  await fetch('/api/dono', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ agente: chave, dono }) });
  const ag = agentePorChave(chave);
  if (ag) ag.dono = dono;
}

async function salvarPrompt(chave) {
  const system = document.getElementById('campoSystem').value;
  await fetch('/api/prompt', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ agente: chave, system }) });
  const ag = agentePorChave(chave);
  if (ag) { ag.system = system; ag.customizado = true; }
}

async function carregarMailbox(chave) {
  const sessao = window.SalaDeGuerra.sessaoAtual();
  const res = await fetch('/api/recados?sessao=' + encodeURIComponent(sessao));
  const j = await res.json();
  const relevantes = (j.recados || []).filter((r) => r.de === chave || r.para === chave);
  const box = document.getElementById('mailboxAgente');
  if (!box) return;
  box.innerHTML = relevantes.length
    ? relevantes.map((r) => `<div class="mailbox-item"><b>${escapeHtml(r.de)} → ${escapeHtml(r.para)}</b>: ${escapeHtml(r.assunto)}<br>${escapeHtml(r.pedido)}</div>`).join('')
    : 'sem recados nesta sessão ainda.';
}

async function rodarAgente(chave, usarExemplo) {
  const ag = agentePorChave(chave);
  const sessao = window.SalaDeGuerra.sessaoAtual();
  const entradaEl = document.getElementById('campoEntrada');
  const systemEl = document.getElementById('campoSystem');
  const saidaEl = document.getElementById('saidaAgente');
  saidaEl.textContent = 'rodando…';

  mover_e_pensar(chave);

  try {
    const res = await fetch('/api/rodar', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        agente: chave, sessao, usarExemplo,
        entrada: usarExemplo ? '' : (entradaEl?.value || ''),
        system: systemEl?.value || '',
      }),
    });
    const j = await res.json();
    saidaEl.textContent = JSON.stringify(j, null, 2);
    const resumo = j.ok ? (j.dados?.resumo || j.dados?.reacao_torcedor || j.dados?.racional || 'feito ✔') : ('erro: ' + j.erro);
    falarNaMesa(chave, String(resumo));
    carregarMailbox(chave);
  } catch (e) {
    saidaEl.textContent = 'Falha ao chamar /api/rodar: ' + e;
  }
}

function mover_e_pensar(chave) {
  const el = document.getElementById('boneco-' + chave);
  if (!el) return;
  el.classList.add('andando');
  window.setTimeout(() => el.classList.remove('andando'), 1200);
}
function falarNaMesa(chave, texto) {
  const el = document.getElementById('boneco-' + chave);
  if (!el) return;
  const balao = el.querySelector('.balao');
  if (!balao) return;
  balao.textContent = texto.length > 90 ? texto.slice(0, 90) + '…' : texto;
  el.classList.add('falando');
  window.setTimeout(() => el.classList.remove('falando'), 4200);
}

// ── Convocar reunião ────────────────────────────────────────────────────

document.getElementById('btnConvocar').onclick = async () => {
  const tema = document.getElementById('temaReuniao').value.trim();
  const sessao = window.SalaDeGuerra.sessaoAtual();
  const status = document.getElementById('reuniaoStatus');
  if (!tema) { status.textContent = 'escreva o tema primeiro.'; return; }
  status.textContent = 'convocando a mesa…';

  try {
    const res = await fetch('/api/reuniao', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tema, sessao }),
    });
    const j = await res.json();
    if (!res.ok) { status.textContent = 'erro: ' + (j.error || 'falhou'); return; }
    status.textContent = `reunião concluída — ${j.etapas.length} etapas.`;
    mostrarTranscricao(j);
    animarReuniao(j.etapas.map((e) => e.chave));
  } catch (e) {
    status.textContent = 'falha ao convocar: ' + e;
  }
};

document.getElementById('fecharTranscricao').onclick = () => {
  document.getElementById('transcricao').hidden = true;
};

function mostrarTranscricao(j) {
  const wrap = document.getElementById('transcricao');
  const conteudo = document.getElementById('transcricaoConteudo');
  conteudo.innerHTML = `<div style="margin-bottom:8px;color:var(--texto-fraco)">Tema: <b>${escapeHtml(j.tema)}</b> · sessão: ${escapeHtml(j.sessao)}</div>` +
    j.etapas.map((e) => `
      <div class="fala-etapa">
        <div class="quem">${escapeHtml(e.nome)} ${e.ok ? '' : '⚠️ falhou'}</div>
        <pre>${escapeHtml(JSON.stringify(e.dados, null, 2))}</pre>
      </div>
    `).join('');
  wrap.hidden = false;
}

/** Anima a cadeia de agentes da reunião indo até a Mesa de Reunião, um a um, com um respiro entre eles. */
function animarReuniao(chaves) {
  chaves.forEach((chave, i) => {
    window.setTimeout(() => {
      const el = document.getElementById('boneco-' + chave);
      if (!el) return;
      el.style.left = (50 + (i % 2 === 0 ? -8 : 8)) + '%';
      el.style.top = (46 + (i % 3) * 4) + '%';
      el.classList.add('andando');
      window.setTimeout(() => el.classList.remove('andando'), 1800);
      window.setTimeout(() => {
        const balao = el.querySelector('.balao');
        if (balao) { balao.textContent = '💬 falando na reunião…'; el.classList.add('falando'); }
        window.setTimeout(() => el.classList.remove('falando'), 3000);
      }, 1900);
    }, i * 2200);
  });
  const total = chaves.length * 2200 + 4000;
  window.setTimeout(() => chaves.forEach((chave) => {
    const el = document.getElementById('boneco-' + chave);
    if (!el) return;
    el.style.left = el.dataset.baseX + '%';
    el.style.top = el.dataset.baseY + '%';
    el.classList.add('andando');
    window.setTimeout(() => el.classList.remove('andando'), 1900);
  }), total);
}
