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
5. Clique em **Iniciar sequência uma única vez**. O primeiro contato é processado imediatamente; o restante da lista avança automaticamente, sem clicar em cada contato. O intervalo começa após a confirmação de cada envio ou da identificação de um número não cadastrado.

| Contato na lista | Mensagem |
| --- | --- |
| 1 | 1 |
| 2 | 2 |
| 3 | 3 |
| 4 | 1 |
| 5 | 2 |
| 6 | 3 |

Cada contato recebe **uma** mensagem nessa sequência. Somente números que o WhatsApp identifica explicitamente como não cadastrados são pulados automaticamente. Mesmo nesses casos, a extensão espera o intervalo configurado antes de abrir o próximo contato. A distribuição original é mantida: o contato 4 sempre usa a mensagem 1. Uma nova sequência com a mesma lista é uma nova campanha e pode enviar novamente aos mesmos números.

Mantenha o Chrome aberto e o computador ligado, conectado à internet e sem suspensão. Reserve a aba da campanha para os envios: a extensão usa Nova conversa para abrir cada contato dentro da mesma página, sem recarregar ou trocar o endereço da aba. Use outras abas para navegar. Não altere a conversa durante um envio.

## Personalização com o nome

Escreva `(nome)` em qualquer uma das três mensagens. Exemplo: `Bom dia (nome), tudo bem?`. Se o contato aparece como **Maria da Silva** no WhatsApp, o texto enviado será `Bom dia Maria da Silva, tudo bem?`.

O nome é lido novamente em cada conversa. `(NOME)` e `( nome )` também funcionam, inclusive quando o marcador aparece várias vezes. O nome completo é usado como texto, sem executar HTML ou comandos. Se o WhatsApp mostrar somente o telefone e não houver nome disponível, o marcador é removido: `Bom dia, tudo bem?`. A extensão não inventa nomes e não consulta serviços externos para identificá-los. O limite de 3.000 caracteres também é conferido depois da personalização.

## Pausar, retomar e revisar

- **Pausar:** impede a continuação da fila. Um clique em envio que já ocorreu pode concluir; nesse caso, o contato fica para revisão.
- **Retomar:** continua a partir do contato pendente e respeita o intervalo já programado.
- **Encerrar:** termina a campanha e libera a configuração para iniciar outra.
- **Conferi: já foi enviado:** aparece apenas quando o resultado ficou incerto. Após sua confirmação, o registro avança e a sequência continua automaticamente depois do intervalo.
- **Conferi: não foi enviado. Tentar de novo:** mantém o mesmo contato e retoma a fila após sua conferência. Use apenas depois de verificar a conversa para evitar duplicidade.
- **Exportar CSV:** baixa o registro completo com número, variante, resultado e horário.
- **Apagar dados locais:** remove a lista, mensagens e registro da extensão neste perfil do Chrome.

Uma busca vazia, um convite para usar o WhatsApp ou um erro de conexão não são tratados como número inexistente. Quando uma falha transitória ocorre antes de qualquer clique de envio, a extensão faz até três tentativas automáticas no mesmo contato, com cinco segundos entre tentativas. Depois disso, pausa mantendo o contato pendente. Se o clique já ocorreu mas o resultado ficou incerto, a extensão pausa para conferência e não repete o clique automaticamente. Fechar a aba ou reiniciar o Chrome também pausa a campanha. O progresso é recuperado do armazenamento local; a extensão mantém somente a campanha mais recente.

## Como o envio é confirmado

A extensão pesquisa o telefone em Nova conversa, abre o resultado e preenche o editor dentro da página já carregada. Antes de clicar no botão de envio, confere o número do cabeçalho ou dos dados do contato e o texto no editor. Depois, aguarda uma nova mensagem de saída com a confirmação visual do WhatsApp (um ou dois tiques). Isso confirma envio pelo WhatsApp, **não leitura ou entrega ao destinatário**. Mensagens que continuam com o relógio não são marcadas como enviadas.

O preenchimento contempla o editor atual de texto rico, usando seu evento de colagem e, se necessário, a inserção de texto pelo navegador. Não há leitura ou alteração da área de transferência do computador. A ativação do botão segue uma sequência de ponteiro e um único clique; não há envio por Enter nem repetição automática de cliques incertos. A identificação do campo e dos dados do contato contempla estruturas sem as antigas marcações internas do WhatsApp.

O painel informa a etapa atual: localizar o campo, conferir o contato, preencher o texto, acionar Enviar e aguardar confirmação. Se o editor não aceitar o texto, o erro deixa claro que o campo não foi preenchido e mantém o contato pendente. O CSV inclui nome reconhecido, última etapa, código e detalhe do erro para ajudar a investigar incompatibilidades.

Mudanças de presença, como “online”, “digitando” ou “visto por último”, não são usadas como identidade da conversa. Mensagens antigas com texto igual não confirmam um novo envio: a extensão considera o identificador da nova mensagem, quando disponível. A confirmação do progresso pode ser repetida sem repetir o envio. O agendamento usa alarmes do Chrome e um despertador na página, com verificação periódica de recuperação. Ambos respeitam o horário mínimo configurado; computador suspenso, navegador fechado ou limitação do Chrome podem atrasar o avanço.

O adaptador está em `whatsapp.js`. Seus seletores dependem da interface do WhatsApp Web, que pode mudar sem aviso. Se a interface não for reconhecida, o comportamento é pausar. Cabeçalhos com número e a gaveta de dados do contato são suportados; a confirmação de contatos salvos pode exigir atualização dos seletores em versões diferentes do WhatsApp.

A versão 1.2.1 inclui correções de leitura de mensagens com emoji e quebra de linha, proteção contra interpretar descrições de contatos como erro de cadastro, editores `plaintext-only`, grupos/canais reconhecíveis e retomada a partir de outra aba. A auditoria detalhada e seus limites estão em `qa/AUDIT.md` no repositório.

## Privacidade e uso

Contatos, mensagens e progresso ficam em `chrome.storage.local`, no seu perfil do Chrome. Não há servidor, telemetria, leitura de cookies, acesso a credenciais, coleta de conversas nem código remoto. As mensagens são enviadas ao WhatsApp para o funcionamento solicitado. A extensão usa somente as permissões `storage`, `alarms` e acesso a `web.whatsapp.com`.

Use com contatos que autorizaram o recebimento. O intervalo é uma preferência de agendamento, não uma garantia contra restrições do WhatsApp. A extensão não é um produto oficial do WhatsApp/Meta.

## Desenvolvimento e verificação

Da raiz do repositório, com Node.js 22 ou superior:

```sh
node --test extension/test/*.test.mjs
npm --prefix qa ci
node --test extension/test/*.test.mjs qa/*.test.mjs
node qa/realtime-scheduler.mjs
node scripts/check-extension.mjs
python3 scripts/package-extension.py
```

Os testes unitários cobrem importação, rodízio, intervalo após confirmação, pausa/retomada, concorrência, autorização por aba/documento e prevenção de repetição de envios incertos. A suíte em `qa/` conecta a fila, o executor, os alarmes e o adaptador a um DOM de teste: cobre campanhas inteiras com 120 segundos simulados entre contatos, número inexistente no início/meio, mudança de presença, resposta perdida, suspensão do processo da extensão, falha de conexão e relógio sem confirmação. O teste separado `realtime-scheduler.mjs` aguarda dois minutos reais para conferir o despertador automático. Esses testes não substituem um teste de aceitação em uma conta real.

Antes de usar uma lista real, teste com números próprios autorizados: importar dois formatos do mesmo número, enviar uma lista curta com as três variantes, conferir os horários, pausar durante a espera e atualizar a aba. Teste também um número inválido e uma desconexão. Esta implementação não foi validada em uma sessão real do WhatsApp neste ambiente.

Referências oficiais consultadas: [alarmes do Chrome](https://developer.chrome.com/docs/extensions/reference/api/alarms), [ciclo de vida da extensão](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle), [troca de mensagens da extensão](https://developer.chrome.com/docs/extensions/develop/concepts/messaging) e [confirmações do WhatsApp](https://faq.whatsapp.com/665923838265756/).

Também foram consultadas as especificações de [eventos de entrada](https://www.w3.org/TR/input-events-2/) e a documentação de [scripts de conteúdo do Chrome](https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts) para a interação com o editor.


## Integração com SiteHunter — versão 1.3.1

No site `https://zsites.lovable.app` (ou no endereço anterior `https://site-scout-ai-90.lovable.app`), abra Busca e o painel **Automatizar WhatsApp**. Instale o pacote integrado baixado ali ou esta pasta da extensão. Copie o ID de `chrome://extensions` para o site e clique em Conectar plugin. Após instalar ou atualizar, atualize a aba do WhatsApp uma vez.

Selecione a quantidade e as empresas da cidade pesquisada, escreva as três mensagens e configure minutos/segundos (mínimo 30 segundos). O botão **Gerar prévias e iniciar envios** prepara os links individuais e inicia a fila inteira. **Preparar e revisar prévias** permite conferir sem enviar. O navegador e o WhatsApp precisam continuar abertos/conectados.

- `(empresa)`, `(cidade)` e `(previa)` vêm da empresa selecionada; `(nome)` usa o nome disponível no WhatsApp.
- Cada contato recebe seu próprio link; ele é acrescentado mesmo sem `(previa)` no texto.
- Empresas com site informado, fechadas ou sem telefone válido são excluídas da seleção. Telefones repetidos aparecem uma vez. Não se comprova ausência de site apenas pela ausência do campo no Google.
- Com a opção de IA desmarcada, o site usa a prévia salva ou cria seu modelo padrão. A IA opcional pode consumir créditos. Não se geram imagens/vídeos pagos automaticamente.
- A sequência usa os mesmos alarmes, confirmação e intervalos da lista TXT. Pausar, retomar, encerrar e revisar envio incerto estão disponíveis no site e no painel do WhatsApp.
- A mesma solicitação de início é registrada no armazenamento local para impedir repetição após perda de resposta. Limpar os dados/desinstalar a extensão também remove essa proteção.
- Links expirados pausam no contato atual. Revogar uma prévia no estúdio pode invalidar um link de uma fila já iniciada.

O canal externo aceita somente os dois domínios publicados acima e localhost/127.0.0.1 para desenvolvimento. Não aceita outros projetos Lovable. Um domínio próprio exige atualizar a lista exata em `manifest.json` e `site-bridge.js`. Não são enviados tokens de autenticação do site à extensão.

O canal usa APIs oficiais de comunicação de extensões Chrome. A automação da interface do WhatsApp é uma integração independente, não oficial, sujeita a mudanças da interface e às regras do WhatsApp. Use contatos autorizados. Não há garantia de envio infalível ou de ausência de restrições na conta.
