# suite-dnd

Suíte de D&D 5e feita para o celular, para jogar com os amigos na rede de casa. Um computador roda a suíte e todo mundo abre pelo navegador do celular, na mesma Wi-Fi.

| App | Onde | O que faz |
|---|---|---|
| **Fichas** | `apps/fichas`, porta 3000 | Contas, mesas e fichas. É a porta de entrada da suíte. |
| **Mapas** | `apps/mapas`, porta 3001 | Editor e visualizador de mapas quadriculados com os tokens das fichas. Aparece embutido na aba **Mapas** de cada mesa. |
| **MCP** | `apps/mcp` | Servidor [MCP](https://modelcontextprotocol.io) para o Claude ler e mexer nas fichas, nas mesas e nos mapas, e mestrar com a skill `mestre-dnd`. |

- **Ficha completa:** atributos, perícias, salvaguardas, PV, ataques, magias, inventário e notas, com os cálculos feitos sozinhos e rolagem de dados (com vantagem e desvantagem) ao tocar.
- **Mesas:** quem cria uma mesa é o mestre dela e recebe um código de convite. Os jogadores entram com esse código e trazem um personagem para a mesa.
- **Navegação:** o app abre no **Início**, com as mesas e os personagens. No computador, uma barra de ícones à esquerda leva ao Início, aos Personagens, à ficha aberta, a cada mesa, aos mapas e às Configurações; no celular, a mesma coisa fica numa barra embaixo.
- **Privacidade:** cada jogador vê só as próprias fichas. O mestre vê todas as fichas da mesa e decide quais ficam **liberadas** para os outros jogadores, que só podem lê-las. A regra é aplicada pelo servidor, não só pela tela.
- **Ao vivo:** quando alguém muda uma ficha ou mexe no mapa, quem estiver vendo recebe a mudança na hora.

## Requisitos

[Node.js](https://nodejs.org) 18 ou mais novo. Não há dependências para instalar.

## Como rodar

```bash
git clone git@github.com:adenild/ficha-dnd.git suite-dnd
cd suite-dnd
npm start
```

`npm start` liga a suíte inteira (fichas e mapas) num processo só. O terminal mostra os endereços, por exemplo:

```
Fichas D&D rodando na porta 3000.
Neste computador: http://localhost:3000
No celular (mesma Wi-Fi): http://192.168.0.12:3000
Mapas D&D rodando na porta 3001, usando o app de fichas em http://127.0.0.1:3000.
```

Abra o endereço "No celular" da porta 3000 no navegador de cada jogador. Para ficar com cara de app, use "Adicionar à tela de início" no menu do navegador. Os mapas abrem dentro do app de fichas, então não é preciso guardar o endereço da porta 3001.

Se o celular não conseguir abrir, quase sempre é o firewall do computador bloqueando as portas 3000 e 3001. No Windows, aceite o aviso do firewall na primeira vez que rodar o Node, marcando "Redes privadas". No Linux com `ufw`, rode `sudo ufw allow 3000:3001/tcp`.

Também dá para ligar cada app sozinho: `npm run fichas` e `npm run mapas`.

### Configuração

| Variável | Padrão | Para quê |
|---|---|---|
| `PORT` | `3000` | Porta do app de fichas |
| `MAPAS_PORT` | `3001` | Porta do app de mapas |
| `HOST` | `0.0.0.0` | Endereço onde escutar (`127.0.0.1` deixa só neste computador) |
| `DATA_FILE` | `data/db.json` | Onde ficam contas, mesas e fichas |
| `MAPAS_DATA` | `data/mapas.json` | Onde ficam os mapas; as imagens ficam em `mapas-img/`, na mesma pasta |
| `MAPAS_URL` | `http://127.0.0.1:3001` | Onde o app de fichas e o MCP encontram os mapas |
| `FICHA_URL` | `http://127.0.0.1:3000` | Onde o app de mapas e o MCP encontram as fichas |
| `MAPAS_PORTA` / `MAPAS_PUBLICA` | `3001` | Porta (ou endereço completo) dos mapas para o navegador, quando for diferente da porta interna |
| `FICHA_PORTA` / `FICHA_PUBLICA` | `3000` | Porta (ou endereço completo) das fichas para o navegador |

Exemplo: `PORT=8080 MAPAS_PORT=8081 npm start`.

### Com Docker

Dá para rodar tudo em container, sem instalar Node e sem tocar na pasta `data/` local. Cada app tem o seu container (`fichas` e `mapas`), e os dados ficam no volume `ficha-dnd_dados` (o nome vem de quando o projeto se chamava ficha-dnd e foi mantido para não perder nada).

```bash
docker compose up -d --build   # liga (o --build só é preciso depois de mudar o código)
docker compose logs -f         # acompanha os servidores
docker compose stop            # desliga, guardando os dados
```

As fichas abrem em http://localhost:3000. No celular, use o IP deste computador na rede, na mesma porta. Para usar outras portas, defina `FICHA_PORTA` e `MAPAS_PORTA` (por exemplo, `FICHA_PORTA=8080 docker compose up -d`) ou coloque essas variáveis num arquivo `.env` ao lado do `compose.yaml`.

Para levar as fichas que você já tem em `data/db.json` para o volume, com o container criado e parado:

```bash
docker compose stop fichas
docker compose cp data/db.json fichas:/data/db.json
docker compose start fichas
```

Para redefinir uma senha: `docker compose stop fichas`, depois `docker compose run --rm fichas node apps/fichas/server.js --reset-senha "Nome do jogador" novaSenha`, e por fim `docker compose start fichas`.

`docker compose down` remove os containers e mantém os dados. `docker compose down -v` apaga o volume e **todas as fichas e mapas** junto.

Quem já rodava a versão com o nome antigo: antes do primeiro `docker compose up` desta versão, rode `docker compose -p ficha-dnd down` (sem `-v`) para tirar os containers antigos, que ocupam as mesmas portas. O volume com os dados continua e é usado pela suíte.

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

A página de cada mesa tem as abas **Mesa** e **Mapas**. A aba Mapas mostra o app de mapas embutido (`#mesa/<mesa>/mapas`), e o botão **Abrir em outra aba** abre o mesmo mapa sozinho, em tela cheia. Os links "No mapa …" dos personagens abrem essa aba já com o token escolhido e centralizado.

- **Mesma conta:** os mapas não têm cadastro. O navegador manda o cookie de sessão das fichas para outras portas do mesmo endereço, e o app de mapas pergunta ao app de fichas quem é a pessoa, de quais mesas participa e quais fichas pode ver. Por isso, abra tudo pelo mesmo endereço (tudo por `localhost` ou tudo pelo IP da rede). Um token de conta (`Authorization: Bearer fdnd_...`) também funciona. Só páginas desse mesmo endereço podem embutir os mapas.
- **Mestre:** cria mapas para a mesa, pinta o terreno (pedra, madeira, grama, terra, água, parede, lava, porta e rocha) com pincel ou balde, usa uma imagem de fundo (PNG, JPEG, WebP ou GIF, até 8 MB) e põe tokens: das fichas dos jogadores, das fichas dele (monstros e NPCs, que viram inimigos) ou tokens livres. Pode deixar um token oculto, mudar o nome que os jogadores veem, o tipo, o tamanho (1×1 a 4×4) e a cor. O mapa começa oculto; **Mostrar aos jogadores** leva todos para ele.
- **Jogadores:** veem os mapas que o mestre mostrou, sem os tokens ocultos. Movem só os tokens das próprias fichas e podem pôr o próprio personagem no mapa.
- **Ao vivo:** quando um token se move ou o terreno muda, todos veem na hora. Os PV e as condições dos tokens vêm das fichas e mudam quando a ficha muda. De uma ficha que o jogador não pode ler, como a de um monstro, ele vê só o nome do token e se está ileso, ferido, muito ferido ou caído.
- **Régua:** mede em quadrados e metros (1,5 m por quadrado; a diagonal conta como um, como no Livro do Jogador).
- **Ficha a partir do mapa:** no mapa, **Abrir ficha** abre a ficha do token no app de fichas. Se o app de mapas estiver desligado, as fichas funcionam igual, só sem mapas e localizações.

Atalhos no computador: `V` mover, `R` régua, `B` pintar, `G` preencher, setas movem o token escolhido, `Delete` tira do mapa, `Ctrl+Z` desfaz a pintura, `+`, `-` e `0` controlam o zoom, e a roda do mouse aproxima. No celular, um dedo arrasta e dois dedos movem e aproximam o mapa.

## Backup e senhas

- Tudo fica em `data/db.json`, e os mapas em `data/mapas.json` e `data/mapas-img/`. Para fazer backup, copie esses arquivos com a suíte parada. Cada jogador também pode exportar as próprias fichas em Personagens › Exportar e importar.
- As senhas são guardadas com hash (scrypt), nunca em texto.
- Se alguém esquecer a senha, quem roda a suíte pode redefinir:

  ```bash
  node apps/fichas/server.js --reset-senha "Nome do jogador" novaSenha
  ```

## Assistente (MCP)

`apps/mcp` é um servidor MCP que deixa um assistente como o Claude ler e mexer nas fichas, mesas e mapas. Ele entra na suíte com um **token de conta**, nunca com a senha, e usa a mesma API dos celulares: segue as mesmas regras de acesso, e quem estiver com a ficha ou o mapa aberto vê as mudanças na hora. Use um token da conta do mestre para o assistente enxergar todas as fichas da mesa.

Para ligar no Claude Code:

1. Com a suíte rodando, abra **Configurações › Conta** e gere um token em **Assistente (MCP)**. Ele aparece uma vez só.
2. Escolha **Node neste computador** ou **Docker**, confira a pasta do projeto e copie a linha pronta. Ela fica assim:

   ```bash
   claude mcp add suite-dnd --scope local -e FICHA_URL=http://localhost:3000 -e FICHA_TOKEN=fdnd_... -- node /caminho/para/suite-dnd/apps/mcp/server.js
   ```

   No Docker, o MCP roda em container e liga as fichas e os mapas sozinho se estiverem parados:

   ```bash
   claude mcp add suite-dnd --scope local -e FICHA_TOKEN=fdnd_... -- docker compose -f /caminho/para/suite-dnd/compose.yaml run --rm -T mcp
   ```

3. Rode a linha no terminal. O escopo `local` guarda o token só na configuração do seu usuário, fora do repositório.

Quem já tinha o MCP registrado com o nome antigo: rode `claude mcp remove ficha-dnd` e registre de novo com a linha acima (o token pode ser o mesmo).

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
| `ver_mapa` | Lista os mapas, ou mostra um mapa em texto (colunas com letras, linhas com números) com os tokens, a posição, os PV e as condições de cada um |
| `gerenciar_mapa` | Mestre cria, mostra aos jogadores, oculta, renomeia, redimensiona ou apaga um mapa |
| `pintar_mapa` | Mestre pinta o terreno em retângulos (com a opção de só o contorno, para paredes) |
| `colocar_token` / `mover_token` / `editar_token` | Põe um token de ficha ou livre, move (dizendo quanto andou), revela, oculta, renomeia ou tira do mapa |
| `medir` | Distância entre tokens ou quadrados pelas regras do quadriculado (diagonal conta 1, 1,5 m por quadrado) |

Fichas, mesas, mapas e tokens podem ser indicados pelo nome, e posições no mapa são coluna e linha (C7). As rolagens feitas pelo assistente não aparecem nos celulares, só as mudanças na ficha e no mapa.

As ferramentas de mapa falam com o app de mapas usando o mesmo token. O endereço vem de `MAPAS_URL`; sem ela, o MCP usa o endereço de `FICHA_URL` na porta 3001 (no Docker, o compose já aponta para o serviço `mapas`). Se os mapas estiverem desligados, as ferramentas de fichas continuam funcionando.

### Jogar com o Claude como mestre

A skill [`mestre-dnd`](.claude/skills/mestre-dnd/SKILL.md) faz o Claude conduzir a sessão no chat: narra, interpreta NPCs, pede testes, roda o combate com iniciativa e aplica dano, cura e condições nas fichas, que mudam ao vivo nos celulares. Se a mesa usa mapa, ele monta o lugar, põe os monstros ocultos, revela quando aparecem, move os tokens nos turnos e mede alcance e áreas de efeito, e os jogadores veem o mapa mudar na tela. Ela já vem com o repositório: abra o Claude Code nesta pasta, com o MCP ligado, e peça algo como "vamos jogar, mestra pra gente na mesa A Mina Perdida".

O token usado pelo MCP precisa ser de uma conta **mestre da mesa**, porque só o mestre pode mudar as fichas dos jogadores. Os monstros viram fichas ocultas dessa conta, e o resumo da campanha fica numa ficha "Diário: nome da mesa", para a próxima sessão continuar de onde parou.

## Limites

- A suíte usa HTTP sem criptografia, pensada só para a rede de casa. Não a exponha na internet sem colocar HTTPS na frente (por exemplo com Caddy ou um túnel).
- As fontes vêm do Google Fonts. Sem internet, os apps usam as fontes do próprio celular e funcionam igual.
- O armazenamento é feito em arquivos JSON, adequado para um grupo de amigos, não para centenas de usuários.

## Testes

```bash
npm test
```

Os testes cobrem as regras de acesso: cadastro, mesas, código de convite, fichas ocultas e liberadas, edição pelo mestre, tokens de conta (pausar, remover e auditoria), preferências da conta, configurações da mesa e persistência. Também cobrem o app de mapas junto com o de fichas (conta, mapas ocultos, quem move qual token, saúde dos monstros, imagem de fundo, localizações e quem pode embutir os mapas) e o servidor MCP de ponta a ponta, inclusive um encontro montado e jogado no mapa.

## Estrutura

```
suite.js              liga fichas e mapas num processo só (npm start)
apps/fichas/          app de fichas: server.js (API, regras de acesso, eventos ao vivo) e public/ (página, ficha, mesas)
apps/mapas/           app de mapas: server.js (API, regras de acesso, eventos ao vivo) e public/ (editor em canvas)
apps/mcp/server.js    servidor MCP para assistentes (fala com as APIs de fichas e mapas)
.claude/skills/       skill mestre-dnd para o Claude mestrar
test/                 testes (node:test)
Dockerfile            uma imagem para os três apps
compose.yaml          serviços fichas, mapas e mcp (portas e volume)
data/                 dados ao rodar sem Docker (fora do git)
```
