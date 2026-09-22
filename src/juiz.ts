// O JUIZ: o filtro que reprova leitura genérica ANTES de ela chegar no João.
//
// POR QUE EM CÓDIGO E NÃO EM PROMPT (João, 16/09/2026: "recomendação
// genérica"): pedir num prompt "seja específico" é o tipo de instrução que o
// modelo concorda com entusiasmo e desobedece na frase seguinte. Instrução é
// conselho; isto aqui é porta.
//
// ━━ A VIRADA DE 22/09/2026 ━━
//
// A régua antiga exigia CLUBE + PRODUTO + NÚMERO + PRAZO. Ela resolvia a
// queixa de 16/09 e criava outra, que o João formulou assim: "não adianta me
// dar um direcionamento 'clube tal, estampa minimalista'. Eu quero tipo assim:
// o público masculino tem procurado por X Y Z de produtos, podemos adaptar
// para os produtos dessa forma. E aí depois disso, eu irei pensar como fazer
// virar uma demanda de futebol."
//
// Ou seja: o juiz estava FORÇANDO o formato errado. Exigir clube e prazo
// empurra a mesa para o palpite tático de véspera; o que ele quer é a leitura
// do mercado com a ponte para os produtos da casa — e a decisão de futebol é
// dele, depois.
//
// A régua nova, então, mede outra coisa. Uma leitura passa se:
//
//   1. nomear a CATEGORIA/família de produto de que está falando;
//   2. trazer um NÚMERO QUE FOI MEDIDO HOJE — conferido contra o dado da
//      rodada, não só "um dígito no texto" (era a brecha antiga: "+15%"
//      inventado passava);
//   3. dizer COMO ISSO CABE num produto que a casa já fabrica;
//   4. declarar CONFIANÇA compatível com a evidência — "forte" exige número de
//      PROCURA, não basta oferta de catálogo;
//   5. dizer O QUE CONFIRMARIA OU DERRUBARIA na próxima rodada — sem isso a
//      tese não evolui, e a reunião de amanhã recomeça do zero;
//   6. não repetir uma leitura anterior sem número novo.
//
// O que saiu de vez: a exigência de clube, a exigência de prazo, e a regra de
// "clube já batido". Repetir ASSUNTO agora é desejável — é assim que a mesa
// aprofunda. O que não pode é repetir CONCLUSÃO sem evidência nova, e é a
// regra 6 que cuida disso.

/** O que a mesa entrega ao João. Substituiu a Recomendacao tática em 22/09/2026. */
export interface Leitura {
  /** O padrão de demanda observado, com a categoria pelo nome. */
  o_que_o_mercado_pede: string;
  /** Os números da rodada que sustentam isso, com a fonte. */
  evidencia: string;
  /** A ponte: como isso vira um produto que a casa JÁ fabrica. */
  como_cabe: string;
  confianca: 'forte' | 'media' | 'fraca';
  /** O que, na próxima rodada, confirmaria ou derrubaria esta leitura. */
  o_que_confirma: string;
  /** A tese de fundo que esta leitura sustenta — o fio que atravessa as reuniões. */
  tese: string;
}

export interface Veredito {
  aprovada: boolean;
  motivos: string[];
  /** Números citados que NÃO batem com o dado da rodada. Não reprovam sozinhos; viram aviso na ata. */
  numerosNaoConferidos: number[];
}

/** O que o juiz precisa saber da rodada para conferir. */
export interface ContextoDoJuiz {
  /** Famílias do mapa de demanda desta rodada. */
  familias: string[];
  /** Palavras do mercado medidas hoje. */
  palavras: string[];
  /** O que a casa fabrica. */
  produtosDaCasa: string[];
  /** Todo número que a rodada mediu de verdade. */
  numeros: Set<number>;
  /** Só os números de PROCURA (Wikipédia, trends). Sustentam "confiança forte". */
  numerosDeProcura: Set<number>;
  /** As leituras das rodadas anteriores, para barrar repetição sem avanço. */
  anteriores: { texto: string; numeros: number[] }[];
}

/** minúsculas e sem acento — pra "Grêmio" casar com "gremio". */
export function normalizar(s: string): string {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

// O que não pode aparecer sozinho no lugar de uma leitura. Cada uma destas já
// saiu numa ata de verdade desta mesa.
const VAGUIDOES = [
  'explorar', 'aproveitar a data', 'reforcar a comunicacao', 'acompanhar de perto',
  'criar algo especial', 'potencializar', 'alavancar', 'engajamento', 'sinergia',
  'avaliar a possibilidade', 'estudar', 'mapear oportunidades', 'fortalecer a presenca',
  'trabalhar melhor', 'melhorar o processo', 'otimizar', 'estar atento', 'ficar de olho',
];

/**
 * Os números que um texto afirma. Aceita "1.000", "1,000", "18%", "£42", "+15%"
 * e devolve inteiros positivos — é assim que dá pra comparar com o que foi
 * medido, já que a mesa escreve o número no formato que quiser.
 */
export function numerosDoTexto(texto: string): number[] {
  const achados = String(texto || '').match(/\d[\d.,]*/g) || [];
  const saida: number[] = [];
  for (const bruto of achados) {
    // "1.000" e "1,000" são mil; "4.5" é quatro e meio. A diferença está em
    // quantos dígitos vêm depois do separador.
    const limpo = bruto.replace(/[.,](\d{3})\b/g, '$1').replace(/[.,]\d+$/, '');
    const n = Number(limpo.replace(/[.,]/g, ''));
    if (isFinite(n) && n > 0) saida.push(Math.round(n));
  }
  return saida;
}

/**
 * As janelas de tempo que a mesa repete em toda rodada ("em 45 dias", "14
 * dias"). São vocabulário, não evidência: não contam como número novo na hora
 * de decidir se uma leitura repetida trouxe avanço — senão bastaria escrever
 * "45 dias" para reapresentar a mesma leitura todo dia.
 */
const JANELAS = new Set([14, 28, 45]);

/**
 * Um número "bate" quando foi medido hoje. A tolerância de 1 existe porque a
 * mesa arredonda percentual ao escrever (18% de 115/630 pode sair como 18 ou
 * 19) — e brigar por um ponto reprovaria leitura honesta.
 */
function bate(n: number, medidos: Set<number>): boolean {
  return medidos.has(n) || medidos.has(n + 1) || medidos.has(n - 1);
}

function citaAlgumDe(texto: string, lista: string[]): string | null {
  const t = normalizar(texto);
  for (const item of lista) {
    const n = normalizar(item);
    if (n.length >= 3 && t.includes(n)) return item;
  }
  return null;
}

/** Palavras que carregam sentido, pra medir se duas leituras dizem a mesma coisa. */
function palavrasCheias(texto: string): Set<string> {
  const vazias = new Set([
    'que', 'com', 'para', 'por', 'dos', 'das', 'uma', 'nos', 'nas', 'mais', 'esta', 'este',
    'como', 'sobre', 'entre', 'ainda', 'pelo', 'pela', 'seus', 'suas', 'tem', 'sao', 'foi',
    'mercado', 'publico', 'produto', 'produtos', 'categoria', 'casa',
  ]);
  return new Set(
    (normalizar(texto).match(/[a-z]{4,}/g) || []).filter((w) => !vazias.has(w)),
  );
}

/** Quanto duas leituras se sobrepõem, de 0 a 1. */
function semelhanca(a: string, b: string): number {
  const A = palavrasCheias(a);
  const B = palavrasCheias(b);
  if (!A.size || !B.size) return 0;
  let comuns = 0;
  for (const w of A) if (B.has(w)) comuns += 1;
  return comuns / Math.min(A.size, B.size);
}

/**
 * Julga UMA leitura contra o que a rodada mediu. Sem IA: ou o texto nomeia as
 * coisas que existem e cita número que foi medido, ou não cita.
 */
export function julgar(l: Leitura, ctx: ContextoDoJuiz): Veredito {
  const motivos: string[] = [];
  const oque = String(l.o_que_o_mercado_pede || '');
  const evid = String(l.evidencia || '');
  const ponte = String(l.como_cabe || '');

  if (oque.trim().length < 20) {
    return {
      aprovada: false,
      numerosNaoConferidos: [],
      motivos: ['a leitura está vazia ou curta demais pra alguém entender do que se trata'],
    };
  }

  // 1. A categoria pelo nome. Só exigimos quando o mapa de demanda de fato
  // carregou — se a fonte caiu, não é justo (nem útil) reprovar por isso.
  const vocabulario = [...ctx.familias, ...ctx.palavras, ...ctx.produtosDaCasa];
  if (vocabulario.length && !citaAlgumDe(oque + ' ' + evid, vocabulario)) {
    motivos.push(
      'não diz DE QUE CATEGORIA DE PRODUTO se trata. Nomeie uma das famílias medidas nesta rodada ' +
      (ctx.familias.length ? '(ex.: ' + ctx.familias.slice(0, 5).join(', ') + ')' : '') +
      ' — "o público quer novidade" não é categoria.',
    );
  }

  // 2. Número medido hoje. Esta é a regra que fecha a brecha antiga: não basta
  // ter dígito no texto, o dígito tem que ser um número que a rodada mediu.
  const citados = numerosDoTexto(evid);
  const naoConferidos = citados.filter((n) => !bate(n, ctx.numeros));
  if (!citados.length) {
    motivos.push(
      'a evidência não tem número nenhum. Cole o número da rodada: itens na família, lançamentos em 45 dias, ' +
      'o share dos lançamentos, o preço médio, as leituras de procura.',
    );
  } else if (ctx.numeros.size && citados.every((n) => !bate(n, ctx.numeros))) {
    motivos.push(
      'nenhum dos números que você citou (' + citados.join(', ') + ') foi medido nesta rodada. Número que não ' +
      'saiu do dado de hoje é número inventado, e é exatamente o que esta conferência existe pra barrar. ' +
      'Use os do mapa de demanda e das leituras de procura, como eles estão escritos.',
    );
  }

  // 3. A ponte. É a metade da entrega que o João pediu com todas as letras —
  // "podemos adaptar para os produtos dessa forma".
  if (ponte.trim().length < 25) {
    motivos.push(
      'falta dizer COMO ISSO CABE nos nossos produtos. Não basta observar o mercado: diga o que vira ' +
      'estampa, cor, gráfica ou linha num produto que a casa já fabrica.',
    );
  } else if (ctx.produtosDaCasa.length && !citaAlgumDe(ponte, ctx.produtosDaCasa)) {
    motivos.push(
      'a ponte não nomeia nenhum produto da casa. Diga em qual: ' + ctx.produtosDaCasa.slice(0, 8).join(', ') + '…',
    );
  }

  // 4. Confiança compatível com a evidência. "Forte" apoiada só em catálogo é
  // a mentira mais fácil de contar aqui: oferta é o que a indústria apostou,
  // não o que o consumidor procurou.
  if (l.confianca === 'forte') {
    const temProcura = citados.some((n) => bate(n, ctx.numerosDeProcura));
    if (!temProcura) {
      motivos.push(
        'você declarou confiança FORTE sem citar um número de procura. Oferta de catálogo mede o que o ' +
        'mercado apostou, não o que o público pediu — com só isso na mão, a confiança honesta é "média". ' +
        'Ou cite a procura medida, ou baixe a confiança.',
      );
    }
  }

  // 5. O que confirma. Sem isto a tese não evolui e a reunião de amanhã
  // recomeça do zero — que é a queixa de fundo do João sobre progressão.
  if (String(l.o_que_confirma || '').trim().length < 15) {
    motivos.push(
      'falta dizer O QUE CONFIRMARIA OU DERRUBARIA isto na próxima rodada. Uma leitura que não se expõe a ' +
      'ser desmentida não é leitura, é opinião — e a mesa de amanhã não tem como avançar nela.',
    );
  }

  // 6. Vaguidão explícita.
  const vago = citaAlgumDe(oque, VAGUIDOES) || citaAlgumDe(ponte, VAGUIDOES);
  if (vago) {
    motivos.push('a frase se apoia em "' + vago + '", que é enfeite. Diga a observação concreta que substitui isso.');
  }

  // 7. Repetição sem avanço. Voltar ao mesmo assunto é BOM — é como a tese
  // amadurece. O que não vale é repetir a conclusão com os mesmos números,
  // fingindo rodada nova.
  for (const ant of ctx.anteriores) {
    if (semelhanca(oque, ant.texto) < 0.6) continue;
    const numeroNovo = citados
      .filter((n) => !JANELAS.has(n))
      .some((n) => !ant.numeros.some((m) => Math.abs(m - n) <= 1));
    if (!numeroNovo) {
      motivos.push(
        'esta é a mesma leitura de uma rodada anterior, com os mesmos números. Repetir o assunto é bom — ' +
        'aprofundar é o trabalho. Mas então traga a medição NOVA que fez a tese andar: o que mudou desde ' +
        'ontem, quanto mudou, e o que isso acrescenta. Se nada mudou, diga isso em vez de reapresentar.',
      );
    }
    break;
  }

  return { aprovada: motivos.length === 0, motivos, numerosNaoConferidos: naoConferidos };
}

export interface Julgamento {
  aprovadas: Leitura[];
  reprovadas: { leitura: Leitura; motivos: string[] }[];
  /** Avisos que não reprovam, mas o João merece ver na ata. */
  avisos: string[];
}

export function julgarTodas(leituras: Leitura[], ctx: ContextoDoJuiz): Julgamento {
  const aprovadas: Leitura[] = [];
  const reprovadas: { leitura: Leitura; motivos: string[] }[] = [];
  const avisos: string[] = [];
  for (const l of leituras) {
    const v = julgar(l, ctx);
    if (v.aprovada) {
      aprovadas.push(l);
      if (v.numerosNaoConferidos.length) {
        avisos.push(
          '"' + l.o_que_o_mercado_pede.slice(0, 70) + '…" cita ' + v.numerosNaoConferidos.join(', ') +
          ', que não bate com nada medido nesta rodada — pode ser conta derivada, pode ser número solto.',
        );
      }
    } else {
      reprovadas.push({ leitura: l, motivos: v.motivos });
    }
  }
  return { aprovadas, reprovadas, avisos };
}

/** O texto que volta pra mesa na segunda tentativa. Direto, com o motivo de cada uma. */
export function formatarReprovacao(reprovadas: { leitura: Leitura; motivos: string[] }[]): string {
  return (
    '⚠ AS LEITURAS ABAIXO FORAM REPROVADAS NA CONFERÊNCIA. Elas não chegaram ao João, e não vão chegar ' +
    'do jeito que estão.\n\n' +
    reprovadas.map((r, i) =>
      (i + 1) + '. "' + r.leitura.o_que_o_mercado_pede + '"\n   Reprovada porque:\n' +
      r.motivos.map((m) => '   - ' + m).join('\n'),
    ).join('\n\n') +
    '\n\nRefaça SÓ estas, corrigindo exatamente o que está apontado. Duas saídas honestas existem e são ' +
    'melhores que insistir: (a) reescrever com a categoria, o número medido hoje e a ponte de produto de ' +
    'verdade; (b) devolver a lista VAZIA, dizendo que o dado de hoje não sustenta leitura nenhuma. ' +
    'O que não vale é maquiar a mesma frase com outras palavras — a conferência é a mesma e vai reprovar de novo.'
  );
}
