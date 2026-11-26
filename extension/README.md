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


## Integração com SiteHunter — versão 1.4.3

No site `https://zsites.lovable.app` (ou endereço anterior `https://site-scout-ai-90.lovable.app`), abra Busca e **Automatizar WhatsApp**. Atualize os arquivos na pasta já instalada e recarregue em `chrome://extensions` para conservar o ID. Atualize a aba do WhatsApp uma vez e conecte o plugin no site.

A integração envia **o arquivo HTML do botão Exportar site**, com as imagens e o vídeo disponíveis. Cada empresa recebe seu documento individual; a mensagem da variante 1/2/3 acompanha o anexo como legenda. O destinatário deve baixar e abrir o HTML no navegador.

- **Preparar e revisar prévias** permite baixar e conferir o arquivo antes de enviar.
- **Gerar prévias e iniciar envios** prepara os documentos, transfere os arquivos ao plugin e inicia a fila inteira. Falha de preparação/transferência impede início parcial.
- `(empresa)`, `(cidade)` e `(nome)` continuam disponíveis. O marcador legado `(previa)` e os URLs antigos de compartilhamento do SiteHunter são removidos da legenda. Nenhum link de prévia é acrescentado automaticamente.
- Seleção por cidade, quantidade, três mensagens alternadas, intervalo configurável, pausa/retomada, TXT e operação sem recarregar o WhatsApp permanecem disponíveis.
- Arquivos são transferidos em partes de 256 KiB e conferidos por SHA-256 antes de iniciar e antes de anexar. Os bytes ficam no IndexedDB da extensão; o estado JSON contém só metadados. Limites: 50 MB por HTML e 256 MB de documentos armazenados/preparados no plugin.
- Só há confirmação quando aparece uma nova mensagem de saída com nome do documento, legenda e tique. Um texto sem o documento não confirma o contato. Falha ambígua depois do clique pausa para revisão e não repete automaticamente.
- Arquivos são removidos do plugin ao concluir, encerrar ou apagar a sequência. Transferências abandonadas e não usadas pela fila podem ser limpas após 24 horas. Se o navegador remover arquivos por falta de espaço, o envio pausa.
- Sequências antigas com links não são convertidas em silêncio: encerre e prepare novamente os contatos pendentes para usar documentos.

O canal externo permite apenas os dois domínios acima e localhost/127.0.0.1 para desenvolvimento. O site não fornece JWT/senha/chaves ao plugin. O documento não é executado pela extensão. A comunicação site-plugin usa APIs do Chrome; a automação do WhatsApp depende da interface externa e não é uma integração oficial da Meta. Use contatos autorizados.

A versão 1.4.3 foi testada com arquivos, campos e eventos nativos do Chromium e respostas controladas do WhatsApp. O aceite integral numa conta real permanece necessário; nenhuma mensagem real foi enviada nesses testes.

## Correção de anexos — 1.4.3

A versão 1.4.3 escolhe a opção **Documento** depois de abrir Anexar e aguarda o campo de arquivo criado por essa opção. Reconhece filtros `text/*`, a opção em português/inglês e campos criados com atraso. Havendo vários seletores, usa o campo associado à opção Documento ou o campo novo, em vez de escolher um seletor de foto arbitrário.

Se não houver campo acessível, tenta uma única soltura do arquivo no editor, seguindo a alternativa de arrastar documentos prevista pela interface Web. Eventos programáticos podem ser recusados por versões do WhatsApp; nesse caso a fila pausa. Depois de entregar o arquivo a um campo ou por soltura, não tenta uma segunda estratégia no mesmo preparo. Continua exigindo prévia do nome exato, legenda correta e confirmação na conversa correta.

O reconhecimento contempla legendas editáveis vazias, janela genérica de anexo, botões Enviar arquivo/documento e ícone send-light. Uma mensagem de texto, documento citado, elemento oculto ou tique antigo não confirmam um documento novo. Rascunho existente, anexo já aberto, cancelamento e mudança de conversa continuam bloqueando o clique.

Para atualizar, substitua os arquivos **na mesma pasta já instalada**, recarregue a extensão em `chrome://extensions` e atualize WhatsApp/site uma vez. Isso conserva o ID e os dados locais. Retome a sequência pausada depois de conferir a conversa; nenhuma nova campanha precisa ser criada apenas para atualizar o adaptador. Não use Remover nem Apagar dados locais se quiser conservar o progresso.

Verificação reproduzível no repositório integrado: `node tests/attachment-browser.mjs` (30 cenários em Chromium) e `node tests/browser-integration.mjs` (site, documentos, download ZIP, fila e intervalos). Os resultados de entrega são controlados; nenhuma conta real do WhatsApp é usada. Consulte o registro de CI para o resultado da versão.

## Busca de contatos — 1.4.3

O erro em Nova conversa com campo vazio foi reproduzido antes da correção. O adaptador agora reconhece campos contenteditable true, plaintext-only e vazios, além de inputs de pesquisa. O preenchimento usa a mesma via de colagem/inserção do navegador e confere o número antes de procurar resultados.

Resultados anteriores à pesquisa não são escolhidos como um contato novo. Linhas com outro telefone explícito são rejeitadas, inclusive quando há só um resultado. Resultados em botões e listas que permanecem na tela após abrir a conversa são contemplados. Uma conversa já aberta com o telefone correto pode ser reutilizada; a conferência do destinatário continua obrigatória antes de preencher ou anexar.

A leitura dos dados inclui Dados da empresa/Business info. O adaptador não clica num botão genérico de chamada, vídeo ou menu para tentar abrir dados do contato. Falhas na busca e nos dados recebem códigos específicos. O site recebe etapa e código, sem expor tokens do job nem o HTML do documento. Não há navegação por link nem recarga entre contatos.

Verificação: 10 regressões da busca, 12 cenários nativos completos de busca → conferência → documento → legenda → confirmação, além das suítes já existentes. O teste qa/extension-browser.mjs carrega a extensão Manifest V3 em um perfil limpo e usa IPC/IndexedDB reais; toda resposta de WhatsApp nesse teste é uma página controlada. Nenhuma conta real ou destinatário externo é usado. Consulte o CI para o resultado executado.
