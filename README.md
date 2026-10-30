# Votos em Mesquita — Eleições 2024

App web para explorar os votos da eleição municipal de 2024 (1º turno, 06/10/2024) em Mesquita/RJ,
com foco em vereador: mapa dos 21 bairros, perfil de cada candidato, comparação entre dois
candidatos, partidos/quociente e comparecimento.

## Rodar

```powershell
py -m http.server -d web 8000
# abra http://127.0.0.1:8000
```

Não há build: `web/` é HTML + CSS + JS puro, com Leaflet via CDN. Os dados já processados ficam em
`web/data/` (cerca de 260 KB), então qualquer hospedagem estática serve (GitHub Pages, Netlify, nginx).

## Atualizar ou regenerar os dados

```powershell
powershell -ExecutionPolicy Bypass -File scripts\download_data.ps1   # ~330 MB do TSE + contornos do OSM em data\raw\
py scripts\build_data.py                                             # gera web\data\ em ~20 s
```

O `build_data.py` usa só a biblioteca padrão do Python e confere no final que a soma seção a seção bate
com o total oficial de cada candidato.

### De onde vem cada coisa

| Arquivo (TSE, dadosabertos.tse.jus.br) | Uso |
|---|---|
| `votacao_secao_2024_RJ` | votos por seção e candidato → agregados por local e bairro |
| `detalhe_votacao_secao_2024` | aptos, comparecimento, abstenção, brancos, nulos |
| `votacao_candidato_munzona_2024` | situação final (eleito QP/média, suplente), partido, federação |
| `votacao_partido_munzona_2024` | votos de legenda |
| `eleitorado_local_votacao_2024` | locais de votação com coordenadas |
| OpenStreetMap, relações `admin_level=10` | contorno dos bairros |

## Funcionalidades

Layout de painel administrativo (menu lateral, quadros de indicador, painéis), com estas telas:

- **Dashboard**: eleitores, comparecimento, quociente, contagem regressiva para 2028, a Câmara eleita em
  hemiciclo, mais votados, comparecimento por bairro e quem ficou "por um fio".
- **Raio-X da Câmara**: quanto dos votos foi para eleitos, por que ninguém se elegeu sozinho, quem teve
  mais votos que um eleito e ficou de fora, o que mudaria com "os 12 mais votados levam", votos que
  faltaram/sobraram para cada candidato e quanto custou cada cadeira por partido.
- **Simulador "E se?"**: soma ou tira votos de candidatos e de legenda e redistribui as 12 cadeiras na
  hora. O motor (`web/eleicao.js`) segue o Código Eleitoral com a regra das sobras de 2024 e reproduz
  exatamente os eleitos do TSE (`node tests/eleicao.test.js`). O cenário vai na URL
  (ex. `#v=simulador&sim=25000:10000`).
- **Mapa por bairro**: % do candidato nos votos válidos, votos absolutos, força relativa (bairro ÷ cidade),
  comparação A × B (escala divergente), mais votado por bairro, abstenção, brancos+nulos, eleitores aptos.
  Os locais de votação aparecem como círculos (tamanho = votos do candidato ou eleitores aptos), com popup
  dos 5 mais votados em cada local.
- **Painel do candidato**: posição, % dos válidos, participação no partido, quanto faltou para o último
  eleito do partido, concentração (quanto veio dos 3 melhores bairros), votos por bairro e melhores locais.
- **Painel do bairro**: comparecimento, mais votados, partidos e locais.
- **Tabelas**: eleitos, ranking com filtros e exportação CSV (com votos por bairro), partidos e agremiações
  com quociente partidário, bairros e locais de votação.
- Cargo de **prefeito** também disponível, tema claro/escuro, layout para celular e link compartilhável
  (o estado vai na URL, ex. `#a=25000&b=77123&m=compare`).

## Limitações que importam na leitura

- **O voto é contado onde a urna está, não onde o eleitor mora.** Cada local foi colocado no bairro em que
  sua coordenada cai.
- Cinco bairros não têm nenhum local de votação (Caixa d'Água, Delamare, Industrial, Parque Ludolf e
  Rocha Sobrinho) e aparecem sem dados.
- O cadastro do TSE às vezes usa nomes populares de bairro ("Presidente Juscelino", "Parque Senador"); o app
  usa o limite oficial do OSM e mostra o nome do TSE no popup e na tabela de locais.
- Na divisa entre Parque Ludolf e Vila Emil falta um trecho no OSM; o script fecha com um segmento reto.
