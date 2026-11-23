# Fichas D&D 5e

App de fichas de D&D 5e feito para o celular, para jogar com os amigos na rede de casa. Um computador roda o servidor e todo mundo abre pelo navegador do celular, na mesma Wi-Fi.

- **Ficha completa:** atributos, perícias, salvaguardas, PV, ataques, magias, inventário e notas, com os cálculos feitos sozinhos e rolagem de dados (com vantagem e desvantagem) ao tocar.
- **Mesas:** quem cria uma mesa é o mestre dela e recebe um código de convite. Os jogadores entram com esse código e trazem um personagem para a mesa.
- **Navegação:** o app abre no **Início**, com as mesas e os personagens. No computador, uma barra de ícones à esquerda leva ao Início, aos Personagens, à ficha aberta, a cada mesa, aos mapas e às Configurações; no celular, a mesma coisa fica numa barra embaixo.
- **Privacidade:** cada jogador vê só as próprias fichas. O mestre vê todas as fichas da mesa e decide quais ficam **liberadas** para os outros jogadores, que só podem lê-las. A regra é aplicada pelo servidor, não só pela tela.
- **Ao vivo:** quando alguém muda uma ficha, quem estiver vendo recebe a mudança na hora.
- **Mapas:** um segundo serviço, na porta 3001, para o mestre desenhar mapas quadriculados e pôr neles os tokens das fichas da mesa. Veja [Mapas](#mapas).

## Requisitos

[Node.js](https://nodejs.org) 18 ou mais novo. Não há dependências para instalar.

## Como rodar

```bash
git clone git@github.com:adenild/ficha-dnd.git
cd ficha-dnd
npm start
```

O terminal mostra os endereços, por exemplo:

```
Fichas D&D rodando na porta 3000.
Neste computador: http://localhost:3000
No celular (mesma Wi-Fi): http://192.168.0.12:3000
```

Abra o endereço "No celular" no navegador de cada jogador. Para ficar com cara de app, use "Adicionar à tela de início" no menu do navegador.

Se o celular não conseguir abrir, quase sempre é o firewall do computador bloqueando a porta 3000. No Windows, aceite o aviso do firewall na primeira vez que rodar o Node, marcando "Redes privadas". No Linux com `ufw`, rode `sudo ufw allow 3000/tcp`.

### Configuração

| Variável | Padrão | Para quê |
|---|---|---|
| `PORT` | `3000` | Porta do servidor |
| `HOST` | `0.0.0.0` | Endereço onde escutar (`127.0.0.1` deixa só neste computador) |
| `DATA_FILE` | `data/db.json` | Onde ficam contas, mesas e fichas |

Exemplo: `PORT=8080 npm start`.

O app de fichas também usa `MAPAS_PORTA` (padrão `3001`) ou `MAPAS_PUBLICA` (endereço completo) para montar o link dos mapas.

### Com Docker

Dá para rodar tudo em container, sem instalar Node e sem tocar na pasta `data/` local. Os dados ficam no volume `ficha-dnd_dados`.

```bash
docker compose up -d --build   # liga (o --build só é preciso depois de mudar o código)
docker compose logs -f app     # acompanha o servidor
docker compose stop            # desliga, guardando os dados
```

O app abre em http://localhost:3000 e os mapas em http://localhost:3001. No celular, use o IP deste computador na rede, na mesma porta. Para usar outras portas, defina `FICHA_PORTA` e `MAPAS_PORTA` (por exemplo, `FICHA_PORTA=8080 docker compose up -d`) ou coloque essas variáveis num arquivo `.env` ao lado do `compose.yaml`.

Para levar as fichas que você já tem em `data/db.json` para o volume, com o container criado e parado:

```bash
docker compose stop app
docker compose cp data/db.json app:/data/db.json
docker compose start app
```

Para redefinir uma senha: `docker compose stop app`, depois `docker compose run --rm app node server.js --reset-senha "Nome do jogador" novaSenha`, e por fim `docker compose start app`.

`docker compose down` remove o container e mantém os dados. `docker compose down -v` apaga o volume e **todas as fichas** junto.

## Primeira sessão

1. O mestre cria a conta e cria a mesa no **Início**, em **Criar mesa**. O código de convite aparece na página da mesa.
2. Cada jogador cria a conta, entra na mesa pelo **Início** com o código e, na página da mesa, cria um personagem ali (**Nova ficha nesta mesa**) ou traz um que já tem (**Trazer**). Também dá para escolher a mesa na aba **Principal** da ficha.
3. Na página da mesa, o mestre vê as fichas da mesa e toca em **Oculta/Liberada** para decidir o que os outros jogadores podem ver.

A página **Personagens** lista os seus personagens com PV, CA, a mesa e, se estiverem num mapa, em qual. Abrir um personagem leva à ficha dele dentro da mesa em que ele está (o endereço fica `#mesa/<mesa>/ficha/<ficha>`), e o cabeçalho da ficha tem atalhos para a mesa e para o personagem no mapa.

## Configurações

O botão **Configurações** (ou **Ajustes**, no celular) abre duas abas:

- **Conta:** nome, tema, se as fichas abrem em modo leitura e qual aba aparece primeiro (valem em todos os aparelhos), troca de senha, sair dos outros aparelhos, os tokens para assistentes e o registro de auditoria.
- **Mesa:** escolha a mesa. O mestre muda o nome e a descrição, copia ou troca o código, fecha a mesa para jogadores novos, decide se as fichas novas já entram liberadas, libera ou oculta todas de uma vez, remove jogadores e apaga a mesa. Os jogadores veem a descrição, quem está na mesa e podem sair dela.

## Mapas

`mapas/server.js` é um editor e visualizador de mapas 2D. É um serviço separado, com seus próprios dados, que conversa com o app de fichas:

- **Mesma conta:** não tem cadastro. O navegador manda o cookie de sessão das fichas para outras portas do mesmo endereço, e o serviço de mapas pergunta ao app de fichas quem é a pessoa, de quais mesas participa e quais fichas pode ver. Por isso, abra os dois pelo mesmo endereço (os dois por `localhost` ou os dois pelo IP da rede). Um token de conta (`Authorization: Bearer fdnd_...`) também funciona.
- **Mestre:** cria mapas para a mesa, pinta o terreno (pedra, madeira, grama, terra, água, parede, lava, porta e rocha) com pincel ou balde, usa uma imagem de fundo (PNG, JPEG, WebP ou GIF, até 8 MB) e põe tokens: das fichas dos jogadores, das fichas dele (monstros e NPCs, que viram inimigos) ou tokens livres. Pode deixar um token oculto, mudar o nome que os jogadores veem, o tipo, o tamanho (1×1 a 4×4) e a cor. O mapa começa oculto; **Mostrar aos jogadores** leva todos para ele.
- **Jogadores:** veem os mapas que o mestre mostrou, sem os tokens ocultos. Movem só os tokens das próprias fichas e podem pôr o próprio personagem no mapa.
- **Ao vivo:** quando um token se move ou o terreno muda, todos veem na hora. Os PV e as condições dos tokens vêm das fichas e mudam quando a ficha muda. De uma ficha que o jogador não pode ler, como a de um monstro, ele vê só o nome do token e se está ileso, ferido, muito ferido ou caído.
- **Régua:** mede em quadrados e metros (1,5 m por quadrado; a diagonal conta como um, como no Livro do Jogador).

Para rodar sem Docker, ligue os dois serviços, cada um num terminal:

```bash
npm start        # fichas, porta 3000
npm run mapas    # mapas, porta 3001
```

No app de fichas, o botão **Mapa** de cada mesa abre os mapas dela, e os personagens mostram em qual mapa estão, com um link que abre o mapa já com o token escolhido. Para isso o app de fichas consulta o serviço de mapas em `MAPAS_URL` (padrão `http://127.0.0.1:3001`; no Docker, `http://mapas:3001`) com a mesma conta, então mapas e tokens ocultos continuam ocultos. Se o serviço de mapas estiver desligado, o app funciona igual, só sem as localizações. No mapa, **Abrir ficha** abre a ficha do token no app de fichas.

| Variável | Padrão | Para quê |
|---|---|---|
| `MAPAS_PORT` | `3001` | Porta do serviço de mapas |
| `FICHA_URL` | `http://localhost:3000` | Onde o serviço de mapas encontra a API das fichas |
| `FICHA_PORTA` / `FICHA_PUBLICA` | porta de `FICHA_URL` | Porta (ou endereço completo) do app de fichas para os links no navegador |
| `MAPAS_DATA` | `data/mapas.json` | Onde ficam os mapas; as imagens ficam em `mapas-img/`, na mesma pasta |

Atalhos no computador: `V` mover, `R` régua, `B` pintar, `G` preencher, setas movem o token escolhido, `Delete` tira do mapa, `Ctrl+Z` desfaz a pintura, `+`, `-` e `0` controlam o zoom, e a roda do mouse aproxima. No celular, um dedo arrasta e dois dedos movem e aproximam o mapa.

## Backup e senhas

- Tudo fica em `data/db.json`, e os mapas em `data/mapas.json` e `data/mapas-img/`. Para fazer backup, copie esses arquivos com os servidores parados. Cada jogador também pode exportar as próprias fichas em Personagens › Exportar e importar.
- As senhas são guardadas com hash (scrypt), nunca em texto.
- Se alguém esquecer a senha, quem roda o servidor pode redefinir:

  ```bash
  node server.js --reset-senha "Nome do jogador" novaSenha
  ```

## Assistente (MCP)

`mcp.js` é um servidor [MCP](https://modelcontextprotocol.io) que deixa um assistente como o Claude ler e mexer nas fichas e mesas. Ele entra no app com um **token de conta**, nunca com a senha, e usa a mesma API dos celulares: segue as mesmas regras de acesso, e quem estiver com a ficha aberta vê as mudanças na hora. Use um token da conta do mestre para o assistente enxergar todas as fichas da mesa.

Para ligar no Claude Code:

1. Com o app rodando, abra **Configurações › Conta** e gere um token em **Assistente (MCP)**. Ele aparece uma vez só.
2. Escolha **Node neste computador** ou **Docker**, confira a pasta do projeto e copie a linha pronta. Ela fica assim:

   ```bash
   claude mcp add ficha-dnd --scope local -e FICHA_URL=http://localhost:3000 -e FICHA_TOKEN=fdnd_... -- node /caminho/para/ficha-dnd/mcp.js
   ```

   No Docker, o MCP roda em container e liga o app sozinho se ele estiver parado:

   ```bash
   claude mcp add ficha-dnd --scope local -e FICHA_TOKEN=fdnd_... -- docker compose -f /caminho/para/ficha-dnd/compose.yaml run --rm -T mcp
   ```

3. Rode a linha no terminal. O escopo `local` guarda o token só na configuração do seu usuário, fora do repositório.

Na mesma tela você pausa um token (as chamadas passam a ser recusadas até retomar), remove (perde o acesso de vez) e vê o registro de auditoria: cada chamada feita com cada token, com data, ação, ficha ou mesa afetada e se foi recusada, além de quando os tokens foram criados, pausados ou removidos. Um token não troca senha, não mexe em tokens nem lê a auditoria: isso só com nome e senha no app. O servidor guarda só o hash do token.

| Ferramenta | O que faz |
|---|---|
| `estado` | Mesas, membros, códigos de convite e resumo das fichas visíveis |
| `ver_ficha` | Ficha completa com os valores calculados (modificadores, perícias, CD de magia...) |
| `criar_ficha` / `editar_ficha` / `apagar_ficha` | Cria, altera em parte ou apaga uma ficha |
| `acao_ficha` | Dano, cura, PV temporários, dado de vida, descanso longo, espaços de magia, salvaguarda contra morte, condições e inspiração |
| `rolar` | Rola uma expressão (`2d6+3`) ou um teste da ficha (perícia, salvaguarda, ataque com dano...), com vantagem ou desvantagem |
| `liberar_ficha` | Mestre libera ou oculta uma ficha para os jogadores |
| `mesa` | Cria, entra, renomeia, troca o código, remove jogador, sai ou apaga uma mesa |

Fichas e mesas podem ser indicadas pelo nome. As rolagens feitas pelo assistente não aparecem nos celulares, só as mudanças na ficha.

### Jogar com o Claude como mestre

A skill [`mestre-dnd`](.claude/skills/mestre-dnd/SKILL.md) faz o Claude conduzir a sessão no chat: narra, interpreta NPCs, pede testes, roda o combate com iniciativa e aplica dano, cura e condições nas fichas, que mudam ao vivo nos celulares. Ela já vem com o repositório: abra o Claude Code nesta pasta, com o MCP ligado, e peça algo como "vamos jogar, mestra pra gente na mesa A Mina Perdida".

O token usado pelo MCP precisa ser de uma conta **mestre da mesa**, porque só o mestre pode mudar as fichas dos jogadores. Os monstros viram fichas ocultas dessa conta, e o resumo da campanha fica numa ficha "Diário: nome da mesa", para a próxima sessão continuar de onde parou.

## Limites

- O servidor usa HTTP sem criptografia, pensado só para a rede de casa. Não o exponha na internet sem colocar HTTPS na frente (por exemplo com Caddy ou um túnel).
- As fontes vêm do Google Fonts. Sem internet, o app usa as fontes do próprio celular e funciona igual.
- O armazenamento é um único arquivo JSON, adequado para um grupo de amigos, não para centenas de usuários.

## Testes

```bash
npm test
```

Os testes cobrem as regras de acesso: cadastro, mesas, código de convite, fichas ocultas e liberadas, edição pelo mestre, tokens de conta (pausar, remover e auditoria), preferências da conta, configurações da mesa e persistência. Também cobrem o servidor MCP de ponta a ponta e o serviço de mapas junto com o app de fichas (conta, mapas ocultos, quem move qual token, saúde dos monstros e imagem de fundo).

## Estrutura

```
server.js         servidor HTTP, API, regras de acesso e eventos ao vivo
mcp.js            servidor MCP para assistentes (fala com a API do server.js)
public/index.html página do app
public/app.js     ficha, rolagens, mesas e conversa com a API
public/style.css  visual
mapas/server.js   serviço de mapas: API, regras de acesso e eventos ao vivo
mapas/public/     editor e visualizador de mapas (canvas)
test/             testes da API (node:test)
Dockerfile        imagem do app e do MCP
compose.yaml      serviços do app, dos mapas e do MCP (portas e volume)
```
