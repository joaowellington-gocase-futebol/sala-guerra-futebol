// A mesa de investigação de mercado.
//
// COMO ISTO FUNCIONAVA E POR QUE MUDOU (João, 18/09/2026):
//
// A versão anterior fazia a Rafa ESCREVER SQL contra a venda própria da casa.
// A ideia era boa no papel — o agente formula a pergunta e vai buscar a
// resposta — e foi um desastre na prática por duas razões:
//
//   Técnica: dependia de o modelo produzir SQL válido E de o datamart
//   responder dentro de 40 segundos. Quando qualquer um dos dois falhava, a
//   rodada inteira ficava sem número e a ata terminava em "não há o que
//   recomendar". O João recebeu essa ata por dias seguidos.
//
//   De fundo, e mais importante: mesmo funcionando, media a Gocase contra ela
//   mesma. "Não precisamos do número de vendas, nem sei como tá sendo
//   calculado isso — podemos mudar a lógica pra trazer dados comerciais no
//   geral, tipo procura e consumo masculino." Ele tem razão: o que decide uma
//   coleção é o mercado, não o retrovisor da própria loja.
//
// Agora a mesa escolhe MEDIÇÕES de um cardápio (src/mercado/metricas.ts) e o
// código faz a conta sobre dados já coletados — procura real na Wikipédia,
// oferta e preço das lojas do nicho, presença do tema na imprensa, na conversa
// da torcida e na prateleira. Duas chamadas de IA no lugar de até dezesseis, e
// é impossível uma rodada terminar sem número.
//
// O que sobrevive entre as rodadas continua sendo as CRENÇAS: o modelo de
// mundo da casa, que cresce, é revisado e às vezes cai.

import type { Env } from './aiproxy';
import { chamarAgente } from './aiproxy';
import { PESSOAS, formatarPessoa } from './pessoas';
import { catalogoDeMetricas, medir, type PedidoDeTeste, type NomeDaMetrica } from './mercado/metricas';
import type { Mundo } from './web/mundo';
import type { Vitrine } from './web/vitrine';

export interface Teste {
  pergunta: string;
  hipotese: string;
  /** A medição escolhida, em texto, pra ata poder mostrar o que foi feito. */
  medicao: string;
  numeros: string;
  veredito: 'confirma' | 'refuta' | 'inconclusivo' | 'falhou';
  o_que_o_numero_diz: string;
}

export interface Crenca { id?: number; afirmacao: string; evidencia: string; confianca: number }

export interface ResultadoInvestigacao {
  perguntas: { pergunta: string; hipotese: string; por_que_importa: string }[];
  testes: Teste[];
  passamosAAcreditar: Crenca[];
  caiuPorTerra: { afirmacao: string; por_que: string }[];
  emAberto: string[];
  leitura: string;
}

const MAX_PERGUNTAS = 4;
const METRICAS_VALIDAS: NomeDaMetrica[] = [
  'procura_do_clube', 'comparar_procura', 'oferta_da_categoria', 'comparar_oferta', 'presenca_do_tema', 'agenda_do_clube',
];

// ── As crenças que estão de pé ───────────────────────────────────────────

export async function crencasVivas(env: Env, limite = 12) {
  const q = await env.DB.query(
    "SELECT id, afirmacao, evidencia, confianca, vezes_confirmada FROM crencas WHERE status = 'viva' ORDER BY confianca DESC, id DESC LIMIT ?",
    [limite],
  );
  return q.rows.map((r) => ({
    id: Number(r.id), afirmacao: String(r.afirmacao), evidencia: String(r.evidencia || ''),
    confianca: Number(r.confianca || 0), vezes: Number(r.vezes_confirmada || 1),
  }));
}

function formatarCrencas(cs: { afirmacao: string; evidencia: string; confianca: number; vezes: number }[]): string {
  if (!cs.length) return 'A mesa ainda não acredita em nada sobre este mercado — esta é a primeira investigação.';
  return cs.map((c) =>
    `- "${c.afirmacao}" (confiança ${c.confianca.toFixed(1)}, confirmada ${c.vezes}x) — apoiada em: ${c.evidencia}`,
  ).join('\n');
}

// ── 1. As perguntas, já na forma de medição ──────────────────────────────

async function proporPerguntas(
  env: Env, contexto: string, crencas: string, naoRepita: string, menu: string, direcao: string,
): Promise<PedidoDeTeste[]> {
  const r = await chamarAgente(
    env,
    'Você é a mesa de inteligência de mercado da Gocase para a linha de futebol — Téo (olheiro), Rafa (dados), ' +
    'Nina (criação), Caio (posicionamento) e Val (operação) pensando juntos.\n\n' +
    'O TRABALHO: entender o mercado em que a casa vende — procura do público, oferta e preço da concorrência, ' +
    'e o que o consumidor masculino está consumindo agora. A partir disso, o João decide o que a área faz.\n\n' +
    direcao + menu +
    '\n\n━━ LEVANTE DE 3 A ' + MAX_PERGUNTAS + ' PERGUNTAS ━━\n' +
    'Cada uma vira uma medição da lista acima. Uma pergunta que não caiba numa medição não serve aqui — ' +
    'reescreva até caber.\n\n' +
    'O QUE FAZ UMA PERGUNTA PRESTAR:\n' +
    '• Ela COMPARA. "Quanta procura tem o Flamengo" ensina pouco; "a procura do Flamengo cresce mais que a do ' +
    'Grêmio na semana do clássico" ensina.\n' +
    '• Ela pode MUDAR UMA DECISÃO. Se a resposta não muda nada do que a casa faria, é curiosidade.\n' +
    '• As perguntas são DIFERENTES ENTRE SI — ângulos que competem, não a mesma ideia reescrita.\n' +
    '• Pelo menos UMA tem que tentar DERRUBAR uma crença que a mesa já tem. Mesa que só busca confirmação é ' +
    'torcida, não inteligência.\n' +
    '• Território virgem vale ouro: medir a presença de um tema que talvez ninguém esteja explorando é uma ' +
    'pergunta excelente, e o resultado zero é uma resposta ÚTIL, não uma falha.\n\n' +
    'O QUE A MESA JÁ ACREDITA (e você precisa desafiar):\n' + crencas + naoRepita +
    '\n\nResponda APENAS {"perguntas":[{"pergunta":"..","hipotese":"o que você aposta que o número vai mostrar",' +
    '"por_que_importa":"o que muda no negócio se for verdade","metrica":"<uma da lista>","alvo_a":"..",' +
    '"alvo_b":"<só quando a medição pedir dois>"}]}',
    'Sinais e contexto de agora:\n' + contexto,
    undefined,
    0.75,
  );

  const d = r.ok ? (r.dados as any) : null;
  const lista = Array.isArray(d?.perguntas) ? d.perguntas : [];
  return lista.slice(0, MAX_PERGUNTAS).map((p: any) => ({
    pergunta: String(p?.pergunta || '').slice(0, 300),
    hipotese: String(p?.hipotese || '').slice(0, 300),
    por_que_importa: String(p?.por_que_importa || '').slice(0, 300),
    metrica: (METRICAS_VALIDAS.includes(p?.metrica) ? p.metrica : 'presenca_do_tema') as NomeDaMetrica,
    alvo_a: String(p?.alvo_a || '').slice(0, 120),
    alvo_b: p?.alvo_b ? String(p.alvo_b).slice(0, 120) : undefined,
  })).filter((p: PedidoDeTeste) => p.pergunta && p.alvo_a);
}

// ── 2. A leitura: o modelo conclui em cima dos números que o código deu ──

interface Conclusao {
  vereditos: { veredito: string; o_que_o_numero_diz: string }[];
  passamosAAcreditar: Crenca[];
  caiuPorTerra: { afirmacao: string; por_que: string }[];
  emAberto: string[];
  leitura: string;
}

async function concluir(
  env: Env,
  medidos: { pedido: PedidoDeTeste; numeros: string }[],
  crencas: string,
): Promise<Conclusao> {
  const vazio: Conclusao = { vereditos: [], passamosAAcreditar: [], caiuPorTerra: [], emAberto: [], leitura: 'Não consegui consolidar esta rodada.' };
  if (!medidos.length) return vazio;

  const r = await chamarAgente(
    env,
    formatarPessoa('analista') +
    '\n\n━━ AGORA LEIA OS NÚMEROS ━━\n' +
    'A mesa escolheu as medições e o sistema fez as contas. Os números abaixo são reais e já estão prontos — ' +
    'você não precisa buscar nada, só ler com a honestidade que é a sua marca.\n\n' +
    'Para CADA pergunta, dê um veredito:\n' +
    '• "confirma" — o número sustenta a hipótese;\n' +
    '• "refuta" — o número diz o contrário, e isto é um resultado ÓTIMO: a casa aprende mais com hipótese ' +
    'derrubada do que com confirmada;\n' +
    '• "inconclusivo" — o número não resolve a pergunta, e forçar seria mentir.\n' +
    'Em "o_que_o_numero_diz", UMA a TRÊS frases suas com os números concretos. Sem adjetivo vazio. Se refutou, ' +
    'diga o que apareceu NO LUGAR da hipótese.\n' +
    'Cuidado com base pequena: comparação apoiada em pouquíssimos itens é "inconclusivo" mesmo quando o número ' +
    'parece bonito.\n\n' +
    '━━ DEPOIS, FECHE A RODADA ━━\n' +
    '• "passamos_a_acreditar": só o que o número sustenta, cada item com a evidência numérica colada e uma ' +
    'confiança de 0 a 1. Nada confirmado? Lista vazia, sem prêmio de consolação.\n' +
    '• "caiu_por_terra": o que foi refutado, inclusive crença antiga que caiu. É a parte mais valiosa.\n' +
    '• "em_aberto": o que ficou sem resposta e merece outra medição na próxima — diga QUAL.\n' +
    '• "leitura": 3 a 5 frases, em português falado, explicando ao dono do negócio o que está acontecendo no ' +
    'mercado agora. Sem jargão, sem "recomenda-se". A recomendação vem depois, em etapa própria.\n\n' +
    'O QUE A MESA ACREDITAVA ANTES DESTA RODADA:\n' + crencas +
    '\n\nResponda APENAS {"vereditos":[{"veredito":"confirma|refuta|inconclusivo","o_que_o_numero_diz":".."}],' +
    '"passamos_a_acreditar":[{"afirmacao":"..","evidencia":"..","confianca":0.0}],' +
    '"caiu_por_terra":[{"afirmacao":"..","por_que":".."}],"em_aberto":[".."],"leitura":".."} ' +
    '— um veredito por pergunta, na mesma ordem em que elas aparecem.',
    medidos.map((x, i) =>
      `PERGUNTA ${i + 1}: ${x.pedido.pergunta}\nHIPÓTESE: ${x.pedido.hipotese}\n` +
      `MEDIÇÃO (${x.pedido.metrica}: ${x.pedido.alvo_a}${x.pedido.alvo_b ? ` × ${x.pedido.alvo_b}` : ''})\n` +
      `NÚMEROS: ${x.numeros}`,
    ).join('\n\n———\n\n'),
    undefined,
    0.3,
  );

  if (!r.ok) return vazio;
  const d = r.dados as any;
  return {
    vereditos: (Array.isArray(d?.vereditos) ? d.vereditos : []).map((v: any) => ({
      veredito: String(v?.veredito || 'inconclusivo'),
      o_que_o_numero_diz: String(v?.o_que_o_numero_diz || '').slice(0, 700),
    })),
    passamosAAcreditar: (Array.isArray(d?.passamos_a_acreditar) ? d.passamos_a_acreditar : []).map((c: any) => ({
      afirmacao: String(c?.afirmacao || '').slice(0, 400),
      evidencia: String(c?.evidencia || '').slice(0, 400),
      confianca: Math.max(0, Math.min(1, Number(c?.confianca ?? 0.5))),
    })).filter((c: Crenca) => c.afirmacao),
    caiuPorTerra: (Array.isArray(d?.caiu_por_terra) ? d.caiu_por_terra : []).map((c: any) => ({
      afirmacao: String(c?.afirmacao || '').slice(0, 400), por_que: String(c?.por_que || '').slice(0, 400),
    })).filter((c: any) => c.afirmacao),
    emAberto: (Array.isArray(d?.em_aberto) ? d.em_aberto : []).map((x: any) => String(x).slice(0, 300)),
    leitura: String(d?.leitura || vazio.leitura).slice(0, 1500),
  };
}

// ── O ciclo inteiro ──────────────────────────────────────────────────────

export async function investigarMercado(
  env: Env,
  opts: { sessao: string; contexto: string; naoRepita: string; direcao?: string; mundo: Mundo; vitrine: Vitrine },
): Promise<ResultadoInvestigacao> {
  const vivas = await crencasVivas(env);
  const textoCrencas = formatarCrencas(vivas);
  const menu = catalogoDeMetricas(opts.mundo, opts.vitrine);

  const pedidos = await proporPerguntas(env, opts.contexto, textoCrencas, opts.naoRepita, menu, opts.direcao || '');
  if (!pedidos.length) {
    return {
      perguntas: [], testes: [], passamosAAcreditar: [], caiuPorTerra: [], emAberto: [],
      leitura: 'A mesa não conseguiu formular pergunta nenhuma nesta rodada.',
    };
  }

  // A conta é local: sem rede, sem SQL, sem timeout. Uma medição que não acha
  // o alvo devolve o motivo, e isso também é informação — quer dizer que a mesa
  // perguntou sobre algo que não está no radar de hoje.
  const medidos = pedidos.map((pedido) => {
    const m = medir(pedido, opts.mundo, opts.vitrine);
    console.log(`[medicao] ${pedido.metrica}(${pedido.alvo_a}${pedido.alvo_b ? ' × ' + pedido.alvo_b : ''}) → ${m.ok ? m.numeros.slice(0, 160) : 'FALHOU: ' + m.erro}`);
    return { pedido, numeros: m.ok ? m.numeros : `não deu pra medir: ${m.erro}`, ok: m.ok };
  });

  const fim = await concluir(env, medidos.filter((x) => x.ok), textoCrencas);

  const testes: Teste[] = medidos.map((x, i) => {
    const v = x.ok ? fim.vereditos[i] : undefined;
    const veredito = x.ok
      ? (['confirma', 'refuta', 'inconclusivo'].includes(String(v?.veredito)) ? String(v?.veredito) : 'inconclusivo')
      : 'falhou';
    return {
      pergunta: x.pedido.pergunta,
      hipotese: x.pedido.hipotese,
      medicao: `${x.pedido.metrica}: ${x.pedido.alvo_a}${x.pedido.alvo_b ? ` × ${x.pedido.alvo_b}` : ''}`,
      numeros: x.numeros,
      veredito: veredito as Teste['veredito'],
      o_que_o_numero_diz: v?.o_que_o_numero_diz || x.numeros,
    };
  });

  const agora = new Date().toISOString();
  for (const t of testes) {
    try {
      await env.DB.exec(
        'INSERT INTO investigacoes (sessao, pergunta, hipotese, sql_usado, linhas, veredito, o_que_o_numero_diz, criado_em) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [opts.sessao, t.pergunta, t.hipotese, t.medicao, 0, t.veredito, `${t.numeros} || ${t.o_que_o_numero_diz}`.slice(0, 1200), agora],
      );
    } catch { /* o registro é auxiliar */ }
  }

  // O modelo de mundo da casa é atualizado: o confirmado entra ou ganha
  // confiança; o que caiu fica registrado como caído, pra ninguém ressuscitar
  // sem evidência nova.
  try {
    for (const c of fim.passamosAAcreditar) {
      const existente = vivas.find((v) => v.afirmacao.toLowerCase().slice(0, 60) === c.afirmacao.toLowerCase().slice(0, 60));
      if (existente) {
        await env.DB.exec(
          'UPDATE crencas SET confianca = ?, evidencia = ?, revisada_em = ?, vezes_confirmada = vezes_confirmada + 1 WHERE id = ?',
          [Math.max(existente.confianca, c.confianca), c.evidencia, agora, existente.id],
        );
      } else {
        await env.DB.exec(
          "INSERT INTO crencas (afirmacao, evidencia, confianca, status, nascida_em, revisada_em) VALUES (?, ?, ?, 'viva', ?, ?)",
          [c.afirmacao, c.evidencia, c.confianca, agora, agora],
        );
      }
    }
    for (const q of fim.caiuPorTerra) {
      const alvo = vivas.find((v) => v.afirmacao.toLowerCase().slice(0, 40) === q.afirmacao.toLowerCase().slice(0, 40));
      if (alvo) {
        await env.DB.exec("UPDATE crencas SET status = 'caiu', evidencia = ?, revisada_em = ? WHERE id = ?",
          [q.por_que, agora, alvo.id]);
      }
    }
  } catch { /* a leitura da rodada vale mesmo se a gravação falhar */ }

  return {
    perguntas: pedidos.map((p) => ({ pergunta: p.pergunta, hipotese: p.hipotese, por_que_importa: '' })),
    testes,
    passamosAAcreditar: fim.passamosAAcreditar,
    caiuPorTerra: fim.caiuPorTerra,
    emAberto: fim.emAberto,
    leitura: fim.leitura,
  };
}

export { PESSOAS };
