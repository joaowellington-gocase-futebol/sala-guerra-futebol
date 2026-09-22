// O motor da reunião — o que transforma "10 agentes rodando em fila" numa mesa
// que discute, e agora numa equipe que responde a alguém.
//
// A reunião tem RODADAS, e o que muda entre elas é quem fala com o quê na
// frente:
//
//   1. FATOS         (paralelo)  o Téo (jogo/busca/notícia) e a Rafa (venda
//                                real). Ninguém opina antes dos fatos entrarem.
//   2. VOZES DA CASA             o que saiu do corredor e o que cada um trouxe
//                                por conta própria — pauta não vem só de API.
//   3. INVESTIGAÇÃO              3 a 4 hipóteses CONCORRENTES, testadas em SQL
//                                contra a venda real. É o lastro da reunião.
//   4. LEITURAS                  o mesmo achado passa por três cabeças
//                                diferentes e rende três leituras diferentes.
//   5. ENTREGA                   o que o João pediu é respondido por quem ele
//                                escolheu (ou por quem tem o assunto).
//   6. DIREÇÃO                   a mesa diz ao João O QUE FAZER com o que
//                                descobriu, com dono, prazo e risco.
//   7. ROTINA                    a Val cobra o que ficou parado — inclusive
//                                pedido do João apodrecendo em aberto.
//
// As rodadas 5 e 6 nasceram em 15/09/2026, do recado dele: "ainda segue não me
// dando direcionamento, eu quero poder dar um tema, feedbacks e demandas gerais
// pra eles, agindo como um coordenador de equipe". A mesa investigava bem e
// terminava sem dizer nada — e ele não tinha por onde mandar. Ver src/direcao.ts.
//
// Cada etapa é gravada assim que termina. Se o Worker morrer no meio (reunião
// longa), o que já rodou fica no banco e aparece na sala — melhor uma reunião
// truncada e visível do que um all-or-nothing invisível.

import type { Env } from './aiproxy';
import { chamarAgente } from './aiproxy';
import { AGENTES, acharAgente, type Agente } from './agentes';
import { entregarRecados, registrarRecados, formatarRecadosParaPrompt } from './mesa';
import { lembrar, formatarMemoriaParaPrompt, gravarMemoria } from './memoria';
import {
  impressaoDigital, ultimasAtas, formatarNaoRepita, ultimasFalasDele, formatarNaoSeRepita,
  manchetesNovas, marcarManchetesVistas, pendenciasAbertas,
} from './historico';
import { buscarPedidosFutebolTravados } from './fontes/pedidosTravados';
import { buscarManchetesReais } from './fontes/noticiasFutebol';
import { buscarTendenciasGoogle } from './fontes/tendenciasGoogle';
import { buscarMundo, dossieDe, resumoDoMundo, type Mundo } from './web/mundo';
import { buscarVitrine, formatarVitrine, type Vitrine } from './web/vitrine';
import { formatarProcura } from './web/procura';
import { pautasVindasDoCorredor, marcarPautasAproveitadas } from './corredor';
import { PESSOAS } from './pessoas';
import { investigarMercado } from './investigacao';
import { montarCardapio, formatarCardapio, PRODUTOS_DA_CASA } from './mercado/cardapio';
import {
  montarMapaDeDemanda, formatarMapaDeDemanda, numerosDaRodada, numerosDeProcura,
} from './mercado/demanda';
import { fecharComLeitura, leiturasAnteriores, type Leitura } from './mercado/leitura';
import { medirLeiturasAnteriores, formatarPlacar } from './placar';
import {
  tesesVivas, podarTeses, movimentoDaRodada, formatarMovimento,
  type MovimentoDaTese,
} from './teses';
import {
  direcaoAberta, blocoDoCoordenador, impressaoDaDirecao, responderDemanda,
  registrarResposta, contarRodada,
  type DirecaoAberta, type EntregaDeDemanda,
} from './direcao';

export interface Etapa {
  rodada: string;
  ordem: number;
  chave: string;
  nome: string;
  ok: boolean;
  dados: unknown;
  fala: string;
}

export interface ResultadoReuniao {
  sessao: string;
  tema: string;
  quando: string;
  automatica: boolean;
  /**
   * 'completa' = as fontes (ou o João) trouxeram algo diferente da rodada
   * anterior, então há o que decidir. 'revisao' = nada mudou; a mesa não finge
   * uma decisão nova, só cobra o que ficou pendente — e o webhook NÃO dispara,
   * pra não encher o canal de reunião que não aconteceu.
   */
  modo: 'completa' | 'revisao';
  impressao: string;
  etapas: Etapa[];
  ata: Ata;
}

export interface Ata {
  resumo: string;
  resumo_curto: string;
  consenso: string[];
  divergencias: { entre: string; sobre: string; posicoes: string }[];
  acoes: { agente: string; acao: string; prazo?: string }[];
  placar_vendas: string;
  /** O que a mesa leu do mercado, com a ponte de produto. Substituiu `recomendacoes` em 22/09/2026. */
  leituras: Leitura[];
  /** O que aconteceu com cada tese nesta rodada — o fio que liga uma reunião à seguinte. */
  movimento_das_teses: MovimentoDaTese[];
  /** Números que passaram na conferência mas não batem com o medido. Transparência, não reprovação. */
  avisos: string[];
  /** O que o juiz barrou por ser genérico. Fica registrado: é calibragem, não vergonha. */
  reprovadas: { o_que: string; motivos: string[] }[];
  entregas: EntregaDeDemanda[];
  precisamos_de_voce: string;
}

// Quem entra com FATO, antes de qualquer opinião. São só dois porque são os
// dois que têm fonte externa própria: o olheiro (calendário, buscas, notícia)
// e o analista (venda real). O produtor tem fonte também, mas fala no fim —
// a cobrança dele precisa ver o que os outros disseram na rodada.
const COLETA = ['olheiro', 'analista'];

/** Quantos pedidos do João são respondidos por rodada. Mais que isto e a reunião não fecha no tempo. */
const MAX_ENTREGAS_POR_RODADA = 2;

/** Busca o dado real de um agente quando ele tem fonte automática. `null` = sem fonte automática. */
export interface FonteAutomatica {
  /** O que o agente vê. Pode já vir filtrado (ex.: manchete que ele nunca reportou). */
  dados: Record<string, unknown>;
  fontesComFalha: string[];
  /**
   * O que o MUNDO mostrou, antes de qualquer filtro nosso. É isto que entra na
   * impressão digital: se usássemos `dados`, o próprio dedupe de manchete
   * mudaria a impressão na rodada seguinte e faria toda alteração real render
   * duas reuniões completas em vez de uma. Achado no teste de fumaça.
   */
  bruto?: unknown;
}

export async function buscarFonteAutomatica(
  env: Env,
  chave: string,
  mundo?: Mundo,
  vitrine?: Vitrine,
): Promise<FonteAutomatica | null> {
  // O dossiê de internet aberta é o que o agente vê primeiro. Cada um recebe o
  // recorte dele (ver src/web/mundo.ts) — e não o mesmo JSON pra todos, que era
  // o que fazia a mesa concordar consigo mesma.
  const daWeb = mundo ? dossieDe(chave, mundo) : '';

  switch (chave) {
    case 'olheiro': {
      // Três fontes com ritmos diferentes, e é essa diferença que faz o
      // olheiro ter o que dizer: o calendário do radar (muda ~1x/dia), o
      // Google Trends (muda várias vezes ao dia) e a notícia por RSS, já
      // filtrada pro que ainda não foi reportado.
      const [g, n] = await Promise.all([
        buscarTendenciasGoogle(env),
        buscarManchetesReais(env),
      ]);
      const { novas, jaVistas } = await manchetesNovas(env, n.manchetes);
      return {
        dados: {
          de_onde_veio: 'internet aberta: globoesporte (calendário), Wikipédia (procura), Google Notícias, ge.globo (RSS), Google Trends',
          dossie_da_internet: daWeb,
          google_trends_de_futebol: g.ok ? g.termos.filter((t) => t.de_futebol) : [],
          manchetes_ge: novas,
          manchetes_ja_reportadas: jaVistas,
        },
        fontesComFalha: [
          ...(mundo?.falhas ?? []),
          ...(g.ok ? [] : [`google_trends: ${g.erro}`]),
          ...(n.ok ? [] : [`ge.globo: ${n.erro}`]),
        ],
        bruto: {
          manchetes: n.manchetes.map((m) => m.link).sort(),
          trends: g.ok ? g.termos.map((t) => t.termo).sort() : [],
          jogos: (mundo?.calendario.proximos ?? []).map((j) => `${j.mandante}x${j.visitante}${j.data}`).sort(),
        },
      };
    }
    case 'analista': {
      // A Rafa deixou de olhar a venda própria (18/09/2026, decisão do João:
      // "não precisamos do número de vendas"). A fonte dela agora é o mercado:
      // oferta, preço praticado e novidade nos catálogos de quem vende pro
      // mesmo público. Continua sendo o contrapeso numérico da mesa — só que
      // medindo o mundo em vez do retrovisor da casa.
      if (!vitrine) return null;
      return {
        dados: {
          de_onde_veio: 'catálogos públicos (Shopify /products.json) de COPA Football, Football Shirt Collective, Stussy e Kith',
          vitrine_do_mercado: formatarVitrine(vitrine),
          categorias: vitrine.categorias,
          novidades_45d: vitrine.novidades.length,
          temas_do_momento: vitrine.temasDoMomento,
        },
        fontesComFalha: vitrine.falhas,
      };
    }
    case 'criacao':
    case 'marketeiro': {
      // Antes a Nina lia um acervo pré-catalogado por outro app e o Caio não
      // tinha fonte externa nenhuma. Agora os dois vão à internet, cada um na
      // dele: ela em uniforme, design e cultura pop; ele em concorrência.
      if (!daWeb) return null;
      return {
        dados: {
          de_onde_veio: chave === 'criacao'
            ? 'internet aberta: Footy Headlines, Hypebeast, Dezeen e Wikipédia (cultura pop em alta)'
            : 'internet aberta: Google Notícias (licenciamento e lançamentos) e Wikipédia (procura)',
          dossie_da_internet: daWeb,
        },
        fontesComFalha: mundo?.falhas ?? [],
      };
    }
    case 'produtor': {
      const [fila, pendentes] = await Promise.all([
        buscarPedidosFutebolTravados(env),
        pendenciasAbertas(env),
      ]);
      return {
        dados: { pedidos: fila.pedidos, tarefas_combinadas: pendentes },
        fontesComFalha: fila.ok ? [] : [fila.erro || 'falha desconhecida'],
      };
    }
    default:
      return null;
  }
}

/**
 * Instrução do agente: a editada na tela, se houver, senão a padrão — com a
 * memória dele, o estado em que ele chegou e o que o João mandou colados.
 */
async function montarSystem(env: Env, ag: Agente, direcao?: DirecaoAberta): Promise<string> {
  const salvo = await env.DB.query('SELECT prompt FROM donos WHERE chave = ?', [ag.chave]);
  const base = String(salvo.rows[0]?.prompt || '') || ag.system;
  const [memorias, falasDele, est] = await Promise.all([
    lembrar(env, ag.chave),
    ultimasFalasDele(env, ag.chave),
    env.DB.query('SELECT humor, obsessao, o_que_me_trava FROM estado_agente WHERE chave = ?', [ag.chave]),
  ]);

  // Como a pessoa chegou. Sem isto ela renasce neutra a cada reunião, e gente
  // não renasce neutra — quem saiu irritado da última continua irritado.
  const e = est.rows[0];
  const comoCheguei = e
    ? `\n\n━━ COMO VOCÊ ESTÁ HOJE ━━\n` +
      `Você saiu da última rodada assim: ${e.humor || 'sem nada registrado'}.` +
      (e.obsessao ? ` O que não sai da sua cabeça: ${e.obsessao}.` : '') +
      (e.o_que_me_trava ? ` E continua te travando: ${e.o_que_me_trava}.` : '') +
      ` Isso é de duas horas atrás, não de outra vida: se ainda é verdade, fale como quem ainda está assim. ` +
      `Se passou, diga que passou.`
    : '';

  // O que o coordenador mandou vem DEPOIS da memória e do humor, por último no
  // prompt: é a última coisa que a pessoa lê antes de falar, como tem que ser.
  const doChefe = direcao ? blocoDoCoordenador(direcao) : '';

  return base + comoCheguei + formatarMemoriaParaPrompt(memorias) + formatarNaoSeRepita(falasDele) + doChefe;
}

/** Uma frase curta pra boca do sprite na salinha. Cada agente fala do jeito dele. */
export function resumirFala(chave: string, ok: boolean, dados: any): string {
  if (!ok) return 'travei aqui: ' + String(dados?.erro || 'falha').slice(0, 70);
  const primeiro = (v: unknown) => (Array.isArray(v) ? v[0] : v);
  // `recado` é a fala de gente que todo agente devolve — é ela que vai pro
  // balão do sprite e pra legenda. O resto abaixo é só rede de proteção.
  if (dados?.recado) return String(dados.recado);
  switch (chave) {
    case 'olheiro': return primeiro(dados?.alertas)?.o_que || 'nada chegando que valha a pena';
    case 'analista': return dados?.produto_da_semana?.nome
      ? `${dados.produto_da_semana.nome}: ${dados.produto_da_semana.un_7d ?? '?'} un na semana`
      : 'não consegui ler a venda';
    case 'criacao': return dados?.o_que_eu_faria || dados?.o_que_o_mercado_diz_do_gosto || 'sem direção nova nesta rodada';
    case 'marketeiro': return dados?.aposta_que_eu_faria || dados?.espaco_vazio || 'meu quadro não mudou';
    case 'produtor': return primeiro(dados?.hoje)?.o_que || dados?.fila?.resumo || 'rotina em dia';
    default: return 'falei.';
  }
}

interface ContextoFala {
  sessao: string;
  rodada: string;
  ordem: number;
  entradaBase: string;
  contexto?: string;
  instrucaoExtra?: string;
  direcao?: DirecaoAberta;
}

/** Uma fala: monta prompt, chama o AI Proxy, grava recado/memória/etapa. Nunca lança. */
async function falar(env: Env, ag: Agente, ctx: ContextoFala): Promise<Etapa> {
  let system: string;
  try {
    system = await montarSystem(env, ag, ctx.direcao);
  } catch {
    system = ag.system;
  }

  const pendentes = await entregarRecados(env, ctx.sessao, ag.chave);
  let corpo = ag.user(ctx.entradaBase) + formatarRecadosParaPrompt(pendentes);
  if (ctx.contexto) corpo += `\n\nO QUE A MESA JÁ DISSE NESTA REUNIÃO:\n${ctx.contexto}`;
  if (ctx.instrucaoExtra) corpo += `\n\n${ctx.instrucaoExtra}`;

  const r = await chamarAgente(env, system, corpo, undefined, ag.temperatura);
  const dados = r.ok ? r.dados : { erro: r.erro };
  const fala = resumirFala(ag.chave, r.ok, dados);

  try {
    if (r.ok) {
      const d = r.dados as any;
      await registrarRecados(env, ctx.sessao, ag.chave, (d?.recados_para || []).slice(0, 6));
      if (d?.aprendi) await gravarMemoria(env, ag.chave, 'aprendi', d.aprendi, ctx.sessao);
    }
    await env.DB.exec(
      'INSERT INTO reunioes (sessao, etapa, chave, dados, criado_em) VALUES (?, ?, ?, ?, ?)',
      [ctx.sessao, ctx.ordem, ag.chave, JSON.stringify(dados).slice(0, 12000), new Date().toISOString()],
    );
    await env.DB.exec(
      'INSERT INTO falas (sessao, ordem, rodada, chave, texto, criado_em) VALUES (?, ?, ?, ?, ?, ?)',
      [ctx.sessao, ctx.ordem, ctx.rodada, ag.chave, String(fala).slice(0, 300), new Date().toISOString()],
    );

    // O estado interno da pessoa atravessa a reunião e chega na próxima.
    if (r.ok) {
      const d = r.dados as any;
      const humor = String(d?.estado?.humor || '').slice(0, 300);
      const obsessao = String(d?.estado?.nao_sai_da_cabeca || '').slice(0, 300);
      const trouxe = String(d?.trouxe_por_conta_propria || '').slice(0, 400);
      const trava = String(d?.o_que_me_trava || '').slice(0, 400);
      if (humor || obsessao || trouxe || trava) {
        await env.DB.exec(
          `INSERT INTO estado_agente (chave, humor, obsessao, trouxe_por_conta_propria, o_que_me_trava, atualizado_em)
           VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(chave) DO UPDATE SET humor=excluded.humor, obsessao=excluded.obsessao,
             trouxe_por_conta_propria=excluded.trouxe_por_conta_propria,
             o_que_me_trava=excluded.o_que_me_trava, atualizado_em=excluded.atualizado_em`,
          [ag.chave, humor, obsessao, trouxe, trava, new Date().toISOString()],
        );
      }
    }
  } catch { /* gravação é best-effort: uma reunião não cai por causa do log dela */ }

  return { rodada: ctx.rodada, ordem: ctx.ordem, chave: ag.chave, nome: ag.nome, ok: r.ok, dados, fala };
}

/** As N primeiras frases de um texto — a rede de proteção do resumo curto. */
export function primeirasFrases(texto: string, n: number): string {
  const frases = String(texto || '').split(/(?<=[.!?])\s+/).filter(Boolean);
  return frases.slice(0, n).join(' ').trim() || String(texto || '').slice(0, 220);
}

function recortar(dados: unknown, max = 1800): string {
  const s = JSON.stringify(dados);
  return s.length > max ? s.slice(0, max) + '…' : s;
}

function contextoDe(etapas: Etapa[]): string {
  return etapas.map((e) => `[${e.nome}] ${recortar(e.dados)}`).join('\n\n');
}

export async function rodarReuniao(
  env: Env,
  opcoes: { tema?: string; sessao?: string; automatica?: boolean },
): Promise<ResultadoReuniao> {
  const quando = new Date().toISOString();
  const automatica = !!opcoes.automatica;
  // O id da sessão precisa de SEGUNDO + sufixo aleatório, não só até o minuto:
  // duas reuniões no mesmo minuto (dois cliques em "Convocar", ou um disparo
  // manual junto do cron) caíam na mesma sessão, e como `atas` tem o sessao
  // como chave primária a segunda apagava a ata da primeira e as falas das
  // duas se misturavam na reencenação. Achado no teste de fumaça.
  const carimbo = quando.slice(0, 19).replace(/[-:T]/g, '');
  const sufixo = Math.random().toString(36).slice(2, 6);
  const sessao = (opcoes.sessao || '').slice(0, 80) || `${automatica ? 'auto' : 'mesa'}-${carimbo}-${sufixo}`;
  const etapas: Etapa[] = [];
  let ordem = 0;

  // ── 0. O QUE O JOÃO MANDOU, E AS FONTES ─────────────────────────────────
  //
  // Busca o dado bruto ANTES de gastar qualquer chamada de IA e tira a
  // impressão digital dele. Se for igual à da rodada anterior, não há decisão
  // nova a tomar — e uma reunião completa aqui só produziria a mesma ata com
  // outras palavras.
  //
  // A direção do coordenador entra NA impressão digital de propósito: pauta,
  // feedback ou pedido novo dele é motivo pra reunir de verdade, mesmo que o
  // mundo lá fora não tenha mexido um milímetro. Ele é o único que consegue
  // convocar uma reunião só falando.
  // O cardápio (o que a casa tem na mão) e o placar (o que deu a recomendação
  // anterior) vêm antes de qualquer chamada de IA: são eles que impedem a mesa
  // de falar no vácuo, que era a queixa do João em 16/09.
  // O mundo primeiro: ele traz o calendário, que o cardápio reaproveita em vez
  // de varrer o globoesporte de novo.
  const [mundo, vitrine] = await Promise.all([buscarMundo(), buscarVitrine()]);
  const cardapio = montarCardapio(mundo, vitrine);
  // O mapa de demanda é o corte transversal dos catálogos: é ele que responde
  // "o que o público masculino tem procurado" em categoria e preço, que é o
  // que o João pediu em 22/09. Ver src/mercado/demanda.ts.
  const mapa = montarMapaDeDemanda(vitrine, mundo);

  // A poda vem ANTES de ler as teses: a mesa carrega no máximo três, e o que
  // ninguém investiga há uma semana sai de cena sozinho.
  await podarTeses(env);
  const [direcao, placarBruto, teses, leiturasDeAntes] = await Promise.all([
    direcaoAberta(env),
    medirLeiturasAnteriores(env, mapa),
    tesesVivas(env),
    leiturasAnteriores(env),
  ]);
  const placar = formatarPlacar(placarBruto);
  const fontes: Record<string, FonteAutomatica | null> = {};
  await Promise.all(COLETA.map(async (chave) => { fontes[chave] = await buscarFonteAutomatica(env, chave, mundo, vitrine); }));
  const impressao = impressaoDigital({
    fontes: Object.fromEntries(Object.entries(fontes).map(([k, v]) => [k, v?.bruto ?? v?.dados ?? null])),
    direcao: impressaoDaDirecao(direcao),
    // O mundo entra pelo que ele tem de mais estável: o que a concorrência
    // lançou e que jogos vêm. Se nada disso mudou, não houve dia novo lá fora.
    mundo: [
      ...mundo.noticias.concorrencia.map((i) => i.titulo),
      ...mundo.calendario.proximos.map((j) => `${j.mandante}x${j.visitante}`),
      ...vitrine.novidades.slice(0, 20).map((p) => p.titulo),
    ].sort().join('|'),
  });

  const anteriores = await ultimasAtas(env, 6);
  const naoRepita = formatarNaoRepita(anteriores);
  const semDadoNovo = !!anteriores[0] && anteriores[0].impressao === impressao;
  const modo: 'completa' | 'revisao' = semDadoNovo && !opcoes.tema ? 'revisao' : 'completa';

  if (modo === 'revisao') {
    return await rodarRevisao(env, { sessao, quando, automatica, impressao, anteriores, fontes, direcao });
  }

  // ── 0.5. A PRESTAÇÃO DE CONTAS abre a reunião ───────────────────────────
  //
  // Antes de qualquer coisa nova, o que deu a leitura da véspera. É a Rafa
  // quem diz, porque é número — e é a primeira fala da sala de propósito: uma
  // mesa que cobra a si mesma antes de opinar de novo é uma mesa diferente.
  if (placarBruto.houve) {
    ordem += 1;
    const rafaContas = acharAgente('analista')!;
    // A primeira família comparável da leitura anterior: é a frase mais curta
    // que já diz se a tese de ontem engrossou ou esvaziou.
    const comparavel = placarBruto.cobradas
      .flatMap((c) => c.familias)
      .find((f) => f.agora !== null && f.entao !== null);
    const falaPlacar = comparavel
      ? `Da última: ${comparavel.familia} estava em ${comparavel.entao}, hoje está em ${comparavel.agora}` +
        ` (${comparavel.agora! - comparavel.entao! >= 0 ? '+' : ''}${comparavel.agora! - comparavel.entao!})`
      : placarBruto.cobradas.length
        ? 'Da última leitura não sobrou número comparável no mapa de hoje.'
        : 'Não deu pra medir o que a gente leu da última vez.';
    etapas.push({
      rodada: 'contas', ordem, chave: rafaContas.chave, nome: rafaContas.nome,
      ok: true, dados: placarBruto, fala: falaPlacar.slice(0, 300),
    });
    try {
      await env.DB.exec('INSERT INTO falas (sessao, ordem, rodada, chave, texto, criado_em) VALUES (?, ?, ?, ?, ?, ?)',
        [sessao, ordem, 'contas', rafaContas.chave, falaPlacar.slice(0, 300), new Date().toISOString()]);
      await env.DB.exec('INSERT INTO reunioes (sessao, etapa, chave, dados, criado_em) VALUES (?, ?, ?, ?, ?)',
        [sessao, ordem, rafaContas.chave, JSON.stringify(placarBruto).slice(0, 12000), new Date().toISOString()]);
    } catch { /* registro auxiliar */ }
  }

  // ── 1. OS FATOS — olheiro e analista, em paralelo ───────────────────────
  const coleta = await Promise.all(
    COLETA.map(async (chave) => {
      const ag = acharAgente(chave)!;
      const fonte = fontes[chave];
      const entradaBase = fonte ? JSON.stringify(fonte.dados, null, 2) : ag.exemplo;
      const avisoFonte = fonte?.fontesComFalha.length
        ? `\n\n(Fontes com falha nesta chamada: ${fonte.fontesComFalha.join('; ')} — trabalhe com o que sobrou e diga o que faltou.)`
        : '';
      return falar(env, ag, {
        sessao, rodada: 'fatos', ordem: ++ordem, entradaBase, direcao,
        instrucaoExtra: avisoFonte.trim() || undefined,
      });
    }),
  );
  etapas.push(...coleta);

  // Manchete reportada não volta: a partir daqui ela é passado.
  try {
    const vistas = fontes['olheiro']?.dados?.manchetes as { link: string }[] | undefined;
    if (vistas?.length) await marcarManchetesVistas(env, vistas);
  } catch { /* dedupe é auxiliar */ }

  // ── 2. O QUE VEIO DO CORREDOR E DA CABEÇA DE CADA UM ────────────────────
  //
  // Duas fontes de pauta que não vêm de API nenhuma: o que rendeu nas conversas
  // de corredor, e o que cada um reparou por conta própria na última rodada.
  // É aqui que a mesa deixa de ser um relatório e vira uma equipe — o assunto
  // pode nascer de alguém ter reparado em algo, não só de um dado ter mudado.
  const [doCorredor, trouxeram] = await Promise.all([
    pautasVindasDoCorredor(env),
    env.DB.query('SELECT chave, trouxe_por_conta_propria, o_que_me_trava FROM estado_agente WHERE trouxe_por_conta_propria != \'\' OR o_que_me_trava != \'\'', []),
  ]);

  const vozesDaCasa = [
    doCorredor.length
      ? 'DO CORREDOR (conversa solta entre dois deles que rendeu algo):\n' +
        doCorredor.map((c) => `- ${c.quem} conversaram e saiu isto: ${c.o_que}`).join('\n')
      : '',
    trouxeram.rows.length
      ? 'O QUE CADA UM TROUXE POR CONTA PRÓPRIA na última rodada:\n' +
        trouxeram.rows.map((r) => {
          const nome = PESSOAS[String(r.chave)]?.nome || r.chave;
          const partes = [
            r.trouxe_por_conta_propria ? `reparou: ${r.trouxe_por_conta_propria}` : '',
            r.o_que_me_trava ? `está travado em: ${r.o_que_me_trava}` : '',
          ].filter(Boolean).join(' | ');
          return `- ${nome} ${partes}`;
        }).join('\n')
      : '',
  ].filter(Boolean).join('\n\n');

  if (doCorredor.length) {
    try { await marcarPautasAproveitadas(env, doCorredor.map((c) => c.id)); } catch { /* auxiliar */ }
  }

  // Tudo que a mesa tem na mão antes de começar a pensar.
  const dossie = `O MUNDO LÁ FORA HOJE (internet aberta, consultada agora):\n${resumoDoMundo(mundo)}\n\n` +
    contextoDe(coleta) +
    (vozesDaCasa ? `\n\n${vozesDaCasa}` : '') +
    `\n\n${formatarMapaDeDemanda(mapa)}` +
    `\n\n${formatarCardapio(cardapio)}` +
    `\n\n${placar}`;

  // ── 3. A INVESTIGAÇÃO ───────────────────────────────────────────────────
  //
  // A mesa levanta de 3 a 4 perguntas CONCORRENTES sobre como o mercado se
  // comporta, escreve o próprio SQL pra testar cada uma contra a venda real, e
  // conclui — inclusive concluindo que estava errada. É o lastro do que vem
  // depois: sem número aqui, a direção da rodada 6 vira chute.
  const blocoDirecaoInvestigacao = direcao.tema || direcao.demandas.length
    ? 'O QUE O JOÃO, QUE COORDENA A ÁREA, PEDIU — as perguntas de hoje têm que servir a isto:\n' +
      (direcao.tema ? `• PAUTA DA VEZ: ${direcao.tema.texto}\n` : '') +
      direcao.demandas.map((d) => `• PEDIDO EM ABERTO: ${d.texto}`).join('\n') +
      '\nUma pergunta que ajuda a responder o que ele pediu vale mais que uma pergunta interessante e solta.\n\n'
    : '';

  // O que torna a pergunta RELEVANTE (a segunda queixa dele): ela tem que
  // poder mudar uma decisão sobre um clube e um produto que existem. Pergunta
  // sobre um mercado abstrato rende ata bonita e nenhuma escolha.
  const blocoCardapioInvestigacao =
    formatarMapaDeDemanda(mapa) +
    '\n\n' + formatarCardapio(cardapio) +
    '\n\nA PERGUNTA DE HOJE TEM QUE SER SOBRE O QUE O MERCADO MASCULINO ESTÁ PEDINDO — categoria, preço, ' +
    'linguagem —, não sobre qual clube estampar. O João faz o recorte de futebol depois, com a leitura na ' +
    'mão; o que ele não tem tempo de fazer é ler o mercado. Se a resposta da sua pergunta não mudaria nada ' +
    'sobre nenhuma família de produto medida acima, ela é curiosidade — troque por outra.\n\n';

  const inv = await investigarMercado(env, {
    sessao, contexto: dossie, naoRepita, mundo, vitrine,
    direcao: blocoDirecaoInvestigacao + blocoCardapioInvestigacao,
  });

  const tema = String(opcoes.tema || '').trim()
    || (direcao.tema ? direcao.tema.texto : '')
    || (inv.perguntas[0]?.pergunta ? `Mercado: ${inv.perguntas[0].pergunta}` : 'Rodada sem pergunta formulada');

  // Cada teste vira uma fala da Rafa na sala — é ela quem escreveu o SQL.
  const rafa = acharAgente('analista')!;
  for (const t of inv.testes) {
    ordem += 1;
    const simbolo = t.veredito === 'confirma' ? '✔' : t.veredito === 'refuta' ? '✖' : '…';
    const fala = `${simbolo} ${t.pergunta} — ${t.o_que_o_numero_diz}`.slice(0, 300);
    etapas.push({ rodada: 'teste', ordem, chave: rafa.chave, nome: rafa.nome, ok: t.veredito !== 'falhou', dados: t, fala });
    try {
      await env.DB.exec('INSERT INTO falas (sessao, ordem, rodada, chave, texto, criado_em) VALUES (?, ?, ?, ?, ?, ?)',
        [sessao, ordem, 'teste', rafa.chave, fala, new Date().toISOString()]);
      await env.DB.exec('INSERT INTO reunioes (sessao, etapa, chave, dados, criado_em) VALUES (?, ?, ?, ?, ?)',
        [sessao, ordem, rafa.chave, JSON.stringify(t).slice(0, 12000), new Date().toISOString()]);
    } catch { /* registro auxiliar */ }
  }

  // Quando TODOS os testes falharam, a reunião não tem lastro nenhum — e o que
  // o João precisa ver não é "não aprendemos nada", é o erro técnico que
  // impediu de aprender. Foi exatamente assim que o bug do validador de SQL
  // passou dias invisível: a ata dizia "faltou acesso aos dados" e ninguém
  // tinha como saber que a consulta era recusada aqui dentro.
  const testesQueFalharam = inv.testes.filter((t) => t.veredito === 'falhou');
  const cegaPorFalha = inv.testes.length > 0 && testesQueFalharam.length === inv.testes.length;
  const motivoDaCegueira = cegaPorFalha
    ? `A INVESTIGAÇÃO desta rodada não rodou: ${testesQueFalharam.length} de ${inv.testes.length} consultas falharam. ` +
      `Erro técnico: ${testesQueFalharam.map((t) => t.o_que_o_numero_diz).join(' | ').slice(0, 500)}. ` +
      `ISSO NÃO DEIXA A MESA SEM NÚMERO: a venda da semana e o cardápio de clubes e produtos continuam na sua ` +
      `frente, e é com eles que você decide hoje. Diga que a investigação falhou, diga o erro, e siga usando o ` +
      `número que você TEM — parar a casa por causa de uma consulta que não escreveu é a pior das saídas.`
    : '';

  // O que cada tese andou nesta rodada. Comparação pura entre o estado de
  // antes e o resultado da investigação — sem chamada de IA. É isto que faz a
  // reunião de amanhã continuar de onde esta parou, em vez de recomeçar.
  const movimento = movimentoDaRodada(teses, inv);

  const achado =
    `PERGUNTAS TESTADAS E O QUE O NÚMERO RESPONDEU:\n` +
    inv.testes.map((t) => `- [${t.veredito}] ${t.pergunta}\n  ${t.o_que_o_numero_diz}`).join('\n') +
    `\n\nLEITURA DA RODADA: ${inv.leitura}` +
    (movimento.length ? `\n\nO QUE AS TESES DA MESA ANDARAM HOJE:\n${formatarMovimento(movimento)}` : '') +
    (inv.caiuPorTerra.length ? `\n\nCAIU POR TERRA: ${inv.caiuPorTerra.map((c) => c.afirmacao).join('; ')}` : '') +
    (motivoDaCegueira ? `\n\n⚠ ${motivoDaCegueira}` : '');

  // ── 4. AS LENTES — cada um lê o mesmo resultado do seu jeito ────────────
  //
  // Aqui é onde o time deixa de ser um só cérebro: a mesma conclusão passa
  // por três cabeças diferentes e rende três leituras diferentes.
  const lentes = await Promise.all(
    (['olheiro', 'criacao', 'marketeiro'] as const).map((chave) => {
      const ag = acharAgente(chave)!;
      const foco: Record<string, string> = {
        olheiro: 'Você lê isto como olheiro: o que este comportamento de mercado te faz olhar diferente daqui pra frente? Que sinal você vai passar a vigiar que não vigiava antes?',
        criacao: 'Você lê isto como criação: o que o mercado está dizendo sobre ESTÉTICA e sobre o que o torcedor quer vestir — e, por causa disso, que direção criativa você defende agora? Concreta: clube, tratamento, produto.',
        marketeiro: 'Você lê isto como posicionamento: o que isso diz sobre onde a Gocase está e onde ela deveria estar neste mercado — e qual aposta você faria com isso?',
      };
      const meuDossie = dossieDe(chave, mundo);
      return falar(env, ag, {
        sessao, rodada: 'leitura', ordem: ++ordem,
        entradaBase: achado + (meuDossie ? `\n\n━━ O QUE SÓ VOCÊ ESTÁ VENDO HOJE ━━\n${meuDossie}` : ''),
        contexto: dossie,
        direcao,
        instrucaoExtra:
          foco[chave] + ' Duas ou três frases, no seu jeito de falar. ' +
          'Se o resultado não muda nada no seu pedaço, diga isso — é resposta honesta e vale mais que ' +
          'concordar por educação, e nesse caso não force uma direção que o dado não sustenta.',
      });
    }),
  );
  etapas.push(...lentes);

  const textoLentes = lentes.map((l) => `${l.nome}: ${l.fala}`).join('\n');

  // ── 5. A ENTREGA — o que o João pediu é respondido ──────────────────────
  //
  // Os pedidos mais antigos primeiro: demanda que fica rodando sem resposta é
  // exatamente o que faz alguém parar de pedir.
  const demandasDaVez = [...direcao.demandas]
    .sort((a, b) => a.id - b.id)
    .slice(0, MAX_ENTREGAS_POR_RODADA);

  const entregas: EntregaDeDemanda[] = [];
  for (const demanda of demandasDaVez) {
    const e = await responderDemanda(env, demanda, {
      contexto: dossie,
      achado,
      systemDoAgente: (chave) => montarSystem(env, acharAgente(chave)!, direcao),
    });
    entregas.push(e);
    ordem += 1;
    const fala = (e.recado || e.entrega).slice(0, 300);
    const ag = acharAgente(e.chave)!;
    etapas.push({ rodada: 'entrega', ordem, chave: e.chave, nome: ag.nome, ok: e.pronta, dados: e, fala });
    try {
      await registrarResposta(env, demanda.id, e.entrega + (e.o_que_falta ? `\n\nFalta: ${e.o_que_falta}` : ''));
      await env.DB.exec('INSERT INTO falas (sessao, ordem, rodada, chave, texto, criado_em) VALUES (?, ?, ?, ?, ?, ?)',
        [sessao, ordem, 'entrega', e.chave, fala, new Date().toISOString()]);
      await env.DB.exec('INSERT INTO reunioes (sessao, etapa, chave, dados, criado_em) VALUES (?, ?, ?, ?, ?)',
        [sessao, ordem, e.chave, JSON.stringify(e).slice(0, 12000), new Date().toISOString()]);
    } catch { /* registro auxiliar */ }
  }
  // Os pedidos que não couberam nesta rodada envelhecem do mesmo jeito — é o
  // contador que faz a Val escalar quando algo está parado há muito tempo.
  try {
    await contarRodada(env, direcao.demandas.filter((d) => !demandasDaVez.includes(d)).map((d) => d.id));
    if (direcao.tema) await contarRodada(env, [direcao.tema.id]);
  } catch { /* auxiliar */ }

  // ── 6. A LEITURA — o que o mercado está pedindo, e como cabe na casa ────
  //
  // Virou leitura de mercado em 22/09/2026 (era "a direção": clube, produto e
  // prazo). O material da rodada é o que separa "não há o que ler" de esquiva:
  // enquanto houver família se movendo, palavra circulando ou procura mudando,
  // a mesa tem o que ler — e o fechamento é cobrado por isso.
  const linhasDeMaterial = [
    // O que o mercado lançou, por família — a matéria-prima da leitura.
    ...mapa.familias.filter((f) => f.novos_45d >= 3).slice(0, 4).map((f) =>
      `${f.familia}: ${f.novos_45d} lançamentos em 45d (${f.share_lancamentos_pct}% do que o mercado lançou), ` +
      `preço médio ${f.preco_medio}` + (f.na_casa.length ? ` — a casa faz ${f.na_casa.join('/')}` : ' — a casa não faz')),
    ...mapa.palavras.filter((p) => p.onde === 'dois_lados').slice(0, 3).map((p) =>
      `"${p.palavra}" aparece em ${p.nos_lancamentos} lançamentos E em ${p.fora_da_prateleira} menções fora da prateleira`),
    ...mundo.calendario.proximos.slice(0, 4).map((j) =>
      `${j.mandante} x ${j.visitante} em ${j.data} (daqui a ${j.em_dias} dias)${j.classico ? ' — CLÁSSICO' : ''}`),
    ...mundo.procura.clubes.filter((c) => (c.variacao_pct ?? 0) >= 15)
      .map((c) => `procura por ${c.clube} ${c.variacao_pct! > 0 ? '+' : ''}${c.variacao_pct}% em 14 dias`),
    ...mundo.noticias.concorrencia.slice(0, 3).map((i) => `a concorrência lançou: ${i.titulo.slice(0, 110)}`),
    ...mundo.noticias.uniformes.slice(0, 2).map((i) => `camisa nova: ${i.titulo.slice(0, 110)}`),
    ...cardapio.clubes.filter((c) => c.procura_14d > 0).slice(0, 3)
      .map((c) => `${c.clube}: ${c.procura_14d} leituras em 14d${c.variacao_pct === null ? '' : ` (${c.variacao_pct > 0 ? '+' : ''}${c.variacao_pct}%)`}`),
    // A oferta do mercado: categoria com preço e novidade. Mesmo que tudo o
    // mais falhe, isto é número de mercado com nome — suficiente pra sustentar
    // uma recomendação.
    ...vitrine.categorias.slice(0, 3)
      .map((c) => `${c.tipo}: ${c.novos_45d} lançamentos em 45d, preço médio ${c.preco_medio}`),
  ];

  const fecho = await fecharComLeitura(env, {
    tema, achado, lentes: textoLentes, entregas, naoRepita, direcao, mapa, placar, teses,
    procura: formatarProcura(mundo.procura),
    material: { temMaterial: linhasDeMaterial.length >= 2, linhas: linhasDeMaterial.slice(0, 10) },
    juiz: {
      familias: mapa.familias.map((f) => f.familia),
      palavras: mapa.palavras.map((p) => p.palavra),
      produtosDaCasa: PRODUTOS_DA_CASA,
      numeros: numerosDaRodada(mapa, mundo),
      numerosDeProcura: numerosDeProcura(mundo),
      anteriores: leiturasDeAntes,
    },
  });

  if (fecho.leituras.length || fecho.se_eu_fosse_voce) {
    ordem += 1;
    const caio = acharAgente('marketeiro')!;
    const falaFecho = (fecho.se_eu_fosse_voce || fecho.leituras[0]?.o_que_o_mercado_pede || '').slice(0, 300);
    etapas.push({ rodada: 'direcao', ordem, chave: caio.chave, nome: caio.nome, ok: true, dados: fecho, fala: falaFecho });
    try {
      await env.DB.exec('INSERT INTO falas (sessao, ordem, rodada, chave, texto, criado_em) VALUES (?, ?, ?, ?, ?, ?)',
        [sessao, ordem, 'direcao', caio.chave, falaFecho, new Date().toISOString()]);
      await env.DB.exec('INSERT INTO reunioes (sessao, etapa, chave, dados, criado_em) VALUES (?, ?, ?, ?, ?)',
        [sessao, ordem, caio.chave, JSON.stringify(fecho).slice(0, 12000), new Date().toISOString()]);
    } catch { /* registro auxiliar */ }
  }

  // ── 7. A ROTINA — a Val cobra o que ficou parado ────────────────────────
  const produtor = acharAgente('produtor')!;
  const fonteProdutor = await buscarFonteAutomatica(env, 'produtor', mundo, vitrine);
  const etapaProdutor = await falar(env, produtor, {
    sessao, rodada: 'rotina', ordem: ++ordem,
    entradaBase: JSON.stringify(fonteProdutor?.dados || {}, null, 2),
    contexto: achado,
    direcao,
    instrucaoExtra:
      'A mesa fechou esta rodada com o que está abaixo. Sua lista de hoje serve pra fazer isso ANDAR — e pra ' +
      'cobrar o que já estava combinado antes.\n\n' +
      (fecho.leituras.length
        ? 'O QUE A MESA LEU DO MERCADO AGORA:\n' +
          fecho.leituras.map((l) =>
            `- ${l.o_que_o_mercado_pede} (confiança ${l.confianca})\n  como cabe na casa: ${l.como_cabe}`).join('\n')
        : 'A mesa não entregou leitura nenhuma nesta rodada.') +
      (entregas.length
        ? '\n\nO QUE A MESA ENTREGOU DO QUE O JOÃO PEDIU:\n' +
          entregas.map((e) => `- ${e.nome}: ${e.pronta ? 'entregue' : 'incompleto'} — ${e.entrega.slice(0, 200)}`).join('\n')
        : '') +
      (direcao.demandas.length
        ? '\n\nPEDIDOS DO JOÃO AINDA EM ABERTO (se algum está há 3 rodadas ou mais, escale com todas as letras):\n' +
          direcao.demandas.map((d) => `- [#${d.id}] ${d.texto} (${d.rodadas} rodadas, prazo: ${d.prazo || 'sem prazo'})`).join('\n')
        : ''),
  });
  etapas.push(etapaProdutor);

  try {
    const hoje = (etapaProdutor.dados as any)?.hoje;
    if (Array.isArray(hoje)) {
      for (const item of hoje.slice(0, 6)) {
        const alvo = acharAgente(String(item?.quem || ''));
        if (!alvo || !item?.o_que) continue;
        await gravarMemoria(env, alvo.chave, 'cobranca', [String(item.o_que)], sessao);
      }
    }
  } catch { /* cobrança é o ciclo de aprendizado */ }

  // ── A ATA ───────────────────────────────────────────────────────────────
  //
  // Os campos antigos continuam com o sentido que ganharam na virada de
  // inteligência de mercado (consenso = o que passamos a acreditar;
  // divergências = o que caiu por terra), e os três novos são a parte que
  // faltava: o que a mesa recomenda, o que ela entregou do que foi pedido, e o
  // que ela precisa do João.
  const resumoCurto = fecho.se_eu_fosse_voce
    || (cegaPorFalha ? motivoDaCegueira : '')
    || primeirasFrases(inv.leitura, 2);

  // A leitura vai por inteiro no resumo: é a entrega, não um acessório dela.
  const textoDasLeituras = fecho.leituras.map((l) =>
    `O QUE O MERCADO PEDE: ${l.o_que_o_mercado_pede}\n` +
    `EVIDÊNCIA (${l.confianca}): ${l.evidencia}\n` +
    `COMO CABE NOS NOSSOS PRODUTOS: ${l.como_cabe}\n` +
    `O QUE CONFIRMA OU DERRUBA AMANHÃ: ${l.o_que_confirma}`,
  ).join('\n\n');

  const ata: Ata = {
    resumo: [
      fecho.se_eu_fosse_voce ? `Se eu fosse você: ${fecho.se_eu_fosse_voce}` : '',
      textoDasLeituras,
      movimento.length ? `AS TESES DA MESA HOJE:\n${formatarMovimento(movimento)}` : '',
      placarBruto.houve ? placar.split('\nATENÇÃO AO LER ISTO:')[0].trim() : '',
      inv.leitura,
      motivoDaCegueira,
      textoLentes,
    ].filter(Boolean).join('\n\n'),
    resumo_curto: resumoCurto,
    consenso: inv.passamosAAcreditar.map((c) => `${c.afirmacao} — ${c.evidencia}`),
    divergencias: inv.caiuPorTerra.map((c) => ({
      entre: 'o que a mesa achava × o que o número mostrou',
      sobre: c.afirmacao,
      posicoes: c.por_que,
    })),
    acoes: [
      // A leitura não manda ninguém fazer nada — quem decide o que vira
      // trabalho é o João. O que entra como ação é o que a mesa se comprometeu
      // a medir na próxima rodada.
      ...fecho.leituras.filter((l) => l.o_que_confirma).map((l) => ({
        agente: 'analista', acao: `medir na próxima rodada: ${l.o_que_confirma}`,
      })),
      ...inv.emAberto.map((x) => ({ agente: 'analista', acao: `testar de outro jeito: ${x}` })),
      ...(Array.isArray((etapaProdutor.dados as any)?.hoje) ? (etapaProdutor.dados as any).hoje.slice(0, 4) : [])
        .filter((h: any) => h?.quem && h?.o_que).map((h: any) => ({ agente: String(h.quem), acao: String(h.o_que) })),
    ],
    placar_vendas: cegaPorFalha
      ? 'sem medição nesta rodada — nenhuma consulta rodou'
      : inv.testes.filter((t) => t.veredito === 'refuta').length
        ? `${inv.testes.filter((t) => t.veredito === 'refuta').length} de ${inv.testes.length} hipóteses caíram no teste`
        : `${inv.testes.filter((t) => t.veredito === 'confirma').length} de ${inv.testes.length} hipóteses confirmadas`,
    leituras: fecho.leituras,
    movimento_das_teses: movimento,
    avisos: fecho.avisos,
    reprovadas: fecho.reprovadas,
    entregas,
    precisamos_de_voce: fecho.precisamos_de_voce,
  };

  try {
    await env.DB.exec(
      `INSERT INTO atas (sessao, tema, quando, automatica, resumo, resumo_curto, consenso, divergencias, acoes, placar_vendas, webhook_status, impressao, modo, entregas, precisamos_de_voce, reprovadas, leituras, movimento_teses, avisos)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(sessao) DO UPDATE SET tema=excluded.tema, resumo=excluded.resumo,
         resumo_curto=excluded.resumo_curto, consenso=excluded.consenso,
         divergencias=excluded.divergencias, acoes=excluded.acoes, placar_vendas=excluded.placar_vendas,
         impressao=excluded.impressao, modo=excluded.modo,
         entregas=excluded.entregas, precisamos_de_voce=excluded.precisamos_de_voce,
         reprovadas=excluded.reprovadas, leituras=excluded.leituras,
         movimento_teses=excluded.movimento_teses, avisos=excluded.avisos`,
      [sessao, tema, quando, automatica ? 1 : 0, ata.resumo, ata.resumo_curto, JSON.stringify(ata.consenso),
       JSON.stringify(ata.divergencias), JSON.stringify(ata.acoes), ata.placar_vendas, 'pendente',
       impressao, 'completa', JSON.stringify(ata.entregas),
       ata.precisamos_de_voce, JSON.stringify(ata.reprovadas), JSON.stringify(ata.leituras),
       JSON.stringify(ata.movimento_das_teses), JSON.stringify(ata.avisos)],
    );
  } catch { /* a ata em memória segue válida pro webhook */ }

  return { sessao, tema, quando, automatica, modo: 'completa', impressao, etapas, ata };
}

/**
 * Rodada de REVISÃO: nem as fontes nem o João trouxeram nada diferente da
 * reunião anterior. Não há decisão nova a tomar, e forçar uma produziria só a
 * mesma ata reescrita — que foi o que entupiu o fim de semana do João.
 *
 * O que acontece aqui: UMA chamada de IA, a Val cobrando o que ficou pendente,
 * incluindo o que o João pediu e ainda não recebeu. É o único trabalho que faz
 * sentido quando nada mudou lá fora, e é trabalho que muda de resposta conforme
 * as tarefas andam. O webhook NÃO dispara nesta rodada — quem decide isso é o
 * worker, lendo `modo`.
 */
async function rodarRevisao(
  env: Env,
  ctx: {
    sessao: string; quando: string; automatica: boolean; impressao: string;
    anteriores: { tema: string; quando: string }[];
    fontes: Record<string, FonteAutomatica | null>;
    direcao: DirecaoAberta;
  },
): Promise<ResultadoReuniao> {
  const desde = ctx.anteriores[0]?.quando?.slice(11, 16) || '—';
  const tema = `Sem dado novo desde ${desde} — cobrança de pendências`;
  const pendentes = await pendenciasAbertas(env);

  const produtor = acharAgente('produtor')!;
  const fonteProdutor = await buscarFonteAutomatica(env, 'produtor');
  const etapa = await falar(env, produtor, {
    sessao: ctx.sessao, rodada: 'revisao', ordem: 1,
    entradaBase: JSON.stringify(fonteProdutor?.dados || {}, null, 2),
    direcao: ctx.direcao,
    instrucaoExtra:
      'RODADA DE REVISÃO. As fontes trouxeram exatamente o mesmo dado da rodada anterior e o João não mandou ' +
      'nada novo — nada mudou lá fora, então não há decisão nova pra tomar e a mesa não vai fingir que há. ' +
      'Seu único trabalho agora é a prestação de contas: para cada tarefa abaixo, o que aconteceu e há quantas ' +
      'rodadas está aberta. Se algo está parado há 3 rodadas ou mais, diga com todas as letras — é o tipo de ' +
      'coisa que só aparece se alguém contar. Devolva "hoje" vazio: não é hora de inventar tarefa nova.\n\n' +
      'TAREFAS EM ABERTO:\n' +
      (pendentes.length
        ? pendentes.map((x) => `- [${x.desde}] ${x.agente}: ${x.acao}`).join('\n')
        : '(nenhuma tarefa em aberto)') +
      (ctx.direcao.demandas.length
        ? '\n\nPEDIDOS DO JOÃO AINDA EM ABERTO — estes têm prioridade sobre tudo o resto:\n' +
          ctx.direcao.demandas.map((d) => `- [#${d.id}] ${d.texto} (${d.rodadas} rodadas esperando)`).join('\n')
        : '\n\n(o João não tem nenhum pedido em aberto)') +
      (!pendentes.length && !ctx.direcao.demandas.length
        ? '\n\nSe não há nada aberto nem pedido dele, responda que a mesa está em dia e seja breve.'
        : ''),
  });

  const d = (etapa.ok ? etapa.dados : {}) as any;
  const contas: { agente?: string; tarefa?: string; situacao?: string }[] = Array.isArray(d?.prestacao_de_contas) ? d.prestacao_de_contas : [];
  const paradas = contas.filter((c) => c.situacao === 'ignorada');

  try { await contarRodada(env, ctx.direcao.demandas.map((x) => x.id)); } catch { /* auxiliar */ }

  const ata: Ata = {
    resumo:
      `Nenhuma fonte mudou desde a reunião de ${desde} e o João não mandou nada novo, então a mesa não se ` +
      `reuniu para decidir — esta rodada foi só cobrança do que já estava combinado. ` +
      (contas.length
        ? `${contas.length} tarefa(s) revisada(s), ${paradas.length} ainda parada(s).`
        : 'Não havia tarefa em aberto para cobrar.') +
      (ctx.direcao.demandas.length ? ` ${ctx.direcao.demandas.length} pedido(s) do João continuam em aberto.` : '') +
      (d?.resumo ? ` ${String(d.resumo)}` : ''),
    resumo_curto: ctx.direcao.demandas.length
      ? `Sem dado novo desde ${desde}. ${ctx.direcao.demandas.length} pedido(s) seu(s) ainda em aberto.`
      : paradas.length
        ? `Sem dado novo desde ${desde}. ${paradas.length} tarefa(s) da mesa continuam paradas.`
        : `Sem dado novo desde ${desde}. Nada a decidir e nada parado.`,
    consenso: [], divergencias: [],
    acoes: contas.filter((c) => c.situacao === 'ignorada' && c.agente && c.tarefa)
      .map((c) => ({ agente: String(c.agente), acao: String(c.tarefa) })),
    placar_vendas: '',
    leituras: [], movimento_das_teses: [], avisos: [], reprovadas: [], entregas: [], precisamos_de_voce: '',
  };

  try {
    await env.DB.exec(
      `INSERT INTO atas (sessao, tema, quando, automatica, resumo, resumo_curto, consenso, divergencias, acoes, placar_vendas, webhook_status, impressao, modo, entregas, precisamos_de_voce, reprovadas, leituras, movimento_teses, avisos)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(sessao) DO UPDATE SET tema=excluded.tema, resumo=excluded.resumo, modo=excluded.modo`,
      [ctx.sessao, tema, ctx.quando, ctx.automatica ? 1 : 0, ata.resumo, ata.resumo_curto, '[]', '[]',
       JSON.stringify(ata.acoes), '', 'nao enviado (rodada de revisão)', ctx.impressao, 'revisao', '[]', '', '[]',
       '[]', '[]', '[]'],
    );
  } catch { /* idem */ }

  return { sessao: ctx.sessao, tema, quando: ctx.quando, automatica: ctx.automatica, modo: 'revisao', impressao: ctx.impressao, etapas: [etapa], ata };
}

export const CHAVES_NA_SALA = AGENTES.map((a) => a.chave);
