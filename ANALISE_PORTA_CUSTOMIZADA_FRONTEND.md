# Análise da porta customizada para conexão RDP

## 1. Objetivo da integração

Documentar o contrato real do backend que permite ao frontend consultar a porta customizada de um host selecionado e, futuramente, preencher o campo **Host** do modal RDP com:

```text
ts-eqnx.datacore.com.br:${porta_customizada}
```

O host `11225` é somente um exemplo. O frontend deverá usar o `hostid` do objeto associado ao botão **Conectar**.

## 2. Resumo do funcionamento atual

**Confirmado no código:**

- O backend registra `GET /host/:hostid/com-ip`. A aplicação monta essa rota diretamente, sem prefixo `/api` em `index.ts`.
- A rota consulta o host pelo ID e retorna `hostid`, `nome`, `ip` e `porta_customizada`.
- `porta_customizada` não é uma coluna consultada diretamente: o repositório a calcula com base no IP principal associado ao host, por meio de `gerarPortaDoIp`.
- A listagem `GET /hosts/com-ip` retorna objetos com `hostid`, `host` e `ip`; não inclui `porta_customizada`. O ID retornado é uma string.
- A rota `/host/:hostid/metrics` também inclui `porta_customizada` em seu payload, junto com outras métricas.
- O código-fonte do frontend (telas, botão e modal) não está presente neste repositório. Portanto, não é possível confirmar qual estrutura de host ou fluxo de modal está efetivamente em uso.

**Inferido:** para a chamada individual, o valor correto do parâmetro da rota pode ser obtido do `hostid` do objeto do host selecionado, desde que esse seja o mesmo objeto retornado pela listagem ou por uma API que preserve esse identificador.

## 3. Rota existente e contrato HTTP

**Confirmado no código:**

| Item | Contrato |
|---|---|
| Método | `GET` |
| Caminho | `/host/:hostid/com-ip` |
| Exemplo local | `GET http://localhost:3000/host/11225/com-ip` |
| Parâmetro | `hostid`, no caminho; deve ser composto somente por dígitos |
| Query/body | Não são utilizados |
| Sucesso | HTTP `200`, objeto JSON do host |
| Host inexistente ou fora do escopo de sessão `secondary` | HTTP `404`, JSON `{ "erro": "Host não encontrado" }` |
| `hostid` inválido | HTTP `400`, JSON com a propriedade `erro` |
| Autenticação | `requireExperienceOrLegacyJwt(['normal', 'secondary'])` |

O middleware exige um token `Bearer` válido em ambos os caminhos: se não houver conta na sessão, valida o token legado diretamente; se houver conta na sessão, primeiro exige experiência `normal` ou `secondary` e depois também valida o token. Ausência ou token inválido/expirado resulta em `401`; token de origem inválida ou experiência não permitida resulta em `403`. Para sessão `secondary`, o backend também verifica a associação do host a um grupo permitido; host não permitido recebe `404`. O frontend deve seguir o mecanismo de token já usado pela aplicação e não presumir que o cookie de sessão, sozinho, basta.

Resposta de sucesso, conforme o formato definido no repositório:

```json
{
  "hostid": "11225",
  "nome": "RAMSSAP",
  "ip": "10.86.33.165",
  "porta_customizada": "33165"
}
```

Os tipos do objeto são `hostid: string`, `nome: string`, `ip: string | null` e `porta_customizada: string | null`. O exemplo reproduzido acima foi fornecido na solicitação; o código confirma o formato e a regra de cálculo, não a disponibilidade atual desse registro no banco.

## 4. Fluxo interno da consulta da porta customizada

**Confirmado no código:**

1. A rota em `routes/host.routes.ts` lê `req.params.hostid` e chama `parseHostid`, que aceita apenas a expressão `^\d+$` e converte o valor para `bigint`.
2. Para sessão `secondary`, a rota verifica o escopo do host antes da consulta dos dados.
3. A rota chama `ZabbixService.getHostComIp(hostid)`.
4. O serviço converte o ID para string para a chave do cache e delega a consulta a `HostRepository.getHostComIp(hostid)`.
5. O repositório consulta `hosts.hostid`, `hosts.host` como `nome` e o IP da interface principal (`interface.main = 1`). Se não encontrar o host, retorna `null`.
6. Para um host encontrado, o repositório chama `gerarPortaDoIp(r.ip)`. A função retorna `null` se o IP estiver ausente ou não passar pelas verificações implementadas; a rota ainda responde `200` com `porta_customizada: null`.

Trecho representativo do retorno do repositório:

```ts
return {
  hostid: r.hostid.toString(),
  nome: r.nome,
  ip: r.ip ?? null,
  porta_customizada: gerarPortaDoIp(r.ip),
}
```

A regra documentada em `utils/helpers.ts` usa o terceiro e o quarto octetos para formar cinco dígitos, preenchendo com zeros à esquerda conforme necessário. Para `10.86.33.165`, a regra produz `"33165"`.

**Limitação confirmada:** o gerador verifica se há quatro partes separadas por ponto e valida o quarto octeto como inteiro entre `0` e `255`, mas não valida rigorosamente cada octeto do IP nem limita o valor final à faixa padrão de portas TCP. Assim, o frontend não deve presumir que qualquer string retornada é utilizável como porta de conexão.

## 5. Identificação do host selecionado

**Confirmado no código:**

- `GET /hosts/com-ip` produz uma lista de objetos `{ hostid, host, ip }`, com `hostid` serializado como string.
- Na rota individual, o parâmetro correspondente é `:hostid`.
- Portanto, quando a seleção vier dessa lista, a relação de dados a usar é: objeto associado ao botão **Conectar** → propriedade `hostid` → segmento `:hostid` da chamada `GET /host/:hostid/com-ip`.
- Não se deve fixar `11225`, nem usar o nome ou o IP no lugar do ID.
- A lista para experiência `secondary` é filtrada pelos grupos permitidos; a consulta individual repete a checagem de escopo para esse tipo de sessão.

**Pendente de confirmação:** como o frontend atual associa o botão ao objeto selecionado e se telas diferentes recebem os hosts por estruturas distintas. Este repositório não contém os componentes React/JS correspondentes. A propriedade `hostid` está confirmada na resposta da listagem acima, mas a estrutura de cada tela do frontend não pôde ser verificada.

## 6. Formato do campo Host esperado no modal

**Regra solicitada para a futura integração:**

```text
ts-eqnx.datacore.com.br:${porta_customizada}
```

Com a resposta de exemplo:

```text
porta_customizada = "33165"
Host = "ts-eqnx.datacore.com.br:33165"
```

Não inserir literalmente `+porta_customizada`, não incluir o IP do host nesse campo e não substituir o identificador do domínio pelo nome do host. O valor fixo do domínio e a preservação das demais propriedades/comportamentos do modal são requisitos descritos na solicitação; não foram encontrados nos arquivos de frontend deste repositório.

## 7. Fluxo futuro esperado ao clicar em Conectar

O fluxo abaixo é uma recomendação para a implementação futura, não um comportamento já implementado:

1. Obter o objeto do host cujo botão **Conectar** foi acionado.
2. Ler o `hostid` desse objeto e chamar `GET /host/${hostid}/com-ip`, mantendo o mecanismo de autenticação e credenciais de sessão já usado pelo frontend para a API.
3. Verificar o status HTTP e validar `porta_customizada` antes de abrir/preencher o modal ou iniciar o processo de conexão.
4. Se a porta for válida, definir o campo Host como `ts-eqnx.datacore.com.br:${porta_customizada}` e preservar o fluxo e o restante dos dados do modal.
5. Só então permitir a conexão pelo processo já usado pela aplicação.

**Contrato semelhante disponível:** `GET /host/:hostid/metrics` também retorna `porta_customizada` no payload, e já passa por middleware compatível com experiências `normal` e `secondary`. Se a tela já obtiver esse payload, o frontend pode avaliar reutilizá-lo em vez de fazer uma segunda chamada; não foi possível confirmar se isso ocorre na tela do botão **Conectar**.

## 8. Tratamento de erros e dados ausentes

**Confirmado no código:**

- `porta_customizada` pode ser `null`, inclusive quando o host existe, por exemplo se o IP principal estiver ausente ou o cálculo não conseguir produzir o valor.
- `ip` também pode ser `null`.
- Host inexistente e host fora do escopo permitido para sessão `secondary` resultam em `404`.
- ID malformado resulta em `400`.
- Erros de autenticação/autorização podem resultar em `401` ou `403`, conforme o middleware.
- A rota trata exceções lançadas no handler como HTTP `400` e inclui a mensagem em `erro`; falhas de infraestrutura não são diferenciadas nesse `catch`.

**Recomendação para o frontend:** não montar nem enviar uma conexão se `porta_customizada` estiver ausente, nula, vazia, não numérica ou fora de `1..65535`. Exibir um erro compreensível e manter o modal/processo em estado que não permita iniciar a conexão com host incompleto ou incorreto. Tratar os status HTTP sem considerar respostas de erro como sucesso. A validação de faixa é uma precaução do cliente: o helper atual não a aplica explicitamente à porta derivada.

## 9. Arquivos relevantes do backend, com seus caminhos reais

| Arquivo | Papel |
|---|---|
| `routes/host.routes.ts` | Registra `GET /host/:hostid/com-ip`, valida o ID, aplica autenticação/escopo e serializa sucesso/erros. |
| `routes/_helpers.ts` | Implementa `parseHostid`, incluindo a exigência de dígitos. |
| `middlewares/experience.middleware.ts` | Implementa `requireExperienceOrLegacyJwt` e as respostas de experiência/autenticação. |
| `middlewares/auth.middleware.ts` | Valida o token `Bearer` legado. |
| `services/zabbix.service.ts` | Expõe `getHostComIp` com cache e inclui a porta no payload de `/metrics`. |
| `repositories/host.repository.ts` | Consulta o host/IP principal e calcula `porta_customizada`; também define o formato de `GET /hosts/com-ip`. |
| `utils/helpers.ts` | Implementa `gerarPortaDoIp`, que deriva a porta do IP. |
| `index.ts` | Registra `hostRoutes` sem prefixo `/api`; define a porta padrão `3000`. |
| `routes/docs.openapi.ts` | Documenta a rota como `GET /host/:hostid/com-ip`, mas sua descrição menciona apenas o IP e marca autenticação JWT. |
| `rotas.txt` | Lista a rota e o exemplo-base de URL local. |
| `tests/secondary-scope-routes.test.ts` | Contém cenário de teste com `porta_customizada: null` e a consulta de `/host/:hostid/com-ip` em sessão `secondary`. |

## 10. Informações que o frontend precisará para implementar a integração

1. `hostid` do objeto efetivamente selecionado pelo botão **Conectar**; não reutilizar um ID fixo.
2. URL-base/configuração de ambiente da API e eventual proxy que determine se o frontend chama `/host/...` ou um prefixo externo como `/api`.
3. Token `Bearer` válido para a chamada; se a aplicação também mantém uma sessão, preservar os cookies/opções de credenciais que o cliente HTTP já utiliza. A sessão, sozinha, não satisfaz o middleware atual.
4. Campo correto do modal que representa o Host e forma de preencher esse campo sem alterar o processo atual de conexão.
5. Política de UX para erro HTTP, `porta_customizada: null` ou inválida; em todos esses casos, impedir a conexão.
6. Confirmação de se a tela já possui um payload `/host/:hostid/metrics` com a porta e se é apropriado reutilizá-lo.
7. Confirmação do destino fixo `ts-eqnx.datacore.com.br` e da validação de portas desejada. Esses itens são requisitos da solicitação, não valores configurados ou validados pelo backend.

## 11. Dúvidas ou limitações encontradas durante a análise

- **Pendente:** componentes, hooks, serviços HTTP, estado do modal e fluxo real do botão **Conectar** não podem ser inspecionados porque o frontend não está neste repositório.
- **Pendente:** não foi possível confirmar o prefixo de URL ou proxy usado pelo frontend. No Express, a rota é registrada sem `/api`; documentação anterior no repositório menciona caminhos `/api/...`, o que pode representar um proxy ou contexto de outro checkout.
- **Pendente:** confirmar se o frontend usa a sessão por cookie ou token para esta chamada e quais opções CORS/credenciais já são adotadas.
- **Pendente:** a documentação OpenAPI descreve `GET /host/:hostid/com-ip` apenas como consulta de IP e não declara explicitamente o payload `porta_customizada`; o tipo e o campo foram confirmados diretamente na implementação do repositório.
- **Pendente:** o destino `ts-eqnx.datacore.com.br` não foi localizado como configuração deste backend. Ele deve ser confirmado como requisito/configuração do frontend.
- **Pendente:** confirmar o comportamento do sistema de conexão/modal diante de uma porta ausente ou erro de consulta.
- **Inferido a partir de documentação existente, não verificado no código do frontend:** `DIAGNOSTICO_ERRO_ACESSO_NEGADO.md` registra que o fluxo anterior de conexão em `HostGroup.jsx` enviava `hostname`, `ip` e `port` ao endpoint Guacamole e observa uma divergência com o contrato documentado de `connect-full` (`hostname`, `porta`, `email`). Como o fonte frontend não está presente, isso não comprova o fluxo atualmente executado nem deve ser usado como implementação.

## 12. Checklist para a futura implementação e validação

- [ ] Confirmar quais telas exibem o botão **Conectar** e qual objeto fornece os hosts em cada uma.
- [ ] Associar o botão ao objeto selecionado e usar seu `hostid` real.
- [ ] Confirmar URL-base/proxy e autenticação já usados pelo cliente HTTP.
- [ ] Consultar `GET /host/:hostid/com-ip` (ou confirmar que um payload `/metrics` já carregado pode ser reutilizado).
- [ ] Validar resposta HTTP e `porta_customizada` como string numérica válida na faixa `1..65535`.
- [ ] Em resposta `400`, `401`, `403`, `404`, erro de rede ou porta inválida/ausente, informar o usuário e não iniciar a conexão.
- [ ] Montar o campo exatamente como `ts-eqnx.datacore.com.br:${porta_customizada}`.
- [ ] Preservar os demais campos e o comportamento existente do modal e do processo de conexão.
- [ ] Testar hosts distintos para garantir que nenhum ID esteja fixo.
- [ ] Testar porta válida, `null`/ausente, string vazia/inválida e erros HTTP.
- [ ] Confirmar que sessão `secondary` pode consultar somente host permitido, e que o frontend trata o `404` sem iniciar conexão.
