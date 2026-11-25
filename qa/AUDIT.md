# Auditoria do Pluginwhat — 25/11/2026

Versão analisada: 1.2.0, commit `3372f6a351fa02052ed21fb3f7a54d8ccf3864f1`.
Versão com as correções desta auditoria: 1.2.1.

## Parecer

Foram encontrados erros reproduzíveis que não eram cobertos pelos 48 testes anteriores. As correções abaixo preservam a estrutura solicitada: TXT de contatos, três variantes por posição, intervalo configurável, avanço automático, personalização com `(nome)` e operação sem recarregar a página.

O código corrigido passou pelas verificações descritas neste relatório. Isso não certifica funcionamento sem falhas em todas as versões do WhatsApp Web. O aceite completo em uma conta real permanece pendente. Nenhuma conta foi acessada e nenhuma mensagem real foi enviada nesta auditoria.

## Problemas encontrados e corrigidos

| Problema | Consequência possível na 1.2.0 | Correção e evidência |
| --- | --- | --- |
| Emoji convertido em imagem junto de blocos de texto | A leitura juntava linhas ou acrescentava linhas vazias. O texto visível podia ser recusado ou não ter seu envio confirmado. | Preservação das fronteiras de blocos e linhas vazias. Regressão falhou antes da correção e passou depois; verificada também em Chromium nativo. |
| Texto livre de um perfil interpretado como erro do WhatsApp | Um contato válido com descrição contendo “Este número não está no WhatsApp” podia ser pulado ou excluído da busca. | Descrições de linhas de contato não provam inexistência. A seleção não filtra contatos pelo texto livre do perfil. Testes cobrem a identificação e a sequência completa. |
| Campo editável identificado apenas com `contenteditable="true"` | Um editor com o modo HTML `plaintext-only` não era localizado. | Suporte a modos editáveis explícitos, com identificação do campo de composição. Regressão e inserção nativa no navegador aprovadas. Não se afirma que todas as versões do WhatsApp usam esse modo. |
| Presença de lista de conversas oculta contava como sessão pronta | Estado antigo de DOM podia liberar o início antes da interface estar disponível. | A lista precisa estar visível. Regressão de lista oculta aprovada. |
| Grupo/canal podia ser tratado como contato individual | Um grupo com nome parecido com telefone podia passar pela validação de título. | Bloqueio por indicadores explícitos de grupo e pelo identificador da conversa quando disponível. Regressão de grupo nomeado com telefone aprovada. |
| Comparação da conversa dependia apenas do título | Trocar para outra conversa com o mesmo nome podia não ser detectado antes do clique. | Comparação adicional de identificadores comparáveis da conversa. Espaços de identificação diferentes não são comparados sem um mapeamento suportado, evitando novo falso alerta. |
| Construtor de evento de colagem podia existir e falhar | A preparação encerrava antes de tentar a inserção alternativa. | Falha opcional da colagem permite continuar com inserção pelo navegador. Regressão aprovada. |
| Revisão de envio interrompido a partir de outra aba mantinha a aba antiga | A retomada automática podia ficar vinculada a uma aba já fechada. | O painel valida a nova aba do WhatsApp e atualiza o vínculo antes de retomar. Regressão aprovada. |

Também foram atualizados o texto de revisão de envio incerto, a proteção de fórmulas do CSV com espaços iniciais e a identificação visual da versão instalada.

## Requisitos verificados

| Requisito | Evidência obtida | Limite |
| --- | --- | --- |
| TXT com DDI/DDD, deduplicação e linhas inválidas | Testes do parser e da validação de configuração | A existência de uma conta não pode ser determinada só pelo formato do telefone. |
| M1 para contato 1, M2 para 2, M3 para 3, repetindo | Testes unitários e campanha integrada | A distribuição segue a posição original, inclusive ao encontrar número inexistente. |
| Um clique inicia a lista inteira | Campanhas integradas percorridas sem cliques manuais de avanço | A página do WhatsApp e as APIs do Chrome são simuladas nessa suíte. |
| Intervalo configurável e respeitado após envio ou inexistência confirmada | Relógio controlado com intervalos de 120 segundos; despertador separado acionado após 120.017 ms reais | O teste de tempo real valida o despertador da página, não a entrega pelo WhatsApp nem o alarme real do Chrome. |
| Sem recarregar a página entre contatos | Testes proíbem navegação/recarga no caminho da campanha | Não foi executado o pacote completo carregado como extensão neste ambiente. |
| `(nome)` substituído por contato | Campanha integrada com nomes diferentes, nome ausente, acentos, emoji e `$&`; inserção nativa com nome | Nome disponível depende do que a interface mostra. Não há serviço externo para descobrir nomes. |
| Só avançar depois de confirmação | Nova mensagem de saída com tique, comparação por ID, relógio sem tique, resposta de progresso perdida | Os sinais da interface podem mudar. Envio confirmado não significa leitura. |
| Não pular contatos por erro genérico | Busca vazia, falta de conexão e editor indisponível mantêm o contato | Em erro ambíguo após clique, a fila pausa para evitar duplicação. |

## Verificações executadas

- **58 testes unitários, de integração e de regressão:** aprovados.
- **6 verificações em Chromium Headless Shell 158:** aprovadas numa página local controlada, com DOM, seleção de texto, `execCommand`, eventos de ponteiro e construção real de eventos do navegador. Sem substituição desses mecanismos por jsdom.
- **Despertador de 120 segundos reais:** acionamento após **120.017 ms**, sem avanço antecipado observado.
- **`npm audit --prefix qa --json`:** nenhum alerta conhecido nas dependências de teste consultadas. Isso não prova ausência de vulnerabilidades no código ou no navegador.
- **Manifesto, permissões, recursos e sintaxe JavaScript:** verificados.
- **ZIP:** verificado contra os arquivos de execução e a versão 1.2.1 antes da entrega.

A extensão usa apenas `storage`, `alarms` e acesso ao WhatsApp Web. Não foi encontrado servidor, telemetria, código remoto carregado pela extensão ou acesso a cookies/credenciais no pacote de execução. As dependências de teste não são incluídas no ZIP.

## O que ainda impede afirmar “perfeito”

1. **Teste integral no Chrome com uma conta real:** ainda não realizado. Testes com a extensão carregada, Chrome Runtime real, interface atual do WhatsApp e destinatários autorizados são necessários para aceite de produção.
2. **Interface externa:** os seletores e sinais de confirmação dependem do WhatsApp Web. Uma atualização pode exigir nova adaptação.
3. **Identidade disponível:** títulos iguais e IDs não comparáveis não fornecem uma identidade universal. O código combina conferência do telefone, sinais da conversa e cancelamento por interação, mas não recebe uma API oficial de identidade da interface.
4. **Suspensão e conectividade:** fechar o navegador, suspender o computador ou perder conexão pode atrasar ou pausar a campanha.
5. **Uso suportado pelo serviço:** o WhatsApp restringe automação e envio em massa não autorizados. O intervalo entre mensagens não torna a automação oficial nem garante ausência de restrições na conta.

Para uso comercial que exija uma integração oficialmente suportada, deve-se avaliar a Plataforma do WhatsApp Business. Migrar para ela altera a arquitetura e exige requisitos próprios; essa migração não foi feita silenciosamente nesta revisão.

## Pesquisa realizada

A pesquisa na web e no YouTube identificou documentação e vídeos oficiais do Chrome for Developers. As decisões técnicas foram baseadas no código, nas reproduções de falha e na documentação primária. Os vídeos abaixo foram encontrados pelos metadados/descrições indexados; a reprodução/transcrição integral não foi usada como comprovação técnica.

- [Testes de ponta a ponta de extensões — Google](https://developer.chrome.com/docs/extensions/how-to/test/end-to-end-testing)
- [Testes com Puppeteer — Google](https://developer.chrome.com/docs/extensions/how-to/test/puppeteer)
- [Comunicação entre componentes — Google](https://developer.chrome.com/docs/extensions/develop/concepts/messaging)
- [Scripts de conteúdo — Google](https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts)
- [Alarmes — Google](https://developer.chrome.com/docs/extensions/reference/api/alarms)
- [Vídeo oficial: Automate building Chrome Extensions with Antigravity and DevTools MCP](https://www.youtube.com/watch?v=w37SORQg8II)
- [Vídeo oficial: How to use Chrome DevTools for agents with Chrome extensions](https://www.youtube.com/watch?v=GAyfTSsOXMI)
- [Orientação oficial sobre mensagens automáticas ou em massa — WhatsApp](https://faq.whatsapp.com/5957850900902049/?locale=pt_BR)

## Como reproduzir as verificações

Com Node.js 22 ou superior, na raiz do repositório:

```sh
npm --prefix qa ci
node --test extension/test/*.test.mjs qa/*.test.mjs
node qa/realtime-scheduler.mjs
node scripts/check-extension.mjs
```

Para as verificações nativas, instale um Chromium compatível com Playwright e execute:

```sh
node qa/native-browser.mjs
```

Também é possível apontar um executável próprio usando `CHROMIUM_EXECUTABLE_PATH`. O teste nativo serve apenas uma página local e bloqueia requisições externas. Ele não tenta entrar no WhatsApp.
