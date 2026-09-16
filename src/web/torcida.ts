// A VOZ DA TORCIDA — o que o torcedor está dizendo, com as palavras dele.
//
// É a fonte que faltava pra mesa saber o que o cliente sente, e não só o que
// ele comprou. Venda é resultado; isto é o assunto. Apelido novo de jogador,
// zoação que pegou, revolta com uniforme, meme de clássico — é daqui que sai
// estampa com graça, e nenhum datamart registra isso.
//
// Reddit por RSS, não pela API: o .json público devolve 403 para chamada
// server-side sem token (testado em 16/09/2026), enquanto o .rss responde 200
// normalmente. Menos campo, mas é o que funciona sem credencial.

import { buscarFeed, filtrarPorPalavras, type ItemDeFeed } from './http';
import { REGEX_CLUBES_LICENCIADOS } from '../fontes/clubesLicenciados';

const FEEDS = [
  { fonte: 'r/futebol', url: 'https://www.reddit.com/r/futebol/hot/.rss?limit=25', filtrar: false },
  { fonte: 'r/soccer', url: 'https://www.reddit.com/r/soccer/hot/.rss?limit=25', filtrar: true },
];

export interface Torcida {
  ok: boolean;
  assuntos: ItemDeFeed[];
  falhas: string[];
}

export async function buscarTorcida(): Promise<Torcida> {
  const regex = new RegExp(REGEX_CLUBES_LICENCIADOS, 'i');
  const rs = await Promise.all(FEEDS.map((f) => buscarFeed(f.url, f.fonte, 25)));
  const assuntos: ItemDeFeed[] = [];
  const falhas: string[] = [];

  rs.forEach((r, i) => {
    if (!r.ok) { falhas.push(`${FEEDS[i].fonte}: ${r.erro}`); return; }
    // O sub brasileiro entra inteiro; o internacional só quando fala de clube
    // nosso — senão a mesa recebe Premier League, que não vende aqui.
    assuntos.push(...(FEEDS[i].filtrar ? filtrarPorPalavras(r.itens, regex) : r.itens));
  });

  return { ok: assuntos.length > 0, assuntos: assuntos.slice(0, 20), falhas };
}

export function formatarTorcida(t: Torcida): string {
  if (!t.ok) return `VOZ DA TORCIDA: não carregou (${t.falhas.join('; ')}).`;
  return (
    'O QUE A TORCIDA ESTÁ FALANDO (Reddit, agora) — é o assunto, não a venda. Serve pra pegar apelido, piada e ' +
    'revolta que ninguém registra em banco nenhum:\n' +
    t.assuntos.slice(0, 14).map((i) => `- [${i.fonte}] ${i.titulo} · ${i.link}`).join('\n') +
    (t.falhas.length ? `\n(falhas: ${t.falhas.join('; ')})` : '')
  );
}
