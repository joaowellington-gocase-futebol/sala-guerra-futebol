// A síntese do e-mail: corte por palavra e a reserva sem IA.
import { caber, sinteseDeReserva } from '../src/mercado/sintese';

let falhas = 0;
function ok(cond: boolean, nome: string) { if (!cond) { falhas++; console.log('✖ ' + nome); } }

ok(caber('curto', 50) === 'curto', 'texto curto passa inteiro');
const cortado = caber('camisa de clube concentra a renovação do masculino inteiro', 30);
ok(cortado.length <= 30 && cortado.endsWith('…') && !/\s…$/.test(cortado), 'corta por palavra, com reticência');
ok(!/renova…$/.test(caber('camisa de clube concentra a renovação', 32)), 'não parte palavra no meio');

const r = sinteseDeReserva({
  se_eu_fosse_voce: 'Eu liberaria primeiro um teste de linguagem de uniforme em boné, copo e garrafa.',
  leituras: [{
    o_que_o_mercado_pede: 'camisa de clube concentra a renovação do masculino. Mais texto.',
    evidencia: '324 novos', como_cabe: 'cápsula de copo e garrafa com numeração grande. Resto.',
    confianca: 'media', o_que_confirma: '', tese: '',
  }],
  precisamos_de_voce: '',
});
ok(r.achamos[0].ideia.startsWith('Achamos que camisa de clube'), 'reserva prefixa "Achamos que"');
ok(r.achamos[0].porque === 'cápsula de copo e garrafa com numeração grande.', 'reserva usa só a 1ª frase da ponte');
ok(r.pedido === '', 'sem pedido quando a mesa não precisa de nada');

console.log(falhas ? `${falhas} falha(s)` : 'sintese: tudo verde');
if (falhas) process.exit(1);
