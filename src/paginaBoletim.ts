// A página do boletim semanal: os 10 depoimentos, um do lado do outro, com os
// números da semana de cada agente ao lado do texto dele. HTML no servidor,
// mesma pegada da página da ata — é link de Google Chat, tem que abrir no
// celular sem peso.

import type { Env } from './aiproxy';
import { AGENTES } from './agentes';
import { lerBoletim } from './boletim';

const AG = new Map(AGENTES.map((a) => [a.chave, a]));

function esc(s: unknown): string {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

const ESTILO = `
:root{--fundo:#120f1c;--cartao:#191530;--borda:#2e2752;--texto:#ece9f7;--fraco:#9b93bd;--ouro:#ffcc33;--azul:#4fa3e0;--verde:#3ecf8e;--vermelho:#ff5c6c}
*{box-sizing:border-box}
body{margin:0;background:var(--fundo);color:var(--texto);font:15px/1.6 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif}
.env{max-width:760px;margin:0 auto;padding:22px 16px 60px}
.topo{border-bottom:2px solid var(--borda);padding-bottom:14px;margin-bottom:8px}
.selo{display:inline-block;font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:var(--fundo);background:var(--ouro);padding:3px 8px;border-radius:3px;font-weight:700}
h1{font-size:23px;margin:10px 0 6px}
.meta{color:var(--fraco);font-size:13px}
.nota{color:var(--fraco);font-size:13px;margin:14px 0 22px;border-left:3px solid var(--borda);padding-left:12px}
.card{background:var(--cartao);border:1px solid var(--borda);border-radius:8px;padding:15px 16px;margin-bottom:14px}
.card .cab{display:flex;justify-content:space-between;align-items:baseline;gap:10px;flex-wrap:wrap;margin-bottom:8px}
.card h2{font-size:16px;margin:0;color:var(--ouro)}
.card .papel{color:var(--fraco);font-size:12px;margin:0 0 10px}
.numeros{font-size:11.5px;color:var(--fraco);white-space:nowrap}
.numeros b{color:var(--texto)}
.numeros .ruim{color:var(--vermelho)}
.depoimento{font-size:14.5px;line-height:1.65}
.calado{color:var(--fraco);font-style:italic}
.rodape{margin-top:30px;padding-top:16px;border-top:1px solid var(--borda);display:flex;gap:10px;flex-wrap:wrap}
.botao{display:inline-block;background:var(--ouro);color:#241900;text-decoration:none;font-weight:700;font-size:14px;padding:10px 16px;border-radius:5px}
.botao.calmo{background:var(--cartao);color:var(--texto);border:1px solid var(--borda)}
.vazio{color:var(--fraco);font-style:italic}
`;

export async function renderizarPaginaBoletim(env: Env, origem: string, semanaPedida: string): Promise<Response> {
  const linhas = await lerBoletim(env, semanaPedida);

  if (!linhas.length) {
    return html(`<div class="env"><h1>Nenhum boletim ainda</h1>
      <p class="vazio">O boletim é gerado uma vez por semana, na segunda de manhã. Depois da primeira rodada ele aparece aqui.</p>
      <div class="rodape"><a class="botao" href="${esc(origem)}/index.html">Abrir a salinha</a></div></div>`, 404);
  }

  const semana = String(linhas[0].semana);
  const totalReunioes = Math.max(...linhas.map((l) => Number(l.reunioes) || 0));
  const comFalha = linhas.filter((l) => Number(l.falhas) > 0).length;

  const corpo = `
<div class="env">
  <div class="topo">
    <span class="selo">📊 boletim semanal</span>
    <h1>Como a mesa está se desenvolvendo — semana ${esc(semana)}</h1>
    <div class="meta">${linhas.length} depoimentos · até ${totalReunioes} reuniões na semana · ${comFalha} agente(s) com falha de fonte</div>
  </div>

  <p class="nota">Cada parágrafo abaixo foi escrito pelo próprio agente, em primeira pessoa, lendo a memória dele
  da semana — o que aprendeu, o que a mesa cobrou e o que travou. A instrução manda ele não vender o próprio
  peixe: depoimento em que todo mundo foi ótimo não serve pra nada. Os números ao lado do nome entram na
  entrada dele, pra ele não poder se elogiar contra o fato.</p>

  ${linhas.map((l) => {
    const ag = AG.get(String(l.chave));
    const falhas = Number(l.falhas) || 0;
    const reunioes = Number(l.reunioes) || 0;
    return `
    <div class="card">
      <div class="cab">
        <h2>${esc(ag?.nome || l.chave)}</h2>
        <div class="numeros">
          <b>${reunioes}</b> reuniões ·
          <b>${Number(l.licoes) || 0}</b> lições ·
          <b>${Number(l.cobrancas) || 0}</b> cobranças ·
          <span class="${falhas ? 'ruim' : ''}"><b>${falhas}</b> falhas</span>
        </div>
      </div>
      <p class="papel">${esc(ag?.oque || '')}</p>
      <div class="depoimento ${reunioes === 0 ? 'calado' : ''}">${esc(l.depoimento)}</div>
    </div>`;
  }).join('')}

  <div class="rodape">
    <a class="botao" href="${esc(origem)}/index.html">🕹 Abrir a salinha</a>
    <a class="botao calmo" href="${esc(origem)}/ata">📄 Última ata</a>
  </div>
</div>`;

  return html(corpo);
}

function html(corpo: string, status = 200): Response {
  return new Response(
    `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8">` +
    `<meta name="viewport" content="width=device-width,initial-scale=1">` +
    `<title>Boletim semanal · Sala de Guerra do Futebol</title><style>${ESTILO}</style></head><body>${corpo}</body></html>`,
    { status, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } },
  );
}
