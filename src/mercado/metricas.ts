// AS MÉTRICAS DE MERCADO — o que a mesa pode medir, e que o CÓDIGO calcula.
//
// POR QUE ISTO EXISTE, e por que substitui o SQL (João, 18/09/2026: "não
// precisamos do número de vendas, nem sei como tá sendo calculado isso"):
//
// Até aqui a mesa testava hipótese escrevendo SQL contra a venda própria. Dois
// problemas, e os dois eram fatais. O técnico: a consulta dependia do modelo
// escrever SQL válido e do datamart responder em 40s — e quando qualquer um
// dos dois falhava, a reunião inteira ficava sem número e terminava em "não há
// o que recomendar". O de fundo: mesmo funcionando, ela media a Gocase contra
// ela mesma, e não contra o mercado.
//
// Agora a hipótese é testada contra DADOS DE MERCADO que já estão na mão da
// reunião — procura real, oferta e preço das lojas, presença do tema na
// imprensa e na conversa. O modelo escolhe QUAL comparação quer; a conta é
// feita aqui, em JavaScript puro, sobre dados já coletados. Não há rede, não
// há timeout, não há SQL malformado: uma métrica sempre devolve número.

import type { Mundo } from '../web/mundo';
import type { Vitrine } from '../web/vitrine';

export type NomeDaMetrica =
  | 'procura_do_clube'
  | 'comparar_procura'
  | 'oferta_da_categoria'
  | 'comparar_oferta'
  | 'presenca_do_tema'
  | 'agenda_do_clube';

export interface PedidoDeTeste {
  pergunta: string;
  hipotese: string;
  metrica: NomeDaMetrica;
  alvo_a: string;
  alvo_b?: string;
}

export interface Medicao {
  ok: boolean;
  numeros: string;
  /** Quando não deu pra medir, o motivo — sempre acionável. */
  erro?: string;
}

const norm = (s: string) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();

function acharClube(m: Mundo, alvo: string) {
  const a = norm(alvo);
  return m.procura.clubes.find((c) => norm(c.clube) === a)
    || m.procura.clubes.find((c) => norm(c.clube).includes(a) || a.includes(norm(c.clube)));
}

function acharCategoria(v: Vitrine, alvo: string) {
  const a = norm(alvo);
  return v.categorias.find((c) => norm(c.tipo) === a)
    || v.categorias.find((c) => norm(c.tipo).includes(a) || a.includes(norm(c.tipo)));
}

/** Quantas vezes um tema aparece no que o mundo trouxe hoje. Conta e mostra onde. */
function contarTema(m: Mundo, v: Vitrine, tema: string) {
  const t = norm(tema);
  if (t.length < 3) return null;
  const bate = (s: string) => norm(s).includes(t);

  const noticias = [...m.noticias.concorrencia, ...m.noticias.uniformes, ...m.noticias.clubes]
    .filter((i) => bate(i.titulo) || bate(i.resumo));
  const torcida = m.torcida.assuntos.filter((i) => bate(i.titulo));
  const estetica = [...m.estetica.uniformes, ...m.estetica.cultura_visual].filter((i) => bate(i.titulo) || bate(i.resumo));
  const cultura = m.procura.temas.filter((x) => bate(x.titulo) || bate(x.oque));
  const prateleira = v.novidades.filter((p) => bate(p.titulo) || p.tags.some(bate));

  return { noticias, torcida, estetica, cultura, prateleira };
}

/** O menu que vai no prompt: o que dá pra medir e sobre o quê. */
export function catalogoDeMetricas(m: Mundo, v: Vitrine): string {
  const clubes = m.procura.clubes.map((c) => c.clube);
  const emJogo = m.clubesEmJogo;
  const categorias = v.categorias.slice(0, 12).map((c) => c.tipo);

  return [
    '━━ O QUE VOCÊ PODE MEDIR NESTA RODADA ━━',
    'Você NÃO escreve consulta e NÃO inventa número. Você ESCOLHE uma medição da lista abaixo, e o sistema faz',
    'a conta com o dado já coletado. Toda medição devolve número — não existe "não consegui medir".',
    '',
    '1. procura_do_clube — quanta gente procurou um clube em 14 dias e a variação contra os 14 anteriores.',
    '   alvo_a: nome do clube.',
    '2. comparar_procura — a procura de dois clubes, lado a lado. alvo_a e alvo_b: dois clubes.',
    '3. oferta_da_categoria — quantos itens o mercado tem numa categoria, quantos entraram em 45 dias e a',
    '   faixa de preço. alvo_a: nome da categoria.',
    '4. comparar_oferta — duas categorias, lado a lado: quem está lotado e quem está vazio.',
    '5. presenca_do_tema — quantas vezes um tema aparece hoje na imprensa, na conversa da torcida, nos feeds de',
    '   estética, na cultura em alta e na prateleira do mercado. alvo_a: a palavra ou expressão do tema.',
    '6. agenda_do_clube — se o clube entra em campo na janela e em quantos dias. alvo_a: nome do clube.',
    '',
    `CLUBES COM PROCURA MEDIDA: ${clubes.join(', ') || '(nenhum)'}`,
    `CLUBES QUE JOGAM NA JANELA: ${emJogo.join(', ') || '(nenhum)'}`,
    `CATEGORIAS DO MERCADO: ${categorias.join(' | ') || '(nenhuma)'}`,
    'TEMAS: qualquer palavra que você queira testar (um motivo gráfico, um personagem, uma estética, um clube).',
  ].join('\n');
}

export function medir(pedido: PedidoDeTeste, m: Mundo, v: Vitrine): Medicao {
  switch (pedido.metrica) {
    case 'procura_do_clube': {
      const c = acharClube(m, pedido.alvo_a);
      if (!c) return { ok: false, numeros: '', erro: `não tenho série de procura para "${pedido.alvo_a}" nesta rodada` };
      return {
        ok: true,
        numeros: `${c.clube}: ${c.views_14d} leituras em 14 dias contra ${c.views_14d_ant} nos 14 anteriores` +
          (c.variacao_pct === null ? ' (sem base pra variação)' : ` — ${c.variacao_pct > 0 ? '+' : ''}${c.variacao_pct}%`) +
          (c.pico ? `; pico em ${c.pico.dia} com ${c.pico.views}` : ''),
      };
    }

    case 'comparar_procura': {
      const a = acharClube(m, pedido.alvo_a);
      const b = pedido.alvo_b ? acharClube(m, pedido.alvo_b) : undefined;
      if (!a || !b) return { ok: false, numeros: '', erro: `preciso de dois clubes com série medida (recebi "${pedido.alvo_a}" e "${pedido.alvo_b || '—'}")` };
      const razao = b.views_14d > 0 ? (a.views_14d / b.views_14d).toFixed(2) : '—';
      return {
        ok: true,
        numeros: `${a.clube}: ${a.views_14d} leituras/14d (${a.variacao_pct ?? '?'}%) | ${b.clube}: ${b.views_14d} (${b.variacao_pct ?? '?'}%). ` +
          `${a.clube} tem ${razao}x a procura de ${b.clube}.`,
      };
    }

    case 'oferta_da_categoria': {
      const c = acharCategoria(v, pedido.alvo_a);
      if (!c) return { ok: false, numeros: '', erro: `categoria "${pedido.alvo_a}" não está na vitrine desta rodada` };
      return {
        ok: true,
        numeros: `${c.tipo}: ${c.quantidade} itens no catálogo, ${c.novos_45d} entraram nos últimos 45 dias, ` +
          `preço médio ${c.preco_medio} (de ${c.preco_min} a ${c.preco_max}).`,
      };
    }

    case 'comparar_oferta': {
      const a = acharCategoria(v, pedido.alvo_a);
      const b = pedido.alvo_b ? acharCategoria(v, pedido.alvo_b) : undefined;
      if (!a || !b) return { ok: false, numeros: '', erro: `preciso de duas categorias da vitrine (recebi "${pedido.alvo_a}" e "${pedido.alvo_b || '—'}")` };
      return {
        ok: true,
        numeros: `${a.tipo}: ${a.quantidade} itens, ${a.novos_45d} novos, médio ${a.preco_medio} | ` +
          `${b.tipo}: ${b.quantidade} itens, ${b.novos_45d} novos, médio ${b.preco_medio}.`,
      };
    }

    case 'presenca_do_tema': {
      const r = contarTema(m, v, pedido.alvo_a);
      if (!r) return { ok: false, numeros: '', erro: 'tema curto demais pra medir (use ao menos 3 letras)' };
      const total = r.noticias.length + r.torcida.length + r.estetica.length + r.cultura.length + r.prateleira.length;
      const exemplos = [
        ...r.noticias.slice(0, 2).map((i) => `imprensa: "${i.titulo.slice(0, 80)}"`),
        ...r.prateleira.slice(0, 2).map((p) => `prateleira: "${p.titulo.slice(0, 60)}" (${p.loja}, ${p.preco})`),
        ...r.cultura.slice(0, 1).map((c) => `cultura: ${c.titulo} (${c.views} leituras)`),
      ];
      return {
        ok: true,
        numeros: `"${pedido.alvo_a}" aparece ${total}x hoje: ${r.noticias.length} na imprensa, ${r.torcida.length} na ` +
          `conversa da torcida, ${r.estetica.length} nos feeds de estética, ${r.cultura.length} na cultura em alta, ` +
          `${r.prateleira.length} já na prateleira do mercado.` +
          (exemplos.length ? ` Exemplos — ${exemplos.join(' ; ')}` : '') +
          (total === 0 ? ' ZERO ocorrências: ou o tema é território virgem, ou é irrelevante — a diferença está em quem procura por ele.' : ''),
      };
    }

    case 'agenda_do_clube': {
      const a = norm(pedido.alvo_a);
      const jogos = m.calendario.proximos.filter((j) => norm(j.mandante).includes(a) || norm(j.visitante).includes(a));
      if (!jogos.length) {
        return { ok: true, numeros: `${pedido.alvo_a} NÃO entra em campo na janela de 14 dias. Sem gatilho de data para esse clube agora.` };
      }
      return {
        ok: true,
        numeros: jogos.map((j) => `${j.mandante} x ${j.visitante} em ${j.data} (daqui a ${j.em_dias} dias)${j.classico ? ' — CLÁSSICO' : ''}`).join(' | '),
      };
    }

    default:
      return { ok: false, numeros: '', erro: `medição "${pedido.metrica}" não existe` };
  }
}
