# Fichas D&D 5e

App de fichas de D&D 5e feito para o celular, para jogar com os amigos na rede de casa. Um computador roda o servidor e todo mundo abre pelo navegador do celular, na mesma Wi-Fi.

- **Ficha completa:** atributos, perícias, salvaguardas, PV, ataques, magias, inventário e notas, com os cálculos feitos sozinhos e rolagem de dados (com vantagem e desvantagem) ao tocar.
- **Mesas:** quem cria uma mesa é o mestre dela e recebe um código de convite. Os jogadores entram com esse código e escolhem a mesa na aba Principal da ficha.
- **Privacidade:** cada jogador vê só as próprias fichas. O mestre vê todas as fichas da mesa e decide quais ficam **liberadas** para os outros jogadores, que só podem lê-las. A regra é aplicada pelo servidor, não só pela tela.
- **Ao vivo:** quando alguém muda uma ficha, quem estiver vendo recebe a mudança na hora.

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

### Com Docker

Dá para rodar tudo em container, sem instalar Node e sem tocar na pasta `data/` local. Os dados ficam no volume `ficha-dnd_dados`.

```bash
docker compose up -d --build   # liga (o --build só é preciso depois de mudar o código)
docker compose logs -f app     # acompanha o servidor
docker compose stop            # desliga, guardando os dados
```

O app abre em http://localhost:3000. No celular, use o IP deste computador na rede, na mesma porta. Para usar outra porta, defina `FICHA_PORTA` (por exemplo, `FICHA_PORTA=8080 docker compose up -d`) ou coloque `FICHA_PORTA=8080` num arquivo `.env` ao lado do `compose.yaml`.

Para levar as fichas que você já tem em `data/db.json` para o volume, com o container criado e parado:

```bash
docker compose stop app
docker compose cp data/db.json app:/data/db.json
docker compose start app
```

Para redefinir uma senha: `docker compose stop app`, depois `docker compose run --rm app node server.js --reset-senha "Nome do jogador" novaSenha`, e por fim `docker compose start app`.

`docker compose down` remove o container e mantém os dados. `docker compose down -v` apaga o volume e **todas as fichas** junto.

## Primeira sessão

1. O mestre cria a conta, abre o menu ☰ e cria a mesa em **Criar mesa**. O código de convite aparece no menu, junto da mesa.
2. Cada jogador cria a conta, cria a ficha (ou começa pelo exemplo), entra na mesa pelo menu ☰ com o código e escolhe a mesa na aba **Principal** da ficha.
3. No menu ☰, o mestre vê as fichas da mesa e toca em **Oculta/Liberada** para decidir o que os outros jogadores podem ver.

## Configurações

O botão **Configurações** do menu ☰ abre duas abas:

- **Conta:** nome, tema, se as fichas abrem em modo leitura e qual aba aparece primeiro (valem em todos os aparelhos), troca de senha, sair dos outros aparelhos, os tokens para assistentes e o registro de auditoria.
- **Mesa:** escolha a mesa. O mestre muda o nome e a descrição, copia ou troca o código, fecha a mesa para jogadores novos, decide se as fichas novas já entram liberadas, libera ou oculta todas de uma vez, remove jogadores e apaga a mesa. Os jogadores veem a descrição, quem está na mesa e podem sair dela.

## Backup e senhas

- Tudo fica em `data/db.json`. Para fazer backup, copie esse arquivo com o servidor parado. Cada jogador também pode exportar as próprias fichas pelo menu ☰ › Exportar e importar.
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

Os testes cobrem as regras de acesso: cadastro, mesas, código de convite, fichas ocultas e liberadas, edição pelo mestre, tokens de conta (pausar, remover e auditoria), preferências da conta, configurações da mesa e persistência. Também cobrem o servidor MCP de ponta a ponta.

## Estrutura

```
server.js         servidor HTTP, API, regras de acesso e eventos ao vivo
mcp.js            servidor MCP para assistentes (fala com a API do server.js)
public/index.html página do app
public/app.js     ficha, rolagens, mesas e conversa com a API
public/style.css  visual
test/             testes da API (node:test)
Dockerfile        imagem do app e do MCP
compose.yaml      serviço do app (porta e volume) e do MCP
```
