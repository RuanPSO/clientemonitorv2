import { readFileSync } from 'node:fs'

type HttpMethod = 'get' | 'post'
type AuthRequirement = 'public' | 'jwt' | 'static-bearer' | 'microsoft-session'
type ValueType = 'string' | 'integer' | 'number' | 'boolean'

interface ApiField {
  name: string
  description: string
  required: boolean
  type?: ValueType
  example?: string | number | boolean
}

interface ApiOperation {
  operationId: string
  method: HttpMethod
  path: string
  category: string
  summary: string
  description: string
  auth: AuthRequirement
  query?: ApiField[]
  body?: ApiField[]
  successStatus?: string
  successDescription?: string
  responseExample?: unknown
  serverUrl?: string
}

interface OpenApiParameter {
  name: string
  in: 'path' | 'query'
  required: boolean
  description: string
  schema: { type: ValueType }
  example?: string | number | boolean
}

interface OpenApiOperation {
  tags: string[]
  summary: string
  description: string
  operationId: string
  servers?: Array<{ url: string; description?: string }>
  parameters?: OpenApiParameter[]
  requestBody?: {
    required: boolean
    content: {
      'application/json': {
        schema: {
          type: 'object'
          properties: Record<string, Record<string, unknown>>
          required?: string[]
        }
      }
    }
  }
  responses: Record<string, {
    description: string
    content?: { 'application/json': { example: unknown } }
  }>
  security?: Array<Record<string, string[]>>
}

interface OpenApiDocument {
  openapi: '3.0.3'
  info: {
    title: string
    version: string
    description: string
  }
  'x-environment': string
  servers: Array<{ url: string; description: string }>
  tags: Array<{ name: string }>
  paths: Record<string, Partial<Record<HttpMethod, OpenApiOperation>>>
  components: {
    securitySchemes: {
      bearerAuth: { type: 'http'; scheme: 'bearer'; bearerFormat: 'JWT' }
      staticBearerAuth: { type: 'http'; scheme: 'bearer'; description: string }
      microsoftSession: {
        type: 'apiKey'
        in: 'cookie'
        name: 'clientemonitor.sid'
        description: string
      }
    }
  }
}

function readApplicationVersion(): string {
  const manifest: unknown = JSON.parse(
    readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
  )
  if (
    typeof manifest !== 'object' ||
    manifest === null ||
    !('version' in manifest) ||
    typeof manifest.version !== 'string'
  ) {
    throw new Error('Não foi possível ler a versão da aplicação em package.json')
  }
  return manifest.version
}

export const apiVersion = readApplicationVersion()

export const apiOperations: ApiOperation[] = [
  {
    operationId: 'checkGuacamoleConnectivity',
    method: 'get',
    path: '/api/conectado',
    category: 'Guacamole Lite',
    summary: 'Verificar comunicação com o Portal RDP',
    description: 'Consulta diretamente a URL configurada em GUACAMOLE_BASE_URL (padrão http://10.86.26.18:8410/) sem autenticação. Retorna sucesso quando o Portal RDP responde HTTP 200 com HTML. Não inicia uma sessão RDP.',
    auth: 'public',
    successDescription: 'O Portal RDP respondeu HTTP 200 com status conectado.',
    responseExample: {
      status: 'conectado',
    },
  },
  {
    operationId: 'getServiceOverview',
    method: 'get',
    path: '/',
    category: 'Início e saúde',
    summary: 'Informações da API',
    description: 'Retorna o estado básico, o nome do serviço, a versão e o horário da resposta.',
    auth: 'public',
    responseExample: {
      ok: true,
      servico: 'API Zabbix',
      versao: apiVersion,
      timestamp: '<data/hora ISO 8601>',
    },
  },
  {
    operationId: 'getHealth',
    method: 'get',
    path: '/health',
    category: 'Início e saúde',
    summary: 'Verificar saúde da API',
    description: 'Retorna o estado do serviço, informações do cache, tempo ativo e horário da resposta.',
    auth: 'public',
  },
  {
    operationId: 'createGuacamoleLiteToken',
    method: 'post',
    path: '/api/guacamole/token',
    category: 'Guacamole Lite',
    summary: 'Gerar token de conexão RDP',
    description: 'Emite um token AES-256-CBC para abrir uma sessão no Guacamole Lite. O host e o domínio são preenchidos pelo backend como ts.datacore.com.br; o cliente informa somente usuário, senha e porta. Requer o token estático configurado em API_BEARER_TOKEN.',
    auth: 'static-bearer',
    serverUrl: `http://localhost:${process.env.GUAC_PORT ?? '8190'}`,
    body: [
      { name: 'username', type: 'string', required: true, description: 'Usuário RDP, sem domínio.', example: 'usuario' },
      { name: 'password', type: 'string', required: true, description: 'Senha do usuário RDP.', example: '<SENHA>' },
      { name: 'port', type: 'integer', required: true, description: 'Porta RDP customizada recebida do card do host.', example: 3389 },
    ],
    responseExample: {
      token: '<TOKEN_AES_256_CBC>',
      websocketUrl: 'ws://localhost:8190/?token=<TOKEN_AES_256_CBC>',
    },
  },
  {
    operationId: 'login',
    method: 'post',
    path: '/login',
    category: 'Autenticação e usuários',
    summary: 'Autenticar usuário por e-mail e senha',
    description: 'Em caso de sucesso, retorna um JWT e os dados públicos do usuário.',
    auth: 'public',
    body: [
      { name: 'email', type: 'string', required: true, description: 'E-mail da conta.', example: 'usuario@exemplo.com' },
      { name: 'senha', type: 'string', required: true, description: 'Senha da conta.', example: '<SENHA>' },
    ],
    successDescription: 'Autenticação concluída; o corpo inclui o token e os dados públicos do usuário.',
  },
  {
    operationId: 'getCurrentUser',
    method: 'get',
    path: '/me',
    category: 'Autenticação e usuários',
    summary: 'Consultar usuário autenticado',
    description: 'Busca os dados públicos do usuário identificado pelo JWT.',
    auth: 'jwt',
  },
  {
    operationId: 'createUser',
    method: 'post',
    path: '/users',
    category: 'Autenticação e usuários',
    summary: 'Criar usuário pendente de ativação',
    description: 'Cria uma conta e envia um e-mail de ativação. Requer um JWT válido.',
    auth: 'jwt',
    body: [
      { name: 'nome', type: 'string', required: true, description: 'Nome do usuário.', example: 'Nome de exemplo' },
      { name: 'email', type: 'string', required: true, description: 'E-mail da conta.', example: 'usuario@exemplo.com' },
      { name: 'grupo', type: 'integer', required: true, description: 'Identificador do grupo.', example: 1 },
      { name: 'cargo', type: 'string', required: false, description: 'Cargo do usuário.', example: 'Operações' },
    ],
    successStatus: '201',
    successDescription: 'Usuário criado; a resposta pode incluir um aviso se o envio do e-mail falhar.',
  },
  {
    operationId: 'validateActivationToken',
    method: 'get',
    path: '/ativar',
    category: 'Autenticação e usuários',
    summary: 'Validar token de ativação',
    description: 'Valida o token enviado ao usuário e retorna informações básicas da conta.',
    auth: 'public',
    query: [
      { name: 'token', type: 'string', required: true, description: 'Token recebido no e-mail de ativação.', example: '<TOKEN_DE_ATIVACAO>' },
    ],
  },
  {
    operationId: 'activateUser',
    method: 'post',
    path: '/ativar',
    category: 'Autenticação e usuários',
    summary: 'Ativar conta e definir senha',
    description: 'O token deve ser válido e a senha precisa ter ao menos seis caracteres.',
    auth: 'public',
    body: [
      { name: 'token', type: 'string', required: true, description: 'Token recebido no e-mail de ativação.', example: '<TOKEN_DE_ATIVACAO>' },
      { name: 'senha', type: 'string', required: true, description: 'Nova senha, com no mínimo seis caracteres.', example: '<SENHA>' },
    ],
    responseExample: { message: 'Conta ativada com sucesso' },
  },
  {
    operationId: 'startMicrosoftLogin',
    method: 'get',
    path: '/auth/login',
    category: 'Microsoft Entra ID',
    summary: 'Iniciar login Microsoft',
    description: 'Cria o estado OAuth na sessão e redireciona o navegador para o Microsoft Entra ID.',
    auth: 'public',
    successStatus: '302',
    successDescription: 'Redirecionamento para a página de autenticação Microsoft.',
  },
  {
    operationId: 'completeMicrosoftLogin',
    method: 'get',
    path: '/auth/callback',
    category: 'Microsoft Entra ID',
    summary: 'Concluir callback Microsoft',
    description: 'Valida o código e o estado OAuth, consulta companyName no Microsoft Graph e redireciona para /dashboard. A experiência é informada em /auth/me e aplicada pelo backend nas APIs. Falhas de token ou Graph respondem 502 sem autenticar a sessão.',
    auth: 'public',
    query: [
      { name: 'code', type: 'string', required: true, description: 'Código OAuth enviado pelo Entra ID.' },
      { name: 'state', type: 'string', required: true, description: 'Estado OAuth associado à sessão de login.' },
      { name: 'error', type: 'string', required: false, description: 'Erro OAuth, quando a autenticação não é concluída.' },
    ],
    successStatus: '302',
    successDescription: 'Redirecionamento para um caminho fixo do frontend conforme a experiência decidida pelo backend.',
  },
  {
    operationId: 'refreshMicrosoftSession',
    method: 'get',
    path: '/auth/silent',
    category: 'Microsoft Entra ID',
    summary: 'Verificar sessão Microsoft',
    description: 'Tenta adquirir um token silenciosamente. Requer uma sessão Microsoft ativa.',
    auth: 'microsoft-session',
    responseExample: { authenticated: true },
  },
  {
    operationId: 'getMicrosoftProfile',
    method: 'get',
    path: '/auth/me',
    category: 'Microsoft Entra ID',
    summary: 'Consultar perfil Microsoft',
    description: 'Obtém o perfil e os grupos do Microsoft Graph e responde { user, groups, clientIp, source, experience }. A experiência vem da sessão; se estiver ausente, retorna secondary.',
    auth: 'microsoft-session',
  },
  {
    operationId: 'logoutMicrosoft',
    method: 'get',
    path: '/auth/logout',
    category: 'Microsoft Entra ID',
    summary: 'Encerrar sessão Microsoft',
    description: 'Destrói a sessão local e redireciona o navegador para o logout Microsoft.',
    auth: 'public',
    successStatus: '302',
    successDescription: 'Redirecionamento para o logout Microsoft.',
  },
  {
    operationId: 'getHostDetails',
    method: 'get',
    path: '/host/:hostid/details',
    category: 'Hosts',
    summary: 'Consultar detalhes do host',
    description: 'Retorna os detalhes do host identificado pelo Zabbix.',
    auth: 'jwt',
  },
  {
    operationId: 'getHostBasicInfo',
    method: 'get',
    path: '/host/:hostid/basico',
    category: 'Hosts',
    summary: 'Consultar dados básicos do host',
    description: 'Retorna informações básicas do host. Para sessões secondary, o host precisa pertencer a um grupo permitido para a empresa.',
    auth: 'jwt',
  },
  {
    operationId: 'getHostServices',
    method: 'get',
    path: '/host/:hostid/services',
    category: 'Hosts',
    summary: 'Listar serviços do host',
    description: 'Retorna os serviços associados ao host. Para sessões secondary, o host precisa pertencer a um grupo permitido para a empresa.',
    auth: 'jwt',
  },
  {
    operationId: 'getHostProblems',
    method: 'get',
    path: '/host/:hostid/problemas',
    category: 'Hosts',
    summary: 'Listar problemas do host',
    description: 'Retorna os problemas associados ao host.',
    auth: 'jwt',
  },
  {
    operationId: 'getHostReportByName',
    method: 'get',
    path: '/host/by-name/:hostname/relatorio',
    category: 'Hosts',
    summary: 'Consultar relatório pelo nome do host',
    description: 'Requer sessão Microsoft autenticada com experiência normal. O período inicial e final são obrigatórios; o agrupamento padrão é 15min.',
    auth: 'microsoft-session',
    query: [
      { name: 'inicio', type: 'string', required: true, description: 'Início do período; formato aceito pelo serviço.', example: '<INICIO_ISO_8601>' },
      { name: 'fim', type: 'string', required: true, description: 'Fim do período; formato aceito pelo serviço.', example: '<FIM_ISO_8601>' },
      { name: 'agrupamento', type: 'string', required: false, description: 'Intervalo de agrupamento; padrão 15min.', example: '15min' },
    ],
  },
  {
    operationId: 'listHostsWithIp',
    method: 'get',
    path: '/hosts/com-ip',
    category: 'Hosts',
    summary: 'Listar hosts com endereço IP',
    description: 'Retorna os hosts que possuem endereço IP. Para sessões secondary, inclui somente hosts associados a grupos permitidos para a empresa.',
    auth: 'jwt',
  },
  {
    operationId: 'listHostsWithIpAndOs',
    method: 'get',
    path: '/hosts/com-ip-e-so',
    category: 'Hosts',
    summary: 'Listar hosts com IP e sistema operacional',
    description: 'Retorna hosts com endereço IP e sistema operacional.',
    auth: 'jwt',
  },
  {
    operationId: 'getHostsPingUptime',
    method: 'get',
    path: '/hosts/status-ping-uptime',
    category: 'Hosts',
    summary: 'Consultar ping e uptime dos hosts',
    description: 'Retorna os indicadores de ping e uptime dos hosts. Para sessões secondary, inclui somente hosts associados a grupos permitidos para a empresa.',
    auth: 'jwt',
  },
  {
    operationId: 'getHostIp',
    method: 'get',
    path: '/host/:hostid/com-ip',
    category: 'Hosts',
    summary: 'Consultar IP do host',
    description: 'Retorna o endereço IP associado ao host. Para sessões secondary, o host precisa pertencer a um grupo permitido para a empresa.',
    auth: 'jwt',
  },
  {
    operationId: 'getHostActiveServices',
    method: 'get',
    path: '/host/:hostid/active-services',
    category: 'Hosts',
    summary: 'Listar serviços ativos do host',
    description: 'Retorna os serviços ativos associados ao host. Para sessões secondary, o host precisa pertencer a um grupo permitido para a empresa.',
    auth: 'jwt',
  },
  {
    operationId: 'getHostPeriodReport',
    method: 'get',
    path: '/host/:hostid/relatorio-periodo',
    category: 'Hosts',
    summary: 'Consultar relatório por período',
    description: 'Retorna um relatório do host; se omitido, usa por padrão o período recente configurado pela rota.',
    auth: 'jwt',
    query: [
      { name: 'inicio', type: 'string', required: false, description: 'Início do período; por padrão, um dia antes da resposta.', example: '<INICIO_ISO_8601>' },
      { name: 'fim', type: 'string', required: false, description: 'Fim do período; por padrão, o horário atual.', example: '<FIM_ISO_8601>' },
    ],
  },
  {
    operationId: 'getHostSeries',
    method: 'get',
    path: '/host/:hostid/serie',
    category: 'Hosts',
    summary: 'Consultar série de métricas',
    description: 'Retorna pontos de uma série identificada pela chave.',
    auth: 'jwt',
    query: [
      { name: 'key', type: 'string', required: true, description: 'Chave do item de monitoramento.', example: '<CHAVE_DO_ITEM>' },
      { name: 'inicio', type: 'string', required: false, description: 'Início do período; por padrão, um dia antes da resposta.', example: '<INICIO_ISO_8601>' },
      { name: 'fim', type: 'string', required: false, description: 'Fim do período; por padrão, o horário atual.', example: '<FIM_ISO_8601>' },
    ],
  },
  {
    operationId: 'getHostMetrics',
    method: 'get',
    path: '/host/:hostid/metrics',
    category: 'Hosts',
    summary: 'Consultar métricas do host',
    description: 'Retorna o conjunto de métricas preparado para o host. Para sessões secondary, o host precisa pertencer a um grupo permitido para a empresa.',
    auth: 'jwt',
  },
  {
    operationId: 'listGroups',
    method: 'get',
    path: '/grupos',
    category: 'Grupos',
    summary: 'Listar grupos',
    description: 'Retorna os grupos disponíveis no Zabbix. Requer um JWT Bearer válido; quando há sessão Microsoft, também verifica se a experiência permite acessar a rota.',
    auth: 'jwt',
  },
  {
    operationId: 'getGroupByKey',
    method: 'get',
    path: '/grupo/:chave',
    category: 'Grupos',
    summary: 'Consultar grupo pela chave',
    description: 'Retorna os hosts associados à chave do grupo. Sessões secondary só podem consultar grupos permitidos para a empresa.',
    auth: 'jwt',
  },
  {
    operationId: 'getFullGroupHosts',
    method: 'get',
    path: '/grupo/:chave/hosts-full',
    category: 'Grupos',
    summary: 'Consultar dados completos dos hosts do grupo',
    description: 'Retorna os dados completos dos hosts associados à chave do grupo. Sessões secondary só podem consultar grupos permitidos para a empresa.',
    auth: 'jwt',
  },
  {
    operationId: 'listGroupsWithHosts',
    method: 'get',
    path: '/grupos/com-hosts',
    category: 'Grupos',
    summary: 'Listar grupos com hosts',
    description: 'Retorna os grupos acompanhados de seus hosts. Sessões secondary recebem somente grupos permitidos para a empresa e os hosts desses grupos.',
    auth: 'jwt',
  },
  {
    operationId: 'getHostSmartReport',
    method: 'get',
    path: '/host/:hostid/relatorio',
    category: 'Relatórios e SLA',
    summary: 'Consultar relatório inteligente do host',
    description: 'Retorna os dados do relatório inteligente do host. Datas padrão cobrem os últimos 30 dias; agrupamento padrão 15min.',
    auth: 'jwt',
    query: [
      { name: 'inicio', type: 'string', required: false, description: 'Início do período; padrão nos últimos 30 dias.', example: '<INICIO_ISO_8601>' },
      { name: 'fim', type: 'string', required: false, description: 'Fim do período; padrão no horário atual.', example: '<FIM_ISO_8601>' },
      { name: 'agrupamento', type: 'string', required: false, description: 'Intervalo de agrupamento; padrão 15min.', example: '15min' },
    ],
  },
  {
    operationId: 'createHostSmartReport',
    method: 'post',
    path: '/host/:hostid/relatorio',
    category: 'Relatórios e SLA',
    summary: 'Gerar relatório inteligente do host',
    description: 'Gera o relatório usando o período informado no corpo JSON.',
    auth: 'jwt',
    body: [
      { name: 'inicio', type: 'string', required: true, description: 'Início do período.', example: '<INICIO_ISO_8601>' },
      { name: 'fim', type: 'string', required: true, description: 'Fim do período.', example: '<FIM_ISO_8601>' },
      { name: 'agrupamento', type: 'string', required: false, description: 'Intervalo de agrupamento; padrão 15min.', example: '15min' },
    ],
  },
  {
    operationId: 'getAvailabilityReport',
    method: 'get',
    path: '/relatorio/disponibilidade',
    category: 'Relatórios e SLA',
    summary: 'Gerar relatório de disponibilidade',
    description: 'Retorna o relatório de disponibilidade para uma lista de hosts no período informado.',
    auth: 'jwt',
    query: [
      { name: 'hostids', type: 'string', required: true, description: 'Identificadores separados por vírgula.', example: '<HOSTID_1>,<HOSTID_2>' },
      { name: 'inicio', type: 'string', required: true, description: 'Início do período.', example: '<INICIO_ISO_8601>' },
      { name: 'fim', type: 'string', required: true, description: 'Fim do período.', example: '<FIM_ISO_8601>' },
    ],
  },
  {
    operationId: 'getHostSla',
    method: 'get',
    path: '/host/:hostid/sla',
    category: 'Relatórios e SLA',
    summary: 'Consultar SLA do host',
    description: 'Retorna o resumo de SLA dos serviços do host. O período padrão cobre os últimos 30 dias.',
    auth: 'jwt',
    query: [
      { name: 'inicio', type: 'string', required: false, description: 'Início do período; padrão nos últimos 30 dias.', example: '<INICIO_ISO_8601>' },
      { name: 'fim', type: 'string', required: false, description: 'Fim do período; padrão no horário atual.', example: '<FIM_ISO_8601>' },
    ],
  },
  {
    operationId: 'getHostServiceHistory',
    method: 'get',
    path: '/host/:hostid/services/history',
    category: 'Serviços',
    summary: 'Consultar histórico dos serviços',
    description: 'Retorna mudanças de estado dos serviços do host. O período padrão cobre os últimos 30 dias.',
    auth: 'jwt',
    query: [
      { name: 'inicio', type: 'string', required: false, description: 'Início do período; padrão nos últimos 30 dias.', example: '<INICIO_ISO_8601>' },
      { name: 'fim', type: 'string', required: false, description: 'Fim do período; padrão no horário atual.', example: '<FIM_ISO_8601>' },
    ],
  },
  {
    operationId: 'getHostServiceTimeline',
    method: 'get',
    path: '/host/:hostid/services/timeline',
    category: 'Serviços',
    summary: 'Consultar linha do tempo dos serviços',
    description: 'Retorna segmentos contínuos de estado dos serviços do host. O período padrão cobre os últimos 30 dias.',
    auth: 'jwt',
    query: [
      { name: 'inicio', type: 'string', required: false, description: 'Início do período; padrão nos últimos 30 dias.', example: '<INICIO_ISO_8601>' },
      { name: 'fim', type: 'string', required: false, description: 'Fim do período; padrão no horário atual.', example: '<FIM_ISO_8601>' },
    ],
  },
  {
    operationId: 'listActiveIncidents',
    method: 'get',
    path: '/incidentes/ativos',
    category: 'Incidentes',
    summary: 'Listar incidentes ativos',
    description: 'Retorna os incidentes ativos do dia. Requer um JWT Bearer válido; quando há sessão Microsoft, exige experiência normal.',
    auth: 'jwt',
  },
  {
    operationId: 'getIncidentHostTotals',
    method: 'get',
    path: '/incidentes/hosts-totais',
    category: 'Incidentes',
    summary: 'Consultar totais de hosts por status',
    description: 'Retorna a contagem de hosts por status. Requer um JWT Bearer válido; quando há sessão Microsoft, exige experiência normal.',
    auth: 'jwt',
  },
  {
    operationId: 'getRecentProblems',
    method: 'get',
    path: '/incidentes/problemas-24h',
    category: 'Incidentes',
    summary: 'Listar principais problemas das últimas 24 horas',
    description: 'Retorna os dez principais problemas das últimas 24 horas. Requer um JWT Bearer válido; quando há sessão Microsoft, exige experiência normal.',
    auth: 'jwt',
  },
  {
    operationId: 'getIncidentDashboard',
    method: 'get',
    path: '/incidentes/dashboard',
    category: 'Incidentes',
    summary: 'Consultar dados do painel de incidentes',
    description: 'Retorna os dados agregados usados pelo painel de incidentes. Requer um JWT Bearer válido; quando há sessão Microsoft, exige experiência normal.',
    auth: 'jwt',
  },
]

function toOpenApiPath(path: string): string {
  return path.replace(/:([A-Za-z0-9_]+)/g, '{$1}')
}

function createParameters(operation: ApiOperation): OpenApiParameter[] {
  const pathParameters = Array.from(operation.path.matchAll(/:([A-Za-z0-9_]+)/g), (match) => ({
    name: match[1]!,
    in: 'path' as const,
    required: true,
    description: `Parâmetro de caminho ${match[1]}; o valor é interpretado pela rota.`,
    schema: { type: 'string' as const },
  }))
  const queryParameters = (operation.query ?? []).map((field) => ({
    name: field.name,
    in: 'query' as const,
    required: field.required,
    description: field.description,
    schema: { type: field.type ?? 'string' },
    ...(field.example === undefined ? {} : { example: field.example }),
  }))
  return [...pathParameters, ...queryParameters]
}

function createRequestBody(fields: ApiField[]): NonNullable<OpenApiOperation['requestBody']> {
  const properties = Object.fromEntries(
    fields.map((field) => [
      field.name,
      {
        ...(field.type === undefined ? {} : { type: field.type }),
        description: field.description,
        ...(field.example === undefined ? {} : { example: field.example }),
      },
    ]),
  )
  const required = fields.filter((field) => field.required).map((field) => field.name)
  return {
    required: true,
    content: {
      'application/json': {
        schema: {
          type: 'object',
          properties,
          ...(required.length === 0 ? {} : { required }),
        },
      },
    },
  }
}

function createOperation(operation: ApiOperation): OpenApiOperation {
  const responses: OpenApiOperation['responses'] = {
    [operation.successStatus ?? '200']: {
      description: operation.successDescription ?? 'Resposta JSON gerada pela rota.',
    },
  }
  if (
    operation.auth === 'jwt' ||
    operation.auth === 'static-bearer' ||
    operation.auth === 'microsoft-session'
  ) {
    responses['401'] = { description: 'Credenciais ausentes, inválidas ou sessão não autenticada.' }
  }
  if (operation.responseExample !== undefined) {
    const successResponse = responses[operation.successStatus ?? '200']!
    responses[operation.successStatus ?? '200'] = {
      description: successResponse.description,
      content: {
        'application/json': {
          example: operation.responseExample,
        },
      },
    }
  }
  return {
    tags: [operation.category],
    summary: operation.summary,
    description: operation.description,
    operationId: operation.operationId,
    ...(operation.serverUrl === undefined
      ? {}
      : {
          servers: [{
            url: operation.serverUrl,
            description: 'Gateway Guacamole Lite (porta configurável por GUAC_PORT).',
          }],
        }),
    ...(createParameters(operation).length === 0 ? {} : { parameters: createParameters(operation) }),
    ...(operation.body === undefined ? {} : { requestBody: createRequestBody(operation.body) }),
    responses,
    ...(operation.auth === 'jwt'
      ? { security: [{ bearerAuth: [] }] }
      : operation.auth === 'static-bearer'
        ? { security: [{ staticBearerAuth: [] }] }
        : operation.auth === 'microsoft-session'
        ? { security: [{ microsoftSession: [] }] }
        : {}),
  }
}

function createOpenApiDocument(): OpenApiDocument {
  const paths: OpenApiDocument['paths'] = {}
  for (const operation of apiOperations) {
    const path = toOpenApiPath(operation.path)
    const pathOperations = paths[path] ?? {}
    pathOperations[operation.method] = createOperation(operation)
    paths[path] = pathOperations
  }

  return {
    openapi: '3.0.3',
    info: {
      title: 'ClientMonitor API',
      version: apiVersion,
      description: 'Referência das rotas da API confirmadas no código atual. Rotas protegidas por JWT usam o esquema Bearer; quando uma sessão Microsoft acompanha a chamada, as regras de experiência da rota também são aplicadas. Rotas administrativas e de diagnóstico interno não fazem parte deste catálogo.',
    },
    'x-environment': process.env.NODE_ENV ?? 'Não configurado',
    servers: [{ url: '/', description: 'Origem do backend que está servindo esta documentação.' }],
    tags: [...new Set(apiOperations.map((operation) => operation.category))].map((name) => ({ name })),
    paths,
    components: {
      securitySchemes: {
        bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
        staticBearerAuth: {
          type: 'http',
          scheme: 'bearer',
          description: 'Token estático configurado no backend como API_BEARER_TOKEN.',
        },
        microsoftSession: {
          type: 'apiKey',
          in: 'cookie',
          name: 'clientemonitor.sid',
          description: 'Cookie de sessão criado pelo fluxo de autenticação Microsoft.',
        },
      },
    },
  }
}

export const openApiDocument = createOpenApiDocument()

export function getAuthLabel(auth: AuthRequirement): string {
  switch (auth) {
    case 'jwt':
      return 'JWT Bearer'
    case 'static-bearer':
      return 'Bearer estático'
    case 'microsoft-session':
      return 'Sessão Microsoft'
    case 'public':
      return 'Sem autenticação na rota'
  }
}
