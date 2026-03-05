/**
 * Gera um HTML interativo com mapa Leaflet mostrando todos os listings do CSV.
 * Saída: data/mapa.html
 *
 * Uso: node scripts/generate-map.js
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const csvPath = path.join(__dirname, '../data/listings.csv');
const outPath = path.join(__dirname, '../data/mapa.html');

if (!fs.existsSync(csvPath)) {
  console.error('Arquivo não encontrado:', csvPath);
  process.exit(1);
}

const csv = fs.readFileSync(csvPath, 'utf8');
const lines = csv.split('\n').slice(1).filter((l) => l.trim());

function parseCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      inQuotes = !inQuotes;
      current += c;
    } else if (c === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += c;
    }
  }
  result.push(current);
  return result;
}

const points = [];
for (const line of lines) {
  const p = parseCSVLine(line);
  const coords = p[5] || '';
  const titulo = (p[2] || '')
    .slice(0, 80)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
  const m = coords.match(/(-?[\d.]+),(-?[\d.]+)/);
  if (m) {
    points.push({
      lat: parseFloat(m[1]),
      lon: parseFloat(m[2]),
      titulo,
    });
  }
}

const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Airbnb Curitiba - Mapa dos Listings</title>
  <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
  <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: system-ui, -apple-system, sans-serif; }
    #map { height: 100vh; }
  </style>
</head>
<body>
  <div id="map"></div>
  <script>
    const map = L.map('map').setView([-25.428, -49.267], 12);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
    }).addTo(map);

    L.marker([-25.428, -49.267]).addTo(map)
      .bindPopup('<b>Centro Curitiba</b><br>(referência)');

    const points = ${JSON.stringify(points)};
    points.forEach(function(p) {
      L.circleMarker([p.lat, p.lon], {
        radius: 4,
        fillColor: '#e74c3c',
        color: '#c0392b',
        weight: 1,
        fillOpacity: 0.7
      }).addTo(map).bindPopup(p.titulo);
    });
  </script>
</body>
</html>
`;

fs.writeFileSync(outPath, html);
console.log('Mapa gerado: data/mapa.html');
console.log('Total de pontos:', points.length);