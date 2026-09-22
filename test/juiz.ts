// Testes da régua. O juiz é a peça mais consequente do app — é ela que decide
// o que chega no João —, é função pura e não fala com rede nenhuma, então não
// há desculpa pra não testar.
//
// Rodar: ./test/rodar.sh

import assert from 'node:assert/strict';
import { julgar, julgarTodas, numerosDoTexto, type Leitura, type ContextoDoJuiz } from '../src/juiz';
import { familiaDe, montarMapaDeDemanda, numerosDaRodada } from '../src/mercado/demanda';
import type { Vitrine, ProdutoDaVitrine } from '../src/web/vitrine';

let passou = 0;
const falhas: string[] = [];
function teste(nome: string, fn: () => void) {
  try { fn(); passou += 1; }
  catch (e) { falhas.push(`${nome}\n    ${(e as Error).message.split('\n')[0]}`); }
}

// ── o contexto de uma rodada plausível ───────────────────────────────────
const ctx: ContextoDoJuiz = {
  familias: ['camisa de clube', 'camiseta', 'boné e chapéu', 'objeto e casa'],
  palavras: ['retro', 'blokecore'],
  produtosDaCasa: ['capinha', 'térmico', 'caneca', 'camiseta', 'moletom', 'boné'],
  numeros: new Set([115, 630, 18, 42, 1000, 31, 4200, 12]),
  numerosDeProcura: new Set([4200, 12]),
  anteriores: [],
};

const boa: Leitura = {
  o_que_o_mercado_pede:
    'camisa de clube saiu do nicho de torcedor e virou peça de guarda-roupa masculino',
  evidencia: '115 dos 630 lançamentos de 45 dias são camisa de clube (18%), preço médio 42',
  como_cabe:
    'camiseta e moletom com a gráfica de camisa retrô — gola, listra e patrocínio dos anos 90 — aplicada como estampa, sem escudo',
  confianca: 'media',
  o_que_confirma: 'se "retro" subir nas menções fora da prateleira nas próximas duas rodadas',
  tese: 'camisa de clube virou vestuário masculino',
};

teste('uma leitura completa passa', () => {
  const v = julgar(boa, ctx);
  assert.equal(v.aprovada, true, 'reprovou: ' + v.motivos.join(' | '));
});

teste('número que não foi medido hoje reprova', () => {
  const v = julgar({ ...boa, evidencia: 'a procura por camisa de clube cresceu 73% e o preço médio é 888' }, ctx);
  assert.equal(v.aprovada, false);
  assert.ok(v.motivos.some((m) => m.includes('foi medido nesta rodada')), v.motivos.join(' | '));
});

teste('evidência sem número nenhum reprova', () => {
  const v = julgar({ ...boa, evidencia: 'todo mundo está usando camisa de clube por aí' }, ctx);
  assert.equal(v.aprovada, false);
  assert.ok(v.motivos.some((m) => m.includes('não tem número')));
});

teste('confiança forte sem número de procura reprova', () => {
  const v = julgar({ ...boa, confianca: 'forte' }, ctx);
  assert.equal(v.aprovada, false);
  assert.ok(v.motivos.some((m) => m.includes('confiança FORTE')), v.motivos.join(' | '));
});

teste('confiança forte COM número de procura passa', () => {
  const v = julgar({
    ...boa,
    confianca: 'forte',
    evidencia: '115 dos 630 lançamentos são camisa de clube e a procura foi de 4200 leituras em 14 dias',
  }, ctx);
  assert.equal(v.aprovada, true, v.motivos.join(' | '));
});

teste('sem ponte de produto reprova', () => {
  const v = julgar({ ...boa, como_cabe: 'dá pra adaptar' }, ctx);
  assert.equal(v.aprovada, false);
  assert.ok(v.motivos.some((m) => m.includes('COMO ISSO CABE')));
});

teste('ponte que não nomeia produto da casa reprova', () => {
  const v = julgar({
    ...boa,
    como_cabe: 'podemos trabalhar essa linguagem visual nos nossos lançamentos do semestre que vem',
  }, ctx);
  assert.equal(v.aprovada, false);
  assert.ok(v.motivos.some((m) => m.includes('não nomeia nenhum produto da casa')));
});

teste('sem o que confirma reprova — é o que trava a progressão', () => {
  const v = julgar({ ...boa, o_que_confirma: '' }, ctx);
  assert.equal(v.aprovada, false);
  assert.ok(v.motivos.some((m) => m.includes('CONFIRMARIA')));
});

teste('vaguidão reprova', () => {
  const v = julgar({
    ...boa,
    o_que_o_mercado_pede: 'precisamos explorar o engajamento da torcida com camisa de clube',
  }, ctx);
  assert.equal(v.aprovada, false);
  assert.ok(v.motivos.some((m) => m.includes('enfeite')));
});

teste('sem categoria nomeada reprova', () => {
  const v = julgar({
    ...boa,
    o_que_o_mercado_pede: 'o consumidor anda querendo coisas diferentes das que existem por aí hoje',
    evidencia: '115 de 630 itens, 18 por cento',
  }, ctx);
  assert.equal(v.aprovada, false);
  assert.ok(v.motivos.some((m) => m.includes('CATEGORIA')));
});

teste('repetir a leitura de ontem com os mesmos números reprova', () => {
  const v = julgar(boa, {
    ...ctx,
    anteriores: [{ texto: boa.o_que_o_mercado_pede, numeros: [115, 630, 18, 42] }],
    // 45 (a janela) sai da conta de "número novo" — é vocabulário, não evidência.
  });
  assert.equal(v.aprovada, false);
  assert.ok(v.motivos.some((m) => m.includes('mesma leitura')), v.motivos.join(' | '));
});

teste('voltar ao mesmo assunto COM número novo passa — é aprofundar', () => {
  const v = julgar(
    { ...boa, evidencia: 'camisa de clube foi de 115 para 1000 itens no catálogo, 31 deles novos' },
    { ...ctx, anteriores: [{ texto: boa.o_que_o_mercado_pede, numeros: [115, 630] }] },
  );
  assert.equal(v.aprovada, true, v.motivos.join(' | '));
});

teste('número derivado vira aviso, não reprovação', () => {
  const j = julgarTodas([{ ...boa, evidencia: '115 dos 630 lançamentos, o que dá 7 vezes a média' }], ctx);
  assert.equal(j.aprovadas.length, 1);
  assert.equal(j.avisos.length, 1);
  assert.ok(j.avisos[0].includes('7'));
});

// ── leitura de número em texto ───────────────────────────────────────────
teste('numerosDoTexto entende os formatos que a mesa escreve', () => {
  assert.deepEqual(numerosDoTexto('115 de 630 (18%)'), [115, 630, 18]);
  assert.deepEqual(numerosDoTexto('1.000 itens e 1,200 libras'), [1000, 1200]);
  assert.deepEqual(numerosDoTexto('cresceu +15% contra £42,50'), [15, 42]);
  assert.deepEqual(numerosDoTexto('sem número aqui'), []);
});

// ── o mapa de demanda ────────────────────────────────────────────────────
const produto = (p: Partial<ProdutoDaVitrine>): ProdutoDaVitrine => ({
  loja: 'COPA Football', titulo: 'Item', tipo: 'Tees', preco: 40, moeda: 'GBP/USD',
  publicado: '2026-09-01', dias_no_ar: 10, tags: [], link: 'https://exemplo', ...p,
});

teste('familiaDe reconhece pelo tipo e pelo título', () => {
  assert.equal(familiaDe({ tipo: 'Tees', titulo: 'Logo Tee' }), 'camiseta');
  assert.equal(familiaDe({ tipo: 'Headwear', titulo: 'Bucket Hat' }), 'boné e chapéu');
  assert.equal(familiaDe({ tipo: 'Apparel', titulo: '1994 Retro Shirt' }), 'camisa de clube');
  assert.equal(familiaDe({ tipo: 'Drinkware', titulo: 'Enamel Mug' }), 'objeto e casa');
  assert.equal(familiaDe({ tipo: 'Vinyl', titulo: 'Album' }), 'outros');
});

teste('o mapa agrega transversal às lojas e marca o que a casa não faz', () => {
  const produtos = [
    ...Array.from({ length: 6 }, () => produto({ tipo: 'Tees', dias_no_ar: 10 })),
    ...Array.from({ length: 4 }, () => produto({ loja: 'Kith', tipo: 'Tees', dias_no_ar: 200 })),
    ...Array.from({ length: 5 }, () => produto({ tipo: 'Footwear', titulo: 'Sneaker', dias_no_ar: 5, preco: 100 })),
  ];
  const vitrine: Vitrine = {
    ok: true, produtos, novidades: produtos.filter((p) => p.dias_no_ar <= 45),
    categorias: [], temasDoMomento: [{ palavra: 'retro', vezes: 4 }], falhas: [],
  };
  const mapa = montarMapaDeDemanda(vitrine);

  assert.equal(mapa.total_produtos, 15);
  assert.equal(mapa.total_novidades_45d, 11);

  const camiseta = mapa.familias.find((f) => f.familia === 'camiseta')!;
  assert.equal(camiseta.itens, 10, 'junta as duas lojas na mesma família');
  assert.equal(camiseta.novos_45d, 6);
  assert.deepEqual(camiseta.na_casa, ['camiseta']);

  const calcado = mapa.familias.find((f) => f.familia === 'calçado')!;
  assert.deepEqual(calcado.na_casa, [], 'a casa não fabrica calçado');
  assert.ok(mapa.buracos.includes('calçado'), 'calçado é empurrão sem correspondente: ' + mapa.buracos.join(','));
});

teste('numerosDaRodada inclui as janelas de tempo do vocabulário', () => {
  const vitrine: Vitrine = {
    ok: true, produtos: [], novidades: [], categorias: [], temasDoMomento: [], falhas: [],
  };
  const ns = numerosDaRodada(montarMapaDeDemanda(vitrine));
  for (const janela of [14, 28, 45]) assert.ok(ns.has(janela), 'falta a janela ' + janela);
});

console.log(`\n${passou} testes passaram`);
if (falhas.length) {
  console.log(`${falhas.length} FALHARAM:\n  - ${falhas.join('\n  - ')}\n`);
  process.exit(1);
}
console.log('tudo verde\n');
