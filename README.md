# Pluginwhat

Extensão para Chrome com painel dentro do WhatsApp Web: importação de contatos TXT, três mensagens em rodízio e intervalo configurável entre contatos.

Use `(nome)` no texto para inserir o nome exibido pelo contato, por exemplo: `Bom dia (nome), tudo bem?`. A extensão confere e personaliza cada mensagem antes do envio, e o painel mostra a etapa atual e os detalhes de uma eventual falha.

## Instalar a extensão

O plugin pronto para carregar está em [`extension/`](./extension/). Veja o [guia completo em português](./extension/README.md).

1. Baixe este repositório e extraia o ZIP.
2. Abra `chrome://extensions` no Chrome e ative **Modo do desenvolvedor**.
3. Clique em **Carregar sem compactação** e selecione a pasta `extension` (a que contém `manifest.json`).
4. Abra ou atualize o WhatsApp Web e entre na sua conta. Use o painel **PW · Pluginwhat**.

Não é necessário compilar ou instalar dependências para carregar a extensão. Os envios seguem `M1 → contato 1`, `M2 → contato 2`, `M3 → contato 3`, repetindo a partir do contato 4. Cada contato recebe uma mensagem. O intervalo começa após a confirmação do envio anterior.

Para testar e gerar um ZIP apenas do plugin:

```sh
node --test extension/test/*.test.mjs
node scripts/check-extension.mjs
python3 scripts/package-extension.py
```

A base web abaixo foi preservada para manter a integração existente com o Lovable.

This project was built with [Lovable](https://lovable.dev).

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/075786e2-6db8-4109-9284-84366ca67a8d).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
