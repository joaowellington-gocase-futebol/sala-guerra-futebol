// O parecer de coleção: as regras que o código segura, a tabela e o calendário comercial.
import { validarParecer, lerFormato, produtoDaCasa, semNumeroInventado, frasesFrouxas, linhasDoCard } from '../src/mercado/parecer';
import { classificar } from '../src/web/tabela';
import { proximasDatas } from '../src/mercado/calendarioComercial';

let falhas = 0;
function ok(cond: boolean, nome: string) { if (!cond) { falhas++; console.log('✖ ' + nome); } }

// Formato
ok(lerFormato('Cápsula') === 'capsula', 'lê cápsula com acento');
ok(lerFormato('coleção estruturada') === 'colecao', 'lê coleção');
ok(lerFormato('drops isolados') === 'drops', 'lê drops');
ok(lerFormato('segurar') === 'segurar', 'lê segurar');
ok(lerFormato('talvez') === null, 'formato desconhecido não passa');

// Produto da casa
ok(produtoDaCasa('Garrafa térmica 650ml') === 'garrafa', 'garrafa térmica é garrafa');
ok(produtoDaCasa('copo térmico') === 'térmico', 'copo térmico é térmico');
ok(produtoDaCasa('Boné trucker') === 'boné', 'boné sem acento');
ok(produtoDaCasa('calça jogger') === null, 'calça a casa não faz');

// Número
const conhecidos = new Set([314, 60, 57]);
ok(semNumeroInventado('Líder tem 60 pontos. Vai vender 5000 unidades.', conhecidos).texto === 'Líder tem 60 pontos.', 'corta frase com número inventado');
ok(!semNumeroInventado('Cápsula de 4 peças para 2026.', conhecidos).cortou, 'número pequeno e ano passam');

// Validação: coleção com 3 peças vira cápsula; peça fora da casa cai
const bruto = {
  formato: 'colecao',
  veredito: 'Recomendamos uma cápsula de título em espera para Flamengo e Palmeiras, separados por 3 pontos.',
  momento: 'O título se decide a dias da Black Friday.',
  porques: [
    { ideia: 'o título cai em cima da Black Friday', porque: 'a última rodada é 5 dias depois', base: 'calendario' },
    { ideia: 'narrativa de campeão vende em uma semana', porque: 'vendeu 9000 unidades em 2019', base: 'leitura_de_mercado' },
  ],
  conceito: {
    nome: '"Noite do Título"', ideia: 'a arte pronta que sai no apito final', linguagem_visual: 'tipografia de faixa',
    pecas: [
      { produto: 'copo térmico', o_que_e: 'peça-manifesto com a data' },
      { produto: 'capinha', o_que_e: 'uso diário' },
      { produto: 'calça', o_que_e: 'não fazemos' },
      { produto: 'boné', o_que_e: 'presente' },
    ],
    janela: 'na semana da última rodada',
  },
  descartamos: { formato: 'drops', por_que: 'o título é uma narrativa só' },
  riscos: ['o campeão pode sair antes'],
  muda_de_ideia_se: 'a diferença passar de 9 pontos',
};
const p = validarParecer(bruto, new Set([60, 57, 3]))!;
ok(!!p, 'parecer válido');
ok(p.formato === 'capsula', 'coleção com 3 peças válidas virou cápsula');
ok(p.conceito!.pecas.length === 3, 'peça em produto que a casa não faz caiu');
ok(p.conceito!.nome === 'Noite do Título', 'nome sem aspas');
ok(p.porques.length === 1, 'porquê com número inventado caiu');
ok(p.porques[0].ideia.startsWith('Achamos que'), 'porquê prefixado');
ok(p.ajustes.some((a) => /virou cápsula/.test(a)), 'ajuste registrado');
ok(p.descartamos?.formato === 'drops', 'alternativa descartada');
ok(linhasDoCard(p)[0].startsWith('*🧭 CÁPSULA —*'), 'card abre pelo formato');
ok(validarParecer({ formato: 'drops' }, conhecidos) === null, 'sem veredito não passa');

ok(frasesFrouxas({ ...p, veredito: 'Vale olhar o teste A/B de textura' }).length === 2, 'acha frase de quem não decidiu');

// Tabela
const tab = classificar([
  { ordem: 1, nome_popular: 'Flamengo', pontos: 60, jogos: 28, ultimos_jogos: ['d', 'v', 'v', 'v', 'v'] },
  { ordem: 2, nome_popular: 'Palmeiras', pontos: 57, jogos: 28, ultimos_jogos: ['v', 'e', 'e', 'v', 'e'] },
  { ordem: 3, nome_popular: 'Athletico-PR', pontos: 49, jogos: 28 },
  ...Array.from({ length: 11 }, (_, i) => ({ ordem: 4 + i, nome_popular: 'Meio' + i, pontos: 45 - i, jogos: 28 })),
  { ordem: 15, nome_popular: 'Mirassol', pontos: 32, jogos: 28 },
  { ordem: 16, nome_popular: 'Vasco', pontos: 31, jogos: 27 },
  { ordem: 17, nome_popular: 'Grêmio', pontos: 29, jogos: 28 },
  { ordem: 18, nome_popular: 'Internacional', pontos: 28, jogos: 28 },
  { ordem: 19, nome_popular: 'Remo', pontos: 23, jogos: 28, ultimos_jogos: ['d', 'd', 'd', 'd', 'd'] },
  { ordem: 20, nome_popular: 'Chapecoense', pontos: 18, jogos: 27 },
]);
const clube = (n: string) => tab.find((c) => c.clube === n)!;
ok(clube('Flamengo').situacao === 'lider' && clube('Flamengo').momento === 'embalado', 'líder embalado');
ok(clube('Palmeiras').situacao === 'briga_titulo', '3 pontos atrás é briga');
ok(clube('Athletico-PR').situacao !== 'briga_titulo', '11 pontos atrás não é briga');
ok(clube('Vasco').situacao === 'risco_rebaixamento', '2 pontos acima do Z4 é risco');
ok(clube('Internacional').situacao === 'zona_rebaixamento', '18º está na zona');
ok(clube('Remo').momento === 'em_queda', '5 derrotas é queda');
ok(clube('Flamengo').restantes === 10, '10 rodadas restantes');

// Calendário comercial
const datas = proximasDatas(new Date(Date.UTC(2026, 8, 29, 12)), 120, '2026-12-02');
const achar = (n: string) => datas.find((d) => d.nome === n);
ok(achar('Black Friday')?.data === '2026-11-27', 'Black Friday 2026 é 27/11');
ok(achar('Dia das Crianças')?.em_dias === 13, 'Dia das Crianças em 13 dias');
ok(achar('Última rodada do Brasileirão')?.em_dias === 64, 'fim do campeonato em 64 dias');
ok(achar('Natal')?.data === '2026-12-25', 'Natal');
ok(!achar('Dia dos Pais'), 'Dia dos Pais fora da janela de 120 dias');
ok(datas.every((d, i) => i === 0 || d.em_dias >= datas[i - 1].em_dias), 'em ordem');

console.log(falhas ? `${falhas} falha(s)` : 'parecer: tudo verde');
if (falhas) process.exit(1);
