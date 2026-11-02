# Verificação da sequência automática

Os testes de integração executam os módulos reais `background.js`, `content-main.js`, `core.js` e `whatsapp.js`, conectados a um DOM de teste em jsdom e a implementações simuladas das APIs do Chrome. Não acessam uma conta do WhatsApp nem enviam mensagens reais.

```sh
npm --prefix qa ci
node --test extension/test/*.test.mjs qa/*.test.mjs
node qa/realtime-scheduler.mjs
node scripts/check-extension.mjs
```

Use Node.js 22 ou superior. O teste de tempo real demora dois minutos. Os demais usam um relógio controlado para percorrer campanhas completas com intervalos de 120 segundos.

Cobertura principal:

- Um único início processa toda a lista sem navegação, atualização da página ou cliques de avanço manual.
- As variantes seguem a posição original do contato, inclusive quando um número não cadastrado é identificado.
- Um número não cadastrado no início ou meio da lista é registrado e o próximo contato aguarda o intervalo completo.
- Busca vazia, convite e falha de conexão não permitem pular o contato.
- Mudanças de presença após o clique não interrompem a confirmação.
- Uma mensagem antiga com o mesmo texto/ID não confirma um novo envio.
- Um relógio sem tique não é tratado como envio confirmado e não gera novo clique automático.
- Uma resposta perdida de confirmação não duplica a mensagem ou o avanço.
- A suspensão do processo da extensão preserva o agendamento.
- Um teste separado mede o acionamento real após 120 segundos, sem relógio simulado.
- Editor controlado que rejeita o método antigo de inserção, campo sem `footer`, painel de dados sem identificadores antigos e botão dependente de eventos de ponteiro.
- Mensagens com `(nome)` para contatos diferentes, inclusive nome ausente, acentos, emoji e caracteres como `$&`.
- Falha explícita de editor vazio, sem confirmação falsa de envio, e autorização do texto personalizado no processo da extensão.

Limite de validação: DOM, APIs do Chrome e destinatários são simulados. Esta suíte não comprova compatibilidade de todas as versões do WhatsApp Web. A aceitação em uma sessão real deve conferir três números próprios/autorizados, tempos entre envios, um número não cadastrado e uma desconexão.
