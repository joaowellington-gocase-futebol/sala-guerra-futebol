// A voz do coordenador dentro da mesa.
//
// O QUE ESTAVA ERRADO (João, 15/09/2026): "ainda segue não me dando
// direcionamento". A mesa tinha virado uma mesa de inteligência que só produz
// entendimento — os prompts chegavam a PROIBIR a Nina e o Caio de propor
// qualquer coisa ("NÃO proponha produto nem campanha"). O resultado era uma
// ata que explica o mercado e termina sem dizer o que fazer. E o João, que é
// quem toca a área, não tinha nenhum canal pra mandar na equipe: existia um
// "tema fixo" perdido no ⚙ Config, e mais nada.
//
// Este arquivo cria as três coisas que faltavam pra ele ser COORDENADOR da
// equipe, e não espectador dela:
//
//   TEMA      — "a pauta desta semana é X". Vira a pauta da reunião, no lugar
//               da pergunta que a investigação escolheria sozinha.
//   FEEDBACK  — "a ata de ontem ficou rasa", "gostei do corte do clássico".
//               Entra no system prompt de TODO MUNDO, como recado do chefe, e
//               fica lá até ele arquivar. É o que faz a equipe corrigir rumo.
//   DEMANDA   — "quero 3 direções de coleção pro clube X até sexta". Tem dono,
//               tem prazo, é respondida por um deles numa rodada própria e é
//               cobrada em toda reunião até ele dar por entregue.
//
// Regra que atravessa tudo: direção do coordenador é ORDEM, não sugestão. Um
// agente pode discordar — e deve dizer que discorda —, mas não pode ignorar.

import type { Env } from './aiproxy';
import { chamarAgente } from './aiproxy';
import { acharAgente } from './agentes';
import { PESSOAS, formatarPessoa } from './pessoas';

export type TipoDirecao = 'tema' | 'feedback' | 'demanda';

export interface Direcao {
  id: number;
  tipo: TipoDirecao;
  texto: string;
  para: string;        // chave do agente, ou '' = a mesa inteira
  prazo: string;
  status: string;      // aberta | entregue | arquivada
  criado_em: string;
  criado_por: string;
  resposta: string;    // o que a mesa devolveu na última rodada
  rodadas: number;     // quantas reuniões já viram isto
}

function linha(r: Record<string, unknown>): Direcao {
  return {
    id: Number(r.id), tipo: String(r.tipo) as TipoDirecao, texto: String(r.texto || ''),
    para: String(r.para || ''), prazo: String(r.prazo || ''), status: String(r.status || 'aberta'),
    criado_em: String(r.criado_em || ''), criado_por: String(r.criado_por || ''),
    resposta: String(r.resposta || ''), rodadas: Number(r.rodadas || 0),
  };
}

export async function abrirDirecao(
  env: Env,
  d: { tipo: TipoDirecao; texto: string; para?: string; prazo?: string; quem?: string },
): Promise<number> {
  // Tema é um só: um novo tema substitui o anterior, senão a mesa fica com
  // três pautas concorrentes e volta a não decidir nada.
  if (d.tipo === 'tema') {
    await env.DB.exec("UPDATE direcao SET status = 'arquivada' WHERE tipo = 'tema' AND status = 'aberta'", []);
  }
  await env.DB.exec(
    `INSERT INTO direcao (tipo, texto, para, prazo, status, criado_em, criado_por, resposta, rodadas)
     VALUES (?, ?, ?, ?, 'aberta', ?, ?, '', 0)`,
    [d.tipo, d.texto.slice(0, 1200), (d.para || '').slice(0, 40), (d.prazo || '').slice(0, 60),
     new Date().toISOString(), (d.quem || '').slice(0, 120)],
  );
  const q = await env.DB.query('SELECT id FROM direcao ORDER BY id DESC LIMIT 1', []);
  return Number(q.rows[0]?.id || 0);
}

export async function listarDirecao(env: Env, limite = 60): Promise<Direcao[]> {
  const q = await env.DB.query(
    "SELECT * FROM direcao ORDER BY CASE status WHEN 'aberta' THEN 0 ELSE 1 END, id DESC LIMIT ?", [limite]);
  return q.rows.map(linha);
}

export interface DirecaoAberta {
  tema: Direcao | null;
  feedbacks: Direcao[];
  demandas: Direcao[];
  todas: Direcao[];
}

export async function direcaoAberta(env: Env): Promise<DirecaoAberta> {
  const q = await env.DB.query("SELECT * FROM direcao WHERE status = 'aberta' ORDER BY id DESC LIMIT 30", []);
  const todas = q.rows.map(linha);
  return {
    tema: todas.find((d) => d.tipo === 'tema') || null,
    // Feedback velho demais vira ruído no prompt: os 6 últimos bastam pra
    // corrigir rumo, e o resto continua guardado na tela.
    feedbacks: todas.filter((d) => d.tipo === 'feedback').slice(0, 6),
    demandas: todas.filter((d) => d.tipo === 'demanda'),
    todas,
  };
}

export async function mudarStatus(env: Env, id: number, status: string) {
  await env.DB.exec('UPDATE direcao SET status = ?, atendida_em = ? WHERE id = ?',
    [status, new Date().toISOString(), id]);
}

export async function registrarResposta(env: Env, id: number, resposta: string) {
  await env.DB.exec('UPDATE direcao SET resposta = ?, rodadas = rodadas + 1 WHERE id = ?',
    [resposta.slice(0, 1500), id]);
}

export async function contarRodada(env: Env, ids: number[]) {
  for (const id of ids) {
    try { await env.DB.exec('UPDATE direcao SET rodadas = rodadas + 1 WHERE id = ?', [id]); } catch { /* auxiliar */ }
  }
}

/**
 * O bloco que entra no system prompt de TODO agente. É curto de propósito: o
 * que o chefe disse tem que caber na cabeça de quem vai falar em seguida.
 */
export function blocoDoCoordenador(d: DirecaoAberta): string {
  if (!d.tema && !d.feedbacks.length && !d.demandas.length) return '';

  const partes: string[] = [
    '\n\n━━ O QUE O JOÃO (SEU COORDENADOR) MANDOU ━━',
    'O João Wellington coordena esta equipe. O que está aqui embaixo veio dele, direto, e não é sugestão: ' +
    'é o que ele espera de vocês nesta rodada. Você pode discordar — e se discordar, DIGA na sua fala, com o ' +
    'motivo — mas não pode ignorar nem responder por cima.',
  ];

  if (d.tema) {
    partes.push(`\n📌 A PAUTA QUE ELE DEU: "${d.tema.texto}"` +
      (d.tema.rodadas ? ` (já é a ${d.tema.rodadas + 1}ª rodada com esta pauta)` : '') +
      '\nÉ sobre isto que a reunião é. Se o dado desta rodada não tem nada a ver com a pauta, diga isso na ' +
      'cara em vez de forçar uma ligação que não existe.');
  }

  if (d.feedbacks.length) {
    partes.push('\n🗣 O QUE ELE FALOU DO TRABALHO DE VOCÊS:\n' +
      d.feedbacks.map((f) => {
        const alvo = f.para ? `${PESSOAS[f.para]?.nome || f.para}, ` : '';
        return `- ${alvo}"${f.texto}"`;
      }).join('\n') +
      '\nIsto é correção de rumo. Mudar por causa disso não é puxar o saco — é trabalhar com alguém. ' +
      'Se um feedback é sobre você e você acha que ele está enganado, responda a ele, com argumento.');
  }

  if (d.demandas.length) {
    partes.push('\n📋 O QUE ELE PEDIU E AINDA NÃO FOI ENTREGUE:\n' +
      d.demandas.map((x) => {
        const dono = x.para ? (PESSOAS[x.para]?.nome || x.para) : 'a mesa';
        return `- [#${x.id}] ${dono}: ${x.texto}` +
          (x.prazo ? ` (prazo: ${x.prazo})` : '') +
          (x.rodadas >= 3 ? ` — ATENÇÃO: está em aberto há ${x.rodadas} rodadas` : '');
      }).join('\n') +
      '\nDemanda em aberto tem prioridade sobre curiosidade da mesa. Se o que você tem hoje ajuda a entregar ' +
      'alguma delas, fale disso primeiro.');
  }

  return partes.join('\n');
}

/** Só o que muda a impressão digital da rodada — direção nova = reunião nova. */
export function impressaoDaDirecao(d: DirecaoAberta): string {
  return d.todas.map((x) => `${x.id}:${x.tipo}:${x.texto.slice(0, 80)}`).join('|');
}

// ── A rodada de ENTREGA: alguém responde ao que o João pediu ─────────────

export interface EntregaDeDemanda {
  id: number;
  chave: string;
  nome: string;
  entrega: string;
  o_que_falta: string;
  pronta: boolean;
  recado: string;
}

/** Sem dono declarado, o pedido cai em quem tem o assunto. Palavra simples, de propósito. */
export function donoProvavel(texto: string): string {
  const t = texto.toLowerCase();
  if (/estampa|arte|desenh|estétic|visual|cor|coleç|refer[êe]ncia|layout/.test(t)) return 'criacao';
  if (/vend|númer|numer|dado|receita|margem|consulta|sql|métric|metric/.test(t)) return 'analista';
  if (/jogo|calend[áa]rio|notícia|noticia|tend[êe]ncia|clássico|classico|lançamento|lancamento/.test(t)) return 'olheiro';
  if (/posiciona|campanha|concorr[êe]nc|marca|comunica|preço|preco/.test(t)) return 'marketeiro';
  if (/prazo|fila|pedido|travad|operaç|operac|process|organiz/.test(t)) return 'produtor';
  return 'marketeiro';
}

export async function responderDemanda(
  env: Env,
  demanda: Direcao,
  ctx: { contexto: string; achado: string; systemDoAgente: (chave: string) => Promise<string> },
): Promise<EntregaDeDemanda> {
  const chave = demanda.para && acharAgente(demanda.para) ? demanda.para : donoProvavel(demanda.texto);
  const ag = acharAgente(chave)!;
  const pessoa = PESSOAS[chave];

  let system: string;
  try { system = await ctx.systemDoAgente(chave); } catch { system = ag.system; }

  const r = await chamarAgente(
    env,
    system +
    '\n\n━━ AGORA É COM VOCÊ: O JOÃO PEDIU ISTO DIRETAMENTE ━━\n' +
    'Esta parte da reunião não é análise. É entrega. O João pediu uma coisa concreta e a resposta sai de você.\n' +
    'O QUE ELE PEDIU: "' + demanda.texto + '"' +
    (demanda.prazo ? `\nPRAZO QUE ELE DEU: ${demanda.prazo}` : '') +
    (demanda.rodadas ? `\nJá se passaram ${demanda.rodadas} rodadas desde que ele pediu.` : '') +
    (demanda.resposta ? `\n\nO QUE VOCÊ JÁ TINHA RESPONDIDO NA RODADA ANTERIOR:\n${demanda.resposta}\n` +
      'Não repita isso. Avance: ou você entrega o que faltava, ou diz por que empacou.' : '') +
    '\n\nCOMO RESPONDER:\n' +
    '• "entrega" é a coisa em si, pronta pra ele usar — não um plano de como você faria. Se ele pediu três ' +
    'direções, venham as três, descritas de um jeito que dá pra alguém executar. Se ele pediu um número, venha ' +
    'o número. Nada de "vamos avaliar", "sugiro explorar", "poderíamos considerar".\n' +
    '• Ancore no que a mesa descobriu hoje. Entrega sem evidência é chute com capa de trabalho, e ele percebe.\n' +
    '• "o_que_falta" é honestidade: o que você não conseguiu fazer e por quê, ou o que você precisa dele pra ' +
    'terminar. Vazio se estiver completo.\n' +
    '• "pronta" é true só quando você entregaria isso pra ele sem vergonha. Se está pela metade, é false — e ' +
    'não tem problema nenhum, desde que você diga o que falta.\n' +
    '• Se você acha que o pedido está errado, entregue mesmo assim E diga o que você faria diferente. Ele é o ' +
    'coordenador; você é quem entende do seu pedaço. As duas coisas cabem.\n' +
    '\nResponda APENAS {"entrega":"..","o_que_falta":"..","pronta":bool,"recado":"<2 a 3 frases suas, faladas, ' +
    'do jeito que você diria pro João>","estado":{"humor":"..","nao_sai_da_cabeca":".."}}',
    `PEDIDO DO JOÃO: ${demanda.texto}\n\nO QUE A MESA DESCOBRIU NESTA RODADA:\n${ctx.achado}\n\n` +
    `O QUE ESTAVA NA MESA HOJE:\n${ctx.contexto}`,
    undefined,
    0.55,
  );

  const d = (r.ok ? r.dados : {}) as any;
  const entrega = String(d?.entrega || '').trim();
  return {
    id: demanda.id,
    chave,
    nome: pessoa?.nome || ag.nome,
    entrega: entrega || `(não consegui entregar nesta rodada: ${r.erro || 'resposta vazia'})`,
    o_que_falta: String(d?.o_que_falta || '').slice(0, 600),
    pronta: !!d?.pronta && !!entrega,
    recado: String(d?.recado || '').slice(0, 300),
  };
}

// ── O fecho da reunião mudou de casa em 22/09/2026 ───────────────────────
//
// A rodada de DIREÇÃO ("o que a Gocase faz amanhã de manhã", com clube,
// produto e prazo) vivia aqui embaixo. Ela foi substituída pela LEITURA DE
// MERCADO e mora agora em src/mercado/leitura.ts — o arquivo explica a troca.
//
// O que ficou neste arquivo é só a voz do coordenador: tema, feedback e
// demanda. Eram duas responsabilidades no mesmo lugar, e só uma delas mudou.
