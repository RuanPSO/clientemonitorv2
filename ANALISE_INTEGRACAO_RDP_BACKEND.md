# Análise do backend para integração RDP

**Data da análise:** 29/10/2026  
**Escopo:** contrato do backend principal para o frontend iniciar navegação POST ao portal Guacamole-Lite informado. Nenhum código de aplicação foi alterado.

## Como interpretar as evidências

- **Confirmado no código:** verificado na implementação, configuração versionada ou testes deste repositório.
- **Informado sobre o portal externo:** requisito fornecido para esta análise; o código do servidor do portal não está disponível aqui.
- **Precisa ser validado:** depende do frontend, do ambiente implantado ou do responsável pelo portal.

## 1. Resumo executivo

- **Confirmado no código:** a API Express principal monta `GET /host/:hostid/com-ip` sem prefixo `/api`. A rota consulta o host pelo `hostid` e retorna `hostid`, `nome`, `ip` e `porta_customizada`.
- **Confirmado no código:** a API principal também monta `GET /api/conectado`. Essa rota somente verifica se a URL configurada do portal responde HTTP 200 com conteúdo HTML; ela não cria sessão, não emite token e não retransmite HTML.
- **Confirmado no código:** `porta_customizada` é calculada a partir do terceiro e quarto octetos do IP da interface principal. Não há regra de domínio-base para o `hostname` do portal na API principal.
- **Informado sobre o portal externo:** o navegador deve fazer um POST de navegação diretamente à raiz do portal com `hostname`, `username` e `password`; o portal valida os dados, prepara `window.AUTO_LOGIN` e responde com HTML. O contrato de conteúdo/formato do POST precisa ser confirmado com o portal para que um formulário HTML nativo seja compatível.
- **Conclusão:** para o fluxo informado, a API principal já fornece os dados necessários e não precisa de uma nova rota. O frontend pode obter a porta e enviar o formulário diretamente ao portal, sem encaminhar a senha ao backend principal. Antes da integração, ainda é necessário confirmar o domínio-base, o formato aceito pelo POST externo, a acessibilidade do portal a partir do navegador e o uso de HTTPS.

## 2. Arquitetura e limites de responsabilidade

### API principal

**Confirmado no código:** [index.ts](index.ts) inicia a aplicação Express e monta `conectadoRoutes` e `hostRoutes` diretamente, sem prefixo global `/api`. A rota de host delega a consulta a `ZabbixService.getHostComIp()` em [services/zabbix.service.ts](services/zabbix.service.ts), que usa `HostRepository.getHostComIp()` em [repositories/host.repository.ts](repositories/host.repository.ts).

### Portal RDP informado

**Informado sobre o portal externo:** o serviço na URL `http://10.86.26.18:8410/` é independente. O navegador envia o POST diretamente a ele e recebe o HTML que inicializa o login automático. Não foi encontrada neste repositório a implementação do servidor desse portal; por isso, o seu processamento não pode ser verificado localmente.

### Outro gateway RDP presente neste repositório

**Confirmado no código:** [server.js](server.js) implementa outro processo, iniciado pelo script `start:guacamole` em [package.json](package.json). Esse gateway oferece `POST /api/guacamole/token`, autenticado por bearer estático, recebe JSON com usuário, senha e porta, emite um token e usa o hostname fixo `ts.datacore.com.br`. Ele é distinto da API principal iniciada por `index.ts` e do portal externo indicado nesta análise. Não se deve confundir essa rota com o POST de navegação externa nem usá-la como substituta sem uma decisão explícita de arquitetura.

**Conclusão de responsabilidade:** no fluxo pedido, a API principal fornece os dados do host; o portal externo valida credenciais e inicia a sessão; o navegador envia o formulário e apresenta a página retornada. A API principal não precisa receber senha, criar token RDP ou servir/proxy do HTML.

## 3. Rotas reais identificadas

| Método e caminho | Autenticação / comportamento confirmado | Resultado |
|---|---|---|
| `GET /host/:hostid/com-ip` | Passa por `requireExperienceOrLegacyJwt(['normal', 'secondary'])`. O middleware exige JWT Bearer válido com origem `portal`; quando existe sessão de experiência, ela também precisa ser `normal` ou `secondary`. Na experiência `secondary`, a rota verifica se o host pertence aos grupos permitidos. | Objeto do host, `404` se ausente ou fora do escopo secundário, `400` para erro capturado pela rota. |
| `GET /api/conectado` | Sem middleware de autenticação nesta rota. Faz uma chamada HTTP server-to-server à URL configurada do portal. | `200` com `{"status":"conectado"}` somente se o destino retorna HTTP 200 e `Content-Type` HTML. Ver seção 5 para falhas. |

Os caminhos e a descrição de autenticação também aparecem no catálogo em [routes/docs.openapi.ts](routes/docs.openapi.ts). O comportamento executável dos middlewares e controladores prevalece em caso de divergência documental.

## 4. Contrato real de `GET /host/:hostid/com-ip`

### Parâmetro e validação

**Confirmado no código:** a rota está em `routes/host.routes.ts`, no handler `GET /host/:hostid/com-ip`. `parseHostid()` em [routes/_helpers.ts](routes/_helpers.ts) aceita somente caracteres de dígito (`^\d+$`) e converte o resultado para `BigInt`.

- Não há verificação explícita de intervalo, existência ou valor maior que zero antes da consulta. Zeros e zeros à esquerda passam pela expressão regular; um identificador grande também pode chegar à consulta.
- Erro de conversão/validação capturado pelo handler retorna HTTP `400` com `{ "erro": "<mensagem>" }`.
- Se não houver host, a rota responde HTTP `404` com `{ "erro": "Host não encontrado" }`.
- Para sessão `secondary`, um host fora dos grupos permitidos também resulta em `404` com o mesmo corpo, evitando distinguir host ausente de host não autorizado nesse escopo.
- O `catch` da rota converte qualquer erro capturado, inclusive falha inesperada na consulta, em HTTP `400`. Portanto, `400` não significa necessariamente apenas `hostid` malformado.

### Consulta, tipos e resposta

**Confirmado no código:** `HostRepository.getHostComIp()` executa uma consulta parametrizada com `prisma.$queryRaw` às tabelas `hosts` e `interface`. Seleciona `h.hostid`, `h.host` como `nome` e `i.ip`; a junção é pela interface principal (`i.main = 1`) e é `LEFT JOIN`. O schema Prisma define `hosts.hostid` como `BigInt`, `hosts.host` como texto e a interface como `Renamedinterface`, com `hostid`, `main` e `ip`; a tabela foi renomeada no schema por `interface` ser um identificador reservado.

O tipo de retorno declarado pelo repositório e serializado pela rota é:

```json
{
  "hostid": "11225",
  "nome": "RAMSSAP",
  "ip": "10.86.33.165",
  "porta_customizada": "33165"
}
```

O exemplo acima foi fornecido na solicitação; sua forma e o cálculo da porta são compatíveis com o código, mas não representam uma consulta a dados reais feita durante esta análise. `hostid` é convertido de `BigInt` para string. `nome` vem do campo `hosts.host`. `ip` e `porta_customizada` podem ser `null`, pois a junção é externa e a função retorna nulo quando não consegue calcular uma porta.

### Cálculo de `porta_customizada`

**Confirmado no código:** `gerarPortaDoIp()` em [utils/helpers.ts](utils/helpers.ts) usa o terceiro e o quarto segmentos do IP: mantém o terceiro segmento quando cabe no espaço disponível, limita-o aos últimos dígitos se necessário e completa o quarto segmento com zeros à esquerda para formar uma string de cinco dígitos. Assim, `10.86.33.165` resulta em `"33165"`.

Essa função não constitui uma validação completa de IPv4: verifica que há quatro segmentos e que o quarto pode ser convertido em inteiro entre 0 e 255, mas não valida os demais segmentos como octetos IPv4. Em IP nulo, com estrutura diferente de quatro segmentos ou quarto segmento inválido, a porta é `null`. O frontend deve tratar `ip`/`porta_customizada` nulos como ausência de destino, não montar `hostname` com `"null"` nem tentar adivinhar uma porta.

Os testes existentes em [tests/secondary-scope-routes.test.ts](tests/secondary-scope-routes.test.ts) cobrem o acesso autorizado e a restrição de escopo da rota, mas não verificam diretamente o formato completo da resposta nem os casos de validação do cálculo da porta.

## 5. Contrato real de `GET /api/conectado`

**Confirmado no código:** a implementação está em [routes/conectado.routes.ts](routes/conectado.routes.ts). A URL alvo é `GUACAMOLE_BASE_URL`, após `trim()`, ou `http://10.86.26.18:8410/` como padrão. A chamada usa `GET`, não segue redirecionamentos e tem timeout configurável por `GUACAMOLE_TIMEOUT_MS` (padrão de 10.000 ms). O teste em [tests/conectado.routes.test.ts](tests/conectado.routes.test.ts) confirma que a rota consulta o endereço configurado sem encaminhar cookie.

| Condição observada | Resposta da API |
|---|---|
| Portal responde HTTP `200` e `Content-Type` contém `text/html` | HTTP `200`, `{"status":"conectado"}` |
| Timeout configurado inválido ou não positivo | HTTP `500`, `{"error":"Configuração interna do serviço inválida."}` |
| Timeout da requisição | HTTP `504`, `{"error":"Tempo limite excedido ao consultar o serviço remoto."}` |
| Falha de rede | HTTP `502`, `{"error":"Falha ao consultar o serviço remoto."}` |
| Portal responde `401`/`403`, outro status (incluindo redirecionamento) ou conteúdo não HTML | HTTP `502`, com mensagem de erro correspondente no corpo |

Essa resposta confirma apenas o acesso do processo servidor à URL de verificação. A rota não envia credenciais, não chama a rota de emissão de token do gateway separado, não cria sessão RDP e não prova que o navegador do usuário consegue acessar o portal.

## 6. Origem e montagem do destino RDP (`hostname`)

- **Confirmado no código:** a API principal entrega `porta_customizada`, não entrega um `hostname` RDP completo e não contém uma regra para acrescentar `ts-eqnx.datacore.com.br` ou outro domínio-base.
- **Informado na solicitação:** foi sugerido o formato `ts-eqnx.datacore.com.br:<porta_customizada>`.
- **Precisa ser validado:** domínio-base, resolução DNS, compatibilidade do portal com `hostname` contendo `host:porta`, e se a porta calculada corresponde ao destino efetivamente acessível. Não há regra local que confirme que `ts-eqnx.datacore.com.br` é universal ou correto para todos os hosts/ambientes.
- **Distinção importante:** o processo separado `server.js` fixa `RDP_HOSTNAME = 'ts.datacore.com.br'` e recebe a porta separadamente. Isso documenta somente o contrato daquele gateway; não valida nem substitui o formato pedido para o POST do portal externo.

O frontend só deve montar o valor final após confirmação do domínio-base e de que o portal interpreta o campo `hostname` no formato `host:porta`. Até essa validação, registrar a regra como pendente; não derivar o domínio de `nome`, `ip` ou de uma constante do gateway separado.

## 7. Integração com o portal externo

### Informado sobre o portal (não verificável neste repositório)

O contrato informado é um POST de navegação diretamente à raiz `/` do portal com `hostname`, `username` e `password`. O portal valida os campos, gera internamente o token criptografado e retorna HTML com `window.AUTO_LOGIN`, usado pelo JavaScript do próprio portal para iniciar a conexão.

Nesse fluxo, o navegador pode enviar um formulário HTML nativo e navegar para a resposta do portal. A senha deve ser mantida no frontend/navegador e enviada somente ao portal. O backend principal não precisa receber nem retransmitir as credenciais ou a resposta HTML.

### O que pode ser confirmado localmente

- A API principal possui uma verificação de disponibilidade (`GET /api/conectado`), não um endpoint que implementa o contrato acima.
- Há um gateway separado em `server.js` com contrato próprio, que recebe JSON em `POST /api/guacamole/token`; ele não é a raiz do portal e não comprova o contrato do serviço na porta 8410.
- A implementação externa de POST na raiz, seus campos, parser de corpo, regras de validação, geração do HTML e inicialização de sessão não estão disponíveis neste código.

### Pendências de compatibilidade

**Precisa ser validado com o responsável pelo portal:** um formulário POST nativo do navegador envia normalmente `application/x-www-form-urlencoded` (ou `multipart/form-data` se configurado). Não se presume que o portal aceite esses formatos, nem que aceite JSON. Confirmar exatamente o método, caminho, `Content-Type`, nomes dos campos, limites e resposta esperada. Também confirmar se o POST pode ser iniciado da origem do frontend sem bloqueio por política CSP ou outra regra do portal.

## 8. Segurança e conectividade

- **Exposição de senha:** no fluxo direto, a senha viaja do navegador ao portal, sem passar pelo backend principal. Não enviar a senha à API principal, não incluí-la em URL/query string e não registrá-la em logs. A API principal registra método, caminho, status e duração via Morgan; não registra o corpo HTTP por esse middleware. O formulário e qualquer código do frontend também devem evitar logs e persistência de credenciais.
- **HTTP/HTTPS:** a URL informada e o padrão atualmente configurado para a verificação são `http://10.86.26.18:8410/`. HTTP não protege usuário/senha em trânsito contra observação ou alteração na rede. Antes de usar credenciais reais, validar e preferir HTTPS até o portal, com certificado válido; também confirmar que nenhuma terminação TLS insegura expõe o tráfego.
- **Acesso do navegador:** a URL informada usa um endereço privado. O computador do usuário precisa ter rota de rede, VPN e DNS apropriados para alcançá-la. Uma consulta bem-sucedida feita pelo servidor principal não garante essa conectividade do cliente.
- **CORS e navegação:** a navegação por formulário HTML é diferente de `fetch`/XHR e a política CORS não autoriza por si só ler a resposta do portal por JavaScript. O fluxo proposto deve ser testado como navegação real; políticas CSP do frontend e restrições do portal ainda podem impedir o envio ou a apresentação.
- **Configuração:** `GUACAMOLE_BASE_URL` em `.env.example` e `routes/conectado.routes.ts` configura somente o alvo da verificação server-to-server. Não há configuração de frontend neste repositório para o destino da navegação. Se a URL variar entre ambientes, configurá-la no frontend/deploy correspondente sem criar uma rota nova apenas para retransmitir ou descobrir a URL.
- **Dados secretos:** a chave de criptografia do gateway separado não é necessária para o fluxo direto e não deve ser copiada para o frontend ou para esta integração. Nenhum valor secreto de configuração foi reproduzido neste relatório.

## 9. Lacunas e riscos

1. **Domínio-base não definido na API principal:** o formato com `ts-eqnx.datacore.com.br` não é confirmado por código/configuração da rota de host.
2. **Contrato HTTP do portal externo pendente:** falta confirmar se o POST nativo aceita `application/x-www-form-urlencoded`, o caminho `/`, nomes/validação dos campos e o formato da resposta.
3. **Transporte HTTP:** o endereço informado é HTTP; credenciais reais não devem ser enviadas sem transporte protegido.
4. **Acessibilidade por cliente:** rede do backend e rede do navegador são diferentes; o usuário pode não alcançar o IP privado.
5. **Dados incompletos:** IP ou porta podem ser nulos; a regra de geração de porta não valida todos os octetos do IPv4.
6. **Erros da consulta do host:** a rota transforma erros capturados, inclusive indisponibilidade inesperada da consulta, em `400`, o que pode dificultar a distinção de falhas de infraestrutura.
7. **Possível confusão de serviços:** o gateway local `server.js` emite tokens e fixa outro hostname. Não é o portal externo e não deve ser misturado ao contrato de navegação descrito.
8. **Cobertura de contrato:** os testes da rota `/api/conectado` cobrem disponibilidade, erro, timeout e ausência de POST. Não foi encontrado teste dedicado que fixe os tipos/campos de sucesso de `/host/:hostid/com-ip`.

## 10. Conclusão: mudanças necessárias ou não no backend principal

**Não é necessária uma rota adicional no backend principal para o fluxo descrito**, desde que:

1. `GET /host/:hostid/com-ip` retorne uma porta não nula para o host escolhido;
2. o frontend obtenha/valide o domínio-base e componha `hostname` somente após confirmação do contrato;
3. o portal aceite o formato de POST enviado por um formulário nativo;
4. o navegador do usuário consiga acessar o portal por uma conexão protegida.

O backend já entrega os dados de host necessários e `GET /api/conectado` pode ser usado como diagnóstico opcional de disponibilidade do lado servidor, não como etapa de criação da sessão. O POST e a senha devem seguir diretamente do navegador ao portal. Não adicionar rota de geração de token, proxy de HTML ou encaminhamento de credenciais sem uma necessidade de arquitetura comprovada e revisada.

## 11. Plano de validação e critérios de aceite

1. **Confirmar o contrato do portal com seu responsável:** método e caminho, campos, `Content-Type` aceito por formulário HTML nativo, validação, resposta HTML e uso de `window.AUTO_LOGIN`. **Aceite:** navegador envia o formato acordado e recebe a página de conexão sem proxy da API principal.
2. **Confirmar o endereço de destino:** domínio-base, composição com porta e resolução/rota a partir das máquinas clientes. **Aceite:** o `hostname` validado alcança o host e a porta corretos; a aplicação não presume `ts-eqnx...` a partir do backend.
3. **Validar transporte e acesso de rede:** usar HTTPS com certificado válido e testar a partir de uma estação representativa, incluindo VPN/rede necessária. **Aceite:** a conexão e o POST chegam ao portal com TLS; acesso do backend não é usado como substituto do teste no navegador.
4. **Testar consulta ao host:** com sessão/JWT autorizado, chamar `GET /host/:hostid/com-ip` para host com interface principal, host sem IP e host inexistente, e verificar autorização de host na experiência secundária. **Aceite:** campos/tipos correspondem ao contrato; ausência de IP/porta é tratada explicitamente; respostas `400`/`404` são apresentadas sem tentar conexão com destino incompleto.
5. **Testar disponibilidade separadamente:** chamar `GET /api/conectado` com portal acessível e em falha/timeout. **Aceite:** sucesso é interpretado apenas como disponibilidade HTTP do lado servidor, sem iniciar sessão ou liberar a tentativa como garantidamente acessível no navegador.
6. **Verificar privacidade operacional:** inspecionar logs do frontend, backend, proxy e portal durante um teste controlado. **Aceite:** senha não aparece em URL, logs ou backend principal; a API principal não recebe o POST de credenciais nem o HTML do portal.
7. **Regressão:** executar `npm test` e `npm run typecheck` no repositório após qualquer futura mudança de implementação. Este relatório é somente documental, portanto esses comandos não foram necessários para sua criação.
