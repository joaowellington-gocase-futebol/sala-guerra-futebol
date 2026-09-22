// O FECHO DA REUNIÃO — onde a mesa entrega a leitura de mercado ao João.
//
// Este arquivo nasceu em 22/09/2026 substituindo o fecho tático que morava em
// src/direcao.ts. A diferença não é de texto, é de PERGUNTA:
//
//   antes  "o que a Gocase faz amanhã de manhã?"  → "3 SKUs do Flamengo até sexta"
//   agora  "o que o mercado masculino está pedindo, e como isso cabe nos
//           nossos produtos?"
//
// A troca veio do João: "não adianta me dar um direcionamento 'clube tal,
// estampa minimalista'. Eu quero tipo assim: o público masculino tem procurado
// por X Y Z de produtos, podemos adaptar para os produtos dessa forma. E aí
// depois disso, eu irei pensar como fazer virar uma demanda de futebol."
//
// A decisão de futebol voltou a ser dele. A mesa entrega a leitura e a ponte
// de produto; ele faz o recorte. Duas coisas garantem que isso não vire ensaio
// sobre o mercado:
//
//   1. o MAPA DE DEMANDA (src/mercado/demanda.ts) dá os números transversais,
//      então a leitura escolhe dentro do que foi medido;
//   2. o JUIZ (src/juiz.ts) confere cada número contra o que a rodada mediu, e
//      exige a ponte de produto e o que confirmaria a leitura amanhã.

import type { Env } from '../aiproxy';
import { chamarAgente } from '../aiproxy';
import {
  type Leitura, type ContextoDoJuiz, julgarTodas, formatarReprovacao, numerosDoTexto,
} from '../juiz';
import { type MapaDeDemanda, formatarMapaDeDemanda } from './demanda';
import { type Tese, formatarTesesParaPrompt } from '../teses';
import type { DirecaoAberta } from '../direcao';
import type { EntregaDeDemanda } from '../direcao';

export type { Leitura };

export interface FechamentoDaMesa {
  leituras: Leitura[];
  /** O que a mesa tentou empurrar e a conferência barrou. Vai pra ata: é sinal de calibragem. */
  reprovadas: { o_que: string; motivos: string[] }[];
  /** Números que passaram mas não batem com nada medido. Aviso, não reprovação. */
  avisos: string[];
  se_eu_fosse_voce: string;
  precisamos_de_voce: string;
}

const VAZIO: FechamentoDaMesa = {
  leituras: [], reprovadas: [], avisos: [], se_eu_fosse_voce: '', precisamos_de_voce: '',
};

/** No máximo duas por rodada: o pedido foi aprofundar, não listar. */
const MAX_LEITURAS = 2;

function lerLeituras(d: any): Leitura[] {
  const cru = Array.isArray(d?.leituras) ? d.leituras : [];
  return cru.slice(0, MAX_LEITURAS).map((x: any) => {
    const c = String(x?.confianca || '').toLowerCase();
    return {
      o_que_o_mercado_pede: String(x?.o_que_o_mercado_pede || '').slice(0, 700),
      evidencia: String(x?.evidencia || '').slice(0, 700),
      como_cabe: String(x?.como_cabe || '').slice(0, 700),
      confianca: (c === 'forte' || c === 'fraca' ? c : 'media') as Leitura['confianca'],
      o_que_confirma: String(x?.o_que_confirma || '').slice(0, 400),
      tese: String(x?.tese || '').slice(0, 300),
    };
  }).filter((x: Leitura) => x.o_que_o_mercado_pede);
}

/**
 * O material da rodada. É o que separa "não há o que ler" de esquiva: enquanto
 * houver família com lançamento e palavra circulando, existe leitura a fazer.
 */
export interface MaterialDaRodada {
  temMaterial: boolean;
  linhas: string[];
}

function systemDoFechamento(ctx: {
  mapa: MapaDeDemanda; procura: string; placar: string; teses: Tese[]; material: MaterialDaRodada;
}): string {
  return [
    'Você é a mesa inteira — Téo, Rafa, Nina, Caio e Val — fechando a reunião do dia para o JOÃO WELLINGTON, ' +
    'que coordena a área de futebol da Gocase.',
    '',
    'O QUE ELE PEDE DE VOCÊS, nas palavras dele: "não adianta me dar um direcionamento \'clube tal, estampa ' +
    'minimalista\'. Eu quero tipo assim: o público masculino tem procurado por X Y Z de produtos, podemos ' +
    'adaptar para os produtos dessa forma. E aí depois disso, eu irei pensar como fazer virar uma demanda de ' +
    'futebol."',
    '',
    'Leia isso com atenção, porque inverte o que esta mesa fazia antes. NÃO é a sua tarefa dizer qual clube ' +
    'estampar nem em que data subir SKU — esse recorte é dele, e ele o faz melhor que vocês. A sua tarefa é a ' +
    'que ele não tem tempo de fazer: LER O MERCADO e trazer a ponte para os produtos da casa.',
    '',
    ctx.placar,
    '',
    formatarTesesParaPrompt(ctx.teses),
    '',
    formatarMapaDeDemanda(ctx.mapa),
    '',
    ctx.procura,
    '',
    '━━ O QUE VOCÊS DEVOLVEM ━━',
    'No máximo ' + MAX_LEITURAS + ' leituras, e é MUITO melhor UMA funda que duas mornas. Cada leitura tem ' +
    'seis campos, e existe uma conferência automática depois de vocês que lê o texto, não a intenção:',
    '',
    '• "o_que_o_mercado_pede" — o padrão que vocês observaram, com A CATEGORIA PELO NOME (uma das famílias ' +
    'medidas acima). Fale do público e do produto, não do clube. Exemplo de forma (não copie o conteúdo): ' +
    '"camisa de clube saiu do nicho de torcedor e virou peça de guarda-roupa masculino".',
    '• "evidencia" — os NÚMEROS DESTA RODADA que sustentam isso, com a fonte. A conferência confere cada ' +
    'número contra o que foi medido hoje: número que não saiu dos blocos acima é reprovado como inventado. ' +
    'Cite-os como estão escritos.',
    '• "como_cabe" — A PONTE, e é a metade da entrega que ele mais quer. O que isso vira num produto que a ' +
    'casa JÁ fabrica: que gráfica, que paleta, que recorte, em qual produto. Se a família não tem ' +
    'correspondente na casa, traduza a LINGUAGEM dela para um produto que tem — não proponha que a casa passe ' +
    'a fabricar coisa nova.',
    '• "confianca" — "forte", "media" ou "fraca". FORTE só vale citando número de PROCURA (as leituras da ' +
    'Wikipédia). Oferta de catálogo é o que a indústria apostou, não o que o público pediu: com só isso, o ' +
    'honesto é "media". A conferência reprova confiança forte sem procura.',
    '• "o_que_confirma" — o que, na PRÓXIMA rodada, confirmaria ou derrubaria isto. É o que permite à mesa de ' +
    'amanhã continuar de onde vocês pararam em vez de recomeçar.',
    '• "tese" — a tese de fundo que esta leitura sustenta, em uma frase. Se ela engrossa uma das teses que já ' +
    'estão de pé lá em cima, repita a tese daquela; se funda uma nova, enuncie a nova.',
    '',
    '━━ SOBRE REPETIR ASSUNTO ━━',
    'Voltar ao mesmo assunto de ontem é BOM e é o que ele pediu: as reuniões têm que entender de forma ' +
    'progressiva. O que a conferência barra é repetir a mesma conclusão COM OS MESMOS NÚMEROS, sem nada novo. ' +
    'Aprofundar é trazer a medição de hoje sobre o assunto de ontem e dizer o que ela acrescentou.',
    '',
    '• "se_eu_fosse_voce": 1 ou 2 frases, direto ao João, com a única coisa que vocês olhariam se só desse pra ' +
    'olhar uma. É o que chega no celular dele.',
    '• "precisamos_de_voce": o que a mesa precisa que ele decida ou libere. Vazio se não precisa de nada.',
    '',
    ctx.material.temMaterial
      ? '━━ VOCÊS TÊM MATERIAL HOJE ━━\n' +
        'Não aceitem de vocês mesmos um "não há o que ler" nesta rodada. O que está na mesa agora:\n' +
        ctx.material.linhas.map((l) => '• ' + l).join('\n') + '\n' +
        'Com família se movendo e palavra circulando, existe leitura a fazer. "Não temos nada" com esse ' +
        'material na mão não é honestidade, é esquiva.'
      : '━━ E A SAÍDA HONESTA ━━\n' +
        'Se o mapa de demanda não carregou e a procura não se mexeu, devolvam lista VAZIA e digam isso em ' +
        '"se_eu_fosse_voce". Com esse cenário, é resposta legítima.',
  ].join('\n');
}

export async function fecharComLeitura(
  env: Env,
  ctx: {
    tema: string; achado: string; lentes: string; entregas: EntregaDeDemanda[];
    naoRepita: string; direcao: DirecaoAberta; mapa: MapaDeDemanda; procura: string;
    placar: string; teses: Tese[]; material: MaterialDaRodada; juiz: ContextoDoJuiz;
  },
): Promise<FechamentoDaMesa> {
  const system = systemDoFechamento(ctx);

  const corpo = [
    'PAUTA DESTA REUNIÃO: ' + ctx.tema,
    ctx.direcao.tema ? 'PAUTA DADA PELO JOÃO: ' + ctx.direcao.tema.texto : '',
    ctx.direcao.feedbacks.length
      ? 'FEEDBACKS ABERTOS DELE (a leitura tem que levar isto em conta):\n' +
        ctx.direcao.feedbacks.map((f) => '- ' + f.texto).join('\n')
      : '',
    '\nO QUE A INVESTIGAÇÃO DE HOJE MOSTROU:\n' + ctx.achado,
    ctx.lentes ? '\nCOMO CADA UM LEU ISSO:\n' + ctx.lentes : '',
    ctx.entregas.length
      ? '\nO QUE A MESA ENTREGOU DO QUE ELE PEDIU:\n' +
        ctx.entregas.map((e) => '- ' + e.nome + ': ' + e.entrega).join('\n')
      : '',
  ].filter(Boolean).join('\n');

  const formato =
    '\n\nResponda APENAS {"leituras":[{"o_que_o_mercado_pede":"..","evidencia":"..","como_cabe":"..",' +
    '"confianca":"forte|media|fraca","o_que_confirma":"..","tese":".."}],"se_eu_fosse_voce":"..",' +
    '"precisamos_de_voce":".."}';

  const r1 = await chamarAgente(env, system + ctx.naoRepita + formato, corpo, undefined, 0.45);
  if (!r1.ok) return VAZIO;
  const d1 = r1.dados as any;

  let { aprovadas, reprovadas, avisos } = julgarTodas(lerLeituras(d1), ctx.juiz);

  // A segunda chance roda quando não sobrou nada aprovado — seja porque tudo
  // foi reprovado, seja porque a mesa devolveu lista vazia tendo material na
  // mão.
  const esquivou = !aprovadas.length && !reprovadas.length && ctx.material.temMaterial;
  if ((reprovadas.length || esquivou) && !aprovadas.length) {
    const empurrao = reprovadas.length
      ? formatarReprovacao(reprovadas)
      : '⚠ VOCÊS DEVOLVERAM A LISTA VAZIA TENDO MATERIAL NA MÃO:\n' +
        ctx.material.linhas.map((l) => '- ' + l).join('\n') +
        '\n\nIsso não passa. Com família de produto se movendo e palavra circulando, existe pelo menos uma ' +
        'leitura defensável a fazer — e é justamente a que o João está esperando. Escolha uma família medida ' +
        'hoje, cite os números dela como estão escritos, diga o que a linguagem dela vira num produto que a ' +
        'casa fabrica, e declare a confiança honesta. Se ainda assim acharem que não há nada, a lista vazia ' +
        'precisa vir com o motivo específico: o que exatamente faltou, e o que destravaria.';

    const r2 = await chamarAgente(env, system + ctx.naoRepita + formato, corpo + '\n\n' + empurrao, undefined, 0.4);
    if (r2.ok) {
      const d2 = r2.dados as any;
      const segunda = julgarTodas(lerLeituras(d2), ctx.juiz);
      aprovadas = segunda.aprovadas;
      avisos = [...avisos, ...segunda.avisos];
      // Guarda as duas rodadas de reprovação: é o registro de que a mesa
      // tentou empurrar vaguidão duas vezes, e isso é informação sobre ela.
      reprovadas = [...reprovadas, ...segunda.reprovadas];
      if (segunda.aprovadas.length || String(d2?.se_eu_fosse_voce || '').trim()) {
        d1.se_eu_fosse_voce = d2?.se_eu_fosse_voce || d1?.se_eu_fosse_voce;
        d1.precisamos_de_voce = d2?.precisamos_de_voce || d1?.precisamos_de_voce;
      }
    }
  }

  return {
    leituras: aprovadas,
    reprovadas: reprovadas.map((x) => ({ o_que: x.leitura.o_que_o_mercado_pede, motivos: x.motivos })),
    avisos,
    se_eu_fosse_voce: String(d1?.se_eu_fosse_voce || '').slice(0, 600),
    precisamos_de_voce: String(d1?.precisamos_de_voce || '').slice(0, 400),
  };
}

/** As leituras das últimas atas, no formato que o juiz usa pra barrar repetição sem avanço. */
export async function leiturasAnteriores(env: Env, quantasAtas = 4): Promise<{ texto: string; numeros: number[] }[]> {
  try {
    const q = await env.DB.query(
      "SELECT leituras FROM atas WHERE leituras IS NOT NULL AND leituras != '[]' ORDER BY quando DESC LIMIT ?",
      [quantasAtas],
    );
    const saida: { texto: string; numeros: number[] }[] = [];
    for (const linha of q.rows) {
      let ls: any[] = [];
      try { ls = JSON.parse(String(linha.leituras || '[]')); } catch { ls = []; }
      for (const l of ls) {
        const texto = String(l?.o_que_o_mercado_pede || '');
        if (texto) saida.push({ texto, numeros: numerosDoTexto(String(l?.evidencia || '')) });
      }
    }
    return saida;
  } catch {
    return [];
  }
}
