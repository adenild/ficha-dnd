---
titulo: Escrevendo na wiki
categoria: Suíte
ordem: 91
resumo: Como formatar as páginas da wiki da mesa: títulos, negrito, listas, tabelas, imagens, links, blocos de leitura e trechos só para o mestre.
---
As páginas são escritas em texto simples com algumas marcas, no estilo Markdown. Use o botão **Ver como fica** no editor para conferir o resultado antes de salvar.

## Texto

| Você escreve | Aparece |
|---|---|
| `**negrito**` | **negrito** |
| `*itálico*` | *itálico* |
| `` `código` `` | `código` |

Uma linha em branco separa parágrafos. Uma quebra de linha simples continua no mesmo parágrafo, mas pula de linha.

## Títulos

Comece a linha com `#`. Use `##` para as seções da página e `###` para subseções; elas aparecem no índice ao lado do texto e viram destino de links.

```
## A cidade de Pedravela
### O mercado
```

## Listas

```
- item
- outro item
  - item dentro do item

1. primeiro passo
2. segundo passo
```

## Tabelas

```
| Nome | Papel |
|---|---|
| Orla | taverneira |
| Bram | ferreiro |
```

## Links

- **Para outra página:** `[[Nome da página]]`. Funciona com páginas da mesa e com as regras, como `[[condicoes]]`.
- **Para uma seção:** `[[combate#agarrar]]`, ou `[[#seção]]` para uma seção da própria página.
- **Com outro texto:** `[[condicoes#caido|derrubado]]` mostra "derrubado" e leva à condição Caído.
- **Para um site:** `[texto](https://exemplo.com)`.

Um link para uma página que ainda não existe aparece riscado. O mestre pode tocar nele para criar a página.

## Imagens

No editor, toque em **Imagem** para enviar uma (PNG, JPEG, WebP ou GIF, até 8 MB). Ela entra no texto assim:

```
![Mapa de Pedravela](/api/wiki/img/... "Legenda opcional")
```

Só quem participa da mesa consegue abrir as imagens dela.

## Blocos especiais

Um bloco começa com `:::tipo` numa linha e termina com `:::` sozinho noutra. O que vier depois do tipo vira o título do bloco.

```
:::leitura A porta do templo
O ar cheira a incenso velho. Sete velas ainda queimam.
:::
```

| Tipo | Para quê |
|---|---|
| `nota` | Quadro lateral com uma informação extra |
| `leitura` | Texto para o mestre ler em voz alta |
| `aviso` | Algo importante ou perigoso |
| `mestre` | **Só o mestre vê.** Os jogadores recebem a página sem este trecho |

:::mestre Exemplo
Este bloco só aparece para o mestre da mesa. Use para segredos, estatísticas de monstros e notas de preparação dentro de uma página que os jogadores também leem.
:::

## Citações e linhas

- Comece a linha com `>` para uma citação.
- Uma linha só com `---` desenha uma linha de separação.
