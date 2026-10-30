'use strict';

// Motor da eleição proporcional para vereador (Código Eleitoral, arts. 106 a 109, com a regra
// das sobras aplicada em 2024). Funções puras: recebem votos, devolvem quem ocupa cada cadeira.
//
//   1. Quociente eleitoral (QE) = válidos ÷ cadeiras; fração até 0,5 é desprezada, acima arredonda para cima.
//   2. Quociente partidário = votos da agremiação ÷ QE (para baixo). Essas vagas vão aos mais votados
//      da agremiação que tenham pelo menos 10% do QE.
//   3. Sobras, pela maior média (votos ÷ (vagas já obtidas + 1)): só agremiações com 80% do QE
//      e candidatos com 20% do QE.
//   4. Se ainda sobrar cadeira, todas as agremiações disputam pela maior média, sem exigência mínima
//      (decisão do STF nas ADIs 7228, 7263 e 7325, válida desde 2024).
const Eleicao = (() => {
  function quociente(validos, cadeiras) {
    const q = validos / cadeiras;
    const f = Math.floor(q);
    return q - f > 0.5 ? f + 1 : f;
  }

  // ags: [{ id, votos, cands: [{ sq, votos }] }]  (votos da agremiação = nominais + legenda)
  // devolve { qe, eleitos: Map(sq -> { ag, via: 'QP' | 'MEDIA' | 'MEDIA_GERAL' }), vagas: { [ag]: n } }
  function distribuir(ags, cadeiras, validos) {
    const qe = quociente(validos, cadeiras);
    const eleitos = new Map();
    const vagas = {};
    const fila = {};
    for (const a of ags) {
      vagas[a.id] = 0;
      fila[a.id] = [...a.cands].sort((x, y) => y.votos - x.votos);
    }
    const proximo = (a, minimo) => fila[a.id].find((c) => !eleitos.has(c.sq) && c.votos >= minimo);
    const ocupa = (a, c, via) => { eleitos.set(c.sq, { ag: a.id, via }); vagas[a.id]++; };

    let livres = cadeiras;
    for (const a of ags) {
      const qp = qe > 0 ? Math.floor(a.votos / qe) : 0;
      for (let i = 0; i < qp && livres > 0; i++) {
        const c = proximo(a, 0.1 * qe);
        if (!c) break;
        ocupa(a, c, 'QP');
        livres--;
      }
    }

    const rodada = (exigeAg, exigeCand, via) => {
      while (livres > 0) {
        let melhor = null;
        for (const a of ags) {
          if (a.votos < exigeAg) continue;
          const c = proximo(a, exigeCand);
          if (!c) continue;
          const media = a.votos / (vagas[a.id] + 1);
          if (!melhor || media > melhor.media) melhor = { a, c, media };
        }
        if (!melhor) return;
        ocupa(melhor.a, melhor.c, via);
        livres--;
      }
    };
    rodada(0.8 * qe, 0.2 * qe, 'MEDIA');
    rodada(0, 0, 'MEDIA_GERAL');

    return { qe, eleitos, vagas };
  }

  return { quociente, distribuir };
})();

if (typeof module !== 'undefined') module.exports = Eleicao;
