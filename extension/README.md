# Pluginwhat — extensão para Chrome

Painel lateral dentro do WhatsApp Web para importar contatos de um TXT, configurar três mensagens e enviar uma mensagem por contato, na ordem da lista, com intervalo fixo.

## Instalação

1. Baixe o ZIP da extensão e extraia a pasta `pluginwhat-extension`. Ao baixar o código completo do GitHub, use a pasta `extension`.
2. No Chrome, acesse `chrome://extensions`.
3. Ative **Modo do desenvolvedor**, no canto superior direito.
4. Clique em **Carregar sem compactação** e selecione a pasta que contém `manifest.json`.
5. Abra ou atualize `https://web.whatsapp.com/` e entre na sua conta. O botão **PW · Pluginwhat** e o painel aparecem quando a lista de conversas carregar.

Não é preciso instalar Node.js para usar. A extensão é Manifest V3, para Chrome 120 ou superior. Ela é carregada localmente; não foi publicada na Chrome Web Store.

## Como usar

1. Importe um `.txt` UTF-8 com **um número por linha**, até 5.000 contatos e 2 MB. Inclua DDI e DDD. A opção brasileira adiciona `55` a números com 10/11 dígitos; números estrangeiros devem começar com `+` e DDI. O formato do número é validado, mas a existência da conta só pode ser verificada no WhatsApp.
2. Confira os números da prévia. Números repetidos são removidos após normalização. Linhas inválidas são ignoradas e exibidas com a numeração original. A ordem da primeira ocorrência é preservada.
3. Preencha as três mensagens, até 3.000 caracteres cada.
4. Defina minutos e segundos. Exemplos: `1:30`, `2:00`, `3:00`. O intervalo pode variar de 30 segundos a 24 horas.
5. Clique em **Iniciar sequência**. O primeiro contato é processado imediatamente; os seguintes aguardam o intervalo após a confirmação do envio anterior.

| Contato na lista | Mensagem |
| --- | --- |
| 1 | 1 |
| 2 | 2 |
| 3 | 3 |
| 4 | 1 |
| 5 | 2 |
| 6 | 3 |

Cada contato recebe **uma** mensagem nessa sequência. Pular um contato mantém a distribuição original: o contato 4 sempre usa a mensagem 1. Uma nova sequência com a mesma lista é uma nova campanha e pode enviar novamente aos mesmos números.

Mantenha o Chrome aberto e o computador ligado, conectado à internet e sem suspensão. Reserve a aba da campanha para os envios: a extensão usa Nova conversa para abrir cada contato dentro da mesma página, sem recarregar ou trocar o endereço da aba. Use outras abas para navegar. Não altere a conversa durante um envio.

## Pausar, retomar e revisar

- **Pausar:** impede a continuação da fila. Um clique em envio que já ocorreu pode concluir; nesse caso, o contato fica para revisão.
- **Retomar:** continua a partir do contato pendente e respeita o intervalo já programado.
- **Encerrar:** termina a campanha e libera a configuração para iniciar outra.
- **Pular este contato:** registra o contato como pulado e avança. A retomada é manual.
- **Conferi: já foi enviado:** aparece apenas quando o resultado ficou incerto. Confira a conversa antes de usar.
- **Exportar CSV:** baixa o registro completo com número, variante, resultado e horário.
- **Apagar dados locais:** remove a lista, mensagens e registro da extensão neste perfil do Chrome.

Se o número não existir, o WhatsApp sair da conta, a conexão falhar, a interface mudar ou o destinatário não puder ser confirmado, a fila pausa. Não há repetição automática de tentativas ambíguas. Fechar a aba ou reiniciar o Chrome também pausa a campanha. O progresso é recuperado do armazenamento local; a extensão mantém somente a campanha mais recente.

## Como o envio é confirmado

A extensão pesquisa o telefone em Nova conversa, abre o resultado e preenche o editor dentro da página já carregada. Antes de clicar no botão de envio, confere o número do cabeçalho ou dos dados do contato e o texto no editor. Depois, aguarda uma nova mensagem de saída com a confirmação visual do WhatsApp (um ou dois tiques). Isso confirma envio pelo WhatsApp, **não leitura ou entrega ao destinatário**. Mensagens que continuam com o relógio não são marcadas como enviadas.

O adaptador está em `whatsapp.js`. Seus seletores dependem da interface do WhatsApp Web, que pode mudar sem aviso. Se a interface não for reconhecida, o comportamento é pausar. Cabeçalhos com número e a gaveta de dados do contato são suportados; a confirmação de contatos salvos pode exigir atualização dos seletores em versões diferentes do WhatsApp.

## Privacidade e uso

Contatos, mensagens e progresso ficam em `chrome.storage.local`, no seu perfil do Chrome. Não há servidor, telemetria, leitura de cookies, acesso a credenciais, coleta de conversas nem código remoto. As mensagens são enviadas ao WhatsApp para o funcionamento solicitado. A extensão usa somente as permissões `storage`, `alarms` e acesso a `web.whatsapp.com`.

Use com contatos que autorizaram o recebimento. O intervalo é uma preferência de agendamento, não uma garantia contra restrições do WhatsApp. A extensão não é um produto oficial do WhatsApp/Meta.

## Desenvolvimento e verificação

Da raiz do repositório, com Node.js 20 ou superior:

```sh
node --test extension/test/*.test.mjs
node scripts/check-extension.mjs
python3 scripts/package-extension.py
```

Os testes automatizados cobrem importação, rodízio, intervalo após confirmação, pausa/retomada, concorrência, autorização por aba/documento e prevenção de repetição de envios incertos. `test/whatsapp.test.mjs` testa o adaptador com DOM simulado. Eles não substituem um teste de aceitação em uma conta real.

Antes de usar uma lista real, teste com números próprios autorizados: importar dois formatos do mesmo número, enviar uma lista curta com as três variantes, conferir os horários, pausar durante a espera e atualizar a aba. Teste também um número inválido e uma desconexão. Esta implementação não foi validada em uma sessão real do WhatsApp neste ambiente.
