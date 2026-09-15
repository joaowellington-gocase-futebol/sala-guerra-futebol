// Sprites 16-bit desenhados em código, pixel a pixel — nada de arquivo de
// imagem. Cada agente é um boneco de 16x24 px cujas cores vêm da `paleta`
// declarada em src/agentes.ts, então quem é quem na sala tem uma fonte só de
// verdade (o servidor) e o sprite acompanha automaticamente.
//
// Por que desenhar em vez de usar as fotos antigas: foto redimensionada num
// canvas pixelado vira borrão. Retângulo alinhado ao pixel, não.

const A = 16;   // largura do boneco, em pixels de arte
const ALT = 24; // altura

/** Um retângulo alinhado ao pixel. Todo o resto aqui é feito disto. */
function px(ctx, x, y, w, h, cor) {
  if (!cor) return;
  ctx.fillStyle = cor;
  ctx.fillRect(x, y, w, h);
}

function escurecer(hex, fator) {
  const n = parseInt(String(hex).replace('#', ''), 16);
  const r = Math.max(0, Math.round(((n >> 16) & 255) * fator));
  const g = Math.max(0, Math.round(((n >> 8) & 255) * fator));
  const b = Math.max(0, Math.round((n & 255) * fator));
  return `rgb(${r},${g},${b})`;
}

/**
 * Desenha o boneco com o canto superior esquerdo em (ox, oy), em pixels de arte.
 * `dir`: 'baixo' | 'cima' | 'lado'. `frame` 0..3 é o ciclo de caminhada.
 * `virado`: true espelha horizontalmente (andar pra esquerda).
 */
export function desenharBoneco(ctx, paleta, dir, frame, ox, oy, virado) {
  const p = paleta || {};
  const pele = p.pele || '#e8b98a';
  const peleSombra = escurecer(pele, 0.82);
  const cabelo = p.cabelo || '#2a2018';
  const camisa = p.camisa || '#4fa3e0';
  const camisaSombra = escurecer(camisa, 0.78);
  const calca = p.calca || '#26374a';
  const detalhe = p.detalhe || '#ffffff';
  const sapato = '#1a1520';
  const contorno = 'rgba(10,8,14,0.55)';

  ctx.save();
  if (virado) {
    ctx.translate(ox + A, oy);
    ctx.scale(-1, 1);
  } else {
    ctx.translate(ox, oy);
  }

  // Balanço do passo: o corpo sobe 1px nos frames ímpares. É o truque mais
  // barato que existe pra uma caminhada não parecer um slide.
  const bob = frame === 1 || frame === 3 ? -1 : 0;

  // ── Pernas (embaixo, pra camisa cobrir a junção) ──
  const passo = frame === 1 ? 1 : frame === 3 ? -1 : 0;
  px(ctx, 4, 18, 3, 5, calca);
  px(ctx, 9, 18, 3, 5, calca);
  if (passo === 1) { px(ctx, 3, 20, 3, 3, calca); px(ctx, 10, 18, 3, 4, calca); }
  if (passo === -1) { px(ctx, 10, 20, 3, 3, calca); px(ctx, 3, 18, 3, 4, calca); }
  px(ctx, passo === 1 ? 3 : 4, 22, 4, 2, sapato);
  px(ctx, passo === -1 ? 10 : 9, 22, 4, 2, sapato);

  // ── Tronco ──
  const ty = 10 + bob;
  px(ctx, 3, ty, 10, 8, camisa);
  px(ctx, 3, ty + 6, 10, 2, camisaSombra);      // dobra na barra
  px(ctx, 7, ty, 2, 6, detalhe);                 // faixa/gola, a "identidade" do agente
  // Braços
  px(ctx, 1, ty + 1, 2, 6, camisa);
  px(ctx, 13, ty + 1, 2, 6, camisa);
  px(ctx, 1, ty + 6, 2, 2, pele);                // mãos
  px(ctx, 13, ty + 6, 2, 2, pele);

  // ── Cabeça ──
  const hy = 2 + bob;
  px(ctx, 4, hy, 8, 9, pele);
  px(ctx, 4, hy + 7, 8, 2, peleSombra);          // queixo/sombra do pescoço
  px(ctx, 3, hy + 1, 1, 6, contorno);
  px(ctx, 12, hy + 1, 1, 6, contorno);

  if (dir === 'cima') {
    // De costas: só cabelo, sem rosto. Isso é o que dá a sensação de 3/4 clássico.
    px(ctx, 4, hy, 8, 6, cabelo);
  } else if (dir === 'lado') {
    px(ctx, 4, hy, 8, 3, cabelo);
    px(ctx, 4, hy, 2, 6, cabelo);                // costeleta
    px(ctx, 9, hy + 4, 1, 2, '#161018');         // olho de perfil
    px(ctx, 11, hy + 6, 1, 1, peleSombra);       // boca
  } else {
    px(ctx, 4, hy, 8, 3, cabelo);
    px(ctx, 4, hy, 1, 5, cabelo);
    px(ctx, 11, hy, 1, 5, cabelo);
    px(ctx, 6, hy + 4, 1, 2, '#161018');         // olhos
    px(ctx, 9, hy + 4, 1, 2, '#161018');
    px(ctx, 7, hy + 7, 2, 1, peleSombra);        // boca
  }

  ctx.restore();
}

/** Retrato grande do mesmo boneco, pro painel lateral. Mesma arte, só que ampliada. */
export function desenharRetrato(canvas, paleta, escala = 5) {
  const ctx = canvas.getContext('2d');
  canvas.width = A * escala;
  canvas.height = ALT * escala;
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.save();
  ctx.scale(escala, escala);
  desenharBoneco(ctx, paleta, 'baixo', 0, 0, 0, false);
  ctx.restore();
}

export const TAMANHO_BONECO = { largura: A, altura: ALT };
