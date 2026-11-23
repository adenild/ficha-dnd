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

## Primeira sessão

1. O mestre cria a conta, abre o menu ☰ e cria a mesa em **Criar mesa**. O código de convite aparece logo abaixo do nome da mesa.
2. Cada jogador cria a conta, cria a ficha (ou começa pelo exemplo), entra na mesa pelo menu ☰ com o código e escolhe a mesa na aba **Principal** da ficha.
3. No menu ☰, o mestre vê as fichas da mesa e toca em **Oculta/Liberada** para decidir o que os outros jogadores podem ver.

## Backup e senhas

- Tudo fica em `data/db.json`. Para fazer backup, copie esse arquivo com o servidor parado. Cada jogador também pode exportar as próprias fichas pelo menu ☰ › Exportar e importar.
- As senhas são guardadas com hash (scrypt), nunca em texto.
- Se alguém esquecer a senha, quem roda o servidor pode redefinir:

  ```bash
  node server.js --reset-senha "Nome do jogador" novaSenha
  ```

## Limites

- O servidor usa HTTP sem criptografia, pensado só para a rede de casa. Não o exponha na internet sem colocar HTTPS na frente (por exemplo com Caddy ou um túnel).
- As fontes vêm do Google Fonts. Sem internet, o app usa as fontes do próprio celular e funciona igual.
- O armazenamento é um único arquivo JSON, adequado para um grupo de amigos, não para centenas de usuários.

## Testes

```bash
npm test
```

Os testes cobrem as regras de acesso: cadastro, mesas, código de convite, fichas ocultas e liberadas, edição pelo mestre e persistência.

## Estrutura

```
server.js         servidor HTTP, API, regras de acesso e eventos ao vivo
public/index.html página do app
public/app.js     ficha, rolagens, mesas e conversa com a API
public/style.css  visual
test/             testes da API (node:test)
```
