# Diagnóstico do backend: login de página dupla

## Resumo executivo

O backend é uma API Node.js/TypeScript com Express. A autenticação Microsoft Entra ID usa MSAL Node, OAuth 2.0 Authorization Code, cookie e sessão `express-session`. O callback atual autentica a conta e sempre redireciona para `/dashboard`; a consulta do perfil ocorre depois, em `GET /auth/me`.

O atributo `companyName` já é solicitado no perfil Microsoft Graph (`/me?$select=...companyName`) e normalizado para a sessão. O escopo MSAL já contém `User.Read`, permissão delegada usada para ler o perfil do próprio usuário. Não há evidência no código de que o ID token seja consultado para obter `companyName`.

Há também uma configuração e middleware de acesso por empresa/cargo no workspace, com níveis `total`, `hosts` e `deny`. Eles não equivalem à regra de página normal/secundária: a configuração tem outro formato, libera `hosts` pelo curinga (inclusive para identidade sem empresa) e o middleware não está conectado às rotas de aplicação. Essa configuração está presente como arquivo local não versionado no estado do workspace; não se deve presumir que já esteja implantada.

**Recomendação:** usar a resposta autenticada do Graph como fonte do `companyName`; normalizar e avaliar a lista JSON exclusivamente no backend; gravar o resultado imutável da decisão na sessão autenticada; redirecionar a partir do callback para uma rota frontend fixa apropriada e incluir a mesma decisão em `/auth/me`. Criar middleware de autorização por experiência para os endpoints protegidos, sem confiar em parâmetro, cabeçalho ou estado enviado pelo cliente. Se o Graph não puder ser consultado, falhar explicitamente e não conceder a experiência normal. Se a propriedade vier ausente ou vazia em uma resposta Graph válida, encaminhar à experiência secundária conforme a regra de negócio.

O front-end e suas rotas não estão neste repositório. Os caminhos finais da página secundária e a compatibilidade com a autenticação JWT legada precisam ser confirmados antes da implementação.

## Arquitetura atual (com arquivos/linhas citados)

### Stack, pastas e execução

- Node.js + TypeScript (ES modules), Express 5, Prisma/PostgreSQL e integrações com Microsoft Graph; dependências declaradas em [`package.json`](package.json#L6-L10) e [`package.json`](package.json#L34-L48).
- A entrada é [`index.ts`](index.ts#L10-L30): configura middlewares, CORS, sessão, rotas e tratamento de erros. `npm run dev` executa `tsx watch index.ts`; `npm start` inicia `index.ts` via `tsx`, conforme [`package.json`](package.json#L6-L10).
- Rotas ficam em `routes/`; configuração em `config/`; middleware em `middlewares/`; integrações em `services/`; normalização do perfil em `mappers/`; testes em `tests/`. O projeto contém documentação estática em `public/`, mas não contém a aplicação React nem as páginas do portal. O README afirma que este repositório contém somente o backend e descreve a integração frontend esperada em [`README.md`](README.md#L28-L28) e [`README.md`](README.md#L63-L69).
- A API monta as rotas JWT, as rotas Entra em `/auth`, as rotas administrativas e as rotas de aplicação em [`index.ts`](index.ts#L81-L90). O callback configurado é `/auth/callback`, validado na inicialização em [`config/env.ts`](config/env.ts#L13-L26).
- A sessão usa cookie `HttpOnly`, com `SameSite` configurável e `Secure` em produção em [`config/session.ts`](config/session.ts#L3-L28). A inicialização usa o `MemoryStore` padrão do `express-session`, que não é apropriado para produção com múltiplas instâncias ou reinícios; isso também é documentado em [`README.md`](README.md#L96-L96).

### Autenticação Microsoft atual: passo a passo

1. `GET /auth/login` gera um `state` aleatório, salva-o na sessão e redireciona para a URL de autorização MSAL. Veja [`routes/entra-auth.routes.ts`](routes/entra-auth.routes.ts#L53-L64) e [`config/msal.ts`](config/msal.ts#L50-L56).
2. O MSAL solicita `User.Read`, `GroupMember.Read.All` e `AuditLog.Read.All`; o cache MSAL é serializado na sessão. Veja [`config/msal.ts`](config/msal.ts#L10-L10) e [`config/msal.ts`](config/msal.ts#L11-L48).
3. `GET /auth/callback` rejeita erros Entra, ausência de `code` e `state` ausente/inválido. Com o código válido, troca-o por tokens via `acquireTokenByCode`; o callback atual exige uma conta, regenera a sessão, preserva o cache MSAL, salva a conta e redireciona sempre para `${FRONTEND_URL}/dashboard`. Veja [`routes/entra-auth.routes.ts`](routes/entra-auth.routes.ts#L66-L107).
4. O navegador chama `GET /auth/me` com o cookie. `requireMicrosoftAccount` exige uma conta na sessão; a rota obtém token silenciosamente, consulta perfil e grupos no Graph, normaliza o perfil, guarda usuário, empresa e cargo na sessão e responde `{ user, groups, clientIp, source }`. Veja [`middlewares/entra-auth.middleware.ts`](middlewares/entra-auth.middleware.ts#L5-L12), [`routes/entra-auth.routes.ts`](routes/entra-auth.routes.ts#L123-L154) e [`services/graph.ts`](services/graph.ts#L47-L60).
5. `GET /auth/silent` tenta adquirir token silenciosamente. `GET /auth/logout` destrói a sessão, limpa o cookie e redireciona ao logout Microsoft, conforme [`routes/entra-auth.routes.ts`](routes/entra-auth.routes.ts#L110-L121) e [`routes/entra-auth.routes.ts`](routes/entra-auth.routes.ts#L159-L179).

O middleware HTTP global registra o caminho sem query string; a configuração de sessão é instalada antes das rotas em [`index.ts`](index.ts#L54-L66). Há testes do callback, `/auth/me`, ausência de sessão e logout em [`tests/entra-routes.test.ts`](tests/entra-routes.test.ts).

### Autenticação paralela já existente

Além do fluxo Entra, existem login por senha e JWT. `POST /login` emite um token que atualmente não inclui `companyName`; `validarToken` valida assinatura e `origem === 'portal'`, sem conhecer uma sessão Entra. Veja [`routes/auth.routes.ts`](routes/auth.routes.ts#L51-L91) e [`middlewares/auth.middleware.ts`](middlewares/auth.middleware.ts#L18-L65). Muitas rotas de aplicação usam esse JWT (por exemplo, [`routes/host.routes.ts`](routes/host.routes.ts#L4-L14)).

Assim, a política de página dupla não deve ser aplicada apenas ao middleware Entra sem decidir o que ocorre com clientes JWT existentes; do contrário, o mesmo recurso pode continuar acessível por uma rota alternativa autenticada por JWT.

### Configuração de acesso já existente no workspace

[`config/access-rules.ts`](config/access-rules.ts#L7-L36) define níveis `total`, `hosts` e `deny`, regras por empresa/cargo e curinga. A leitura e validação acontecem sincronamente na importação do módulo; um erro é registrado e resulta em listas vazias, bloqueando acesso conforme [`config/access-rules.ts`](config/access-rules.ts#L69-L140). O formato presente em [`config/access-rules.json`](config/access-rules.json#L1-L15) é `liberados`/`semPermissao`, não o formato `companies` proposto para a decisão de página.

O middleware [`middlewares/access-control.middleware.ts`](middlewares/access-control.middleware.ts#L6-L27) calcula níveis de acesso, mas uma busca no workspace não encontrou chamadas a `requireAccessLevel` nas rotas. Além disso, as regras de curinga atuais retornam `hosts` para empresa desconhecida ou vazia, como também documentado em [`tests/access-rules.test.ts`](tests/access-rules.test.ts#L5-L13). Portanto, não se deve reutilizar essa regra como decisão da experiência sem uma mudança explícita de contrato e de política. Os arquivos `config/access-rules.ts`, `config/access-rules.json` e `middlewares/access-control.middleware.ts` constavam como não versionados no estado local examinado.

## Como obter o companyName (opções e recomendação)

### Opção recomendada: Microsoft Graph delegado

O código já solicita `companyName` em `GET https://graph.microsoft.com/v1.0/me` por meio de `$select` em [`services/graph.ts`](services/graph.ts#L47-L56). O perfil é tipado e normalizado em [`mappers/userMapper.ts`](mappers/userMapper.ts#L1-L35); quando `companyName` é `null` ou ausente, o campo normalizado vira string vazia.

- **Permissão:** `User.Read` delegada é o escopo mínimo já listado em [`config/msal.ts`](config/msal.ts#L10-L10) para obter o perfil do usuário autenticado por `/me`. O valor exato depende de o atributo estar preenchido e visível para o usuário/tenant. Não ampliar a permissão para `Directory.Read.All` sem necessidade comprovada.
- **Vantagens:** já está implementado, consulta o perfil atual no diretório e não depende de configurar uma claim adicional no token.
- **Desvantagens:** envolve uma chamada remota no fluxo de login, pode falhar por rede/Graph/consentimento e acrescenta latência; a informação pode mudar enquanto a sessão está ativa. Atualmente o endpoint `/auth/me` também consulta grupos em paralelo e uma falha no Graph gera erro para a requisição.
- **Tratamento recomendado:** resposta Graph válida com propriedade vazia => experiência secundária; falha ao consultar Graph ou obter token => erro explícito (por exemplo, `502`/`503`), sem decidir como se o valor estivesse vazio e sem conceder a página normal. Registrar o erro sem tokens nem payload integral.

### Opção alternativa: claim do token

O callback recebe um `AccountInfo` e utiliza a conta, mas não lê nem persiste `idTokenClaims`; não há configuração de claim `companyName` no projeto. Veja [`routes/entra-auth.routes.ts`](routes/entra-auth.routes.ts#L86-L103) e [`config/msal.ts`](config/msal.ts#L59-L68).

- Uma claim só é opção se o registro de aplicativo/tenant efetivamente emitir e o backend validar essa claim como dado do usuário. Não presumir que `companyName` esteja presente por padrão ou seja uma optional claim padrão configurável; validar um token real de teste e o mecanismo de emissão do tenant (claim mapping/extensão, se aplicável).
- **Vantagens:** pode evitar uma chamada de perfil separada e permitir decidir no callback com os dados validados do token.
- **Desvantagens:** configuração e governança adicionais no Entra, dados possivelmente desatualizados no token, formatos/nomes de claim dependentes do tenant e risco de confiar em uma claim que não foi validada.
- Se escolhida, manter validação criptográfica/audience/issuer/tenant via MSAL e tratar claim ausente como secundária. Não aceitar valor recebido do browser.

**Conclusão:** continuar com Graph é o caminho de menor mudança e já se alinha ao código. Revisar se o consentimento já existente para `User.Read` está concedido no tenant alvo. Não há evidência de necessidade de permissões adicionais para a regra descrita.

## Desenho da solução proposta (fluxo em texto ou diagrama mermaid)

```mermaid
sequenceDiagram
    participant B as Browser / Frontend
    participant A as API Express
    participant E as Microsoft Entra ID
    participant G as Microsoft Graph
    participant C as JSON de empresas

    B->>A: GET /auth/login
    A->>A: Salva OAuth state na sessão
    A->>E: Redirect Authorization Code
    E->>A: GET /auth/callback?code&state
    A->>A: Valida state e troca code via MSAL
    A->>G: GET /me?$select=companyName (User.Read)
    G-->>A: Perfil do usuário autenticado
    A->>C: Compara empresa normalizada com allow-list
    A->>A: Regenera/salva sessão + experience
    A-->>B: Redirect para rota frontend fixa da experiência
    B->>A: GET /auth/me (cookie; credentials incluído)
    A-->>B: user + experience
    B->>A: Endpoint protegido
    A->>A: Middleware verifica experience da sessão
```

**Ponto de integração recomendado:** concluir a consulta Graph de perfil e o cálculo no callback, após validar a resposta de autenticação e antes do redirect final. Salvar `companyName` normalizado e `experience` na sessão recém-regenerada. Isso evita que a página normal seja aberta antes de o front-end carregar `/auth/me` e disponibiliza a decisão para o middleware desde a primeira requisição subsequente. A página secundária deve ter rota conhecida no frontend; o backend não pode confirmar sua existência neste repositório.

`GET /auth/me` continua sendo a fonte de perfil para o frontend e deve retornar a decisão persistida (não recalcular a partir de um campo enviado pelo cliente). Criar middleware server-side, por exemplo `requireExperience('normal')` / `requireExperience('secondary')`, para os endpoints de cada página. As operações comuns podem ter uma terceira política explicitamente compartilhada.

Em erro de Graph durante callback, não completar o redirecionamento como se a empresa estivesse vazia: retornar erro não-2xx com log seguro e permitir retry/login. Em resposta válida sem atributo, gravar `companyName: null` (ou vazio normalizado) e `experience: 'secondary'`.

## Formato do JSON sugerido

Manter a lista da decisão de experiência separada do `access-rules.json` existente, pois os propósitos e contratos são diferentes. Exemplo para `config/authorized-companies.json`:

```json
{
  "companies": [
    {
      "companyname": "datacore"
    }
  ]
}
```

Validação sugerida na inicialização:

- O documento deve ser um objeto simples contendo `companies` como array.
- Cada item deve ser objeto com `companyname` string não vazia após `trim()`. Rejeitar nulos, números, strings no lugar de objetos, entradas vazias e propriedades faltantes.
- Normalizar valores de ambos os lados com `trim().toLocaleLowerCase('en-US')` (ou `trim().toLowerCase()` para regra independente de localidade) antes da comparação exata. Não usar substring, prefixo, curingas nem `includes` sobre o texto bruto.
- JSON ausente ou inválido deve impedir a inicialização com erro explícito por padrão. Nunca interpretar arquivo inválido como lista vazia e liberar a experiência normal por fallback. Se o negócio preferir disponibilidade secundária durante a falha, isso precisa ser uma decisão explícita e observável; não é equivalente a configuração carregada corretamente.
- Carregar uma vez na inicialização e manter em memória é suficiente para uma pequena allow-list e oferece comportamento determinístico. Alterações no arquivo exigem reinício. Se houver requisito real de atualização sem reinício, implementar recarga atômica, validação completa antes de substituir o cache e manter configuração válida anterior em caso de falha; evitar leitura síncrona por requisição.
- O arquivo não deve conter segredos. Definir claramente se será versionado/configurado por ambiente e garantir que o mesmo caminho exista na imagem/distribuição em produção.

## Contrato com o frontend (campos/rotas que o backend expõe)

### Contrato atual

- `GET /auth/login`: inicia o fluxo Microsoft e responde com redirect.
- `GET /auth/callback`: recebe o retorno Entra e atualmente redireciona sempre para `${FRONTEND_URL}/dashboard`.
- `GET /auth/me`: exige cookie/sessão e retorna `{ user, groups, clientIp, source }`, com `user.companyName` já normalizado. Sem sessão, retorna `401 { "needsLogin": true }`. O contrato atual está descrito em [`README.md`](README.md#L76-L80) e implementado em [`routes/entra-auth.routes.ts`](routes/entra-auth.routes.ts#L123-L154).
- `GET /auth/logout`: encerra a sessão e inicia logout do Entra.

### Contrato proposto

Adicionar `experience` calculado pelo backend ao resultado de `/auth/me`, por exemplo:

```json
{
  "user": {
    "companyName": "Datacore"
  },
  "experience": "normal",
  "groups": [],
  "clientIp": "203.0.113.10",
  "source": "graph"
}
```

Valores permitidos: `"normal"` ou `"secondary"`. A resposta deve continuar sem incluir access token, refresh token, cookie, regras privadas completas ou dados desnecessários do perfil. Se útil, `companyName` pode permanecer no `user` como hoje; a interface decide qual página renderizar usando exclusivamente `experience`.

O callback pode redirecionar para rotas fixas do frontend (`/dashboard` e a rota secundária acordada) usando `FRONTEND_URL` como origem; nunca aceitar um URL de destino fornecido pelo browser sem validação. O frontend deve consultar `/auth/me` com `credentials: 'include'` e renderizar/confirmar a mesma experiência. A lista de empresas autorizadas não deve ser enviada ao frontend.

Não é necessário criar um endpoint público adicional se `/auth/me` já for carregado no início da aplicação. Se o frontend precisar de uma resposta mínima e independente dos grupos, considerar endpoint autenticado de contexto (`GET /auth/experience` ou equivalente) apenas depois de medir o impacto da chamada atual de grupos.

## Arquivos a criar/alterar

| Arquivo | Ação provável | Motivo |
| --- | --- | --- |
| `config/authorized-companies.json` | Criar | Allow-list específica da experiência normal, separada das permissões funcionais existentes. |
| `config/authorized-companies.ts` | Criar | Carregamento, validação estrita, normalização e função pura de classificação. |
| `routes/entra-auth.routes.ts` | Alterar | Resolver Graph no callback, persistir `companyName`/`experience` na sessão, redirecionar de acordo com valor calculado e expor `experience` em `/auth/me`. |
| `types/express-session.d.ts` (ou tipos de sessão atuais) | Alterar | Tipar `experience` e o tipo normalizado do perfil na sessão. A tipagem de sessão hoje está declarada em [`middlewares/auth.middleware.ts`](middlewares/auth.middleware.ts#L31-L45). |
| `middlewares/experience.middleware.ts` | Criar | Autorizar/recusar, no servidor, acesso conforme experiência guardada na sessão; exigir identidade e classificação carregada. |
| `index.ts` e `routes/*.routes.ts` | Alterar | Aplicar middleware nos endpoints que alimentam cada experiência e manter rota de login, `/auth/me` e logout acessíveis conforme necessário. Não proteger somente a tela/SPA. |
| `tests/authorized-companies.test.ts` | Criar | Cobrir validação JSON, normalização, allow-list e classificação de nulo/vazio. |
| `tests/entra-routes.test.ts` | Alterar | Testar redirect pós-login, dados de `/auth/me`, sessão e erros de Graph. O arquivo já testa fluxo Entra. |
| Testes de rotas protegidas | Criar/alterar | Demonstrar bloqueio de URL/API cruzada para cada experiência e preservar endpoints compartilhados. |
| Frontend fora deste repositório | Alterar em repositório separado | Criar a rota secundária, tratar o redirect e ler `experience` de `/auth/me`. A localização não pôde ser identificada aqui. |
| `README.md` e `rotas.txt` | Atualizar | Documentar novo contrato, comportamento de redirect, configuração e implantação do JSON. |

Os arquivos acima são uma proposta; nenhum deles foi alterado para este diagnóstico.

## Riscos e casos de borda

- **Empresa ausente/vazia:** classificar como `secondary`, sem exceção nem fallback para normal. `normalizeUserProfile` já transforma nulo/ausente em `''`.
- **Caixa e espaços:** `Datacore`, `datacore` e valores com espaços externos devem resultar na mesma comparação após normalização.
- **JSON ausente, inválido ou estrutura incorreta:** falhar durante startup com erro legível; não aceitar uma allow-list parcial ou configuração silenciosamente ignorada.
- **Graph indisponível ou sem consentimento:** não confundir indisponibilidade com `companyName` vazio; retornar falha explícita no login e não abrir a experiência normal. Confirmar UX de retry.
- **Sessão já ativa:** hoje `/auth/login` sempre inicia autorização com `prompt=select_account`, mas a sessão do backend pode manter perfil/decisão anteriores. Em reautenticação, regenerar sessão (já ocorre no callback), substituir perfil/empresa/experiência de forma atômica e invalidar valores antigos antes de redirecionar.
- **Empresa alterada no diretório enquanto sessão está ativa:** a decisão armazenada no callback permanece válida até novo login/expiração; decidir TTL ou revalidação periódica caso a revogação precise ser rápida. Não recalcular página como autorização só no navegador.
- **Múltiplos tenants:** `AZURE_TENANT_ID` atual aponta uma autoridade configurada; caso o aplicativo venha a aceitar múltiplos tenants, validar `tid`/issuer e definir se a mesma empresa em tenants distintos tem o mesmo tratamento. Não identificar tenant somente pelo `companyName`.
- **Saída/login em outra conta:** logout destrói a sessão local; testar retorno de logout e nova conta para garantir que perfil e experiência não sobrevivam à sessão.
- **Rotas estáticas e APIs:** esconder botões ou trocar rota SPA não protege API. O frontend pode ter assets públicos, mas cada API deve aplicar a regra no servidor.
- **Autenticação JWT paralela:** decidir se as páginas novas aceitam JWT, se a experiência é exclusiva a Entra ou se o usuário JWT precisa de uma fonte de empresa e política equivalente. O token atual de login não inclui `companyName`.
- **Mudança da allow-list em produção:** cache em memória implica reinicialização para atualização; em cluster, coordenar reinício/deploy de todas as instâncias.
- **Falha parcial do perfil e grupos:** `/auth/me` atual depende do resultado de perfil e grupos em `Promise.all`; a falha de grupos também impede resposta integral. Considerar separar o carregamento necessário para classificação do carregamento opcional de grupos, sem mascarar erros.
- **Logs e dados pessoais:** o perfil completo normalizado/`raw` é registrado em debug em [`routes/entra-auth.routes.ts`](routes/entra-auth.routes.ts#L142-L146), e o payload do Graph também em [`services/graph.ts`](services/graph.ts#L58-L60). Evitar logar perfil bruto ou tokens; para auditoria, preferir identificador estável mínimo, tenant, decisão, horário e resultado da autorização.

### Estimativa de esforço

- Backend (carregador JSON, decisão, callback, sessão, contrato e middleware): **1 a 2 dias** incluindo testes focados.
- Integração frontend e rotas da segunda página: **0,5 a 2 dias**, estimativa dependente do framework e da disponibilidade do outro repositório.
- Endurecimento/compatibilidade da autenticação JWT e implantação da configuração/store de sessão: **0,5 a 2 dias adicionais**, conforme a política de acesso escolhida e ambiente.

Estimativas assumem que Graph `User.Read` já tem consentimento e que a página secundária não exige novo layout/funcionalidade complexa.

## Segurança

1. **Fonte confiável:** usar somente `companyName` retornado pelo Graph com access token obtido pelo MSAL na sessão autenticada (ou claim de token validado se essa opção for formalmente escolhida). Não aceitar `companyName`, `experience`, rota-alvo, tenant ou papel em body/query/local storage como autorização.
2. **Regra fail-closed:** somente match exato após normalização permite `"normal"`. Vazio, ausente ou não correspondente => `"secondary"`. Erro de configuração => startup falha. Erro de Graph => falha explícita; nunca uma decisão normal.
3. **Proteção server-side:** aplicar middleware nas APIs/dados de cada experiência. Retornar `401` sem sessão/classificação e `403` para sessão classificada na experiência oposta. Usar decisão persistida em sessão, nunca apenas checagem de componente/rota SPA. Proteger ou excluir deliberadamente endpoints compartilhados.
4. **Cobertura de todas as credenciais:** revisar rotas JWT existentes e qualquer endpoint alternativo. Um usuário não deve contornar a política de página normal obtendo token JWT em outra rota. Delimitar o alcance das APIs, ou adicionar um mapeamento de autorização equivalente para identidades JWT.
5. **Proteção de sessão:** manter rotação do identificador de sessão após autenticação (já há `req.session.regenerate` no callback), cookies `HttpOnly`, `Secure` em HTTPS, `SameSite` coerente com deployment, proteção contra CSRF para operações mutáveis e store persistente adequado à produção.
6. **Redirect seguro:** gerar destinos somente a partir de `FRONTEND_URL` validada e caminhos constantes controlados pelo backend; não aceitar redirect arbitrário enviado pelo cliente.
7. **Auditoria mínima:** registrar login concluído/negado, `experience`, motivo categorizado (`allowlist_match`, `company_missing`, `company_not_allowed`, `profile_lookup_failed`), `tid` e identificador Entra mínimo se aprovado pela política de privacidade. Não registrar tokens, headers `Authorization`, cookies nem payload Graph completo. Definir retenção e acesso dos logs.
8. **Dados de configuração:** validar todo o JSON antes de iniciar tráfego; monitorar versão/hash da configuração carregada sem divulgar a lista se ela for considerada restrita.

## Plano de testes

Testar a função de política isoladamente e as rotas/sessão usando dependências Graph simuladas, sem chamadas reais à Microsoft:

| Caso | Entrada/condição | Resultado esperado |
| --- | --- | --- |
| Empresa autorizada | `companyName: "datacore"` e JSON com `datacore` | `experience: "normal"`; callback redireciona à rota normal; `/auth/me` expõe o mesmo valor. |
| Empresa não autorizada | `companyName: "Outra Empresa"` | `experience: "secondary"`; nunca recebe `normal`. |
| Valor vazio | `companyName: ""` | `secondary`. |
| Nulo/ausente | Propriedade Graph `null` ou ausente | Normalização para vazio e `secondary`. |
| Diferença de caixa | `Datacore`, `DATACORE` contra `datacore` | `normal` após normalização. |
| Espaços externos | `"  datacore  "` e entrada JSON com espaços | `normal`; trim consistente. |
| Correspondência parcial | `"datacore fake"` ou `"mydatacore"` | `secondary`, confirmando comparação exata. |
| JSON sintaticamente inválido | Arquivo truncado/malformado | Startup falha com erro claro; não inicia com regra permissiva. |
| JSON estruturalmente inválido | `companies` ausente/não-array, objeto/item inválido, nome vazio ou tipo não-string | Validação rejeita a configuração e não classifica como normal. |
| Arquivo ausente | Configuração não encontrada | Startup falha explicitamente (ou comportamento alternativo formalmente decidido e testado). |
| Falha no Graph | Timeout, `401`, `403`/consentimento, resposta de erro | Login não completa como sucesso; não define `secondary` por inferência nem concede `normal`; erro observável e sem token em logs. |
| Sessão não autenticada | Sem cookie em `/auth/me` ou API protegida | `401`; não revela dados de usuário. |
| Cruzamento de experiência | Sessão `secondary` requisita API normal; sessão `normal` requisita API exclusiva secundária | `403` para rota da experiência oposta. |
| Sessão antes de `/auth/me` | Callback completo, primeira chamada direta à API protegida | Middleware já tem decisão persistida, ou nega de modo seguro; não confia em ordem do frontend. |
| Troca de usuário/logout | Logout e login em seguida com usuário de empresa diferente | Sessão/cookie anteriores invalidados; nova decisão substitui inteiramente a antiga. |
| Bypass JWT | Cliente usa rotas protegidas por JWT fora do fluxo Entra | A política escolhida para JWT é aplicada ou a API é explicitamente fora do escopo; nenhuma rota permite bypass acidental. |
| Destino de callback | Rotas normal e secundária fixas | Redirect usa somente a origem `FRONTEND_URL` validada e os caminhos aprovados, não URL recebida do cliente. |

Há testes existentes de normalização de perfil, regras de acesso e callback Entra em [`tests/entra-auth.test.ts`](tests/entra-auth.test.ts#L45-L52), [`tests/access-rules.test.ts`](tests/access-rules.test.ts#L5-L36) e [`tests/entra-routes.test.ts`](tests/entra-routes.test.ts). Eles não cobrem ainda a política de página dupla. Os comandos configurados são `npm test` e `npm run typecheck` em [`package.json`](package.json#L6-L10).

## Próximos passos em ordem de prioridade

1. **Confirmar escopo e frontend:** identificar o repositório do frontend, nome/rota da página secundária, rota de callback/landing e se ambas compartilham APIs.
2. **Definir política para autenticação JWT:** esclarecer se o login por senha/JWT pode usar uma das experiências; auditar todas as rotas de dados alternativas e definir autorização para elas antes de ativar o fluxo.
3. **Confirmar Entra/Graph:** validar no tenant real que `GET /me?$select=companyName` retorna o valor esperado com `User.Read` delegado e que o consentimento necessário está concedido. Não ampliar escopos sem evidência.
4. **Aprovar semântica de falha e atualização de configuração:** startup deve falhar quando o JSON é inválido; definir frequência de alteração da lista e estratégia de reload/redeploy.
5. **Implementar carregador de configuração e função de decisão pura:** validar formato, normalizar nomes e cobrir casos de nulo/vazio/case/partial match antes de ligar a regra ao login.
6. **Integrar callback/sessão e contrato:** resolver perfil Graph, salvar `experience` na sessão, redirecionar para caminho fixo e incluir `experience` em `/auth/me`; revisar tratamento explícito para falha de Graph.
7. **Aplicar autorização a cada rota de backend:** separar endpoints normal/secundária/compartilhados e testar a negação de acessos cruzados, inclusive por JWT quando aplicável.
8. **Implementar integração frontend:** consumir `/auth/me` com cookie, renderizar a experiência emitida pelo backend e lidar com `401`, erro de Graph e logout sem loop de redirect.
9. **Endurecer produção e operação:** adotar session store persistente, HTTPS/cookies adequados, auditoria mínima, logs sem payload de perfil e configuração JSON distribuída em todas as instâncias.
10. **Executar validação:** rodar testes focados, `npm test`, `npm run typecheck` e teste de integração no tenant de homologação com empresa permitida, empresa não permitida e atributo vazio.

## Dúvidas para fechar antes da implementação

- Qual é o repositório e a rota efetiva da página secundária? O callback deve redirecionar diretamente para páginas distintas ou existe uma landing page única que carrega `/auth/me`?
- A experiência secundária pode chamar quais APIs e ver quais dados? A regra descrita só define qual página mostrar, mas não enumera capacidades.
- Os usuários autenticados pelo fluxo JWT/senha devem ser excluídos do portal, receber uma página por outra regra ou também participar da classificação por empresa?
- O `companyName` vazio por configuração incompleta no Entra deve sempre levar à página secundária (regra literal) ou, operacionalmente, deve bloquear o login e exigir correção do cadastro?
- Qual tenant ou tenants serão aceitos em produção? O valor de empresa é global ou deve ser combinado com `tenantId`?
- Com que frequência a allow-list será alterada e quem será responsável por aprovar/deployar o JSON?
- A falha temporária de Graph deve bloquear o login com retry (recomendado) ou há requisito de uma tela temporária de indisponibilidade?
- Há requisitos de auditoria/privacidade que definem quais identificadores Entra podem constar em logs e por quanto tempo?
