// A página da ata completa: HTML renderizado no servidor, sem canvas e sem
// JavaScript. É o link que sai no Google Chat, então precisa abrir rápido e
// ler bem no celular — a salinha 16-bit é linda mas não é pra isso.
//
// A ordem da página segue a ordem de quem lê: primeiro o que a mesa recomenda
// e o que ela entregou do que o João pediu; depois a investigação que
// sustenta isso; por último a transcrição, pra quem quiser auditar.

import type { Env } from './aiproxy';
import { AGENTES } from './agentes';
import { PESSOAS } from './pessoas';

const NOMES = new Map(AGENTES.map((a) => [a.chave, a.nome]));
const nomeDe = (c: unknown) => {
  const k = String(c || '');
  if (k === 'joao') return 'João (você)';
  return PESSOAS[k]?.nome || NOMES.get(k) || k;
};

function esc(s: unknown): string {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

function jsonSeguro(s: unknown, padrao: unknown = []): any {
  try { return JSON.parse(String(s ?? '')); } catch { return padrao; }
}

function quando(iso: unknown): string {
  try {
    return new Date(String(iso)).toLocaleString('pt-BR', { timeZone: 'America/Fortaleza' });
  } catch { return String(iso || ''); }
}

const ESTILO = `
:root{--fundo:#120f1c;--cartao:#191530;--borda:#2e2752;--texto:#ece9f7;--fraco:#9b93bd;--ouro:#ffcc33;--azul:#4fa3e0;--verde:#3ecf8e;--vermelho:#ff5c6c}
*{box-sizing:border-box}
body{margin:0;background:var(--fundo);color:var(--texto);font:15px/1.6 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif}
.env{max-width:760px;margin:0 auto;padding:22px 16px 60px}
.topo{border-bottom:2px solid var(--borda);padding-bottom:14px;margin-bottom:20px}
.selo{display:inline-block;font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:var(--fundo);background:var(--ouro);padding:3px 8px;border-radius:3px;font-weight:700}
h1{font-size:23px;line-height:1.3;margin:10px 0 6px}
.meta{color:var(--fraco);font-size:13px}
h2{font-size:13px;letter-spacing:.09em;text-transform:uppercase;color:var(--azul);margin:26px 0 8px;border-bottom:1px solid var(--borda);padding-bottom:5px}
.destaque{background:var(--cartao);border-left:4px solid var(--verde);padding:12px 14px;border-radius:0 6px 6px 0;margin:10px 0}
.destaque.brigou{border-left-color:var(--vermelho)}
.destaque .quem{font-weight:700;color:var(--ouro)}
.destaque .sobre{color:var(--fraco);font-size:13.5px}
ul{margin:8px 0;padding-left:20px}li{margin-bottom:7px}
.tarefa{background:var(--cartao);border:1px solid var(--borda);border-radius:6px;padding:11px 13px;margin-bottom:9px}
.tarefa b{color:var(--ouro)}
.reco{background:var(--cartao);border:1px solid var(--borda);border-left:4px solid var(--ouro);border-radius:0 8px 8px 0;padding:13px 15px;margin-bottom:11px}
.reco .oque{font-size:16px;font-weight:700;line-height:1.4}
.reco .linha{color:var(--fraco);font-size:13px;margin-top:6px}
.reco .risco{color:var(--vermelho);font-size:13px;margin-top:5px}
.entrega{background:var(--cartao);border:1px solid var(--borda);border-radius:8px;padding:13px 15px;margin-bottom:11px}
.entrega .cab{font-size:12px;color:var(--fraco);margin-bottom:6px}
.entrega .cab b{color:var(--ouro);font-size:14px}
.entrega .falta{color:var(--vermelho);font-size:13px;margin-top:7px}
.pedido{color:var(--fraco);font-size:13px;font-style:italic;margin-bottom:8px;border-left:2px solid var(--borda);padding-left:9px}
.chamada{background:#241c3a;border:1px solid var(--ouro);border-radius:8px;padding:14px 16px;margin:16px 0;font-size:16px;line-height:1.5}
.fala{border-left:3px solid var(--borda);padding:8px 0 8px 12px;margin-bottom:12px}
.fala .cab{font-size:12px;color:var(--fraco);margin-bottom:3px}
.fala .cab b{color:var(--texto);font-size:14px}
.rodada{display:inline-block;font-size:10px;letter-spacing:.08em;text-transform:uppercase;color:var(--azul);border:1px solid var(--borda);border-radius:3px;padding:1px 6px;margin-left:6px}
details{margin-top:7px}
summary{cursor:pointer;color:var(--fraco);font-size:12px}
pre{background:#0b0913;border:1px solid var(--borda);border-radius:5px;padding:10px;font-size:11.5px;white-space:pre-wrap;word-break:break-word;overflow-x:auto;margin:6px 0 0}
.rodape{margin-top:34px;padding-top:16px;border-top:1px solid var(--borda);display:flex;gap:10px;flex-wrap:wrap}
.botao{display:inline-block;background:var(--ouro);color:#241900;text-decoration:none;font-weight:700;font-size:14px;padding:10px 16px;border-radius:5px}
.botao.calmo{background:var(--cartao);color:var(--texto);border:1px solid var(--borda)}
.vazio{color:var(--fraco);font-style:italic}
`;

export async function renderizarPaginaAta(env: Env, origem: string, sessaoPedida: string): Promise<Response> {
  const q = sessaoPedida
    ? await env.DB.query('SELECT * FROM atas WHERE sessao = ?', [sessaoPedida])
    : await env.DB.query('SELECT * FROM atas ORDER BY quando DESC LIMIT 1', []);
  const ata = q.rows[0];

  if (!ata) {
    return html(`<div class="env"><h1>Ata não encontrada</h1>
      <p class="vazio">Essa reunião não está registrada. Pode ser que ela ainda esteja rodando.</p>
      <div class="rodape"><a class="botao" href="${esc(origem)}/index.html">Abrir a salinha</a></div></div>`, 404);
  }

  const sessao = String(ata.sessao);
  const [falasQ, etapasQ] = await Promise.all([
    env.DB.query('SELECT ordem, rodada, chave, texto FROM falas WHERE sessao = ? ORDER BY ordem', [sessao]),
    env.DB.query('SELECT etapa, chave, dados FROM reunioes WHERE sessao = ? ORDER BY etapa', [sessao]),
  ]);
  const bruto = new Map(etapasQ.rows.map((e) => [Number(e.etapa), String(e.dados || '')]));

  const consenso: string[] = jsonSeguro(ata.consenso);
  const divergencias: { entre: string; sobre: string; posicoes: string }[] = jsonSeguro(ata.divergencias);
  const acoes: { agente: string; acao: string; prazo?: string }[] = jsonSeguro(ata.acoes);
  const recomendacoes: { o_que: string; por_que: string; quem: string; ate_quando: string; risco: string }[] = jsonSeguro(ata.recomendacoes);
  const entregas: { id: number; nome: string; entrega: string; o_que_falta: string; pronta: boolean }[] = jsonSeguro(ata.entregas);

  // O pedido original de cada entrega, pra página mostrar o que foi pedido ao
  // lado do que veio — sem isso a entrega aparece solta e não dá pra julgar.
  const pedidos = new Map<number, string>();
  if (entregas.length) {
    try {
      const d = await env.DB.query('SELECT id, texto FROM direcao WHERE id IN (' + entregas.map(() => '?').join(',') + ')',
        entregas.map((e) => e.id));
      for (const r of d.rows) pedidos.set(Number(r.id), String(r.texto || ''));
    } catch { /* a entrega vale mesmo sem o texto do pedido */ }
  }

  const corpo = `
<div class="env">
  <div class="topo">
    <span class="selo">${ata.automatica ? '🤖 automática' : '📣 convocada'}</span>
    <h1>${esc(ata.tema)}</h1>
    <div class="meta">${esc(quando(ata.quando))} · sessão <code>${esc(sessao)}</code> · webhook: ${esc(ata.webhook_status || 'não enviado')}</div>
  </div>

  ${ata.resumo_curto ? `<div class="chamada"><b>${esc(ata.resumo_curto)}</b></div>` : ''}

  <h2>🎯 O que a mesa recomenda</h2>
  ${recomendacoes.length ? recomendacoes.map((r) => `
    <div class="reco">
      <div class="oque">${esc(r.o_que)}</div>
      ${r.por_que ? `<div class="linha">Por quê: ${esc(r.por_que)}</div>` : ''}
      <div class="linha">${esc(nomeDe(r.quem))}${r.ate_quando ? ` · até ${esc(r.ate_quando)}` : ''}</div>
      ${r.risco ? `<div class="risco">⚠ ${esc(r.risco)}</div>` : ''}
    </div>`).join('')
    : '<p class="vazio">A mesa não recomendou nada nesta rodada. Isso é uma resposta: o dado de hoje não sustentou nenhuma decisão nova, e recomendação inventada pra parecer produtiva é pior que silêncio.</p>'}

  ${ata.precisamos_de_voce ? `<h2>🙋 A mesa precisa de você</h2><div class="destaque">${esc(ata.precisamos_de_voce)}</div>` : ''}

  ${entregas.length ? `<h2>📮 O que você pediu</h2>` + entregas.map((e) => `
    <div class="entrega">
      <div class="cab">${e.pronta ? '✅ entregue' : '🚧 incompleto'} · por <b>${esc(e.nome)}</b></div>
      ${pedidos.get(Number(e.id)) ? `<div class="pedido">Você pediu: ${esc(pedidos.get(Number(e.id)))}</div>` : ''}
      <div>${esc(e.entrega)}</div>
      ${e.o_que_falta ? `<div class="falta">Falta: ${esc(e.o_que_falta)}</div>` : ''}
    </div>`).join('') : ''}

  <h2>Resumo</h2>
  <p>${esc(ata.resumo)}</p>

  ${ata.placar_vendas ? `<h2>🔬 Placar da investigação</h2><div class="destaque">${esc(ata.placar_vendas)}</div>` : ''}

  <h2>📌 O que passamos a acreditar</h2>
  ${consenso.length ? `<ul>${consenso.map((c) => `<li>${esc(c)}</li>`).join('')}</ul>`
    : '<p class="vazio">Nenhuma hipótese se sustentou no número desta vez — e isso foi registrado como tal, em vez de a mesa se dar um prêmio de consolação.</p>'}

  <h2>❌ O que caiu por terra</h2>
  <p class="vazio" style="margin-bottom:10px">Hipótese derrubada é o resultado mais valioso de uma rodada: é onde a casa
  descobre que acreditava em algo que o número não sustenta.</p>
  ${divergencias.length ? divergencias.map((d) => `
    <div class="destaque brigou">
      <div class="quem">${esc(d.sobre)}</div>
      <div class="sobre">${esc(d.entre)}</div>
      <div>${esc(d.posicoes)}</div>
    </div>`).join('')
    : '<p class="vazio">Nada caiu nesta rodada. Se isso virar rotina, vale desconfiar: mesa que nunca erra costuma estar só testando o que já sabe.</p>'}

  <h2>📋 Quem faz o quê até a próxima</h2>
  ${acoes.length ? acoes.map((a) => `
    <div class="tarefa"><b>${esc(nomeDe(a.agente))}</b> — ${esc(a.acao)}${a.prazo ? ` <span class="sobre">(${esc(a.prazo)})</span>` : ''}</div>`).join('')
    : '<p class="vazio">Nenhuma tarefa distribuída.</p>'}

  <h2>Como a mesa chegou lá</h2>
  ${falasQ.rows.length ? falasQ.rows.map((f) => `
    <div class="fala">
      <div class="cab"><b>${esc(nomeDe(f.chave))}</b><span class="rodada">${esc(f.rodada)}</span></div>
      <div>${esc(f.texto)}</div>
      ${bruto.has(Number(f.ordem)) ? `<details><summary>ver a resposta completa deste agente</summary><pre>${esc(formatar(bruto.get(Number(f.ordem))!))}</pre></details>` : ''}
    </div>`).join('')
    : '<p class="vazio">Sem falas registradas.</p>'}

  <div class="rodape">
    <a class="botao" href="${esc(origem)}/index.html?sessao=${encodeURIComponent(sessao)}">🕹 Ver na salinha</a>
    <a class="botao calmo" href="${esc(origem)}/ata">📄 Ata mais recente</a>
    <a class="botao calmo" href="${esc(origem)}/index.html">Todas as reuniões</a>
  </div>
</div>`;

  return html(corpo);
}

function formatar(bruto: string): string {
  try { return JSON.stringify(JSON.parse(bruto), null, 2); } catch { return bruto; }
}

function html(corpo: string, status = 200): Response {
  return new Response(
    `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8">` +
    `<meta name="viewport" content="width=device-width,initial-scale=1">` +
    `<title>Ata · Sala de Guerra do Futebol</title><style>${ESTILO}</style></head><body>${corpo}</body></html>`,
    { status, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } },
  );
}
