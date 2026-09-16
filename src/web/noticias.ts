// NOTÍCIA DO MERCADO — o que o resto do mundo está lançando, vestindo e
// falando, por busca livre no Google Notícias.
//
// Esta é a fonte que mais mudou o que a mesa consegue enxergar. Antes ela lia
// o RSS de futebol do ge.globo: bom pra saber o resultado do jogo, inútil pra
// saber que "Vasco e Stanley lançaram coleção licenciada no Dia dos Pais" —
// que é exatamente o tipo de coisa que decide o que a Gocase faz no mês.
//
// O Google Notícias aceita qualquer consulta e devolve RSS em português, sem
// chave. Três eixos, porque são três perguntas diferentes:
//   CONCORRÊNCIA — quem lançou o quê no licenciado, com que marca e em que data
//   UNIFORME     — camisa nova é o gatilho mais forte de estampa que existe
//   CLUBE        — o assunto do clube que joga na janela, na voz da imprensa
//
// Confirmado ao vivo em 16/09/2026: 100 itens por consulta, HTTP 200.

import { buscarFeed, type ItemDeFeed } from './http';

// `when:21d` é operador do próprio Google Notícias e é indispensável: sem ele a
// busca ordena por relevância e devolve matéria de abril como se fosse notícia
// — a mesa abriria a reunião de setembro comentando o Dia dos Pais.
function consulta(q: string, janela = '21d'): string {
  return `https://news.google.com/rss/search?q=${encodeURIComponent(`${q} when:${janela}`)}&hl=pt-BR&gl=BR&ceid=BR:pt-150`;
}

const DIAS_ACEITOS = 30;

/** Segunda trava, já que o operador do Google às vezes deixa passar item velho. */
function recente(i: { data: string }): boolean {
  if (!i.data) return true;
  const t = new Date(i.data).getTime();
  if (!isFinite(t)) return true;
  return (Date.now() - t) / 86400000 <= DIAS_ACEITOS;
}

// O Google Notícias devolve o título com " - Veículo" no fim; o veículo é
// informação boa (diz se é imprensa esportiva ou de negócios) e fica.
function arrumar(itens: ItemDeFeed[], fonte: string): ItemDeFeed[] {
  return itens
    .filter(recente)
    .map((i) => ({ ...i, fonte, resumo: i.resumo.replace(/\s*<[^>]*>\s*/g, ' ').slice(0, 220) }));
}

export interface NoticiasDoMercado {
  ok: boolean;
  concorrencia: ItemDeFeed[];
  uniformes: ItemDeFeed[];
  clubes: ItemDeFeed[];
  falhas: string[];
}

/** `emFoco` são os clubes que jogam na janela — a busca por clube é feita só pra eles. */
export async function buscarNoticiasDoMercado(emFoco: string[] = []): Promise<NoticiasDoMercado> {
  const clubesDaVez = emFoco.slice(0, 3);
  const buscas: { chave: 'concorrencia' | 'uniformes' | 'clubes'; fonte: string; url: string }[] = [
    { chave: 'concorrencia', fonte: 'licenciamento', url: consulta('coleção licenciada futebol lançamento produto oficial clube') },
    { chave: 'concorrencia', fonte: 'licenciamento', url: consulta('marca lança linha oficial time brasileiro parceria') },
    { chave: 'uniformes', fonte: 'uniformes', url: consulta('nova camisa uniforme clube brasileiro lançamento') },
    ...clubesDaVez.map((c) => ({ chave: 'clubes' as const, fonte: c, url: consulta(`${c} torcida camisa`) })),
  ];

  const rs = await Promise.all(buscas.map((b) => buscarFeed(b.url, b.fonte, 10)));
  const saida: NoticiasDoMercado = { ok: false, concorrencia: [], uniformes: [], clubes: [], falhas: [] };

  rs.forEach((r, i) => {
    const b = buscas[i];
    if (!r.ok) { saida.falhas.push(`${b.fonte}: ${r.erro}`); return; }
    saida[b.chave].push(...arrumar(r.itens, b.fonte));
  });

  // O Google repete a mesma matéria em veículos diferentes; sem dedupe a mesa
  // lê quatro vezes que o Fluminense lançou camisa.
  const vistos = new Set<string>();
  const unico = (itens: ItemDeFeed[]) => itens.filter((i) => {
    const chave = i.titulo.slice(0, 45).toLowerCase();
    return vistos.has(chave) ? false : (vistos.add(chave), true);
  });
  saida.concorrencia = unico(saida.concorrencia).slice(0, 10);
  saida.uniformes = unico(saida.uniformes).slice(0, 8);
  saida.clubes = unico(saida.clubes).slice(0, 12);
  saida.ok = saida.concorrencia.length + saida.uniformes.length + saida.clubes.length > 0;
  return saida;
}

export function formatarNoticiasDoMercado(n: NoticiasDoMercado): string {
  if (!n.ok) return `NOTÍCIA DE MERCADO: nenhuma consulta respondeu (${n.falhas.join('; ')}).`;
  const linha = (i: ItemDeFeed) => `- ${i.titulo}${i.data ? ` (${i.data.slice(0, 16)})` : ''} · ${i.link}`;
  const partes: string[] = [];

  if (n.concorrencia.length) {
    partes.push(
      'O QUE O MERCADO LICENCIADO ESTÁ LANÇANDO (Google Notícias, busca de agora) — é a concorrência real da ' +
      'Gocase, com marca, produto e data:\n' + n.concorrencia.map(linha).join('\n'),
    );
  }
  if (n.uniformes.length) {
    partes.push(
      '\n\nCAMISA NOVA NO BRASIL (o gatilho de estampa mais forte que existe):\n' + n.uniformes.map(linha).join('\n'),
    );
  }
  if (n.clubes.length) {
    partes.push(
      '\n\nO ASSUNTO DOS CLUBES QUE JOGAM NESTA JANELA:\n' + n.clubes.map(linha).join('\n'),
    );
  }
  if (n.falhas.length) partes.push(`\n\n(consultas com falha: ${n.falhas.join('; ')})`);
  return partes.join('');
}
