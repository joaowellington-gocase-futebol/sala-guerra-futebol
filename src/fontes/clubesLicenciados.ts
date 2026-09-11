// Lista única dos clubes licenciados + CBF, usada tanto pra detectar pedido
// de futebol (pedidosTravados.ts, mesma regex do dashboard da Giovanna) quanto
// pra filtrar notícia relevante (noticiasFutebol.ts) — um lugar só, pra não
// divergir entre os dois usos.
export const REGEX_CLUBES_LICENCIADOS =
  "flamengo|corinthians|palmeiras|vasco|botafogo|fluminense|atl[ée]tico[- ]mg|atl[ée]tico mineiro|" +
  "s[ãa]o paulo|cbf|internacional|gr[êe]mio|vit[óo]ria|sport recife|santos|fortaleza|coritiba|cruzeiro|" +
  "cear[áa]|bahia|futebol";
