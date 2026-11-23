'use strict';
// suite-dnd: liga os apps da suíte num processo só, para rodar em casa com um comando (npm start).
//   fichas  apps/fichas  porta PORT (3000)        contas, mesas e fichas
//   mapas   apps/mapas   porta MAPAS_PORT (3001)  editor e visualizador de mapas
// Cada app também roda sozinho (npm run fichas, npm run mapas), e no Docker cada um tem o seu container.
// O servidor MCP (apps/mcp) não entra aqui: o Claude Code o liga por stdio quando precisa.

const fichaPort = +process.env.PORT || 3000;
const mapasPort = +process.env.MAPAS_PORT || 3001;
// um app acha o outro neste mesmo computador
process.env.FICHA_URL = process.env.FICHA_URL || `http://127.0.0.1:${fichaPort}`;
process.env.MAPAS_URL = process.env.MAPAS_URL || `http://127.0.0.1:${mapasPort}`;
process.env.MAPAS_PORTA = process.env.MAPAS_PORTA || String(mapasPort);
process.env.FICHA_PORTA = process.env.FICHA_PORTA || String(fichaPort);

const apps = [require('./apps/fichas/server.js').main({ sinais: false }), require('./apps/mapas/server.js').main({ sinais: false })];

const stop = () => { for (const a of apps) a.flush(); process.exit(0); };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
