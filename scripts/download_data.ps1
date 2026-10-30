# Baixa os arquivos brutos usados por build_data.py para data\raw\.
# Uso: powershell -ExecutionPolicy Bypass -File scripts\download_data.ps1
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$raw = Join-Path $root 'data\raw'
New-Item -ItemType Directory -Force (Join-Path $raw 'osm') | Out-Null

$tse = 'https://cdn.tse.jus.br/estatistica/sead/odsele'
$files = @(
  'votacao_secao/votacao_secao_2024_RJ.zip',                    # ~157 MB
  'detalhe_votacao_secao/detalhe_votacao_secao_2024.zip',       # ~87 MB
  'votacao_candidato_munzona/votacao_candidato_munzona_2024.zip',
  'votacao_partido_munzona/votacao_partido_munzona_2024.zip',
  'eleitorado_locais_votacao/eleitorado_local_votacao_2024.zip'
)
foreach ($f in $files) {
  $out = Join-Path $raw (Split-Path $f -Leaf)
  if (Test-Path $out) { Write-Host "ja existe: $out"; continue }
  Write-Host "baixando $f"
  curl.exe -sSfL --ssl-no-revoke -o $out "$tse/$f"
  if ($LASTEXITCODE -ne 0) { throw "falha ao baixar $f" }
}

# Relações de bairro (admin_level=10) de Mesquita no OpenStreetMap.
$bairros = 5535088,5535092,5535095,5535101,5535104,5535105,5535106,5535107,5535108,5535109,5535111,
           5535113,5535115,5535117,5535129,5535135,5535139,5535141,5535149,5535150,5535154
foreach ($id in $bairros) {
  $out = Join-Path $raw "osm\$id.xml"
  if (Test-Path $out) { continue }
  curl.exe -sSf --ssl-no-revoke -A 'mesquita-eleicoes/0.1' -o $out "https://api.openstreetmap.org/api/0.6/relation/$id/full"
  if ($LASTEXITCODE -ne 0) { throw "falha ao baixar bairro OSM $id" }
}
Write-Host 'ok. Agora rode: py scripts\build_data.py'
