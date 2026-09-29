// A agenda de jogos: quem entra, por quê, e como aparece.
import { escolherJogos, outrosJogos, ehLicenciado, quandoLegivel, linhasDaAgenda } from '../src/agenda';
import { classificar } from '../src/web/tabela';
import type { Jogo } from '../src/web/calendario';

let falhas = 0;
function ok(cond: boolean, nome: string) { if (!cond) { falhas++; console.log('✖ ' + nome); } }

ok(ehLicenciado('Ceará') && ehLicenciado('ceara'), 'Ceará é licenciado, com ou sem acento');
ok(!ehLicenciado('Botafogo-SP') && !ehLicenciado('Atlético-GO'), 'homônimo não é licenciado');

const j = (m: string, v: string, em: number, extra: Partial<Jogo> = {}): Jogo => ({
  rodada: 29, data: `2026-10-0${em}`, hora: '21:30', mandante: m, visitante: v, local: null, placar: null,
  em_dias: em, classico: false, campeonato: 'Série A', ...extra,
});
const jogos = [
  j('Flamengo', 'Mirassol', 1),
  j('Grêmio', 'Internacional', 2, { classico: true }),
  j('Remo', 'Chapecoense', 2),
  j('Ceará', 'Novorizontino', 1, { campeonato: 'Série B' }),
  j('Sport', 'Fortaleza', 3, { campeonato: 'Série B' }),
  j('Palmeiras', 'Santos', 9),
  j('Flamengo', 'Mirassol', 1),
];
const tabela = { ok: true, campeonato: 'x', fim: null, rodada: 29, clubes: classificar([
  { ordem: 1, nome_popular: 'Flamengo', pontos: 60, jogos: 28 },
  ...Array.from({ length: 15 }, (_, i) => ({ ordem: 2 + i, nome_popular: 'M' + i, pontos: 50 - i, jogos: 28 })),
  { ordem: 17, nome_popular: 'Grêmio', pontos: 29, jogos: 28 },
  { ordem: 18, nome_popular: 'Internacional', pontos: 28, jogos: 28 },
  { ordem: 19, nome_popular: 'Remo', pontos: 23, jogos: 28 },
  { ordem: 20, nome_popular: 'Mirassol', pontos: 18, jogos: 27 },
]) };
const r = escolherJogos(jogos, ['Flamengo'], 7, { 'Série A': tabela });
const achou = (m: string) => r.find((x) => x.mandante.startsWith(m));
ok(r.length === 3, `entram 3 jogos (veio ${r.length})`);
ok(!!achou('Flamengo')?.motivos.includes('foco Flamengo'), 'jogo do Flamengo entra por foco');
ok(r.filter((x) => x.mandante.startsWith('Flamengo')).length === 1, 'jogo repetido entra uma vez');
ok(!!achou('Grêmio')?.motivos.includes('dois licenciados') && achou('Grêmio')!.motivos.includes('clássico'), 'Gre-Nal: dois licenciados e clássico');
ok(achou('Grêmio')?.contexto === 'confronto direto contra o rebaixamento', 'contexto do Gre-Nal');
ok(achou('Grêmio')?.mandante === 'Grêmio (17º)', 'posição ao lado do nome');
ok(!achou('Remo'), 'jogo sem licenciado não entra');
ok(!achou('Ceará'), 'Ceará x não licenciado não entra sem foco');
ok(!!achou('Sport'), 'Sport x Fortaleza entra na Série B');
ok(!achou('Palmeiras'), 'fora da margem de dias não entra');
ok(escolherJogos(jogos, ['Ceará'], 7).some((x) => x.mandante === 'Ceará'), 'foco configurável');
ok(r[0].em_dias <= r[r.length - 1].em_dias, 'em ordem de data');

ok(quandoLegivel({ data: '2026-09-30', hora: '21:30', em_dias: 1 }) === 'Amanhã, qua 30/09 · 21:30', 'amanhã legível');
ok(quandoLegivel({ data: '2026-10-04', hora: null, em_dias: 5 }) === 'Dom 04/10', 'dia da semana');
const card = linhasDaAgenda({ ok: true, dias: 7, foco: ['Flamengo'], jogos: r, falhas: [] });
ok(card[0].includes('próximos 7 dias') && card.length === 4, 'card com título e 3 jogos');
ok(linhasDaAgenda({ ok: true, dias: 7, foco: [], jogos: [], falhas: [] }).length === 0, 'sem jogo, sem bloco');

const outros = outrosJogos(jogos, r, 7);
ok(outros.some((x) => x.mandante === 'Ceará') && !outros.some((x) => x.mandante === 'Remo'), 'Ceará x não licenciado vai em "também jogam"');
ok(!outros.some((x) => x.mandante === 'Grêmio' || x.mandante === 'Flamengo'), 'o que está no destaque não repete');
const soOutros = linhasDaAgenda({ ok: true, dias: 7, foco: ['Flamengo'], jogos: [], outros, falhas: [] });
ok(soOutros.length === 3 && soOutros[2].startsWith('_Também jogam:_'), 'semana sem destaque ainda avisa quem joga');

console.log(falhas ? `${falhas} falha(s)` : 'agenda: tudo verde');
if (falhas) process.exit(1);
