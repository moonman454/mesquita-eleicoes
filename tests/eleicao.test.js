// Confere que o motor reproduz exatamente os 12 eleitos oficiais de 2024: node tests/eleicao.test.js
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const Eleicao = require('../web/eleicao.js');

const d = JSON.parse(fs.readFileSync(path.join(__dirname, '../web/data/mesquita_2024.json'), 'utf8'));
const agDe = Object.fromEntries(d.partidos.map((p) => [p.sigla, p.federacao || p.sigla]));
const ags = {};
for (const p of d.partidos) {
  const id = agDe[p.sigla];
  ags[id] ??= { id, votos: 0, cands: [] };
  ags[id].votos += p.total_validos;
}
const ver = d.candidatos.filter((c) => c.cargo === 'vereador');
for (const c of ver) if (c.destino_votos === 'Válido') ags[agDe[c.partido]].cands.push({ sq: c.sq, votos: c.votos });

const r = Eleicao.distribuir(Object.values(ags), d.meta.cadeiras, d.meta.votos_validos_vereador);
assert.strictEqual(r.qe, d.meta.quociente_eleitoral, 'quociente eleitoral');

const oficial = ver.filter((c) => c.situacao.startsWith('ELEITO'));
assert.strictEqual(r.eleitos.size, oficial.length, 'número de eleitos');
for (const c of oficial) {
  const e = r.eleitos.get(c.sq);
  assert.ok(e, `${c.urna} deveria estar eleito`);
  const via = c.situacao === 'ELEITO POR QP' ? 'QP' : 'MEDIA';
  assert.strictEqual(e.via, via, `${c.urna}: ${c.situacao}`);
}

assert.strictEqual(Eleicao.quociente(96529, 12), 8044);
assert.strictEqual(Eleicao.quociente(100, 8), 12);   // 12,5 -> despreza
assert.strictEqual(Eleicao.quociente(101, 8), 13);   // 12,625 -> arredonda para cima
console.log(`ok: QE ${r.qe}, ${r.eleitos.size} eleitos iguais ao TSE (QP e média)`);
