'use strict';

// ------------------------------------------------------------------ formatação

const nf = new Intl.NumberFormat('pt-BR');
const fmt = (n) => nf.format(Math.round(n || 0));
const pct = (x, d = 1) => (Number.isFinite(x) ? (x * 100).toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d }) + '%' : '–');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const norm = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

// Rampa sequencial (azul, claro → escuro) e divergente (vermelho ← cinza → azul).
const SEQ = {
  light: ['#cde2fb', '#9ec5f4', '#6da7ec', '#3987e5', '#256abf', '#184f95', '#0d366b'],
  dark: ['#104281', '#184f95', '#1c5cab', '#2a78d6', '#5598e7', '#86b6ef', '#b7d3f6'],
};
const DIV = {
  light: ['#b8302f', '#e34948', '#f4a19e', '#f0efec', '#9ec5f4', '#3987e5', '#1c5cab'],
  dark: ['#e66767', '#c23f3e', '#7a2c2b', '#383835', '#184f95', '#2a78d6', '#86b6ef'],
};

// ------------------------------------------------------------------ estado

const S = {
  data: null,
  geo: null,
  cargo: 'vereador',
  metric: 'cand_pct',
  candA: null, // sq
  candB: null,
  bairro: null, // id
  side: 'cand',
  tab: 'eleitos',
  rank: { q: '', partido: '', situacao: '', sort: 'votos', dir: -1 },
};

const D = {}; // índices derivados

const METRICS = {
  cand_pct: { label: 'Candidato: % dos votos válidos do bairro', needs: 'A', kind: 'pct' },
  cand_votos: { label: 'Candidato: votos absolutos', needs: 'A', kind: 'num' },
  cand_forca: { label: 'Candidato: força relativa (bairro ÷ cidade)', needs: 'A', kind: 'ratio' },
  compare: { label: 'Comparação A × B (diferença de %)', needs: 'AB', kind: 'diff' },
  lider: { label: 'Mais votado em cada bairro', kind: 'pct' },
  abstencao: { label: 'Abstenção', kind: 'pct' },
  brancos_nulos: { label: 'Brancos + nulos (sobre comparecimento)', kind: 'pct' },
  aptos: { label: 'Eleitores aptos', kind: 'num' },
};

const theme = () => {
  const t = document.documentElement.dataset.theme;
  if (t) return t;
  return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
};

// ------------------------------------------------------------------ dados

async function load() {
  const [data, geo] = await Promise.all([
    fetch('data/mesquita_2024.json').then((r) => r.json()),
    fetch('data/bairros.geojson').then((r) => r.json()),
  ]);
  S.data = data;
  S.geo = geo;

  D.bairro = Object.fromEntries(data.bairros.map((b) => [b.id, b]));
  D.local = Object.fromEntries(data.locais.map((l) => [l.id, l]));
  D.cand = Object.fromEntries(data.candidatos.map((c) => [c.sq, c]));
  D.partido = Object.fromEntries(data.partidos.map((p) => [p.sigla, p]));

  for (const c of data.candidatos) c.valido = c.destino_votos === 'Válido';

  D.byCargo = {};
  D.validos = {};
  for (const cargo of ['vereador', 'prefeito']) {
    const list = data.candidatos.filter((c) => c.cargo === cargo).sort((a, b) => b.votos - a.votos);
    list.forEach((c, i) => (c.pos = i + 1));
    D.byCargo[cargo] = list;

    const vb = {}, vl = {};
    let total = 0;
    const add = (porBairro, porLocal) => {
      for (const [k, v] of Object.entries(porBairro)) vb[k] = (vb[k] || 0) + v;
      for (const [k, v] of Object.entries(porLocal || {})) vl[k] = (vl[k] || 0) + v;
    };
    for (const c of list) if (c.valido) { add(c.por_bairro, c.por_local); total += c.votos; }
    if (cargo === 'vereador') for (const p of data.partidos) { add(p.legenda_por_bairro, p.legenda_por_local); total += p.legenda; }
    D.validos[cargo] = { bairro: vb, local: vl, total };
  }

  D.leader = {};
  for (const cargo of ['vereador', 'prefeito']) {
    D.leader[cargo] = { bairro: {}, local: {} };
    for (const scope of ['bairro', 'local']) {
      const best = {};
      for (const c of D.byCargo[cargo]) {
        if (!c.valido) continue;
        for (const [k, v] of Object.entries(scope === 'bairro' ? c.por_bairro : c.por_local)) {
          if (!best[k] || v > best[k].v) best[k] = { sq: c.sq, v };
        }
      }
      D.leader[cargo][scope] = best;
    }
  }
}

const cands = () => D.byCargo[S.cargo];
const validosB = (bid) => D.validos[S.cargo].bairro[bid] || 0;
const validosL = (lid) => D.validos[S.cargo].local[lid] || 0;
const validosTotal = () => D.validos[S.cargo].total;
const hasData = (bid) => (D.bairro[bid]?.locais.length || 0) > 0;

function brancosNulos(scope, id) {
  if (S.cargo === 'vereador') {
    const o = scope === 'bairro' ? D.bairro[id] : D.local[id];
    return (o.brancos || 0) + (o.nulos || 0);
  }
  const ex = S.data.extras.prefeito;
  const key = scope === 'bairro' ? 'por_bairro' : 'por_local';
  return (ex.branco?.[key][id] || 0) + (ex.nulo?.[key][id] || 0);
}

const candLabel = (c) => `${c.urna} · ${c.numero} · ${c.partido}`;
const situacaoCurta = (s) => s.replace('ELEITO POR QP', 'Eleito (quociente)').replace('ELEITO POR MÉDIA', 'Eleito (média)')
  .replace('NÃO ELEITO', 'Não eleito').replace('SUPLENTE', 'Suplente').replace(/^ELEITO$/, 'Eleito');
const isEleito = (c) => c.situacao.startsWith('ELEITO');

// ------------------------------------------------------------------ mapa

let map, geoLayer, tileLayer, localLayer;
const labelLayer = L.layerGroup();

function initMap() {
  map = L.map('map', { zoomSnap: 0.25, attributionControl: true, scrollWheelZoom: true });
  setTiles();
  currentScale = scale(); // o L.geoJSON já chama styleFeature na construção
  geoLayer = L.geoJSON(S.geo, {
    style: styleFeature,
    onEachFeature: (f, layer) => {
      layer.on({
        mouseover: (e) => { e.target.setStyle({ weight: 3 }); e.target.bringToFront(); localLayer?.bringToFront(); },
        mouseout: (e) => geoLayer.resetStyle(e.target),
        click: () => selectBairro(f.id),
      });
      layer.bindTooltip(() => tipFor(f.id), { sticky: true, className: 'map-tip', direction: 'top', offset: [0, -8] });
    },
  }).addTo(map);
  map.fitBounds(geoLayer.getBounds(), { padding: [8, 8] });
  labelLayer.addTo(map);
  localLayer = L.layerGroup().addTo(map);
}

function setTiles() {
  if (tileLayer) tileLayer.remove();
  // OSM padrão; o CSS (.leaflet-tile-pane) dessatura para o mapa base não competir com as cores dos dados.
  tileLayer = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  }).addTo(map);
  tileLayer.bringToBack();
}

function metricValue(bid) {
  if (!hasData(bid)) return null;
  const b = D.bairro[bid];
  const A = D.cand[S.candA], B = D.cand[S.candB];
  switch (S.metric) {
    case 'cand_votos': return A ? (A.por_bairro[bid] || 0) : null;
    case 'cand_pct': return A ? (A.por_bairro[bid] || 0) / (validosB(bid) || 1) : null;
    case 'cand_forca': {
      if (!A) return null;
      const city = A.votos / validosTotal();
      return city ? ((A.por_bairro[bid] || 0) / (validosB(bid) || 1)) / city : null;
    }
    case 'compare': {
      if (!A || !B) return null;
      const v = validosB(bid) || 1;
      return ((A.por_bairro[bid] || 0) - (B.por_bairro[bid] || 0)) / v;
    }
    case 'lider': {
      const l = D.leader[S.cargo].bairro[bid];
      return l ? l.v / (validosB(bid) || 1) : null;
    }
    case 'abstencao': return b.aptos ? b.abstencoes / b.aptos : null;
    case 'brancos_nulos': return b.comparecimento ? brancosNulos('bairro', bid) / b.comparecimento : null;
    case 'aptos': return b.aptos;
  }
  return null;
}

// Escala: classes iguais de 0 ao máximo arredondado (diferença e força relativa têm escala própria).
function scale() {
  const vals = S.geo.features.map((f) => metricValue(f.id)).filter((v) => v != null);
  const m = METRICS[S.metric];
  if (m.kind === 'diff') {
    const ext = Math.max(0.01, ...vals.map(Math.abs));
    const step = niceStep(ext / 3);
    return { type: 'div', step, breaks: [-3, -2, -1, 0, 1, 2, 3].map((i) => i * step) };
  }
  if (m.kind === 'ratio') {
    // razão: 1 = igual à média da cidade; classes em torno de 1
    return { type: 'seq', breaks: [0, 0.5, 0.75, 1, 1.25, 1.5, 2, Infinity], fixed: true };
  }
  const max = Math.max(0, ...vals);
  if (!m.needs) {
    // contexto (líder, abstenção, aptos): os valores ficam numa faixa estreita longe do zero,
    // então a escala cobre do menor ao maior valor observado
    const min = Math.min(...vals);
    const step = (max - min) / 7 || 1;
    return { type: 'seq', breaks: Array.from({ length: 8 }, (_, i) => min + i * step) };
  }
  const step = niceStep(max / 7) || 1;
  return { type: 'seq', breaks: Array.from({ length: 8 }, (_, i) => i * step) };
}

function niceStep(raw) {
  if (!raw) return 0;
  const p = Math.pow(10, Math.floor(Math.log10(raw)));
  const f = raw / p;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p;
}

function colorFor(v, sc) {
  const t = theme();
  if (sc.type === 'div') {
    const i = Math.max(-3, Math.min(3, Math.round(v / sc.step)));
    return DIV[t][i + 3];
  }
  const br = sc.breaks;
  let i = 0;
  while (i < 6 && v >= br[i + 1]) i++;
  return SEQ[t][i];
}

let currentScale = null;

function styleFeature(f) {
  const v = metricValue(f.id);
  const sel = f.id === S.bairro;
  const dark = theme() === 'dark';
  if (v == null) {
    return {
      color: dark ? '#4a4a46' : '#b9b8b2', weight: sel ? 3 : 1, dashArray: '3 3',
      fillColor: dark ? '#2b2b29' : '#e7e6e2', fillOpacity: 0.75,
    };
  }
  return {
    color: sel ? (dark ? '#f0efec' : '#0b0b0b') : (dark ? '#1a1a19' : '#ffffff'),
    weight: sel ? 3 : 1.5,
    fillColor: colorFor(v, currentScale),
    fillOpacity: 0.86,
  };
}

function fmtMetric(v) {
  if (v == null) return '–';
  const k = METRICS[S.metric].kind;
  if (k === 'pct') return pct(v);
  if (k === 'num') return fmt(v);
  if (k === 'ratio') return v.toLocaleString('pt-BR', { maximumFractionDigits: 2 }) + '×';
  if (k === 'diff') return (v > 0 ? '+' : '') + (v * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + ' p.p.';
  return String(v);
}

function tipFor(bid) {
  const b = D.bairro[bid];
  if (!hasData(bid)) {
    return `<b>${esc(b.nome)}</b><br><span class="muted">Sem local de votação no bairro.<br>Os moradores votam em bairros vizinhos.</span>`;
  }
  const v = metricValue(bid);
  const A = D.cand[S.candA], B = D.cand[S.candB];
  let extra = '';
  if (S.metric.startsWith('cand') && A) {
    extra = `<br>${esc(A.urna)}: <b>${fmt(A.por_bairro[bid] || 0)}</b> votos (${pct((A.por_bairro[bid] || 0) / (validosB(bid) || 1))})`;
  } else if (S.metric === 'compare' && A && B) {
    extra = `<br>${esc(A.urna)}: <b>${fmt(A.por_bairro[bid] || 0)}</b> · ${esc(B.urna)}: <b>${fmt(B.por_bairro[bid] || 0)}</b>`;
  } else if (S.metric === 'lider') {
    const l = D.leader[S.cargo].bairro[bid];
    extra = l ? `<br>${esc(D.cand[l.sq].urna)} (${esc(D.cand[l.sq].partido)}): <b>${fmt(l.v)}</b> votos` : '';
  }
  return `<b>${esc(b.nome)}</b><br><span class="muted">${METRICS[S.metric].label}:</span> <b>${fmtMetric(v)}</b>${extra}
    <br><span class="muted">${fmt(b.aptos)} aptos · ${b.locais.length} ${b.locais.length === 1 ? 'local' : 'locais'}</span>`;
}

function renderMap() {
  currentScale = scale();
  geoLayer.setStyle(styleFeature);
  renderLabels();
  renderLocais();
  renderLegend();
  renderHint();
}

function renderLabels() {
  labelLayer.clearLayers();
  if (S.metric !== 'lider') return;
  geoLayer.eachLayer((layer) => {
    const bid = layer.feature.id;
    const l = D.leader[S.cargo].bairro[bid];
    if (!l) return;
    const c = D.cand[l.sq];
    L.tooltip({ permanent: true, direction: 'center', className: 'map-label', interactive: false })
      .setLatLng(layer.getBounds().getCenter())
      .setContent(`${esc(c.urna)}<br>${pct(l.v / (validosB(bid) || 1), 0)}`)
      .addTo(labelLayer);
  });
}

function renderLocais() {
  localLayer.clearLayers();
  const A = D.cand[S.candA];
  const useCand = A && S.metric.startsWith('cand');
  const val = (l) => (useCand ? (A.por_local[l.id] || 0) : l.aptos);
  const max = Math.max(1, ...S.data.locais.map(val));
  const dark = theme() === 'dark';
  for (const l of S.data.locais) {
    if (l.lat == null) continue;
    const v = val(l);
    const r = 3 + 11 * Math.sqrt(v / max);
    const m = L.circleMarker([l.lat, l.lon], {
      radius: r, weight: 2, color: dark ? '#1a1a19' : '#ffffff',
      fillColor: dark ? '#f0efec' : '#2b2b29', fillOpacity: 0.72,
    });
    m.bindPopup(() => popupLocal(l.id), { maxWidth: 300 });
    m.bindTooltip(`${esc(l.nome)} · ${useCand ? fmt(v) + ' votos' : fmt(v) + ' aptos'}`, { className: 'map-tip', direction: 'top', offset: [0, -r] });
    m.addTo(localLayer);
  }
}

function popupLocal(lid) {
  const l = D.local[lid];
  const top = cands().filter((c) => c.valido && c.por_local[lid]).sort((a, b) => b.por_local[lid] - a.por_local[lid]).slice(0, 5);
  const v = validosL(lid) || 1;
  const A = D.cand[S.candA];
  const rows = top.map((c, i) => `<tr><td>${i + 1}.</td><td>${esc(c.urna)} <span class="muted">${esc(c.partido)}</span></td><td class="r">${fmt(c.por_local[lid])}</td><td class="r muted">${pct(c.por_local[lid] / v)}</td></tr>`).join('');
  const aLine = A && A.cargo === S.cargo ? `<div>${esc(A.urna)}: <b>${fmt(A.por_local[lid] || 0)}</b> votos (${pct((A.por_local[lid] || 0) / v)})</div>` : '';
  return `<div class="popup"><h4>${esc(l.nome)}</h4>
    <div class="muted">${esc(l.endereco)} · ${esc(D.bairro[l.bairro]?.nome || '')}${l.bairro_tse && norm(l.bairro_tse) !== norm(D.bairro[l.bairro]?.nome) ? ` (TSE: ${esc(l.bairro_tse)})` : ''}</div>
    <div class="muted">Zona ${l.zona} · local ${l.nr} · ${l.secoes} seções · ${fmt(l.aptos)} aptos · abstenção ${pct(l.abstencoes / (l.aptos || 1))}</div>
    ${aLine}<table>${rows}</table></div>`;
}

function renderLegend() {
  const el = document.getElementById('legend');
  const sc = currentScale;
  const t = theme();
  const m = METRICS[S.metric];
  const needsA = m.needs && !D.cand[S.candA];
  const needsB = m.needs === 'AB' && !D.cand[S.candB];
  if (needsA || needsB) {
    el.innerHTML = `<span>${needsB && !needsA ? 'Escolha um segundo candidato em “Comparar com”.' : 'Escolha um candidato para pintar o mapa.'}</span>`;
    return;
  }
  let ramp, ticks;
  if (sc.type === 'div') {
    ramp = DIV[t].map((c) => `<span style="background:${c}"></span>`).join('');
    const A = D.cand[S.candA], B = D.cand[S.candB];
    ticks = `<div class="ticks"><span>${esc(B.urna)} à frente</span><span>empate</span><span>${esc(A.urna)} à frente</span></div>`;
  } else {
    ramp = SEQ[t].map((c) => `<span style="background:${c}"></span>`).join('');
    const br = sc.breaks;
    const lab = (v) => (m.kind === 'ratio' ? v.toLocaleString('pt-BR') + '×' : m.kind === 'pct' ? pct(v, v < 0.1 && v > 0 ? 1 : 0) : fmt(v));
    const mid = m.kind === 'ratio' ? 1 : (br[0] + br[7]) / 2;
    ticks = `<div class="ticks"><span>${lab(br[0])}</span><span>${lab(mid)}</span><span>${m.kind === 'ratio' ? '2×+' : lab(br[7])}</span></div>`;
  }
  el.innerHTML = `<div><div class="ramp">${ramp}</div>${ticks}</div>
    <span class="swatch nodata"><i></i>Sem local de votação</span>
    <span class="swatch dot"><i></i>Local de votação (tamanho = ${D.cand[S.candA] && S.metric.startsWith('cand') ? 'votos do candidato' : 'eleitores aptos'})</span>`;
}

function renderHint() {
  const el = document.getElementById('map-hint');
  const A = D.cand[S.candA];
  const hints = {
    cand_pct: A ? `Participação de ${A.urna} nos votos válidos de cada bairro. Na cidade: ${pct(A.votos / validosTotal())}.` : '',
    cand_votos: A ? `Quantos votos ${A.urna} teve nas urnas de cada bairro.` : '',
    cand_forca: A ? `1× = desempenho igual ao da cidade toda; 2× = o dobro da média municipal de ${A.urna}.` : '',
    compare: '',
    lider: 'Rótulo: candidato mais votado nas urnas do bairro e sua fatia dos votos válidos.',
    abstencao: `Eleitores aptos que não foram votar. Cidade: ${pct(S.data.bairros.reduce((s, b) => s + b.abstencoes, 0) / S.data.bairros.reduce((s, b) => s + b.aptos, 0))}.`,
    brancos_nulos: 'Votos em branco e nulos sobre o total de quem compareceu.',
    aptos: 'Eleitores aptos registrados nas seções do bairro.',
  };
  el.textContent = hints[S.metric] || '';
}

// ------------------------------------------------------------------ painel lateral

function renderSide() {
  document.querySelectorAll('.side-tabs button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.side === S.side)));
  const body = document.getElementById('side-body');
  body.innerHTML = S.side === 'bairro' ? sideBairro() : sideCand();
}

function sideCand() {
  const A = D.cand[S.candA];
  if (!A) return `<p class="empty">Escolha um candidato acima ou clique em um nome no ranking para ver de onde vieram os votos.</p>`;
  const B = D.cand[S.candB];
  const cityShare = A.votos / validosTotal();
  const bairrosDesc = S.data.bairros.filter((b) => hasData(b.id))
    .map((b) => ({ b, v: A.por_bairro[b.id] || 0, vb: B ? (B.por_bairro[b.id] || 0) : 0, val: validosB(b.id) || 1 }))
    .sort((x, y) => y.v - x.v);
  const maxShare = Math.max(...bairrosDesc.map((r) => Math.max(r.v / r.val, B ? r.vb / r.val : 0)), 0.0001);

  const top3 = bairrosDesc.slice(0, 3);
  const top3Share = top3.reduce((s, r) => s + r.v, 0) / (A.votos || 1);
  const best = [...bairrosDesc].sort((x, y) => y.v / y.val - x.v / x.val)[0];

  let partyLine = '';
  if (A.cargo === 'vereador') {
    const p = D.partido[A.partido];
    const mates = cands().filter((c) => c.partido === A.partido);
    const eleitos = mates.filter(isEleito);
    const lastEleito = eleitos[eleitos.length - 1];
    partyLine = `<p class="insight">Teve <strong>${pct(A.votos / (p?.total_validos || 1))}</strong> dos votos do ${esc(A.partido)}
      (${fmt(p?.total_validos)} somando legenda). ${eleitos.length ? `O partido elegeu ${eleitos.length}; ` : 'O partido não elegeu ninguém. '}
      ${lastEleito && !isEleito(A) ? `o eleito menos votado do partido teve <strong>${fmt(lastEleito.votos)}</strong> votos (faltaram ${fmt(lastEleito.votos - A.votos)}).` : ''}</p>`;
  }

  const rows = bairrosDesc.map((r) => {
    const two = !!B;
    return `<button type="button" class="bar-row ${two ? 'two' : ''} ${r.b.id === S.bairro ? 'sel' : ''}" data-bairro="${r.b.id}">
      <span class="name">${esc(r.b.nome)}</span>
      <span class="track"><span class="fill a" style="width:${(r.v / r.val / maxShare) * 100}%"></span>${two ? `<span class="fill b" style="width:${(r.vb / r.val / maxShare) * 100}%"></span>` : ''}</span>
      <span class="val">${two ? `<strong>${pct(r.v / r.val)}</strong> × ${pct(r.vb / r.val)}` : `<strong>${fmt(r.v)}</strong> · ${pct(r.v / r.val)}`}</span>
    </button>`;
  }).join('');

  const topLocais = Object.entries(A.por_local).sort((a, b) => b[1] - a[1]).slice(0, 8);
  const maxL = topLocais[0]?.[1] || 1;
  const locaisRows = topLocais.map(([lid, v]) => `<button type="button" class="bar-row" data-local="${lid}">
      <span class="name" title="${esc(D.local[lid]?.nome)}">${esc(D.local[lid]?.nome)}</span>
      <span class="track"><span class="fill a" style="width:${(v / maxL) * 100}%"></span></span>
      <span class="val"><strong>${fmt(v)}</strong> · ${pct(v / (validosL(lid) || 1))}</span></button>`).join('');

  const badges = [
    `<span class="badge ${isEleito(A) ? 'eleito' : ''}">${isEleito(A) ? '✓ ' : ''}${esc(situacaoCurta(A.situacao))}</span>`,
    `<span class="badge">${esc(A.partido)}${A.federacao ? ' · Fed. ' + esc(A.federacao) : ''}</span>`,
    !A.valido ? `<span class="badge anulado">⚠ Votos ${esc(A.destino_votos.toLowerCase())}</span>` : '',
  ].join('');

  return `<div class="cand-head"><div><h2>${esc(A.urna)}</h2><div class="nome">${esc(A.nome)}</div></div><div class="num">${A.numero}</div></div>
    <div class="badges">${badges}</div>
    <div class="stats">
      <div class="stat"><div class="label">Votos</div><div class="value">${fmt(A.votos)}</div></div>
      <div class="stat"><div class="label">Posição</div><div class="value">${A.pos}º <small>de ${cands().length}</small></div></div>
      <div class="stat"><div class="label">% válidos</div><div class="value">${pct(cityShare, 2)}</div></div>
    </div>
    ${partyLine}
    <p class="insight"><strong>${pct(top3Share, 0)}</strong> dos votos vieram de 3 bairros (${top3.map((r) => esc(r.b.nome)).join(', ')}).
      Melhor desempenho relativo: <strong>${esc(best?.b.nome)}</strong>, com ${pct(best.v / best.val)} dos válidos (${(best.v / best.val / (cityShare || 1)).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}× a média da cidade).</p>
    <div class="section-title">Votos por bairro <small>${B ? '% dos válidos' : 'votos · % dos válidos'}</small></div>
    ${B ? `<div class="key"><span><i style="background:var(--bar-a)"></i>${esc(A.urna)}</span><span><i style="background:var(--bar-b)"></i>${esc(B.urna)}</span></div>` : ''}
    <div class="bars">${rows}</div>
    <div class="section-title">Locais com mais votos</div>
    <div class="bars">${locaisRows}</div>`;
}

function sideBairro() {
  const b = D.bairro[S.bairro];
  if (!b) return `<p class="empty">Clique em um bairro no mapa para ver comparecimento, os mais votados e os locais de votação.</p>`;
  if (!hasData(b.id)) {
    return `<div class="cand-head"><h2>${esc(b.nome)}</h2></div>
      <p class="empty">Não há local de votação dentro dos limites deste bairro. Os eleitores que moram aqui votam em escolas de bairros vizinhos, por isso os votos deles aparecem nesses bairros.</p>`;
  }
  const v = validosB(b.id) || 1;
  const top = cands().filter((c) => c.valido && c.por_bairro[b.id]).sort((x, y) => y.por_bairro[b.id] - x.por_bairro[b.id]).slice(0, 12);
  const max = top[0]?.por_bairro[b.id] || 1;
  const rows = top.map((c) => `<button type="button" class="bar-row ${c.sq === S.candA ? 'sel' : ''}" data-cand="${c.sq}">
      <span class="name" title="${esc(c.nome)}">${esc(c.urna)} <small>${esc(c.partido)}</small></span>
      <span class="track"><span class="fill a" style="width:${(c.por_bairro[b.id] / max) * 100}%"></span></span>
      <span class="val"><strong>${fmt(c.por_bairro[b.id])}</strong> · ${pct(c.por_bairro[b.id] / v)}</span></button>`).join('');

  let partyRows = '';
  if (S.cargo === 'vereador') {
    const totals = {};
    for (const c of cands()) if (c.valido && c.por_bairro[b.id]) totals[c.partido] = (totals[c.partido] || 0) + c.por_bairro[b.id];
    for (const p of S.data.partidos) if (p.legenda_por_bairro[b.id]) totals[p.sigla] = (totals[p.sigla] || 0) + p.legenda_por_bairro[b.id];
    const ps = Object.entries(totals).sort((x, y) => y[1] - x[1]).slice(0, 6);
    const pm = ps[0]?.[1] || 1;
    partyRows = `<div class="section-title">Partidos no bairro <small>nominais + legenda</small></div><div class="bars">${ps.map(([s, n]) => `
      <div class="bar-row"><span class="name">${esc(s)}</span><span class="track"><span class="fill a" style="width:${(n / pm) * 100}%"></span></span><span class="val"><strong>${fmt(n)}</strong> · ${pct(n / v)}</span></div>`).join('')}</div>`;
  }

  const locais = b.locais.map((lid) => D.local[lid]).sort((x, y) => y.aptos - x.aptos);
  return `<div class="cand-head"><div><h2>${esc(b.nome)}</h2><div class="nome">${b.locais.length} ${b.locais.length === 1 ? 'local' : 'locais'} de votação · ${b.secoes} seções</div></div></div>
    <div class="stats">
      <div class="stat"><div class="label">Aptos</div><div class="value">${fmt(b.aptos)}</div></div>
      <div class="stat"><div class="label">Abstenção</div><div class="value">${pct(b.abstencoes / b.aptos)}</div></div>
      <div class="stat"><div class="label">Brancos+nulos</div><div class="value">${pct(brancosNulos('bairro', b.id) / b.comparecimento)}</div></div>
    </div>
    <div class="section-title">Mais votados para ${S.cargo} <small>votos · % dos válidos</small></div>
    <div class="bars">${rows}</div>
    ${partyRows}
    <div class="section-title">Locais de votação</div>
    <div class="bars">${locais.map((l) => `<button type="button" class="bar-row" data-local="${l.id}"><span class="name" title="${esc(l.nome)}">${esc(l.nome)}</span><span class="track"></span><span class="val">${fmt(l.aptos)} aptos</span></button>`).join('')}</div>`;
}

// ------------------------------------------------------------------ tabelas

function renderTable() {
  document.querySelectorAll('#table-tabs button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === S.tab)));
  const el = document.getElementById('table-body');
  const fn = { eleitos: tblEleitos, ranking: tblRanking, partidos: tblPartidos, bairros: tblBairros, locais: tblLocais, sobre: tblSobre }[S.tab];
  el.innerHTML = fn();
}

function strongestBairro(c) {
  let best = null;
  for (const [bid, v] of Object.entries(c.por_bairro)) if (!best || v > best.v) best = { bid, v };
  return best ? `${esc(D.bairro[best.bid]?.nome || best.bid)} <small>${pct(best.v / (c.votos || 1), 0)}</small>` : '–';
}

function tblEleitos() {
  const list = cands().filter(isEleito);
  const max = list[0]?.votos || 1;
  const vt = validosTotal();
  const intro = S.cargo === 'vereador'
    ? `<p class="insight" style="margin-top:12px">${list.length} cadeiras na Câmara. Quociente eleitoral: <strong>${fmt(S.data.meta.quociente_eleitoral)}</strong> votos (válidos ÷ cadeiras). Clique numa linha para ver o candidato no mapa.</p>`
    : `<p class="insight" style="margin-top:12px">Resultado para prefeito (todos os candidatos).</p>`;
  const rows = (S.cargo === 'vereador' ? list : cands()).map((c) => `<tr data-cand="${c.sq}" class="${c.sq === S.candA ? 'is-sel' : ''}">
      <td>${c.pos}º</td><td><strong>${esc(c.urna)}</strong><br><small>${esc(c.nome)}</small></td><td>${c.numero}</td><td>${esc(c.partido)}</td>
      <td class="r">${fmt(c.votos)}<span class="mini-bar" style="width:${(c.votos / max) * 60}px"></span></td><td class="r">${pct(c.votos / vt, 2)}</td>
      <td>${esc(situacaoCurta(c.situacao))}</td><td>${strongestBairro(c)}</td></tr>`).join('');
  return `${intro}<div class="table-wrap"><table><thead><tr><th>Pos.</th><th>Candidato</th><th>Nº</th><th>Partido</th><th class="r">Votos</th><th class="r">% válidos</th><th>Situação</th><th>Bairro com mais votos <small>(% do total dele)</small></th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

function rankingRows() {
  const r = S.rank;
  const q = norm(r.q);
  let list = cands().filter((c) =>
    (!q || norm(c.urna).includes(q) || norm(c.nome).includes(q) || String(c.numero).startsWith(q)) &&
    (!r.partido || c.partido === r.partido) &&
    (!r.situacao || situacaoCurta(c.situacao).startsWith(r.situacao)));
  const key = { votos: (c) => c.votos, urna: (c) => norm(c.urna), partido: (c) => c.partido, numero: (c) => c.numero, situacao: (c) => c.situacao }[r.sort];
  list = list.sort((a, b) => (key(a) > key(b) ? 1 : key(a) < key(b) ? -1 : 0) * r.dir);
  return list;
}

function tblRanking() {
  const r = S.rank;
  const partidos = [...new Set(cands().map((c) => c.partido))].sort();
  const list = rankingRows();
  const vt = validosTotal();
  const max = cands()[0]?.votos || 1;
  const arrow = (k) => (r.sort === k ? (r.dir < 0 ? ' ↓' : ' ↑') : '');
  const rows = list.map((c) => `<tr data-cand="${c.sq}" class="${c.sq === S.candA ? 'is-sel' : ''}">
      <td>${c.pos}º</td><td><strong>${esc(c.urna)}</strong><br><small>${esc(c.nome)}</small></td><td>${c.numero}</td><td>${esc(c.partido)}</td>
      <td>${esc(situacaoCurta(c.situacao))}${c.valido ? '' : ' <small>(votos anulados)</small>'}</td>
      <td class="r">${fmt(c.votos)}<span class="mini-bar" style="width:${(c.votos / max) * 60}px"></span></td><td class="r">${pct(c.votos / vt, 2)}</td><td>${strongestBairro(c)}</td></tr>`).join('');
  return `<div class="table-tools">
      <label class="field"><span>Buscar</span><input id="rk-q" value="${esc(r.q)}" placeholder="Nome ou número"></label>
      <label class="field"><span>Partido</span><select id="rk-p"><option value="">Todos</option>${partidos.map((p) => `<option ${p === r.partido ? 'selected' : ''}>${esc(p)}</option>`).join('')}</select></label>
      <label class="field"><span>Situação</span><select id="rk-s"><option value="">Todas</option>${['Eleito', 'Suplente', 'Não eleito'].map((s) => `<option ${s === r.situacao ? 'selected' : ''}>${s}</option>`).join('')}</select></label>
      <span class="spacer"></span><span class="insight">${list.length} candidatos</span>
      <button type="button" class="btn" id="rk-csv">Baixar CSV</button></div>
    <div class="table-wrap"><table><thead><tr><th>Pos.</th><th data-sort="urna">Candidato${arrow('urna')}</th><th data-sort="numero">Nº${arrow('numero')}</th><th data-sort="partido">Partido${arrow('partido')}</th>
      <th data-sort="situacao">Situação${arrow('situacao')}</th><th class="r" data-sort="votos">Votos${arrow('votos')}</th><th class="r">% válidos</th><th>Bairro com mais votos</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

function tblPartidos() {
  if (S.cargo !== 'vereador') return `<p class="empty">A divisão por partido (legenda e quociente) vale para a eleição proporcional de vereador. Troque o cargo para “Vereador” no topo.</p>`;
  const qe = S.data.meta.quociente_eleitoral;
  const vt = validosTotal();
  // federação disputa como um partido só: agrega para o quociente partidário
  const ag = {};
  for (const p of S.data.partidos) {
    const k = p.federacao || p.sigla;
    ag[k] ??= { nome: k, fed: !!p.federacao, total: 0, eleitos: 0, partidos: [] };
    ag[k].total += p.total_validos; ag[k].eleitos += p.eleitos; ag[k].partidos.push(p.sigla);
  }
  const ags = Object.values(ag).sort((a, b) => b.total - a.total);
  const max = ags[0]?.total || 1;
  const agRows = ags.map((a) => `<tr><td><strong>${esc(a.nome)}</strong>${a.fed ? ' <small>federação</small>' : ''}</td>
      <td class="r">${fmt(a.total)}<span class="mini-bar" style="width:${(a.total / max) * 80}px"></span></td><td class="r">${pct(a.total / vt)}</td>
      <td class="r">${pct(a.total / qe, 0)}</td><td class="r">${Math.floor(a.total / qe)}</td><td class="r"><strong>${a.eleitos}</strong></td></tr>`).join('');
  const pRows = S.data.partidos.map((p) => {
    const top = cands().find((c) => c.partido === p.sigla);
    return `<tr><td><strong>${esc(p.sigla)}</strong> <small>${p.numero}</small></td><td>${esc(p.federacao || '–')}</td>
      <td class="r">${fmt(p.nominais)}</td><td class="r">${fmt(p.legenda)}</td><td class="r">${fmt(p.total_validos)}</td><td class="r">${pct(p.legenda / (p.total_validos || 1))}</td>
      <td class="r">${p.eleitos}</td><td>${top ? `<span data-cand="${top.sq}" style="cursor:pointer;text-decoration:underline dotted">${esc(top.urna)}</span> <small>${fmt(top.votos)}</small>` : '–'}</td></tr>`;
  }).join('');
  return `<p class="insight" style="margin-top:12px">Quociente eleitoral = ${fmt(vt)} votos válidos ÷ ${S.data.meta.cadeiras} cadeiras = <strong>${fmt(qe)}</strong>.
      O quociente partidário (votos ÷ QE, arredondado para baixo) dá as vagas diretas; o restante foi distribuído pelas maiores médias.</p>
    <div class="section-title">Por agremiação <small>partido isolado ou federação</small></div>
    <div class="table-wrap"><table><thead><tr><th>Agremiação</th><th class="r">Votos válidos</th><th class="r">% válidos</th><th class="r">% do QE</th><th class="r">Quociente partidário</th><th class="r">Eleitos</th></tr></thead><tbody>${agRows}</tbody></table></div>
    <div class="section-title">Por partido</div>
    <div class="table-wrap"><table><thead><tr><th>Partido</th><th>Federação</th><th class="r">Nominais</th><th class="r">Legenda</th><th class="r">Total</th><th class="r">% legenda</th><th class="r">Eleitos</th><th>Mais votado</th></tr></thead><tbody>${pRows}</tbody></table></div>`;
}

function tblBairros() {
  const rows = [...S.data.bairros].sort((a, b) => b.aptos - a.aptos).map((b) => {
    if (!hasData(b.id)) return `<tr data-bairro="${b.id}"><td><strong>${esc(b.nome)}</strong></td><td colspan="6"><small>sem local de votação</small></td></tr>`;
    const l = D.leader[S.cargo].bairro[b.id];
    const c = l && D.cand[l.sq];
    return `<tr data-bairro="${b.id}" class="${b.id === S.bairro ? 'is-sel' : ''}"><td><strong>${esc(b.nome)}</strong></td><td class="r">${b.locais.length}</td><td class="r">${fmt(b.aptos)}</td>
      <td class="r">${pct(b.comparecimento / b.aptos)}</td><td class="r">${pct(b.abstencoes / b.aptos)}</td><td class="r">${pct(brancosNulos('bairro', b.id) / b.comparecimento)}</td>
      <td>${c ? `${esc(c.urna)} <small>${esc(c.partido)} · ${pct(l.v / (validosB(b.id) || 1))}</small>` : '–'}</td></tr>`;
  }).join('');
  return `<p class="insight" style="margin-top:12px">Os números de cada bairro somam as urnas instaladas nele. Clique numa linha para destacar o bairro no mapa.</p>
    <div class="table-wrap"><table><thead><tr><th>Bairro</th><th class="r">Locais</th><th class="r">Aptos</th><th class="r">Comparecimento</th><th class="r">Abstenção</th><th class="r">Brancos+nulos</th><th>Mais votado (${S.cargo})</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

function tblLocais() {
  const rows = [...S.data.locais].sort((a, b) => b.aptos - a.aptos).map((l) => {
    const ld = D.leader[S.cargo].local[l.id];
    const c = ld && D.cand[ld.sq];
    return `<tr data-local="${l.id}"><td><strong>${esc(l.nome)}</strong><br><small>${esc(l.endereco)}</small></td><td>${esc(D.bairro[l.bairro]?.nome || '–')}<br><small>TSE: ${esc(l.bairro_tse)}</small></td>
      <td class="r">${l.zona}</td><td class="r">${l.secoes}</td><td class="r">${fmt(l.aptos)}</td><td class="r">${pct(l.abstencoes / (l.aptos || 1))}</td>
      <td>${c ? `${esc(c.urna)} <small>${pct(ld.v / (validosL(l.id) || 1))}</small>` : '–'}</td></tr>`;
  }).join('');
  return `<p class="insight" style="margin-top:12px">${S.data.locais.length} locais de votação. “Bairro” é o bairro oficial em que a coordenada do local cai no mapa; “TSE” é o bairro escrito no cadastro do local, que às vezes usa nomes populares (ex.: “Presidente Juscelino”, “Parque Senador”).</p>
    <div class="table-wrap"><table><thead><tr><th>Local</th><th>Bairro</th><th class="r">Zona</th><th class="r">Seções</th><th class="r">Aptos</th><th class="r">Abstenção</th><th>Mais votado (${S.cargo})</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

function tblSobre() {
  const m = S.data.meta;
  const semLocal = S.data.bairros.filter((b) => !hasData(b.id)).map((b) => b.nome);
  const anul = S.data.extras.vereador;
  const anulados = Object.entries(anul).filter(([k]) => k.startsWith('nr:')).reduce((s, [, v]) => s + Object.values(v.por_bairro).reduce((a, b) => a + b, 0), 0)
    + S.data.candidatos.filter((c) => c.cargo === 'vereador' && !c.valido).reduce((s, c) => s + c.votos, 0);
  return `<div class="prose">
    <h3>De onde vêm os números</h3>
    <ul>
      <li>Votos por seção, comparecimento, candidatos, partidos e locais de votação: arquivos abertos do TSE das Eleições 2024 (1º turno, ${m.data_eleicao.split('-').reverse().join('/')}).</li>
      <li>A soma dos votos seção a seção confere, candidato por candidato, com o total oficial do TSE.</li>
      <li>Limites dos ${S.data.bairros.length} bairros: OpenStreetMap (ODbL). Na divisa entre Parque Ludolf e Vila Emil falta um trecho no OSM e ele foi fechado com uma linha reta.</li>
    </ul>
    <h3>Como ler o mapa</h3>
    <ul>
      <li><strong>O voto é contado onde a urna está, não onde o eleitor mora.</strong> Cada local de votação foi colocado no bairro em que sua coordenada cai, e o bairro soma as urnas dos seus locais.</li>
      <li>Bairros sem nenhum local de votação ficam em cinza tracejado: ${semLocal.map(esc).join(', ') || 'nenhum'}. Os moradores desses bairros votam em escolas vizinhas.</li>
      <li>“% dos válidos” para vereador usa votos nominais válidos + votos de legenda. Brancos, nulos e votos anulados não entram.</li>
      <li>“Força relativa” compara o desempenho do candidato no bairro com o desempenho dele na cidade inteira: 1× é igual à média, 2× é o dobro.</li>
      <li>Votos de candidaturas anuladas ou sub judice (${fmt(anulados)} votos para vereador) aparecem no perfil do candidato, mas não contam como válidos.</li>
    </ul>
    <h3>Atualizar os dados</h3>
    <p>Rode <code>scripts\\download_data.ps1</code> e depois <code>py scripts\\build_data.py</code>. Gerado em ${esc(m.gerado_em.replace('T', ' '))}.</p>
  </div>`;
}

function exportCsv() {
  const head = ['posicao', 'numero', 'nome_urna', 'nome', 'partido', 'situacao', 'votos', 'pct_validos', ...S.data.bairros.map((b) => b.nome)];
  const vt = validosTotal();
  const lines = [head, ...rankingRows().map((c) => [c.pos, c.numero, c.urna, c.nome, c.partido, situacaoCurta(c.situacao), c.votos,
    (c.votos / vt * 100).toFixed(3).replace('.', ','), ...S.data.bairros.map((b) => c.por_bairro[b.id] || 0)])];
  const csv = '﻿' + lines.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(';')).join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  a.download = `mesquita_2024_${S.cargo}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// ------------------------------------------------------------------ KPIs

function renderKpis() {
  const bs = S.data.bairros;
  const aptos = bs.reduce((s, b) => s + b.aptos, 0);
  const comp = bs.reduce((s, b) => s + b.comparecimento, 0);
  const bn = bs.reduce((s, b) => s + brancosNulos('bairro', b.id), 0);
  const vt = validosTotal();
  const first = cands()[0];
  const tiles = [
    ['Eleitores aptos', fmt(aptos), `${S.data.locais.length} locais de votação`],
    ['Comparecimento', pct(comp / aptos), `${fmt(comp)} eleitores`],
    ['Abstenção', pct(1 - comp / aptos), `${fmt(aptos - comp)} eleitores`],
    ['Brancos + nulos', pct(bn / comp), `${fmt(bn)} votos`],
    ['Votos válidos', fmt(vt), S.cargo === 'vereador' ? 'nominais + legenda' : 'para prefeito'],
    S.cargo === 'vereador'
      ? ['Quociente eleitoral', fmt(S.data.meta.quociente_eleitoral), `${S.data.meta.cadeiras} cadeiras`]
      : ['Prefeito eleito', esc(first.urna), `${esc(first.partido)} · ${pct(first.votos / vt)}`, true],
    S.cargo === 'vereador' ? ['Mais votado', esc(first.urna), `${esc(first.partido)} · ${fmt(first.votos)} votos`, true] : null,
  ].filter(Boolean);
  document.getElementById('kpis').innerHTML = tiles.map(([l, v, n, text]) => `<div class="kpi card"><div class="label">${l}</div><div class="value ${text ? 'text' : ''}">${v}</div><div class="note">${n}</div></div>`).join('');
}

// ------------------------------------------------------------------ interação

function renderAll() {
  document.querySelectorAll('.seg button').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.cargo === S.cargo)));
  const sel = document.getElementById('metric');
  sel.innerHTML = Object.entries(METRICS).map(([k, m]) => `<option value="${k}" ${k === S.metric ? 'selected' : ''}>${m.label}</option>`).join('');
  document.getElementById('cand-list').innerHTML = cands().map((c) => `<option value="${esc(candLabel(c))}"></option>`).join('');
  document.getElementById('cand-a').value = D.cand[S.candA] ? candLabel(D.cand[S.candA]) : '';
  document.getElementById('cand-b').value = D.cand[S.candB] ? candLabel(D.cand[S.candB]) : '';
  renderKpis();
  renderMap();
  renderSide();
  renderTable();
  writeHash();
}

function resolveCand(text) {
  const t = norm(text).trim();
  if (!t) return null;
  const list = cands();
  return (list.find((c) => norm(candLabel(c)) === t) || list.find((c) => String(c.numero) === t) ||
    list.find((c) => norm(c.urna) === t) || list.find((c) => norm(c.urna).startsWith(t)) || list.find((c) => norm(c.nome).includes(t)))?.sq ?? null;
}

function selectCand(sq, slot = 'A') {
  if (slot === 'A') S.candA = sq; else S.candB = sq;
  if (sq && slot === 'A') {
    S.side = 'cand';
    if (!METRICS[S.metric].needs) S.metric = 'cand_pct';
  }
  if (sq && slot === 'B') { S.metric = 'compare'; S.side = 'cand'; }
  if (!sq && slot === 'B' && S.metric === 'compare') S.metric = 'cand_pct';
  renderAll();
}

function selectBairro(bid) {
  S.bairro = bid;
  S.side = 'bairro';
  renderMap();
  renderSide();
  if (S.tab === 'bairros') renderTable();
  writeHash();
}

function focusLocal(lid) {
  const l = D.local[lid];
  if (!l?.lat) return;
  map.flyTo([l.lat, l.lon], 16, { duration: 0.6 });
  localLayer.eachLayer((m) => {
    const p = m.getLatLng();
    if (p.lat === l.lat && p.lng === l.lon) setTimeout(() => m.openPopup(), 650);
  });
  document.getElementById('map').scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function writeHash() {
  const p = new URLSearchParams();
  if (S.cargo !== 'vereador') p.set('cargo', S.cargo);
  if (S.metric !== 'cand_pct') p.set('m', S.metric);
  if (S.candA) p.set('a', D.cand[S.candA].numero);
  if (S.candB) p.set('b', D.cand[S.candB].numero);
  if (S.bairro) p.set('bairro', S.bairro);
  if (S.tab !== 'eleitos') p.set('tab', S.tab);
  const h = p.toString();
  history.replaceState(null, '', h ? '#' + h : location.pathname);
}

function readHash() {
  const p = new URLSearchParams(location.hash.slice(1));
  if (p.get('cargo') === 'prefeito') S.cargo = 'prefeito';
  if (METRICS[p.get('m')]) S.metric = p.get('m');
  const byNum = (n) => cands().find((c) => String(c.numero) === n)?.sq ?? null;
  if (p.get('a')) S.candA = byNum(p.get('a'));
  if (p.get('b')) S.candB = byNum(p.get('b'));
  if (D.bairro[p.get('bairro')]) { S.bairro = p.get('bairro'); S.side = 'bairro'; }
  if (document.querySelector(`#table-tabs [data-tab="${p.get('tab')}"]`)) S.tab = p.get('tab');
  if (!S.candA) S.candA = cands()[0]?.sq ?? null; // começa mostrando o mais votado
}

function bindEvents() {
  document.querySelector('.seg').addEventListener('click', (e) => {
    const c = e.target.closest('button')?.dataset.cargo;
    if (!c || c === S.cargo) return;
    S.cargo = c;
    S.candA = cands()[0].sq;
    S.candB = null;
    if (S.metric === 'compare') S.metric = 'cand_pct';
    renderAll();
  });
  document.getElementById('metric').addEventListener('change', (e) => { S.metric = e.target.value; renderMap(); writeHash(); });
  for (const [id, slot] of [['cand-a', 'A'], ['cand-b', 'B']]) {
    const inp = document.getElementById(id);
    inp.addEventListener('change', () => selectCand(resolveCand(inp.value), slot));
  }
  document.querySelector('.side-tabs').addEventListener('click', (e) => {
    const s = e.target.closest('button')?.dataset.side;
    if (s) { S.side = s; renderSide(); }
  });
  document.getElementById('table-tabs').addEventListener('click', (e) => {
    const t = e.target.closest('button')?.dataset.tab;
    if (t) { S.tab = t; renderTable(); writeHash(); }
  });

  // cliques delegados em linhas/barras (painel e tabelas)
  const onPick = (e) => {
    const t = e.target.closest('[data-cand],[data-bairro],[data-local],th[data-sort]');
    if (!t) return;
    if (t.matches('th[data-sort]')) {
      const k = t.dataset.sort;
      S.rank.dir = S.rank.sort === k ? -S.rank.dir : (k === 'votos' ? -1 : 1);
      S.rank.sort = k;
      renderTable();
    } else if (t.dataset.cand) {
      selectCand(t.dataset.cand, 'A');
      document.getElementById('map').scrollIntoView({ behavior: 'smooth', block: 'center' });
    } else if (t.dataset.bairro) {
      selectBairro(t.dataset.bairro);
      if (t.closest('#table-body')) document.getElementById('map').scrollIntoView({ behavior: 'smooth', block: 'center' });
    } else if (t.dataset.local) focusLocal(t.dataset.local);
  };
  document.getElementById('side-body').addEventListener('click', onPick);
  document.getElementById('table-body').addEventListener('click', onPick);

  const tb = document.getElementById('table-body');
  tb.addEventListener('input', (e) => {
    if (e.target.id !== 'rk-q') return;
    S.rank.q = e.target.value;
    const pos = e.target.selectionStart;
    renderTable();
    const inp = document.getElementById('rk-q');
    inp.focus(); inp.setSelectionRange(pos, pos);
  });
  tb.addEventListener('change', (e) => {
    if (e.target.id === 'rk-p') { S.rank.partido = e.target.value; renderTable(); }
    if (e.target.id === 'rk-s') { S.rank.situacao = e.target.value; renderTable(); }
  });
  tb.addEventListener('click', (e) => { if (e.target.id === 'rk-csv') exportCsv(); });

  document.getElementById('theme-toggle').addEventListener('click', () => {
    const next = theme() === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem('theme', next); } catch { /* armazenamento indisponível */ }
    setTiles();
    renderMap();
  });
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { setTiles(); renderMap(); });
}

(async function main() {
  try { const t = localStorage.getItem('theme'); if (t) document.documentElement.dataset.theme = t; } catch { /* ignore */ }
  try {
    await load();
  } catch (err) {
    document.querySelector('.layout').innerHTML = `<p class="card empty" style="padding:16px">Não consegui carregar os dados (${esc(err.message)}). Abra o app por um servidor local: <code>py -m http.server -d web 8000</code>.</p>`;
    return;
  }
  readHash();
  initMap();
  bindEvents();
  const m = S.data.meta;
  document.getElementById('foot').innerHTML = `Fontes: ${m.fontes.map(esc).join(' · ')}. Dados gerados em ${esc(m.gerado_em.replace('T', ' '))}.`;
  renderAll();
})();
