"""Gera os dados do app a partir dos arquivos abertos do TSE + contornos de bairro do OpenStreetMap.

Entradas (data/raw/, baixadas por scripts/download_data.ps1):
  votacao_secao_2024_RJ.zip            votos por seção e por candidato
  detalhe_votacao_secao_2024.zip       aptos/comparecimento/brancos/nulos por seção
  votacao_candidato_munzona_2024.zip   situação final (eleito/suplente), partido, federação
  votacao_partido_munzona_2024.zip     votos de legenda por partido
  eleitorado_local_votacao_2024.zip    locais de votação com bairro e coordenadas
  osm/<relation_id>.xml                contorno de cada bairro (API do OSM, relation/<id>/full)

Saídas (web/data/):
  mesquita_2024.json   tudo o que o app consome, já agregado
  bairros.geojson      polígonos dos bairros

Só biblioteca padrão: `py scripts/build_data.py`.
"""

from __future__ import annotations

import csv
import io
import json
import sys
import xml.etree.ElementTree as ET
import zipfile
from collections import defaultdict
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw"
OUT = ROOT / "web" / "data"

CD_MUNICIPIO = "58467"  # código TSE de Mesquita/RJ
CARGO_VEREADOR = "13"
CARGO_PREFEITO = "11"
VOTO_BRANCO = "95"
VOTO_NULO = "96"

csv.field_size_limit(sys.maxsize)


def read_zip_csv(zip_name: str, member: str, prefilter: str | None = None):
    """Itera as linhas (dict) de um CSV latin-1 do TSE dentro de um zip.

    `prefilter` descarta a linha crua antes do parse — o CSV de seções do RJ tem ~1 GB.
    """
    with zipfile.ZipFile(RAW / zip_name) as zf:
        with zf.open(member) as fh:
            text = io.TextIOWrapper(fh, encoding="latin-1", newline="")
            header = next(csv.reader([text.readline()], delimiter=";"))
            for line in text:
                if prefilter and prefilter not in line:
                    continue
                row = next(csv.reader([line], delimiter=";"))
                yield dict(zip(header, row))


def to_int(value: str) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return 0


def title_pt(name: str) -> str:
    small = {"de", "da", "do", "das", "dos", "e"}
    words = name.lower().split()
    return " ".join(w if (i and w in small) else w[:1].upper() + w[1:] for i, w in enumerate(words))


# ---------------------------------------------------------------- geometria (OSM)

def slug(name: str) -> str:
    import unicodedata

    s = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode().lower()
    return "".join(c if c.isalnum() else "-" for c in s).strip("-").replace("--", "-")


def assemble_rings(ways: list[list[tuple[float, float]]]) -> list[list[tuple[float, float]]]:
    """Junta os ways de uma relação multipolygon em anéis fechados, casando pontas."""
    pending = [list(w) for w in ways if len(w) >= 2]
    rings = []
    while pending:
        ring = pending.pop(0)
        changed = True
        while ring[0] != ring[-1] and changed:
            changed = False
            for i, way in enumerate(pending):
                if way[0] == ring[-1]:
                    ring += way[1:]
                elif way[-1] == ring[-1]:
                    ring += way[::-1][1:]
                elif way[-1] == ring[0]:
                    ring = way[:-1] + ring
                elif way[0] == ring[0]:
                    ring = way[::-1][:-1] + ring
                else:
                    continue
                pending.pop(i)
                changed = True
                break
        if ring[0] != ring[-1] and not pending and gap_km(ring[0], ring[-1]) < MAX_GAP_KM:
            # Parque Ludolf e Vila Emil: o trecho da divisa entre os dois não é membro de nenhuma das
            # duas relações no OSM. Fecha com um segmento reto em vez de perder o bairro.
            print(f"  ! anel aberto fechado com segmento reto ({gap_km(ring[0], ring[-1]):.2f} km)", file=sys.stderr)
            ring.append(ring[0])
        if ring[0] == ring[-1] and len(ring) >= 4:
            rings.append(ring)
    return rings


MAX_GAP_KM = 2.0


def gap_km(a, b) -> float:
    import math

    dx = (a[0] - b[0]) * 111.32 * math.cos(math.radians(a[1]))
    dy = (a[1] - b[1]) * 110.57
    return math.hypot(dx, dy)


def load_bairro_geometries():
    features = []
    for path in sorted((RAW / "osm").glob("*.xml")):
        root = ET.parse(path).getroot()
        nodes = {n.get("id"): (float(n.get("lon")), float(n.get("lat"))) for n in root.iter("node")}
        ways = {w.get("id"): [nodes[nd.get("ref")] for nd in w.iter("nd")] for w in root.iter("way")}
        rel = root.find("relation")
        tags = {t.get("k"): t.get("v") for t in rel.iter("tag")}
        outer = [ways[m.get("ref")] for m in rel.iter("member") if m.get("type") == "way" and m.get("role") != "inner"]
        inner = [ways[m.get("ref")] for m in rel.iter("member") if m.get("type") == "way" and m.get("role") == "inner"]
        outer_rings, inner_rings = assemble_rings(outer), assemble_rings(inner)
        if not outer_rings:
            print(f"  ! sem anel externo: {tags.get('name')}", file=sys.stderr)
            continue
        polygons = []
        for ring in outer_rings:
            holes = [h for h in inner_rings if point_in_ring(h[0], ring)]
            polygons.append([ring] + holes)
        name = tags.get("name")
        features.append({
            "type": "Feature",
            "id": slug(name),
            "properties": {"id": slug(name), "nome": name, "osm_id": int(rel.get("id"))},
            "geometry": {
                "type": "MultiPolygon",
                "coordinates": [[[[round(x, 6), round(y, 6)] for x, y in r] for r in poly] for poly in polygons],
            },
        })
    return features


def point_in_ring(pt, ring) -> bool:
    x, y = pt
    inside = False
    j = len(ring) - 1
    for i in range(len(ring)):
        xi, yi = ring[i]
        xj, yj = ring[j]
        if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi) + xi:
            inside = not inside
        j = i
    return inside


def find_bairro(features, lon: float, lat: float) -> str | None:
    for f in features:
        for poly in f["geometry"]["coordinates"]:
            if point_in_ring((lon, lat), poly[0]) and not any(point_in_ring((lon, lat), h) for h in poly[1:]):
                return f["id"]
    return None


def nearest_bairro(features, lon: float, lat: float) -> str:
    """Para locais que caem um pouco fora do contorno (borda, imprecisão do geocódigo)."""
    best, best_d = None, float("inf")
    for f in features:
        for poly in f["geometry"]["coordinates"]:
            for x, y in poly[0]:
                d = (x - lon) ** 2 + (y - lat) ** 2
                if d < best_d:
                    best, best_d = f["id"], d
    return best


# ---------------------------------------------------------------- locais de votação

def load_locais(features):
    by_name = {slug(f["properties"]["nome"]): f["id"] for f in features}
    locais = {}
    for r in read_zip_csv("eleitorado_local_votacao_2024.zip", "eleitorado_local_votacao_2024.csv", '"58467"'):
        if r["CD_MUNICIPIO"] != CD_MUNICIPIO or r["NR_TURNO"] != "1":
            continue
        key = f'{r["NR_ZONA"]}-{r["NR_LOCAL_VOTACAO"]}'
        loc = locais.get(key)
        if loc is None:
            lat, lon = float(r["NR_LATITUDE"] or 0), float(r["NR_LONGITUDE"] or 0)
            has_coords = lat < -1 and lon < -1
            bairro, metodo = None, None
            if has_coords:
                bairro = find_bairro(features, lon, lat)
                metodo = "coordenada"
                if bairro is None:
                    bairro, metodo = nearest_bairro(features, lon, lat), "coordenada (mais próximo)"
            if bairro is None:
                bairro, metodo = by_name.get(slug(r["NM_BAIRRO"])), "nome do bairro (TSE)"
            loc = locais[key] = {
                "id": key,
                "zona": int(r["NR_ZONA"]),
                "nr": int(r["NR_LOCAL_VOTACAO"]),
                "nome": title_pt(r["NM_LOCAL_VOTACAO"]),
                "endereco": title_pt(r["DS_ENDERECO"]),
                "bairro_tse": title_pt(r["NM_BAIRRO"]),
                "bairro": bairro,
                "metodo_bairro": metodo,
                "lat": lat if has_coords else None,
                "lon": lon if has_coords else None,
                "secoes": 0,
                "eleitores": 0,
            }
        loc["secoes"] += 1
        loc["eleitores"] += to_int(r["QT_ELEITOR_SECAO"])
    return locais


# ---------------------------------------------------------------- votos

def load_candidatos():
    cands = {}
    for r in read_zip_csv("votacao_candidato_munzona_2024.zip", "votacao_candidato_munzona_2024_RJ.csv", '"58467"'):
        if r["CD_MUNICIPIO"] != CD_MUNICIPIO or r["CD_CARGO"] not in (CARGO_VEREADOR, CARGO_PREFEITO):
            continue
        sq = r["SQ_CANDIDATO"]
        c = cands.get(sq)
        if c is None:
            c = cands[sq] = {
                "sq": sq,
                "cargo": "vereador" if r["CD_CARGO"] == CARGO_VEREADOR else "prefeito",
                "numero": int(r["NR_CANDIDATO"]),
                "nome": title_pt(r["NM_CANDIDATO"]),
                "urna": r["NM_URNA_CANDIDATO"].upper(),
                "partido": r["SG_PARTIDO"],
                "federacao": None if r["SG_FEDERACAO"].startswith("#") else r["SG_FEDERACAO"],
                "situacao": r["DS_SIT_TOT_TURNO"],
                "candidatura": r["DS_SITUACAO_CANDIDATURA"],
                "destino_votos": r["NM_TIPO_DESTINACAO_VOTOS"],
                "votos": 0,
            }
        c["votos"] += to_int(r["QT_VOTOS_NOMINAIS"])
    return cands


def load_partidos():
    parts = {}
    for r in read_zip_csv("votacao_partido_munzona_2024.zip", "votacao_partido_munzona_2024_RJ.csv", '"58467"'):
        if r["CD_MUNICIPIO"] != CD_MUNICIPIO or r["CD_CARGO"] != CARGO_VEREADOR:
            continue
        p = parts.setdefault(r["SG_PARTIDO"], {
            "sigla": r["SG_PARTIDO"],
            "numero": int(r["NR_PARTIDO"]),
            "nome": r["NM_PARTIDO"],
            "federacao": None if r["SG_FEDERACAO"].startswith("#") else r["SG_FEDERACAO"],
            "legenda": 0,
            "nominais": 0,
            "total_validos": 0,
        })
        p["legenda"] += to_int(r["QT_TOTAL_VOTOS_LEG_VALIDOS"])
        p["nominais"] += to_int(r["QT_VOTOS_NOMINAIS_VALIDOS"])
    for p in parts.values():
        p["total_validos"] = p["legenda"] + p["nominais"]
    return parts


def load_votos_secao(cands, partido_por_numero, locais):
    """Votos por seção → por local. Devolve dicts {cargo: {votavel: {local: votos}}}."""
    por_local = {CARGO_VEREADOR: defaultdict(lambda: defaultdict(int)), CARGO_PREFEITO: defaultdict(lambda: defaultdict(int))}
    sq_por_numero = {(c["cargo"], c["numero"]): c["sq"] for c in cands.values()}
    sem_local = set()
    for r in read_zip_csv("votacao_secao_2024_RJ.zip", "votacao_secao_2024_RJ.csv", '"MESQUITA"'):
        if r["CD_MUNICIPIO"] != CD_MUNICIPIO or r["NR_TURNO"] != "1" or r["CD_CARGO"] not in por_local:
            continue
        local = f'{r["NR_ZONA"]}-{r["NR_LOCAL_VOTACAO"]}'
        if local not in locais:
            sem_local.add(local)
        nr = r["NR_VOTAVEL"]
        cargo = "vereador" if r["CD_CARGO"] == CARGO_VEREADOR else "prefeito"
        if nr == VOTO_BRANCO:
            key = "branco"
        elif nr == VOTO_NULO:
            key = "nulo"
        elif cargo == "vereador" and len(nr) == 2:
            key = f"legenda:{partido_por_numero.get(int(nr), nr)}"
        else:
            key = sq_por_numero.get((cargo, int(nr)), f"nr:{nr}")
        por_local[r["CD_CARGO"]][key][local] += to_int(r["QT_VOTOS"])
    if sem_local:
        print(f"  ! locais nos votos sem cadastro: {sorted(sem_local)}", file=sys.stderr)
    return por_local


def load_comparecimento():
    """Aptos/comparecimento/abstenção/brancos/nulos por local, para o cargo de vereador."""
    acc = defaultdict(lambda: defaultdict(int))
    campos = {
        "QT_APTOS": "aptos", "QT_COMPARECIMENTO": "comparecimento", "QT_ABSTENCOES": "abstencoes",
        "QT_VOTOS_NOMINAIS": "nominais", "QT_VOTOS_LEGENDA": "legenda",
        "QT_VOTOS_BRANCOS": "brancos", "QT_VOTOS_NULOS": "nulos",
    }
    for r in read_zip_csv("detalhe_votacao_secao_2024.zip", "detalhe_votacao_secao_2024_RJ.csv", '"MESQUITA"'):
        if r["CD_MUNICIPIO"] != CD_MUNICIPIO or r["NR_TURNO"] != "1" or r["CD_CARGO"] != CARGO_VEREADOR:
            continue
        local = f'{r["NR_ZONA"]}-{r["NR_LOCAL_VOTACAO"]}'
        for src, dst in campos.items():
            acc[local][dst] += to_int(r[src])
    return acc


# ---------------------------------------------------------------- montagem

def main():
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
    OUT.mkdir(parents=True, exist_ok=True)
    print("bairros (OSM)…")
    features = load_bairro_geometries()
    print(f"  {len(features)} bairros")

    print("locais de votação…")
    locais = load_locais(features)
    sem_bairro = [l["id"] for l in locais.values() if not l["bairro"]]
    print(f"  {len(locais)} locais, {sum(1 for l in locais.values() if l['lat'])} com coordenada, sem bairro: {sem_bairro}")

    print("candidatos e partidos…")
    cands = load_candidatos()
    partidos = load_partidos()
    partido_por_numero = {p["numero"]: p["sigla"] for p in partidos.values()}

    print("votos por seção (lê ~1 GB, demora)…")
    votos = load_votos_secao(cands, partido_por_numero, locais)

    print("comparecimento por seção…")
    comp = load_comparecimento()

    bairro_de = {l["id"]: l["bairro"] for l in locais.values()}

    def por_bairro(por_local: dict) -> dict:
        out = defaultdict(int)
        for local, v in por_local.items():
            out[bairro_de.get(local) or "sem-bairro"] += v
        return dict(out)

    for loc in locais.values():
        loc.update({k: comp[loc["id"]].get(k, 0) for k in
                    ("aptos", "comparecimento", "abstencoes", "nominais", "legenda", "brancos", "nulos")})

    bairros = []
    for f in features:
        b = {"id": f["id"], "nome": f["properties"]["nome"],
             "locais": sorted(l["id"] for l in locais.values() if l["bairro"] == f["id"])}
        for k in ("aptos", "comparecimento", "abstencoes", "nominais", "legenda", "brancos", "nulos", "eleitores", "secoes"):
            b[k] = sum(locais[lid][k] for lid in b["locais"])
        bairros.append(b)

    v_ver, v_pref = votos[CARGO_VEREADOR], votos[CARGO_PREFEITO]
    candidatos = []
    for c in sorted(cands.values(), key=lambda c: -c["votos"]):
        pl = v_ver.get(c["sq"]) if c["cargo"] == "vereador" else v_pref.get(c["sq"])
        pl = dict(pl or {})
        c["votos_secoes"] = sum(pl.values())
        c["por_local"] = pl
        c["por_bairro"] = por_bairro(pl)
        candidatos.append(c)

    for p in partidos.values():
        leg = dict(v_ver.get(f"legenda:{p['sigla']}", {}))
        p["legenda_por_bairro"] = por_bairro(leg)
        p["legenda_por_local"] = leg
        p["eleitos"] = sum(1 for c in candidatos if c["cargo"] == "vereador" and c["partido"] == p["sigla"]
                           and c["situacao"].startswith("ELEITO"))

    eleitos = [c for c in candidatos if c["cargo"] == "vereador" and c["situacao"].startswith("ELEITO")]
    validos_ver = sum(p["total_validos"] for p in partidos.values())
    cadeiras = len(eleitos)

    extras = {
        cargo: {k: {"por_local": dict(v), "por_bairro": por_bairro(v)} for k, v in votos[cd].items()
                if k in ("branco", "nulo") or k.startswith("nr:")}
        for cargo, cd in (("vereador", CARGO_VEREADOR), ("prefeito", CARGO_PREFEITO))
    }

    data = {
        "meta": {
            "municipio": "Mesquita",
            "uf": "RJ",
            "ano": 2024,
            "data_eleicao": "2024-10-06",
            "cadeiras": cadeiras,
            "votos_validos_vereador": validos_ver,
            "quociente_eleitoral": round(validos_ver / cadeiras) if cadeiras else None,
            "gerado_em": datetime.now().isoformat(timespec="seconds"),
            "fontes": [
                "TSE — Portal de Dados Abertos (dadosabertos.tse.jus.br), Eleições 2024",
                "Contornos de bairro: © colaboradores do OpenStreetMap (ODbL)",
            ],
        },
        "bairros": bairros,
        "locais": sorted(locais.values(), key=lambda l: (l["bairro"] or "", l["nome"])),
        "candidatos": candidatos,
        "partidos": sorted(partidos.values(), key=lambda p: -p["total_validos"]),
        "extras": extras,
    }

    (OUT / "mesquita_2024.json").write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    (OUT / "bairros.geojson").write_text(
        json.dumps({"type": "FeatureCollection", "features": features}, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8")

    # conferências: o total das seções tem que bater com o total oficial por zona
    divergentes = [(c["urna"], c["votos"], c["votos_secoes"]) for c in candidatos if c["votos"] != c["votos_secoes"]]
    print(f"\n{len([c for c in candidatos if c['cargo'] == 'vereador'])} candidatos a vereador, "
          f"{cadeiras} cadeiras, quociente {data['meta']['quociente_eleitoral']}")
    print(f"aptos {sum(b['aptos'] for b in bairros)}, comparecimento {sum(b['comparecimento'] for b in bairros)}")
    print(f"candidatos com total por seção ≠ total oficial: {divergentes[:10] or 'nenhum'}")
    print(f"ok → {OUT}")


if __name__ == "__main__":
    main()
