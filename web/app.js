'use strict';

// ------------------------------------------------------------------ formatação

const nf = new Intl.NumberFormat('pt-BR');
const fmt = (n) => nf.format(Math.round(n || 0));
const pct = (x, d = 1) => (Number.isFinite(x) ? (x * 100).toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d }) + '%' : '–');
const sinal = (n) => (n > 0 ? '+' : n < 0 ? '−' : '') + fmt(Math.abs(n));
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
// Cores das agremiações: paleta categórica em ordem fixa, pela votação real (a cor segue o partido,
// não muda quando o simulador redistribui as cadeiras). Da 9ª em diante: cinza.
const CAT = {
  light: ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948'],
  dark: ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767'],
};
const OUTROS = '#8b939a';

const ELEICAO_2028 = new Date(2028, 9, 1); // 1º turno: primeiro domingo de outubro

// ------------------------------------------------------------------ estado

const S = {
  data: null,
  geo: null,
  view: 'painel',
  cargo: 'vereador',
  metric: 'cand_pct',
  candA: null, // sq
  candB: null,
  bairro: null, // id
  side: 'cand',
  rank: { q: '', partido: '', situacao: '', sort: 'votos', dir: -1 },
  sim: [], // ajustes do simulador: { k: 'c:<sq>' | 'p:<sigla>', d: votos }
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

const VIEWS = {
  painel: { title: 'Dashboard', sub: 'Resumo da eleição municipal de 6 de outubro de 2024 em Mesquita/RJ.' },
  mapa: { title: 'Mapa de votos', sub: 'De onde vieram os votos de cada candidato, bairro a bairro. O voto conta onde a urna está, não onde o eleitor mora.' },
  raiox: { title: 'Raio-X da Câmara', sub: 'Como os votos para vereador viraram 12 cadeiras, e por que ter mais votos não garante a vaga.' },
  simulador: { title: 'Simulador “E se?”', sub: 'Mude votos de candidatos ou de legenda e veja a Câmara se redistribuir com as regras oficiais de 2024.' },
  eleitos: { title: 'Eleitos', table: true },
  ranking: { title: 'Candidatos', table: true },
  partidos: { title: 'Partidos', table: true },
  bairros: { title: 'Bairros', table: true },
  locais: { title: 'Locais de votação', table: true },
  sobre: { title: 'Sobre os dados', table: true },
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

  // agremiação = partido isolado ou federação (a federação disputa como um partido só)
  D.agDe = Object.fromEntries(data.partidos.map((p) => [p.sigla, p.federacao || p.sigla]));
  const agTotal = {};
  for (const p of data.partidos) agTotal[D.agDe[p.sigla]] = (agTotal[D.agDe[p.sigla]] || 0) + p.total_validos;
  D.agTotal = agTotal;
  D.agOrdem = Object.keys(agTotal).sort((a, b) => agTotal[b] - agTotal[a]);
  D.real = simular([]);
  D.margem = {};
}

const cands = () => D.byCargo[S.cargo];
const vereadores = () => D.byCargo.vereador;
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
const diasPara2028 = () => Math.max(0, Math.ceil((ELEICAO_2028 - new Date(new Date().toDateString())) / 86400000));

// ------------------------------------------------------------------ simulação de cadeiras

function montar(adj) {
  const dC = {}, dP = {};
  for (const a of adj) {
    const alvo = a.k.startsWith('c:') ? dC : dP;
    alvo[a.k.slice(2)] = (alvo[a.k.slice(2)] || 0) + a.d;
  }
  let validos = D.validos.vereador.total;
  const ags = {};
  const ag = (sigla) => (ags[D.agDe[sigla]] ??= { id: D.agDe[sigla], votos: 0, cands: [] });
  for (const p of S.data.partidos) {
    const leg = Math.max(0, p.legenda + (dP[p.sigla] || 0));
    ag(p.sigla).votos += leg;
    validos += leg - p.legenda;
  }
  for (const c of vereadores()) {
    if (!c.valido) continue;
    const v = Math.max(0, c.votos + (dC[c.sq] || 0));
    const a = ag(c.partido);
    a.votos += v;
    a.cands.push({ sq: c.sq, votos: v });
    validos += v - c.votos;
  }
  return { ags: Object.values(ags), validos };
}

function simular(adj) {
  const { ags, validos } = montar(adj);
  const r = Eleicao.distribuir(ags, S.data.meta.cadeiras, validos);
  r.validos = validos;
  r.agVotos = Object.fromEntries(ags.map((a) => [a.id, a.votos]));
  return r;
}

// Menor busca binária em [lo, hi] onde ok(n) passa a ser verdadeiro (ok é monotônico na prática).
function menorQue(ok, hi) {
  let lo = 1;
  if (!ok(hi)) return null;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (ok(mid)) hi = mid; else lo = mid + 1;
  }
  return lo;
}

// Para quem não se elegeu: quantos votos a mais bastariam. Para quem se elegeu: com quantos a menos perderia a vaga.
function margem(c) {
  if (!c || c.cargo !== 'vereador' || !c.valido) return null;
  if (c.sq in D.margem) return D.margem[c.sq];
  const k = 'c:' + c.sq;
  let r;
  if (D.real.eleitos.has(c.sq)) {
    const n = menorQue((x) => !simular([{ k, d: -x }]).eleitos.has(c.sq), c.votos);
    r = n == null ? null : { tipo: 'perde', n };
  } else {
    const n = menorQue((x) => simular([{ k, d: x }]).eleitos.has(c.sq), 60000);
    r = n == null ? null : { tipo: 'falta', n };
  }
  D.margem[c.sq] = r;
  return r;
}

function margens() {
  return vereadores().filter((c) => c.valido).map((c) => ({ c, m: margem(c) })).filter((x) => x.m);
}

// ------------------------------------------------------------------ cores e hemiciclo

function agColor(ag) {
  const i = D.agOrdem.indexOf(ag);
  return i >= 0 && i < 8 ? CAT[theme()][i] : OUTROS;
}

function seatTip(c, e, extra = '') {
  const via = { QP: 'quociente partidário', MEDIA: 'maior média (sobras)', MEDIA_GERAL: 'maior média (sobras, sem mínimo)' }[e.via];
  return esc(`<b>${esc(c.urna)}</b> · ${esc(c.partido)}<br><span class="muted">${fmt(c.votos)} votos · vaga por ${via}</span>${extra}`);
}

// Hemiciclo de 12 cadeiras (7 na fileira de fora, 5 na de dentro), agrupadas por agremiação.
function hemiciclo(res, { destaque = null, votos = null, acao = 'cand' } = {}) {
  const seats = [...res.eleitos.entries()]
    .map(([sq, e]) => ({ c: D.cand[sq], e }))
    .sort((a, b) => D.agOrdem.indexOf(a.e.ag) - D.agOrdem.indexOf(b.e.ag) || b.c.votos - a.c.votos);
  const cx = 200, cy = 206, pad = 0.13;
  const pos = [];
  for (const [k, R] of [[7, 178], [5, 116]]) {
    for (let i = 0; i < k; i++) {
      const ang = Math.PI - pad - (i * (Math.PI - 2 * pad)) / (k - 1);
      pos.push({ x: cx + R * Math.cos(ang), y: cy - R * Math.sin(ang), ang });
    }
  }
  pos.sort((a, b) => b.ang - a.ang);
  const circles = seats.map((s, i) => {
    const p = pos[i];
    if (!p) return '';
    const novo = destaque && !destaque.has(s.c.sq);
    const v = votos ? votos[s.c.sq] : s.c.votos;
    const extra = votos && v !== s.c.votos ? `<br>Simulado: <b>${fmt(v)}</b> votos` : '';
    const attr = acao === 'sim' ? `data-simpick="${s.c.sq}"` : `data-cand="${s.c.sq}"`;
    return `${novo ? `<circle class="seat-ring" cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="27"/>` : ''}
      <circle class="seat" ${attr} cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="21" fill="${agColor(s.e.ag)}"
        stroke="var(--surface)" stroke-width="2" data-tip="${seatTip(s.c, s.e, extra)}" tabindex="0" role="button" aria-label="${esc(s.c.urna)}, ${esc(s.c.partido)}"/>`;
  }).join('');
  return `<div class="hemi-wrap"><svg class="hemi" viewBox="0 0 400 236" role="img" aria-label="Distribuição das ${seats.length} cadeiras">
      ${circles}
      <text class="hemi-total" x="200" y="190" text-anchor="middle">${seats.length}</text>
      <text class="hemi-cap" x="200" y="210" text-anchor="middle">cadeiras</text>
    </svg>${partyKey(res, destaque ? D.real : null)}</div>`;
}

function partyKey(res, base) {
  const ags = D.agOrdem.filter((a) => res.vagas[a] || (base && base.vagas[a]));
  return `<div class="party-key">${ags.map((a) => {
    const d = base ? (res.vagas[a] || 0) - (base.vagas[a] || 0) : 0;
    return `<span><i style="background:${agColor(a)}"></i>${esc(a)} <b>${res.vagas[a] || 0}</b>${d ? ` <span class="${d > 0 ? 'delta-up' : 'delta-down'}">(${d > 0 ? '+' : '−'}${Math.abs(d)})</span>` : ''}</span>`;
  }).join('')}</div>`;
}

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
  if (!map) return;
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
  if (!map) return;
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

// ------------------------------------------------------------------ painel lateral do mapa

function renderSide() {
  document.querySelectorAll('.side-tabs button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.side === S.side)));
  const body = document.getElementById('side-body');
  body.innerHTML = S.side === 'bairro' ? sideBairro() : sideCand();
}

function margemLine(c) {
  const m = margem(c);
  if (!m) return '';
  if (m.tipo === 'falta') {
    return `<div class="callout">Faltaram <strong>${fmt(m.n)} votos</strong> para ${esc(c.urna)} conquistar uma cadeira (com as regras de 2024 e os demais votos iguais).
      <a href="#v=simulador" data-simset="c:${c.sq}:${m.n}">Ver no simulador →</a></div>`;
  }
  return `<div class="callout">Margem: com <strong>${fmt(m.n)} votos a menos</strong>, ${esc(c.urna)} teria perdido a cadeira.
    <a href="#v=simulador" data-simset="c:${c.sq}:${-m.n}">Ver no simulador →</a></div>`;
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
    ${margemLine(A)}
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

// ------------------------------------------------------------------ dashboard

function widget(cls, icon, label, value, note, link, href, text = false) {
  return `<div class="widget ${cls}"><span class="w-icon" aria-hidden="true">${icon}</span>
    <div class="w-label">${label}</div><div class="w-value ${text ? 'text' : ''}">${value}</div><div class="w-note">${note}</div>
    <a class="w-link" href="#v=${href}">${link}<span aria-hidden="true">→</span></a></div>`;
}

function renderPainel() {
  const bs = S.data.bairros;
  const aptos = bs.reduce((s, b) => s + b.aptos, 0);
  const comp = bs.reduce((s, b) => s + b.comparecimento, 0);
  const first = cands()[0];
  const vt = validosTotal();
  const dias = diasPara2028();
  document.getElementById('widgets').innerHTML = [
    widget('w-blue', '◉', 'Eleitores aptos', fmt(aptos), `${S.data.locais.length} locais de votação · ${bs.filter((b) => hasData(b.id)).length} bairros com urnas`, 'Ver no mapa', 'mapa'),
    widget('w-violet', '✓', 'Comparecimento', pct(comp / aptos), `${fmt(aptos - comp)} eleitores não foram votar`, 'Bairros', 'bairros'),
    S.cargo === 'vereador'
      ? widget('w-aqua', '◧', 'Quociente eleitoral', fmt(S.data.meta.quociente_eleitoral), `votos por cadeira · ${S.data.meta.cadeiras} cadeiras`, 'Raio-X da Câmara', 'raiox')
      : widget('w-aqua', '★', 'Prefeito eleito', esc(first.urna), `${esc(first.partido)} · ${pct(first.votos / vt)} dos válidos`, 'Resultado completo', 'eleitos', true),
    widget('w-red', '⏱', 'Dias para a eleição', fmt(dias), '1º turno em 01/10/2028', 'Simular cenários', 'simulador'),
  ].join('');

  const nomEleitos = [...D.real.eleitos.keys()].reduce((s, sq) => s + D.cand[sq].votos, 0);
  document.getElementById('dash-camara').innerHTML = `${hemiciclo(D.real)}
    <p class="insight" style="text-align:center;margin-top:10px">Só <strong>${pct(nomEleitos / D.real.validos, 0)}</strong> dos votos válidos para vereador foram para quem se elegeu.
    Clique numa cadeira para ver o vereador no mapa.</p>`;

  document.getElementById('dash-top-title').textContent = `Mais votados · ${S.cargo}`;
  const top = cands().slice(0, 10);
  const max = top[0]?.votos || 1;
  document.getElementById('dash-top').innerHTML = `<div class="bars">${top.map((c) => `
    <button type="button" class="bar-row" data-cand="${c.sq}">
      <span class="name" title="${esc(c.nome)}">${esc(c.urna)} <small>${esc(c.partido)}</small></span>
      <span class="track"><span class="fill ${isEleito(c) ? 'a' : 'muted'}" style="width:${(c.votos / max) * 100}%"></span></span>
      <span class="val"><strong>${fmt(c.votos)}</strong> · ${pct(c.votos / vt)}</span></button>`).join('')}</div>
    <div class="key" style="margin-top:8px"><span><i style="background:var(--bar-a)"></i>Eleito</span><span><i style="background:var(--bar-muted)"></i>Não eleito</span></div>`;

  const bsd = bs.filter((b) => hasData(b.id)).map((b) => ({ b, v: b.comparecimento / b.aptos })).sort((x, y) => y.v - x.v);
  document.getElementById('dash-bairros').innerHTML = `<div class="bars">${bsd.map((r) => `
    <button type="button" class="bar-row" data-bairro="${r.b.id}">
      <span class="name">${esc(r.b.nome)}</span>
      <span class="track"><span class="fill a" style="width:${r.v * 100}%"></span></span>
      <span class="val"><strong>${pct(r.v)}</strong> · ${fmt(r.b.aptos)} aptos</span></button>`).join('')}</div>`;

  const fio = margens().filter((x) => x.m.tipo === 'falta').sort((a, b) => a.m.n - b.m.n).slice(0, 6);
  document.getElementById('dash-fio').innerHTML = `<p class="insight">Candidatos que ficaram mais perto de uma cadeira: quantos votos a mais teriam bastado, mantendo todos os outros votos iguais.</p>
    <div class="chip-list">${fio.map(({ c, m }) => `
      <button type="button" class="chip" data-simset="c:${c.sq}:${m.n}">
        <span class="c-name">${esc(c.urna)} <small>${esc(c.partido)} · ${fmt(c.votos)} votos</small></span>
        <span class="c-meta">faltaram <b>${fmt(m.n)}</b></span></button>`).join('')}</div>`;
}

// ------------------------------------------------------------------ Raio-X

function renderRaiox() {
  const R = D.real;
  const qe = R.qe;
  const V = R.validos;
  const ver = vereadores();
  const eleitos = ver.filter((c) => R.eleitos.has(c.sq));
  const nomEleitos = eleitos.reduce((s, c) => s + c.votos, 0);
  const nomTodos = ver.filter((c) => c.valido).reduce((s, c) => s + c.votos, 0);
  const legenda = S.data.partidos.reduce((s, p) => s + p.legenda, 0);
  const nomNao = nomTodos - nomEleitos;
  const naoEleitos = ver.filter((c) => c.valido && !R.eleitos.has(c.sq)).length;
  const t = theme();

  const top = [...eleitos].sort((a, b) => b.votos - a.votos)[0];
  const minEleito = [...eleitos].sort((a, b) => a.votos - b.votos)[0];
  const fora = ver.filter((c) => c.valido && !R.eleitos.has(c.sq) && c.votos > minEleito.votos);
  const agSem = D.agOrdem.filter((a) => !R.vagas[a]);
  const votosSem = agSem.reduce((s, a) => s + D.agTotal[a], 0);

  const seg = [
    ['Em candidatos eleitos', nomEleitos, CAT[t][0]],
    ['Em candidatos não eleitos', nomNao, 'var(--bar-muted)'],
    ['Só no partido (voto de legenda)', legenda, CAT[t][3]],
  ];
  const hero = `<div class="panel"><div class="panel-head"><h2>Para onde foram os ${fmt(V)} votos válidos</h2></div>
    <div class="panel-body hero">
      <div>
        <div class="hero-num">${pct(nomEleitos / V, 0)}</div>
        <p class="hero-lead">dos votos para vereador foram para quem se elegeu.</p>
        <p class="hero-sub">Os outros ${fmt(V - nomEleitos)} votos foram para ${naoEleitos} candidatos que não se elegeram ou só para o partido.
          Eles não foram perdidos: no sistema proporcional, todo voto soma para o partido e decide quantas cadeiras cada um leva.
          Quem ocupa a cadeira são os mais votados dentro de cada partido.</p>
      </div>
      <div>
        <div class="stack" role="img" aria-label="Divisão dos votos válidos">${seg.map(([l, v, c]) => `<span style="width:${(v / V) * 100}%;background:${c}" data-tip="${esc(`<b>${l}</b><br>${fmt(v)} votos · ${pct(v / V)}`)}"></span>`).join('')}</div>
        <div class="stack-key">${seg.map(([l, v, c]) => `<div><i style="background:${c}"></i>${l}<b>${fmt(v)} · ${pct(v / V)}</b></div>`).join('')}</div>
        ${hemiciclo(R)}
      </div>
    </div></div>`;

  const facts = `<div class="facts">
    <div class="fact"><div class="f-num">${pct(top.votos / qe, 0)}</div><div class="f-lead">foi o máximo que um vereador teve do quociente</div>
      <p>Ninguém se elegeu sozinho. O mais votado, ${esc(top.urna)}, teve ${fmt(top.votos)} votos, menos da metade dos ${fmt(qe)} que valem uma cadeira. Todos os 12 dependeram dos votos do partido.</p></div>
    <div class="fact f-violet"><div class="f-num">${fora.length}</div><div class="f-lead">candidatos tiveram mais votos que um eleito e ficaram de fora</div>
      <p>O eleito com menos votos, ${esc(minEleito.urna)} (${esc(minEleito.partido)}), teve ${fmt(minEleito.votos)}. ${fora.map((c) => esc(c.urna)).join(', ')} tiveram mais e não entraram.</p></div>
    <div class="fact f-red"><div class="f-num">${fmt(votosSem)}</div><div class="f-lead">votos (${pct(votosSem / V, 0)}) foram para partidos que não elegeram ninguém</div>
      <p>${agSem.length} das ${D.agOrdem.length} agremiações não chegaram a nenhuma cadeira. A maior delas foi ${esc(agSem[0])}, com ${fmt(D.agTotal[agSem[0]])} votos.</p></div>
  </div>`;

  // barra de cada eleito até o quociente (o trilho cheio = 1 QE)
  const quota = `<div class="panel"><div class="panel-head"><h2>Ninguém chegou ao quociente sozinho</h2></div><div class="panel-body">
    <p class="insight">Cada trilho vai até o quociente eleitoral (${fmt(qe)} votos, o preço de uma cadeira). A parte pintada é o que o vereador conseguiu com o próprio nome.</p>
    <div class="bars">${[...eleitos].sort((a, b) => b.votos - a.votos).map((c) => `
      <button type="button" class="bar-row" data-cand="${c.sq}">
        <span class="name">${esc(c.urna)} <small>${esc(c.partido)}</small></span>
        <span class="track" style="background:var(--surface-2);border-radius:4px"><span class="fill" style="width:${(c.votos / qe) * 100}%;background:${agColor(R.eleitos.get(c.sq).ag)}"></span></span>
        <span class="val"><strong>${fmt(c.votos)}</strong> · ${pct(c.votos / qe, 0)} do QE</span></button>`).join('')}</div></div></div>`;

  // duelos: quem ficou de fora × eleitos com menos votos
  const usados = new Set();
  const asc = [...eleitos].sort((a, b) => a.votos - b.votos);
  const duelos = fora.map((o) => {
    const e = asc.find((x) => !usados.has(x.sq) && x.votos < o.votos) || asc[0];
    usados.add(e.sq);
    return [o, e];
  });
  const porque = (c, dentro) => {
    const ag = D.agDe[c.partido];
    const n = R.vagas[ag] || 0;
    const colegas = eleitos.filter((x) => D.agDe[x.partido] === ag);
    if (dentro) {
      const k = ver.filter((x) => x.valido && D.agDe[x.partido] === ag && x.votos > c.votos).length + 1;
      return `${esc(ag)} somou ${fmt(D.agTotal[ag])} votos e levou ${n} ${n === 1 ? 'cadeira' : 'cadeiras'}; ele era o ${k}º do partido.`;
    }
    const m = margem(c);
    return `${esc(ag)} levou ${n} ${n === 1 ? 'cadeira' : 'cadeiras'}${colegas.length ? `, ocupadas por ${colegas.map((x) => esc(x.urna)).join(' e ')}` : ''}.${m ? ` Faltaram ${fmt(m.n)} votos.` : ''}`;
  };
  const duel = `<div class="panel"><div class="panel-head"><h2>Mais votos, sem cadeira</h2></div><div class="panel-body">
    ${duelos.map(([o, e]) => `<div class="duel">
      <div class="duel-side out" data-cand="${o.sq}"><div class="d-tag">✕ Ficou de fora</div><div class="d-name">${esc(o.urna)} <small>${esc(o.partido)}</small></div>
        <div class="d-votes">${fmt(o.votos)} votos</div><div class="d-why">${porque(o, false)}</div></div>
      <div class="duel-vs">×</div>
      <div class="duel-side in" data-cand="${e.sq}"><div class="d-tag">✓ Eleito</div><div class="d-name">${esc(e.urna)} <small>${esc(e.partido)}</small></div>
        <div class="d-votes">${fmt(e.votos)} votos</div><div class="d-why">${porque(e, true)}</div></div>
    </div>`).join('')}</div></div>`;

  // se valesse só o mais votado
  const top12 = ver.filter((c) => c.valido).slice(0, S.data.meta.cadeiras);
  const top12s = new Set(top12.map((c) => c.sq));
  const entrariam = top12.filter((c) => !R.eleitos.has(c.sq));
  const sairiam = eleitos.filter((c) => !top12s.has(c.sq));
  const chip = (c, cls, sign) => `<button type="button" class="chip ${cls}" data-cand="${c.sq}"><span class="c-sign">${sign}</span>
    <span class="c-name">${esc(c.urna)} <small>${esc(c.partido)}</small></span><span class="c-meta">${fmt(c.votos)} votos · ${c.pos}º</span></button>`;
  const swap = `<div class="panel"><div class="panel-head"><h2>Se fosse “os 12 mais votados levam”</h2></div><div class="panel-body">
    <p class="insight">No voto majoritário (o “distritão”, já rejeitado pelo Congresso), entrariam os 12 com mais votos, sem olhar o partido.
      <strong>${entrariam.length} ${entrariam.length === 1 ? 'cadeira mudaria' : 'cadeiras mudariam'} de dono</strong>.</p>
    <div class="swap"><div><h3>Entrariam</h3><div class="chip-list">${entrariam.map((c) => chip(c, 'in', '+')).join('')}</div></div>
      <div><h3>Sairiam</h3><div class="chip-list">${sairiam.map((c) => chip(c, 'out', '−')).join('')}</div></div></div></div></div>`;

  // por um fio
  const ms = margens();
  const perto = ms.filter((x) => x.m.tipo === 'falta').sort((a, b) => a.m.n - b.m.n).slice(0, 8);
  const frageis = ms.filter((x) => x.m.tipo === 'perde').sort((a, b) => a.m.n - b.m.n).slice(0, 5);
  const fio = `<div class="panel"><div class="panel-head"><h2>Por um fio</h2><a class="panel-link" href="#v=simulador">Abrir o simulador →</a></div><div class="panel-body">
    <div class="swap">
      <div><h3>Mais perto de entrar <small>votos a mais que bastariam</small></h3><div class="chip-list">${perto.map(({ c, m }) => `
        <button type="button" class="chip" data-simset="c:${c.sq}:${m.n}"><span class="c-name">${esc(c.urna)} <small>${esc(c.partido)} · ${fmt(c.votos)}</small></span><span class="c-meta">+<b>${fmt(m.n)}</b></span></button>`).join('')}</div></div>
      <div><h3>Mais perto de sair <small>votos a menos que derrubariam</small></h3><div class="chip-list">${frageis.map(({ c, m }) => `
        <button type="button" class="chip" data-simset="c:${c.sq}:${-m.n}"><span class="c-name">${esc(c.urna)} <small>${esc(c.partido)} · ${fmt(c.votos)}</small></span><span class="c-meta">−<b>${fmt(m.n)}</b></span></button>`).join('')}</div></div>
    </div>
    <p class="insight" style="margin-top:10px">Cada número considera só aquele candidato mudando e todos os outros votos iguais. Clique para ver a Câmara que resultaria.</p></div></div>`;

  // preço de uma cadeira por agremiação
  const maxAg = D.agTotal[D.agOrdem[0]];
  const custo = `<div class="panel"><div class="panel-head"><h2>Quanto custou cada cadeira</h2></div><div class="panel-body">
    <p class="insight">Votos de cada agremiação (partido ou federação) e quantos votos ela precisou por cadeira. Barras cinza: não elegeu ninguém.</p>
    <div class="bars">${D.agOrdem.slice(0, 12).map((a) => {
      const n = R.vagas[a] || 0;
      return `<div class="bar-row"><span class="name">${esc(a)}</span>
        <span class="track"><span class="fill" style="width:${(D.agTotal[a] / maxAg) * 100}%;background:${n ? agColor(a) : 'var(--bar-muted)'}"></span></span>
        <span class="val"><strong>${fmt(D.agTotal[a])}</strong> · ${n ? `${n} ${n === 1 ? 'cadeira' : 'cadeiras'} · ${fmt(D.agTotal[a] / n)}/cadeira` : 'nenhuma cadeira'}</span></div>`;
    }).join('')}</div></div></div>`;

  document.getElementById('raiox').innerHTML = `${hero}${facts}<div class="grid-2"><div>${quota}${swap}</div><div>${duel}${fio}</div></div>${custo}`;
}

// ------------------------------------------------------------------ simulador

function simTargetLabel(k) {
  if (k.startsWith('p:')) { const p = D.partido[k.slice(2)]; return `Legenda · ${p.sigla} · ${p.numero}`; }
  return candLabel(D.cand[k.slice(2)]);
}

function resolveSimTarget(text) {
  const t = norm(text).trim();
  if (!t) return null;
  if (t.startsWith('legenda')) {
    const p = S.data.partidos.find((x) => norm(`Legenda · ${x.sigla} · ${x.numero}`) === t)
      || S.data.partidos.find((x) => t.includes(norm(x.sigla)));
    return p ? 'p:' + p.sigla : null;
  }
  const sq = resolveIn(vereadores().filter((c) => c.valido), text);
  return sq ? 'c:' + sq : null;
}

function addAdj(k, d) {
  if (!k || !d) return;
  const a = S.sim.find((x) => x.k === k);
  if (a) a.d += d; else S.sim.push({ k, d });
  S.sim = S.sim.filter((x) => x.d !== 0);
}

function simPresets() {
  if (D.presets) return D.presets;
  const R = D.real;
  const ver = vereadores();
  const eleitos = ver.filter((c) => R.eleitos.has(c.sq));
  const minEleito = [...eleitos].sort((a, b) => a.votos - b.votos)[0];
  const foraTop = ver.find((c) => c.valido && !R.eleitos.has(c.sq));
  const out = [];
  const mf = margem(foraTop);
  if (mf) out.push({ adj: [{ k: 'c:' + foraTop.sq, d: mf.n }], html: `<strong>${esc(foraTop.urna)}</strong>, o mais votado que ficou de fora: quantos votos faltaram? (+${fmt(mf.n)})` });
  const top = ver[0];
  out.push({ adj: [{ k: 'c:' + top.sq, d: 10000 }], html: `Efeito “puxador”: e se <strong>${esc(top.urna)}</strong> tivesse 10 mil votos a mais?` });
  const agSem = D.agOrdem.find((a) => !R.vagas[a]);
  const sigla = S.data.partidos.filter((p) => D.agDe[p.sigla] === agSem).sort((a, b) => b.total_validos - a.total_validos)[0]?.sigla;
  if (sigla) {
    const n = menorQue((x) => (simular([{ k: 'p:' + sigla, d: x }]).vagas[agSem] || 0) > 0, 20000);
    if (n) out.push({ adj: [{ k: 'p:' + sigla, d: n }], html: `Quantos votos de legenda faltaram para <strong>${esc(agSem)}</strong> eleger alguém? (+${fmt(n)})` });
  }
  const mp = margem(minEleito);
  if (mp) out.push({ adj: [{ k: 'c:' + minEleito.sq, d: -mp.n }], html: `E se <strong>${esc(minEleito.urna)}</strong>, o eleito com menos votos, tivesse ${fmt(mp.n)} a menos?` });
  D.presets = out;
  return out;
}

function renderSimulador() {
  const res = simular(S.sim);
  const R = D.real;
  const entram = [...res.eleitos.keys()].filter((sq) => !R.eleitos.has(sq)).map((sq) => D.cand[sq]);
  const saem = [...R.eleitos.keys()].filter((sq) => !res.eleitos.has(sq)).map((sq) => D.cand[sq]);
  const { ags } = montar(S.sim);
  const votosSim = Object.fromEntries(ags.flatMap((a) => a.cands.map((c) => [c.sq, c.votos])));
  const opts = [
    ...vereadores().filter((c) => c.valido).map((c) => candLabel(c)),
    ...S.data.partidos.map((p) => `Legenda · ${p.sigla} · ${p.numero}`),
  ];
  const prev = document.getElementById('sim-alvo')?.value || '';
  const prevD = document.getElementById('sim-d')?.value || '500';

  const verdict = S.sim.length === 0
    ? '<p class="verdict same">Esta é a Câmara eleita de verdade. Faça um ajuste para simular.</p>'
    : entram.length
      ? `<p class="verdict">${entram.length} ${entram.length === 1 ? 'cadeira muda' : 'cadeiras mudam'} de dono</p>`
      : '<p class="verdict same">Com esses votos, a Câmara continuaria a mesma.</p>';
  const chip = (c, cls, sign) => `<button type="button" class="chip ${cls}" data-simpick="${c.sq}"><span class="c-sign">${sign}</span>
    <span class="c-name">${esc(c.urna)} <small>${esc(c.partido)}</small></span><span class="c-meta">${fmt(votosSim[c.sq] ?? c.votos)} votos</span></button>`;

  document.getElementById('simulador').innerHTML = `<div class="sim-grid">
    <div>
      <div class="panel"><div class="panel-head"><h2>Ajustes</h2></div><div class="panel-body">
        <div class="adj-form">
          <label class="field"><span>Candidato a vereador ou voto de legenda</span>
            <input id="sim-alvo" list="sim-list" placeholder="Nome, número ou “Legenda PL”" autocomplete="off" value="${esc(prev)}"></label>
          <datalist id="sim-list">${opts.map((o) => `<option value="${esc(o)}"></option>`).join('')}</datalist>
          <div class="row">
            <label class="field"><span>Votos (use − para tirar)</span><input id="sim-d" type="number" step="50" value="${esc(prevD)}"></label>
            <button type="button" class="btn primary" id="sim-add">Aplicar</button>
          </div>
          <div class="quick">${[-1000, -500, -100, 100, 500, 1000, 5000].map((n) => `<button type="button" class="btn sm" data-quick="${n}">${sinal(n)}</button>`).join('')}</div>
          <div class="adj-list">${S.sim.map((a, i) => `<div class="adj"><span class="a-name">${esc(simTargetLabel(a.k))}</span>
            <span class="a-delta ${a.d > 0 ? 'up' : 'down'}">${sinal(a.d)}</span><button type="button" data-unadj="${i}" aria-label="Remover ajuste">✕</button></div>`).join('')
            || '<p class="insight">Nenhum ajuste ainda. Escolha um candidato, digite quantos votos somar ou tirar e clique em Aplicar. Clicar numa cadeira também escolhe o vereador.</p>'}</div>
          ${S.sim.length ? '<button type="button" class="btn" id="sim-reset">Desfazer tudo</button>' : ''}
        </div></div></div>
      <div class="panel"><div class="panel-head"><h2>Experimente</h2></div><div class="panel-body">
        <div class="presets">${simPresets().map((p, i) => `<button type="button" class="preset" data-preset="${i}">${p.html}</button>`).join('')}</div>
      </div></div>
    </div>
    <div>
      <div class="panel"><div class="panel-head"><h2>Câmara simulada</h2>${S.sim.length ? '<span class="panel-link">tracejado = cadeira que mudou</span>' : ''}</div><div class="panel-body">
        ${verdict}
        ${hemiciclo(res, { destaque: S.sim.length ? new Set(R.eleitos.keys()) : null, votos: votosSim, acao: 'sim' })}
        <div class="sim-status">
          <span>Votos válidos: <b>${fmt(res.validos)}</b>${res.validos !== R.validos ? ` (${sinal(res.validos - R.validos)})` : ''}</span>
          <span>Quociente eleitoral: <b>${fmt(res.qe)}</b>${res.qe !== R.qe ? ` (era ${fmt(R.qe)})` : ''}</span>
        </div>
        ${entram.length ? `<div class="swap" style="margin-top:14px"><div><h3>Entrariam</h3><div class="chip-list">${entram.map((c) => chip(c, 'in', '+')).join('')}</div></div>
          <div><h3>Sairiam</h3><div class="chip-list">${saem.map((c) => chip(c, 'out', '−')).join('')}</div></div></div>` : ''}
      </div></div>
      <div class="panel"><div class="panel-head"><h2>Como a conta é feita</h2></div><div class="panel-body prose">
        <ul>
          <li><strong>Quociente eleitoral</strong> = votos válidos ÷ 12 cadeiras. Votos somados aqui entram nos válidos, então o quociente também sobe.</li>
          <li><strong>Quociente partidário</strong> = votos do partido ou federação ÷ quociente eleitoral, arredondado para baixo. São as vagas diretas, para os mais votados do partido com pelo menos 10% do quociente.</li>
          <li><strong>Sobras</strong>: cadeiras restantes vão, uma a uma, para a maior média (votos ÷ vagas já obtidas + 1), entre partidos com 80% do quociente e candidatos com 20%. Se ainda sobrar, todos disputam sem mínimo.</li>
          <li>Com os votos reais, a conta reproduz exatamente os 12 eleitos e o tipo de vaga de cada um (quociente ou média) informados pelo TSE.</li>
        </ul></div></div>
    </div></div>`;
}

// ------------------------------------------------------------------ tabelas

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
    ? `<p class="insight">${list.length} cadeiras na Câmara. Quociente eleitoral: <strong>${fmt(S.data.meta.quociente_eleitoral)}</strong> votos (válidos ÷ cadeiras). Clique numa linha para ver o candidato no mapa.</p>`
    : `<p class="insight">Resultado para prefeito (todos os candidatos).</p>`;
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
  return `<p class="insight">Quociente eleitoral = ${fmt(vt)} votos válidos ÷ ${S.data.meta.cadeiras} cadeiras = <strong>${fmt(qe)}</strong>.
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
  return `<p class="insight">Os números de cada bairro somam as urnas instaladas nele. Clique numa linha para ver o bairro no mapa.</p>
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
  return `<p class="insight">${S.data.locais.length} locais de votação. “Bairro” é o bairro oficial em que a coordenada do local cai no mapa; “TSE” é o bairro escrito no cadastro do local, que às vezes usa nomes populares (ex.: “Presidente Juscelino”, “Parque Senador”).</p>
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
    <h3>Raio-X e simulador</h3>
    <ul>
      <li>A distribuição de cadeiras segue o Código Eleitoral (quociente eleitoral, quociente partidário, sobras com as exigências de 80% e 20% e, depois, disputa sem mínimo, como decidiu o STF para 2024). Com os votos reais, ela reproduz exatamente os 12 eleitos do TSE.</li>
      <li>“Faltaram N votos” muda só aquele candidato e mantém todos os outros votos iguais. Os votos somados entram nos válidos e mudam o quociente, como aconteceria numa eleição de verdade.</li>
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

function renderTable() {
  const fn = { eleitos: tblEleitos, ranking: tblRanking, partidos: tblPartidos, bairros: tblBairros, locais: tblLocais, sobre: tblSobre }[S.view];
  document.getElementById('table-title').textContent = VIEWS[S.view].title + (S.view !== 'sobre' && S.view !== 'partidos' ? ` · ${S.cargo}` : '');
  document.getElementById('table-body').innerHTML = fn();
}

// ------------------------------------------------------------------ telas

function renderView() {
  const v = VIEWS[S.view];
  const camara = S.view === 'raiox' || S.view === 'simulador';
  document.getElementById('page-title').textContent = v.title;
  document.getElementById('crumb').textContent = v.title;
  document.getElementById('page-sub').textContent = v.sub ? v.sub + (camara && S.cargo === 'prefeito' ? ' (vale para vereador, eleição proporcional.)' : '') : '';
  document.getElementById('page-sub').hidden = !v.sub;
  document.title = S.view === 'painel' ? 'Mesquita em Dados' : `${v.title} · Mesquita em Dados`;
  const section = v.table ? 'tabela' : S.view;
  document.querySelectorAll('.view').forEach((el) => el.classList.toggle('active', el.dataset.view === section));
  document.querySelectorAll('#nav a').forEach((a) => (a.dataset.view === S.view ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current')));
  document.querySelectorAll('.seg button').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.cargo === S.cargo)));

  if (S.view === 'painel') renderPainel();
  else if (S.view === 'mapa') renderMapView();
  else if (S.view === 'raiox') renderRaiox();
  else if (S.view === 'simulador') renderSimulador();
  else renderTable();
  writeHash();
}

function renderMapView() {
  const sel = document.getElementById('metric');
  sel.innerHTML = Object.entries(METRICS).map(([k, m]) => `<option value="${k}" ${k === S.metric ? 'selected' : ''}>${m.label}</option>`).join('');
  document.getElementById('cand-list').innerHTML = cands().map((c) => `<option value="${esc(candLabel(c))}"></option>`).join('');
  document.getElementById('cand-a').value = D.cand[S.candA] ? candLabel(D.cand[S.candA]) : '';
  document.getElementById('cand-b').value = D.cand[S.candB] ? candLabel(D.cand[S.candB]) : '';
  if (!map) initMap(); else map.invalidateSize();
  renderMap();
  renderSide();
}

function setView(v) {
  if (!VIEWS[v]) return;
  S.view = v;
  closeMenu();
  renderView();
  window.scrollTo({ top: 0 });
}

function resolveIn(list, text) {
  const t = norm(text).trim();
  if (!t) return null;
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
  if (S.view !== 'mapa') setView('mapa'); else renderView();
}

function selectBairro(bid) {
  S.bairro = bid;
  S.side = 'bairro';
  if (S.view !== 'mapa') { setView('mapa'); return; }
  renderMap();
  renderSide();
  writeHash();
}

function focusLocal(lid) {
  const l = D.local[lid];
  if (!l?.lat) return;
  if (S.view !== 'mapa') setView('mapa');
  map.flyTo([l.lat, l.lon], 16, { duration: 0.6 });
  localLayer.eachLayer((m) => {
    const p = m.getLatLng();
    if (p.lat === l.lat && p.lng === l.lon) setTimeout(() => m.openPopup(), 650);
  });
  document.getElementById('map').scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function writeHash() {
  const p = new URLSearchParams();
  if (S.view !== 'painel') p.set('v', S.view);
  if (S.cargo !== 'vereador') p.set('cargo', S.cargo);
  if (S.view === 'mapa') {
    if (S.metric !== 'cand_pct') p.set('m', S.metric);
    if (S.candA) p.set('a', D.cand[S.candA].numero);
    if (S.candB) p.set('b', D.cand[S.candB].numero);
    if (S.bairro) p.set('bairro', S.bairro);
  }
  if (S.view === 'simulador' && S.sim.length) {
    p.set('sim', S.sim.map((a) => (a.k.startsWith('c:') ? D.cand[a.k.slice(2)].numero : 'L' + a.k.slice(2)) + ':' + a.d).join(','));
  }
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
  const legacyTab = { ranking: 'ranking', partidos: 'partidos', bairros: 'bairros', locais: 'locais', sobre: 'sobre', eleitos: 'eleitos' }[p.get('tab')];
  if (VIEWS[p.get('v')]) S.view = p.get('v');
  else if (legacyTab) S.view = legacyTab;
  else if (p.get('a') || p.get('b') || p.get('bairro') || p.get('m')) S.view = 'mapa'; // links antigos abriam o mapa
  if (p.get('sim')) {
    S.sim = [];
    for (const part of p.get('sim').split(',')) {
      const [alvo, d] = part.split(':');
      const n = parseInt(d, 10);
      if (!n) continue;
      if (alvo.startsWith('L') && D.partido[alvo.slice(1)]) addAdj('p:' + alvo.slice(1), n);
      else {
        const c = vereadores().find((x) => String(x.numero) === alvo && x.valido);
        if (c) addAdj('c:' + c.sq, n);
      }
    }
  }
  if (!S.candA) S.candA = cands()[0]?.sq ?? null; // começa mostrando o mais votado
}

// ------------------------------------------------------------------ menu e eventos

function closeMenu() {
  document.getElementById('sidebar').classList.remove('open');
  document.getElementById('scrim').hidden = true;
  document.getElementById('menu-btn').setAttribute('aria-expanded', 'false');
}

function bindEvents() {
  document.getElementById('menu-btn').addEventListener('click', () => {
    const open = !document.getElementById('sidebar').classList.contains('open');
    document.getElementById('sidebar').classList.toggle('open', open);
    document.getElementById('scrim').hidden = !open;
    document.getElementById('menu-btn').setAttribute('aria-expanded', String(open));
  });
  document.getElementById('scrim').addEventListener('click', closeMenu);

  document.querySelector('.seg').addEventListener('click', (e) => {
    const c = e.target.closest('button')?.dataset.cargo;
    if (!c || c === S.cargo) return;
    S.cargo = c;
    S.candA = cands()[0].sq;
    S.candB = null;
    if (S.metric === 'compare') S.metric = 'cand_pct';
    renderView();
  });
  document.getElementById('metric').addEventListener('change', (e) => { S.metric = e.target.value; renderMap(); writeHash(); });
  for (const [id, slot] of [['cand-a', 'A'], ['cand-b', 'B']]) {
    const inp = document.getElementById(id);
    inp.addEventListener('change', () => selectCand(resolveIn(cands(), inp.value), slot));
  }
  document.querySelector('.side-tabs').addEventListener('click', (e) => {
    const s = e.target.closest('button')?.dataset.side;
    if (s) { S.side = s; renderSide(); }
  });

  // um só ouvinte para cliques em toda a área de conteúdo e no menu
  document.addEventListener('click', (e) => {
    const simset = e.target.closest('[data-simset]');
    if (simset) {
      e.preventDefault();
      const [tipo, id, d] = simset.dataset.simset.split(':');
      S.sim = [];
      addAdj(`${tipo}:${id}`, parseInt(d, 10));
      setView('simulador');
      return;
    }
    const link = e.target.closest('a[href^="#v="]');
    if (link) { e.preventDefault(); setView(new URLSearchParams(link.getAttribute('href').slice(1)).get('v')); return; }
    if (!e.target.closest('.content')) return;

    const t = e.target.closest('[data-cand],[data-bairro],[data-local],th[data-sort],[data-simpick],[data-unadj],[data-preset],[data-quick],#sim-add,#sim-reset,#rk-csv');
    if (!t) return;
    if (t.id === 'rk-csv') exportCsv();
    else if (t.matches('th[data-sort]')) {
      const k = t.dataset.sort;
      S.rank.dir = S.rank.sort === k ? -S.rank.dir : (k === 'votos' ? -1 : 1);
      S.rank.sort = k;
      renderTable();
    } else if (t.id === 'sim-add' || t.dataset.quick) {
      const k = resolveSimTarget(document.getElementById('sim-alvo').value);
      const d = parseInt(t.dataset.quick || document.getElementById('sim-d').value, 10);
      if (!k) { document.getElementById('sim-alvo').focus(); return; }
      addAdj(k, d || 0);
      renderView();
    } else if (t.id === 'sim-reset') { S.sim = []; renderView(); }
    else if (t.dataset.unadj) { S.sim.splice(+t.dataset.unadj, 1); renderView(); }
    else if (t.dataset.preset) { S.sim = simPresets()[+t.dataset.preset].adj.map((a) => ({ ...a })); renderView(); }
    else if (t.dataset.simpick) {
      const inp = document.getElementById('sim-alvo');
      inp.value = candLabel(D.cand[t.dataset.simpick]);
      document.getElementById('sim-d').focus();
    } else if (t.dataset.cand) selectCand(t.dataset.cand, 'A');
    else if (t.dataset.bairro) selectBairro(t.dataset.bairro);
    else if (t.dataset.local) focusLocal(t.dataset.local);
  });

  // teclado nas cadeiras do hemiciclo (são <circle> com role=button)
  document.addEventListener('keydown', (e) => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target.matches?.('.seat')) { e.preventDefault(); e.target.dispatchEvent(new MouseEvent('click', { bubbles: true })); }
    if (e.key === 'Enter' && e.target.id === 'sim-d') document.getElementById('sim-add').click();
    if (e.key === 'Escape') closeMenu();
  });

  // dica flutuante para elementos com data-tip (cadeiras, faixas)
  const tip = document.createElement('div');
  tip.className = 'tip';
  tip.hidden = true;
  document.body.appendChild(tip);
  document.addEventListener('pointermove', (e) => {
    const el = e.target.closest?.('[data-tip]');
    if (!el) { tip.hidden = true; return; }
    tip.innerHTML = el.dataset.tip;
    tip.hidden = false;
    const w = tip.offsetWidth, h = tip.offsetHeight;
    tip.style.left = Math.min(window.innerWidth - w - 8, e.clientX + 14) + 'px';
    tip.style.top = (e.clientY - h - 12 < 4 ? e.clientY + 18 : e.clientY - h - 12) + 'px';
  });

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

  const retheme = () => { setTiles(); renderView(); };
  document.getElementById('theme-toggle').addEventListener('click', () => {
    const next = theme() === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem('theme', next); } catch { /* armazenamento indisponível */ }
    retheme();
  });
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', retheme);
}

(async function main() {
  try { const t = localStorage.getItem('theme'); if (t) document.documentElement.dataset.theme = t; } catch { /* ignore */ }
  try {
    await load();
  } catch (err) {
    document.querySelector('.content').innerHTML = `<p class="panel empty" style="padding:16px">Não consegui carregar os dados (${esc(err.message)}). Abra o app por um servidor local: <code>py -m http.server -d web 8000</code>.</p>`;
    return;
  }
  readHash();
  bindEvents();
  const dias = diasPara2028();
  document.getElementById('countdown').innerHTML = `<strong>${fmt(dias)}</strong><span>dias para a eleição de 2028</span>`;
  const m = S.data.meta;
  document.getElementById('foot').innerHTML = `Fontes: ${m.fontes.map(esc).join(' · ')}. Dados gerados em ${esc(m.gerado_em.replace('T', ' '))}.`;
  renderView();
})();
