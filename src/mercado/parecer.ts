// O PARECER DE COLEÇÃO — a mesa decide como uma equipe sênior decidiria.
//
// POR QUE ISTO EXISTE (João, 29/09/2026), sobre a ata que dizia "camisa de
// clube segue forte na oferta" e pedia um teste A/B de textura tonal:
//
//   "tá muito bom, fácil leitura, mas não me diz nada que eu já não saiba. Eu
//   preciso de algo tipo: nós achamos interessante fazer uma coleção bem
//   estruturada em tema tal, ou então, não recomendamos, optamos por drops
//   isolados pois é um período sem grandes tendências masculinas. Quero que a
//   mesa se comporte como profissionais seniores mesmo, e criativos. Quero um
//   resultado digno de uma pesquisa de mercado."
//
// O diagnóstico: a mesa só era perguntada "o que o mercado pede?". Pergunta de
// observação rende observação — e a observação mais segura é sempre a óbvia.
// Nenhuma etapa tinha a obrigação de DECIDIR. Um planejador de coleção sênior
// não entrega leitura: entrega formato, conceito, data e o risco que aceitou.
//
// O que muda:
//   1. A pergunta vira uma DECISÃO FECHADA: coleção estruturada, cápsula,
//      drops isolados ou segurar. Não existe "vale olhar".
//   2. O comitê recebe o que um sênior tem na cabeça e a mesa não tinha: a
//      tabela do campeonato (src/web/tabela.ts) e o calendário comercial
//      (src/mercado/calendarioComercial.ts). Coleção se decide por janela.
//   3. Uma BANCA cética lê a proposta e reescreve: corta o óbvio, derruba
//      narrativa forçada, troca o conceito se ele for genérico.
//   4. O código segura o que o prompt não segura: número que ninguém mediu
//      cai, peça em produto que a casa não faz cai, e "coleção" com menos de
//      quatro peças vira cápsula — três peças não são coleção.

import type { Env } from '../aiproxy';
import { chamarAgente } from '../aiproxy';
import { numerosDoTexto } from '../juiz';
import { caber } from './sintese';
import { PRODUTOS_DA_CASA } from './cardapio';
import { formatarMapaDeDemanda, type MapaDeDemanda } from './demanda';
import { proximasDatas, formatarCalendarioComercial } from './calendarioComercial';
import { formatarTabela, type Tabela } from '../web/tabela';
import { formatarCalendario } from '../web/calendario';
import { formatarProcura } from '../web/procura';
import { formatarEstetica } from '../web/estetica';
import { formatarNoticiasDoMercado } from '../web/noticias';
import type { Mundo } from '../web/mundo';
import type { DirecaoAberta } from '../direcao';

export type Formato = 'colecao' | 'capsula' | 'drops' | 'segurar';

export const NOME_DO_FORMATO: Record<Formato, string> = {
  colecao: 'Coleção estruturada',
  capsula: 'Cápsula',
  drops: 'Drops isolados',
  segurar: 'Segurar',
};

export interface Porque {
  /** Começa por "Achamos que". */
  ideia: string;
  porque: string;
  /** De onde vem: número medido hoje, calendário/tabela, ou leitura de mercado (experiência, sem número). */
  base: 'medido' | 'calendario' | 'leitura_de_mercado';
}

export interface Peca { produto: string; o_que_e: string }

export interface Conceito {
  nome: string;
  ideia: string;
  linguagem_visual: string;
  pecas: Peca[];
  janela: string;
}

export interface Drop { gatilho: string; produto: string; quando: string }

export interface Sinal { sinal: string; forca: 'forte' | 'medio' | 'fraco'; leitura: string }

export interface Parecer {
  formato: Formato;
  veredito: string;
  momento: string;
  sinais: Sinal[];
  porques: Porque[];
  conceito: Conceito | null;
  drops: Drop[];
  descartamos: { formato: Formato; por_que: string } | null;
  riscos: string[];
  muda_de_ideia_se: string;
  pedido: string;
  /** O que a banca cortou ou trocou na proposta — fica na ata, é o registro de que houve contraponto. */
  a_banca_mudou: string;
  /** O que o código teve de corrigir. Vazio é o normal. */
  ajustes: string[];
}

// ── Limites do texto ─────────────────────────────────────────────────────

const T = { veredito: 220, momento: 360, ideia: 150, porque: 230, peca: 140, curto: 200, sinal: 180 };
const MAX_PORQUES = 3;
const MAX_SINAIS = 4;

/**
 * Frases que um sênior não assina: ou empurram a decisão pra depois, ou
 * repetem o que o João já sabe. Aparecem no veredito → a banca é avisada.
 */
export const FRASES_DE_QUEM_NAO_DECIDIU = [
  'vale olhar', 'vale acompanhar', 'acompanhar de perto', 'monitorar', 'segue forte', 'continua forte',
  'teste a/b', 'teste ab', 'vale testar', 'pode ser interessante', 'explorar', 'aproveitar o momento',
  'aproveitar a data', 'oportunidade interessante', 'ficar de olho',
];

/** O que o João sabe de cor. Frase que ele escreveria sem abrir o e-mail é desperdício. */
export const O_QUE_O_JOAO_JA_SABE = [
  'camisa de clube vende e o mercado lança muita camisa',
  'clube grande (Flamengo, Corinthians, Palmeiras) vende mais que clube pequeno',
  'clássico e jogo decisivo aumentam a procura',
  'Dia dos Pais e Natal são datas fortes para produto de torcida',
  'retrô e nostalgia são uma linguagem forte no futebol',
  'minimalismo/tonal é uma estética em alta no masculino',
];

// ── Normalização e conferência (código, não prompt) ──────────────────────

const norm = (s: string) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();

export function lerFormato(x: unknown): Formato | null {
  const t = norm(String(x || ''));
  if (/capsula/.test(t)) return 'capsula';
  if (/colec/.test(t)) return 'colecao';
  if (/drop/.test(t)) return 'drops';
  if (/segur|nao lancar|esperar|aguardar/.test(t)) return 'segurar';
  return null;
}

/** O produto da casa que a peça usa, ou null se a casa não faz. */
export function produtoDaCasa(texto: string): string | null {
  const t = norm(texto);
  const sinonimos: Record<string, string[]> = {
    capinha: ['capinha', 'capa de celular', 'case'],
    'térmico': ['termico', 'copo termico'],
    garrafa: ['garrafa'],
    copo: ['copo'],
    caneca: ['caneca'],
    camiseta: ['camiseta'],
    moletom: ['moletom'],
    'boné': ['bone'],
    mochila: ['mochila'],
    almofada: ['almofada'],
    adesivo: ['adesivo'],
    chaveiro: ['chaveiro'],
    toalha: ['toalha'],
  };
  for (const p of PRODUTOS_DA_CASA) {
    const alvos = sinonimos[p] || [norm(p)];
    if (alvos.some((a) => t.includes(a))) return p;
  }
  return null;
}

/**
 * Tira as frases que citam número que ninguém mediu. Números até 12 passam
 * (são "4 peças", "3 drops"), e anos também.
 */
export function semNumeroInventado(texto: string, conhecidos: Set<number>): { texto: string; cortou: boolean } {
  const frases = String(texto || '').split(/(?<=[.!?;])\s+/);
  const ficam = frases.filter((f) => numerosDoTexto(f).every((n) => n <= 12 || (n >= 2025 && n <= 2028) || conhecidos.has(n)));
  return { texto: ficam.join(' ').trim(), cortou: ficam.length !== frases.length };
}

function comAchamos(ideia: string): string {
  const t = ideia.trim().replace(/^[•\-–]\s*/, '');
  if (/^achamos\b/i.test(t)) return 'Achamos' + t.slice(7);
  return 'Achamos que ' + t.charAt(0).toLowerCase() + t.slice(1);
}

/** Aplica as regras da casa sobre o JSON do modelo. Devolve null quando não sobra decisão. */
export function validarParecer(d: any, conhecidos: Set<number>): Parecer | null {
  let formato = lerFormato(d?.formato);
  if (!formato) return null;
  const ajustes: string[] = [];

  const limpar = (s: unknown, max: number, campo: string) => {
    const r = semNumeroInventado(String(s || ''), conhecidos);
    if (r.cortou) ajustes.push(`${campo}: frase com número não medido foi cortada`);
    return caber(r.texto, max);
  };

  const veredito = limpar(d?.veredito, T.veredito, 'veredito');
  if (!veredito) return null;
  const momento = limpar(d?.momento, T.momento, 'momento');

  const porques: Porque[] = (Array.isArray(d?.porques) ? d.porques : [])
    .map((p: any) => {
      const base = ['medido', 'calendario', 'leitura_de_mercado'].includes(p?.base) ? p.base : 'leitura_de_mercado';
      const texto = `${p?.ideia || ''} || ${p?.porque || ''}`;
      const r = semNumeroInventado(texto, conhecidos);
      if (r.cortou || !p?.ideia || !p?.porque) { if (r.cortou) ajustes.push('um porquê citava número não medido e caiu'); return null; }
      // Leitura de mercado é experiência, não medição: não pode vir com número.
      if (base === 'leitura_de_mercado' && numerosDoTexto(String(p.porque)).some((n) => n > 12)) {
        ajustes.push('um porquê de experiência trazia número e caiu');
        return null;
      }
      return { ideia: caber(comAchamos(String(p.ideia)), T.ideia), porque: caber(String(p.porque), T.porque), base } as Porque;
    })
    .filter(Boolean)
    .slice(0, MAX_PORQUES);

  let conceito: Conceito | null = null;
  if (formato === 'colecao' || formato === 'capsula') {
    const c = d?.conceito || {};
    const pecas: Peca[] = (Array.isArray(c.pecas) ? c.pecas : [])
      .map((p: any) => {
        const produto = produtoDaCasa(String(p?.produto || ''));
        if (!produto) { ajustes.push(`peça em "${String(p?.produto || '?').slice(0, 30)}" caiu: a casa não fabrica`); return null; }
        return { produto, o_que_e: limpar(p?.o_que_e, T.peca, 'peça') };
      })
      .filter((p: Peca | null): p is Peca => !!p && !!p.o_que_e)
      .slice(0, 6);
    if (formato === 'colecao' && pecas.length < 4) {
      ajustes.push(`coleção com ${pecas.length} peça(s) válidas virou cápsula`);
      formato = 'capsula';
    }
    if (formato === 'capsula' && pecas.length < 2) {
      ajustes.push('cápsula sem duas peças válidas virou drops isolados');
      formato = 'drops';
    } else if (c.nome) {
      conceito = {
        nome: caber(String(c.nome).replace(/["“”]/g, ''), 60),
        ideia: limpar(c.ideia, T.curto, 'conceito'),
        linguagem_visual: limpar(c.linguagem_visual, T.curto, 'linguagem visual'),
        pecas,
        janela: limpar(c.janela, 120, 'janela'),
      };
    }
  }

  const drops: Drop[] = formato === 'drops'
    ? (Array.isArray(d?.drops) ? d.drops : [])
      .map((x: any) => ({
        gatilho: limpar(x?.gatilho, 140, 'drop'),
        produto: produtoDaCasa(String(x?.produto || '')) || '',
        quando: caber(String(x?.quando || ''), 60),
      }))
      .filter((x: Drop) => x.gatilho && x.produto)
      .slice(0, 3)
    : [];

  const descFormato = lerFormato(d?.descartamos?.formato);
  const sinais: Sinal[] = (Array.isArray(d?.sinais) ? d.sinais : [])
    .map((s: any) => ({
      sinal: limpar(s?.sinal, 90, 'sinal'),
      forca: (['forte', 'medio', 'fraco'].includes(norm(s?.forca)) ? norm(s?.forca) : 'medio') as Sinal['forca'],
      leitura: limpar(s?.leitura, T.sinal, 'sinal'),
    }))
    .filter((s: Sinal) => s.sinal)
    .slice(0, MAX_SINAIS);

  return {
    formato,
    veredito,
    momento,
    sinais,
    porques,
    conceito,
    drops,
    descartamos: descFormato && descFormato !== formato
      ? { formato: descFormato, por_que: limpar(d?.descartamos?.por_que, T.curto, 'descartamos') }
      : null,
    riscos: (Array.isArray(d?.riscos) ? d.riscos : []).map((r: unknown) => limpar(r, 160, 'risco')).filter(Boolean).slice(0, 2),
    muda_de_ideia_se: limpar(d?.muda_de_ideia_se, T.curto, 'muda de ideia'),
    pedido: limpar(d?.pedido, T.curto, 'pedido'),
    a_banca_mudou: caber(String(d?.a_banca_mudou || ''), 300),
    ajustes,
  };
}

/** Frases de quem não decidiu que sobraram no veredito ou no momento. */
export function frasesFrouxas(p: Parecer): string[] {
  const alvo = norm(`${p.veredito} ${p.momento} ${p.porques.map((x) => x.ideia).join(' ')}`);
  return FRASES_DE_QUEM_NAO_DECIDIU.filter((f) => alvo.includes(norm(f)));
}

// ── Os prompts ───────────────────────────────────────────────────────────

const FORMATO_JSON =
  '{"formato":"colecao|capsula|drops|segurar",' +
  '"veredito":"1 frase","momento":"2 frases",' +
  '"sinais":[{"sinal":"..","forca":"forte|medio|fraco","leitura":".."}],' +
  '"porques":[{"ideia":"Achamos que ..","porque":"..","base":"medido|calendario|leitura_de_mercado"}],' +
  '"conceito":{"nome":"..","ideia":"..","linguagem_visual":"..","pecas":[{"produto":"..","o_que_e":".."}],"janela":".."} ou null,' +
  '"drops":[{"gatilho":"..","produto":"..","quando":".."}],' +
  '"descartamos":{"formato":"colecao|capsula|drops|segurar","por_que":".."},' +
  '"riscos":[".."],"muda_de_ideia_se":"..","pedido":"..","a_banca_mudou":".."}';

function systemDoComite(): string {
  return [
    'Vocês são o COMITÊ DE COLEÇÃO da área de futebol da Gocase — a mesma mesa (Téo, Rafa, Nina, Caio e Val), ' +
    'agora no papel que uma empresa séria paga caro para ter: uma head de planejamento de coleção com vinte anos ' +
    'de varejo de moda e licenciados, uma pesquisadora de consumo que separa onda de ruído, um diretor criativo ' +
    'que transforma sinal em conceito, e um comercial que pensa em giro e em data.',
    '',
    'QUEM LÊ: o JOÃO WELLINGTON, coordenador de futebol. Ele pediu, nas palavras dele: "nós achamos interessante ' +
    'fazer uma coleção bem estruturada em tema tal, ou então, não recomendamos, optamos por drops isolados pois é ' +
    'um período sem grandes tendências masculinas. Quero um resultado digno de uma pesquisa de mercado."',
    '',
    '━━ A DECISÃO É FECHADA — escolham UM formato ━━',
    '• "colecao" — coleção estruturada: 4 a 6 peças que contam UMA narrativa, com nome e data de lançamento. Só ' +
    'se justifica com as três coisas juntas: uma narrativa que o público já reconhece (não uma que vocês ' +
    'inventaram), uma janela com data que concentre a compra, e linguagem que rende peças DIFERENTES entre si.',
    '• "capsula" — 2 a 4 peças sobre uma narrativa forte com janela curta ou estreita.',
    '• "drops" — os sinais existem mas não conversam entre si: cada um vale sozinho, e amarrar em coleção seria ' +
    'forçar. Digam isso com todas as letras ("não recomendamos coleção agora, porque...") e listem os drops.',
    '• "segurar" — nada hoje justifica gastar criação. Digam o que estão esperando e até quando.',
    'Dizer "não recomendamos coleção" é uma resposta sênior e respeitada. O que não existe é não decidir: ' +
    '"vale olhar", "vale testar", "monitorar", teste A/B como conclusão — isso é empurrar a decisão pro João.',
    '',
    '━━ COMO UM SÊNIOR CHEGA NA DECISÃO (é o método; sigam na ordem) ━━',
    '1. JANELA. Qual é a próxima data que justifica concentrar esforço? Cruzem o calendário comercial com a ' +
    'tabela do campeonato. A decisão de coleção no fim do ano quase sempre nasce desse cruzamento.',
    '2. NARRATIVA. Existe uma história que uma torcida inteira (ou o público masculino como um todo) vai querer ' +
    'contar ao mesmo tempo? Título, queda, arrancada, virada de ciclo, um código visual que saiu do nicho. ' +
    'Oferta de catálogo (o que as lojas lançaram) é aposta da indústria; procura (Wikipédia) e tabela são o ' +
    'público. Narrativa só com oferta é fraca.',
    '3. RENDE PEÇA? A narrativa vira objetos diferentes nos produtos que a casa fabrica (' +
    PRODUTOS_DA_CASA.filter((p) => p !== 'estampa').join(', ') + ')? Se todas as peças forem a mesma arte em ' +
    'suportes diferentes, é drop, não coleção.',
    '4. O QUE ACONTECE SE DER ERRADO? Se a narrativa depende de um resultado (título, acesso), digam como se ' +
    'protegem: arte pronta em espera, lançamento condicionado, duas versões.',
    '',
    '━━ O QUE SEPARA PESQUISA DE MERCADO DE RELATÓRIO ━━',
    'O João sabe de cor: ' + O_QUE_O_JOAO_JA_SABE.join('; ') + '. Frase que ele escreveria sem abrir o e-mail ' +
    'está proibida. INSIGHT é a relação não óbvia entre dois sinais — a data de uma coisa caindo em cima da ' +
    'outra, um clube cuja situação na tabela contradiz a procura, um código visual que aparece em lugares que ' +
    'não se falam. Um bom parecer faz o leitor dizer "não tinha ligado uma coisa à outra".',
    '',
    '━━ SEJAM CRIATIVOS NO CONCEITO ━━',
    'Quando houver coleção ou cápsula, o conceito tem NOME próprio (2 a 4 palavras, com cara de coleção de ' +
    'verdade, não descrição técnica), uma ideia em uma frase que um vendedor repetiria, e a linguagem visual ' +
    'concreta que um ilustrador desenharia amanhã. Cada peça diz o que ela É naquele produto — e as peças têm ' +
    'que ser diferentes entre si (uma peça-manifesto, uma de uso diário, uma de presente, uma de colecionador). ' +
    'Clube pode entrar quando a narrativa é daquele clube (é o caso de título, queda, acesso), sempre com o motivo.',
    '',
    '━━ AS REGRAS DE LASTRO ━━',
    '• Número só se estiver escrito no material abaixo, como está escrito. Número inventado derruba a frase.',
    '• Cada "porque" declara a base: "medido" (número do material), "calendario" (data ou tabela), ou ' +
    '"leitura_de_mercado" (a experiência de vocês sobre como o varejo se comporta — sem número nenhum, e ' +
    'dito como opinião de quem conhece o mercado).',
    '• "sinais": até 4, os que pesaram na decisão, com força honesta — é a espinha da pesquisa.',
    '• "descartamos": o formato que vocês consideraram e rejeitaram, e por quê. Sênior mostra a alternativa.',
    '• "muda_de_ideia_se": o fato concreto que, se acontecer, muda a recomendação.',
    '• "pedido": o que o João precisa decidir ou liberar. Vazio se nada.',
    '• Sem jargão interno: nada de "rodada", "tese", "empurrão", "share", "família", "SKU", "sinal externo".',
  ].join('\n');
}

function systemDaBanca(): string {
  return [
    'Você é a BANCA do comitê de coleção da Gocase: uma diretora comercial com vinte anos de varejo de moda, que ' +
    'já viu muita coleção bonita encalhar. Você recebe a proposta do comitê e o mesmo material que ele leu. O ' +
    'seu trabalho não é elogiar: é deixar o parecer no nível que um coordenador exigente assinaria.',
    '',
    'Faça estas perguntas, nesta ordem, e CORRIJA a proposta onde a resposta for ruim:',
    '1. O veredito DECIDE? Se sobrou "vale olhar", "testar", "monitorar", reescreva como decisão.',
    '2. O João já sabia disso? Ele sabe de cor: ' + O_QUE_O_JOAO_JA_SABE.join('; ') + '. Se o veredito ou um ' +
    'porquê é isso, corte e ache no material a relação não óbvia que o comitê deixou passar.',
    '3. A narrativa é do público ou do comitê? Coleção apoiada só em oferta de catálogo, sem procura e sem ' +
    'tabela, é aposta. Se for o caso, rebaixe o formato (coleção → cápsula → drops) e diga por quê.',
    '4. O formato é o certo para a JANELA? Confira as datas do calendário e da tabela. Uma coleção sem data que ' +
    'a sustente é catálogo com nome.',
    '5. O conceito é criativo de verdade? Nome genérico ("Coleção Futebol Moderno"), linguagem vaga ("design ' +
    'clean e moderno") ou peças que são a mesma arte em suportes diferentes: reescreva. O conceito tem que ter ' +
    'uma ideia que dá vontade de comprar.',
    '6. O risco foi encarado? Se a narrativa depende de resultado em campo, a proteção tem que estar escrita.',
    '',
    'Pode manter a proposta se ela for boa — banca que muda tudo por mudar é tão ruim quanto a que aprova tudo. ' +
    'Em "a_banca_mudou" diga em uma ou duas frases o que você cortou, trocou ou manteve, e por quê.',
    'As regras de lastro continuam: número só do material, base declarada em cada porquê, sem jargão interno.',
  ].join('\n');
}

// ── A chamada ────────────────────────────────────────────────────────────

export interface MaterialDoParecer {
  pauta: string;
  /** Pauta, feedbacks e pedidos do João em aberto. */
  direcao: string;
  /** Blocos formatados: tabela, calendário comercial, mapa de demanda, procura, estética, imprensa. */
  blocos: string[];
  /** O que a mesa leu hoje (leituras aprovadas, lentes, teses). */
  mesa: string;
  /** Vereditos das últimas atas — pra não repetir a mesma recomendação sem fato novo. */
  anteriores: string[];
}

export async function emitirParecer(env: Env, m: MaterialDoParecer): Promise<{ parecer: Parecer | null; erro?: string }> {
  const corpo = [
    'PAUTA: ' + (m.pauta || 'ideias de coleção com bom aproveitamento de vendas'),
    m.direcao ? '\nO QUE O JOÃO PEDIU E DISSE:\n' + m.direcao : '',
    ...m.blocos.filter(Boolean).map((b) => '\n' + b),
    m.mesa ? '\n━━ O QUE A MESA LEU HOJE ━━\n' + m.mesa : '',
    m.anteriores.length
      ? '\n━━ O QUE VOCÊS RECOMENDARAM NAS ÚLTIMAS REUNIÕES ━━\n' + m.anteriores.map((a) => '- ' + a).join('\n') +
        '\nManter a recomendação é legítimo quando o material confirma — digam o que confirmou. Repetir sem fato ' +
        'novo, não.'
      : '',
  ].filter(Boolean).join('\n');

  const conhecidos = new Set(numerosDoTexto(corpo));
  const formato = '\n\nResponda APENAS um objeto JSON válido, sem markdown: ' + FORMATO_JSON;

  const r1 = await chamarAgente(env, systemDoComite() + formato, corpo, undefined, 0.6);
  if (!r1.ok) return { parecer: null, erro: r1.erro };
  const proposta = validarParecer(r1.dados, conhecidos);
  if (!proposta) return { parecer: null, erro: 'o comitê não devolveu formato nem veredito' };

  const frouxas = frasesFrouxas(proposta);
  const r2 = await chamarAgente(
    env,
    systemDaBanca() + formato,
    corpo + '\n\n━━ A PROPOSTA DO COMITÊ ━━\n' + JSON.stringify(r1.dados, null, 1) +
      (proposta.ajustes.length ? '\n\nA CONFERÊNCIA AUTOMÁTICA JÁ CORRIGIU: ' + proposta.ajustes.join('; ') : '') +
      (frouxas.length ? '\n\nA CONFERÊNCIA ACHOU FRASE DE QUEM NÃO DECIDIU: ' + frouxas.join(', ') : ''),
    undefined, 0.35,
  );
  const final = r2.ok ? validarParecer(r2.dados, conhecidos) : null;
  if (!final) return { parecer: { ...proposta, a_banca_mudou: 'a banca não respondeu; vai a proposta do comitê' } };
  return { parecer: final };
}

// ── O material, montado igual na reunião e na prévia ─────────────────────

/** Os blocos que o comitê lê. A tabela e o calendário comercial vêm primeiro: são a janela. */
export function blocosDoParecer(ctx: { mundo: Mundo; mapa: MapaDeDemanda; tabela: Tabela; hoje?: Date }): string[] {
  const datas = proximasDatas(ctx.hoje || new Date(), 120, ctx.tabela.fim);
  return [
    formatarTabela(ctx.tabela),
    formatarCalendarioComercial(datas),
    formatarCalendario(ctx.mundo.calendario),
    formatarProcura(ctx.mundo.procura),
    formatarMapaDeDemanda(ctx.mapa),
    formatarEstetica(ctx.mundo.estetica),
    formatarNoticiasDoMercado(ctx.mundo.noticias),
  ].filter(Boolean);
}

export function textoDaDirecao(d: DirecaoAberta): string {
  return [
    d.tema ? 'PAUTA DADA POR ELE: ' + d.tema.texto : '',
    ...d.feedbacks.map((f) => 'FEEDBACK DELE: ' + f.texto),
    ...d.demandas.map((x) => 'PEDIDO EM ABERTO: ' + x.texto),
  ].filter(Boolean).join('\n');
}

/** Os vereditos das últimas atas, do mais novo pro mais velho. */
export async function vereditosAnteriores(env: Env, n = 4): Promise<string[]> {
  try {
    const q = await env.DB.query(
      "SELECT quando, sintese FROM atas WHERE sintese LIKE '%\"parecer\"%' ORDER BY quando DESC LIMIT ?", [n]);
    return q.rows.map((r) => {
      try {
        const p = JSON.parse(String(r.sintese || 'null'))?.parecer as Parecer | undefined;
        return p ? `[${String(r.quando).slice(0, 10)}] ${NOME_DO_FORMATO[p.formato]}: ${p.veredito}` : '';
      } catch { return ''; }
    }).filter(Boolean);
  } catch {
    return [];
  }
}

// ── Pra quem lê ──────────────────────────────────────────────────────────

const ROTULO_BASE: Record<Porque['base'], string> = {
  medido: '', calendario: '', leitura_de_mercado: ' _(leitura de mercado)_',
};

/** As linhas do card do Chat. */
export function linhasDoCard(p: Parecer): string[] {
  const l: string[] = [];
  l.push(`*🧭 ${NOME_DO_FORMATO[p.formato].toUpperCase()} —* ${p.veredito}`);
  if (p.momento) l.push(`_${p.momento}_`);
  if (p.porques.length) {
    l.push('');
    for (const x of p.porques) l.push(`💡 *${x.ideia.replace(/[.…]$/, '')}* — ${x.porque}${ROTULO_BASE[x.base]}`);
  }
  if (p.conceito) {
    l.push('');
    l.push(`*🎨 ${p.conceito.nome}* — ${p.conceito.ideia}`);
    if (p.conceito.linguagem_visual) l.push(`_Linguagem:_ ${p.conceito.linguagem_visual}`);
    for (const x of p.conceito.pecas) l.push(`• *${x.produto}* — ${x.o_que_e}`);
    if (p.conceito.janela) l.push(`🗓 ${p.conceito.janela}`);
  }
  if (p.drops.length) {
    l.push('');
    for (const x of p.drops) l.push(`• *${x.produto}* — ${x.gatilho}${x.quando ? ` (${x.quando})` : ''}`);
  }
  if (p.descartamos || p.muda_de_ideia_se) l.push('');
  if (p.descartamos) l.push(`↩️ _Descartamos ${NOME_DO_FORMATO[p.descartamos.formato].toLowerCase()}:_ ${p.descartamos.por_que}`);
  if (p.muda_de_ideia_se) l.push(`🔄 _Mudamos de ideia se:_ ${p.muda_de_ideia_se}`);
  return l;
}
