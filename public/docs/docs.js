(() => {
  const content = document.querySelector('#content')
  const navigation = document.querySelector('#navigation')
  const search = document.querySelector('#search')
  const methodFilter = document.querySelector('#method-filter')
  const versionBadge = document.querySelector('#top-version')
  const breadcrumbCurrent = document.querySelector('#breadcrumb-current')
  const sidebar = document.querySelector('#sidebar')
  const menuToggle = document.querySelector('#menu-toggle')
  const themeToggle = document.querySelector('#theme-toggle')
  const toast = document.querySelector('#toast')
  let specification
  let operations = []
  let toastTimer

  const make = (tag, className, text) => {
    const element = document.createElement(tag)
    if (className) element.className = className
    if (text !== undefined) element.textContent = text
    return element
  }

  const slug = (value) => value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  const displayPath = (path) => path.replace(/\{([^}]+)\}/g, ':$1')
  const authLabel = (operation) => {
    if (operation.security?.some((entry) => 'staticBearerAuth' in entry)) return 'Bearer estático'
    if (operation.security?.some((entry) => 'bearerAuth' in entry)) return 'JWT Bearer'
    if (operation.security?.some((entry) => 'microsoftSession' in entry)) return 'Sessão Microsoft'
    return 'Sem autenticação na rota'
  }
  const allOperations = (document) => Object.entries(document.paths).flatMap(([path, methods]) =>
    Object.entries(methods).map(([method, operation]) => ({
      path,
      method: method.toUpperCase(),
      ...operation,
    })),
  )

  function showToast(message) {
    toast.textContent = message
    toast.classList.add('visible')
    clearTimeout(toastTimer)
    toastTimer = setTimeout(() => toast.classList.remove('visible'), 2300)
  }

  async function copyText(value) {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(value)
        showToast('Copiado para a área de transferência')
        return
      }
    } catch {
      // Tenta o mecanismo compatível com origens HTTP sem acesso à Clipboard API.
    }
    const fallback = make('textarea')
    fallback.className = 'copy-fallback'
    fallback.value = value
    fallback.setAttribute('aria-hidden', 'true')
    document.body.append(fallback)
    fallback.select()
    let copied = false
    try {
      copied = document.execCommand('copy')
    } catch {
      copied = false
    }
    fallback.remove()
    showToast(copied
      ? 'Copiado para a área de transferência'
      : 'Não foi possível copiar. Verifique as permissões do navegador.')
  }

  function appendHighlightedCode(codeElement, value, language) {
    const pattern = language === 'json'
      ? /("(?:\\.|[^"\\])*"(?=\s*:)|"(?:\\.|[^"\\])*"|\b(?:true|false|null)\b|-?\b\d+(?:\.\d+)?\b)/g
      : /("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|(?:\x60)[^\x60]*(?:\x60)|\b(?:const|await|return|true|false|null)\b|\b(?:GET|POST)\b)/g
    let offset = 0
    for (const match of value.matchAll(pattern)) {
      const token = match[0]
      const index = match.index
      codeElement.append(document.createTextNode(value.slice(offset, index)))
      const className = language === 'json' && token.startsWith('"')
        ? (value.slice(index + token.length).trimStart().startsWith(':') ? 'token-key' : 'token-string')
        : /^(const|await|return|true|false|null|GET|POST)$/.test(token)
          ? 'token-keyword'
          : 'token-string'
      codeElement.append(make('span', className, token))
      offset = index + token.length
    }
    codeElement.append(document.createTextNode(value.slice(offset)))
  }

  function addCopyButton(container, value, label = 'Copiar') {
    const button = make('button', 'copy-button', label)
    button.type = 'button'
    button.addEventListener('click', () => copyText(value))
    container.append(button)
  }

  function addCodeBlock(parent, title, code, copyLabel = 'Copiar') {
    const block = make('div', 'code-block')
    const header = make('div', 'code-header')
    header.append(make('span', '', title))
    addCopyButton(header, code, copyLabel)
    const pre = make('pre')
    const codeElement = make('code')
    const language = title.toLowerCase().includes('json')
      ? 'json'
      : title === 'JavaScript'
        ? 'javascript'
        : title === 'cURL'
          ? 'shell'
          : 'text'
    appendHighlightedCode(codeElement, code, language)
    pre.append(codeElement)
    block.append(header, pre)
    parent.append(block)
    return block
  }

  function schemaFields(schema) {
    if (!schema || typeof schema !== 'object') return []
    if (schema.type === 'object' && schema.properties) {
      return Object.entries(schema.properties).map(([name, property]) => ({
        name,
        description: property.description || '',
        required: schema.required?.includes(name) === true,
        type: property.type || 'não especificado',
        example: property.example,
      }))
    }
    return []
  }

  function pathParameters(operation) {
    return (operation.parameters || []).filter((parameter) => parameter.in === 'path')
  }

  function queryParameters(operation) {
    return (operation.parameters || []).filter((parameter) => parameter.in === 'query')
  }

  function samplePath(operation) {
    let path = displayPath(operation.path)
    for (const parameter of pathParameters(operation)) {
      path = path.replace(`:${parameter.name}`, `<${parameter.name}>`)
    }
    const query = queryParameters(operation)
      .map((parameter) => `${encodeURIComponent(parameter.name)}=<${parameter.name}>`)
      .join('&')
    return query ? `${path}?${query}` : path
  }

  function bodyExample(operation) {
    const body = operation.requestBody?.content?.['application/json']?.schema
    const fields = schemaFields(body)
    if (!fields.length) return null
    return JSON.stringify(Object.fromEntries(fields.map((field) => [
      field.name,
      field.example === undefined ? `<${field.name}>` : field.example,
    ])), null, 2)
  }

  function requestSamples(operation) {
    const path = samplePath(operation)
    const baseUrl = operation.servers?.[0]?.url || window.location.origin
    const url = `${baseUrl}${path}`
    const headers = []
    if (operation.security?.some((entry) => 'staticBearerAuth' in entry)) {
      headers.push(`-H "Authorization: Bearer <API_BEARER_TOKEN>"`)
    }
    if (operation.security?.some((entry) => 'bearerAuth' in entry)) {
      headers.push(['-H "Authorization:', 'Bearer YOUR_JWT_TOKEN"'].join(' '))
    }
    const body = bodyExample(operation)
    if (body) headers.push("-H 'Content-Type: application/json'")
    if (body) headers.push(`--data '${body}'`)
    const curl = [
      `curl --request ${operation.method}`,
      `--url '${url}'`,
      ...headers,
    ].join(' \\\n  ')
    const fetchOptions = [`  method: '${operation.method}'`]
    const fetchHeaders = []
    if (operation.security?.some((entry) => 'staticBearerAuth' in entry)) {
      fetchHeaders.push("    Authorization: ['Bearer', apiBearerToken].join(' ')")
    }
    if (operation.security?.some((entry) => 'bearerAuth' in entry)) {
      fetchHeaders.push("    Authorization: ['Bearer', apiToken].join(' ')")
    }
    if (body) fetchHeaders.push("    'Content-Type': 'application/json'")
    if (fetchHeaders.length) fetchOptions.push(`  headers: {\n${fetchHeaders.join(',\n')}\n  }`)
    if (operation.security?.some((entry) => 'microsoftSession' in entry)) {
      fetchOptions.push("  credentials: 'include'")
    }
    if (body) fetchOptions.push(`  body: JSON.stringify(${body})`)
    const javascript = [
      `const baseUrl = '${baseUrl}'`,
      ...(operation.security?.some((entry) => 'staticBearerAuth' in entry)
        ? ["const apiBearerToken = 'YOUR_API_BEARER_TOKEN'"]
        : ["const apiToken = 'YOUR_JWT_TOKEN' // necessário somente para rotas JWT"]),
      `const response = await fetch(\`\${baseUrl}${path.replace(/<([^>]+)>/g, (_, name) => `\${${name}}`)}\`, {`,
      fetchOptions.join(',\n'),
      '})',
      'const data = await response.json()',
      'console.log(response.status, data)',
    ].join('\n')
    return { url, curl, javascript, body }
  }

  function addFieldSection(parent, title, fields) {
    if (!fields.length) return
    const section = make('section', 'doc-section')
    section.append(make('h2', '', title))
    const list = make('div', 'field-list')
    for (const field of fields) {
      const row = make('div', 'field-row')
      const name = make('div', 'field-name')
      name.append(document.createTextNode(field.name))
      if (field.required) name.append(make('span', 'required', 'Obrigatório'))
      row.append(name)
      row.append(make('div', 'field-type', field.schema?.type || field.type || 'string'))
      const detail = make('div', 'field-detail', field.description || 'Sem descrição adicional no código atual.')
      if (field.example !== undefined) {
        detail.append(document.createTextNode(` Exemplo: ${String(field.example)}`))
      }
      row.append(detail)
      list.append(row)
    }
    section.append(list)
    parent.append(section)
  }

  function showOverview() {
    breadcrumbCurrent.textContent = 'Visão geral'
    const root = make('div')
    const hero = make('section', 'hero')
    hero.append(
      make('div', 'eyebrow', 'Documentação da API'),
      make('h1', '', specification.info.title),
      make('p', '', specification.info.description),
    )
    const chips = make('div', 'hero-meta')
    const environment = specification['x-environment']
    const baseUrl = window.location.origin
    chips.append(
      make('span', 'meta-chip', `Versão ${specification.info.version}`),
      make('span', 'meta-chip', `Ambiente ${environment}`),
      make('span', 'meta-chip', `Base ${baseUrl}`),
    )
    hero.append(chips)
    root.append(hero)

    const counts = operations.reduce((result, operation) => {
      result[operation.method] = (result[operation.method] || 0) + 1
      return result
    }, {})
    const stats = make('section', 'stats-grid')
    const cards = [
      ['Endpoints', String(operations.length)],
      ['Categorias', String(new Set(operations.map((operation) => operation.tags[0])).size)],
      ['GET', String(counts.GET || 0)],
      ['POST', String(counts.POST || 0)],
    ]
    for (const [label, value] of cards) {
      const card = make('div', 'stat-card')
      card.append(make('strong', 'stat-value', value), make('span', 'stat-label', label))
      stats.append(card)
    }
    root.append(stats)

    const intro = make('div', 'two-column')
    const methods = make('section', 'panel')
    methods.append(make('h2', '', 'Comece por aqui'))
    methods.append(make('p', '', 'Use a base exibida acima. Para operações protegidas, autentique-se e envie o JWT no header Authorization.'))
    const methodStats = make('div', 'method-stats')
    for (const method of ['GET', 'POST']) {
      const chip = make('div', 'method-stat')
      chip.append(make('span', `method-pill method-${method.toLowerCase()}`, method))
      chip.append(document.createTextNode(`${counts[method] || 0} operações`))
      methodStats.append(chip)
    }
    methods.append(methodStats)
    const auth = make('section', 'panel')
    auth.append(make('h2', '', 'Autenticação'))
    auth.append(make('p', '', 'A documentação é pública. Isso não altera o controle de acesso aplicado pelas rotas da API.'))
    auth.append(make('div', 'auth-note', 'JWT: use POST /login e envie Authorization: Bearer <token>. Microsoft: inicie em /auth/login; endpoints de perfil exigem o cookie de sessão clientemonitor.sid.'))
    intro.append(methods, auth)
    root.append(intro)

    const categoryHeading = make('h2', '', 'Navegue por categoria')
    root.append(categoryHeading)
    const categories = new Map()
    for (const operation of operations) {
      const category = operation.tags[0]
      categories.set(category, (categories.get(category) || 0) + 1)
    }
    const categoryGrid = make('div', 'category-grid')
    for (const [category, count] of categories) {
      const card = make('button', 'category-card')
      card.type = 'button'
      card.append(make('span', '', category), make('span', '', `${count} endpoints →`))
      card.addEventListener('click', () => {
        const group = [...navigation.querySelectorAll('.nav-group')].find((item) => item.dataset.category === category)
        if (group) {
          group.open = true
          group.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
        }
        const first = operations.find((operation) => operation.tags[0] === category)
        if (first) navigateTo(first.operationId)
      })
      categoryGrid.append(card)
    }
    root.append(categoryGrid)

    const start = make('section', 'doc-section')
    start.append(make('h2', '', 'Exemplo rápido'))
    start.append(make('p', '', 'Consulte a saúde da API sem autenticação:'))
    const samples = make('div', 'quick-start')
    const health = operations.find((operation) => operation.operationId === 'getHealth')
    if (health) {
      const { url, curl, javascript } = requestSamples(health)
      addCodeBlock(samples, 'cURL', curl)
      addCodeBlock(samples, 'JavaScript', javascript)
      start.append(samples)
      const link = make('a', '', url)
      link.href = url
      link.target = '_blank'
      link.rel = 'noreferrer'
      const urlLine = make('p')
      urlLine.append(document.createTextNode('URL completa: '), link)
      start.append(urlLine)
    }
    start.append(make('div', 'security-note', 'Rotas administrativas, de depuração e de emissão de token sem credenciais foram excluídas do catálogo. A especificação descreve apenas operações confirmadas; contratos de resposta sem schema no backend são identificados como não especificados.'))
    root.append(start)
    content.replaceChildren(root)
  }

  function navigateTo(operationId) {
    const operation = operations.find((item) => item.operationId === operationId)
    if (!operation) return
    if (window.location.hash !== `#${operationId}`) {
      window.history.pushState(null, '', `#${operationId}`)
    }
    showOperation(operation)
    updateActiveLink(operationId)
    sidebar.classList.remove('open')
    menuToggle.setAttribute('aria-expanded', 'false')
  }

  function updateActiveLink(operationId) {
    for (const link of navigation.querySelectorAll('.nav-link')) {
      const active = link.dataset.operation === operationId
      if (active) link.setAttribute('aria-current', 'page')
      else link.removeAttribute('aria-current')
      if (active) link.closest('.nav-group').open = true
    }
  }

  function showOperation(operation) {
    breadcrumbCurrent.textContent = operation.summary
    const root = make('article', 'operation-card')
    const heading = make('div', 'operation-heading')
    heading.append(make('span', `method-pill method-${operation.method.toLowerCase()}`, operation.method))
    const headingText = make('div')
    headingText.append(make('h1', 'operation-title', operation.summary))
    const pathRow = make('div', 'operation-path')
    pathRow.append(make('code', '', displayPath(operation.path)))
    addCopyButton(pathRow, displayPath(operation.path), 'Copiar caminho')
    headingText.append(pathRow)
    heading.append(headingText)
    root.append(heading, make('p', 'operation-description', operation.description))

    const meta = make('div', 'operation-meta')
    meta.append(make('span', 'meta-chip', operation.tags[0]))
    meta.append(make('span', 'meta-chip', authLabel(operation)))
    const responseCodes = Object.keys(operation.responses || {}).join(', ')
    if (responseCodes) meta.append(make('span', 'meta-chip', `HTTP ${responseCodes}`))
    root.append(meta)

    const pathParams = pathParameters(operation)
    const queryParams = queryParameters(operation)
    const body = operation.requestBody?.content?.['application/json']?.schema
    addFieldSection(root, 'Path parameters', pathParams)
    addFieldSection(root, 'Query parameters', queryParams)
    addFieldSection(root, 'Request body · application/json', schemaFields(body))
    if (!pathParams.length && !queryParams.length && !body) {
      root.append(make('div', 'info-note', 'Esta operação não declara parâmetros nem corpo JSON no catálogo.'))
    }

    const { url, curl, javascript, body: bodySample } = requestSamples(operation)
    const urlSection = make('section', 'doc-section')
    urlSection.append(make('h2', '', 'URL da requisição'))
    addCodeBlock(urlSection, 'URL completa', url, 'Copiar URL')
    root.append(urlSection)

    const exampleSection = make('section', 'doc-section')
    exampleSection.append(make('h2', '', 'Exemplos'))
    const examples = make('div', 'sample-grid two')
    addCodeBlock(examples, 'cURL', curl)
    addCodeBlock(examples, 'JavaScript', javascript)
    exampleSection.append(examples)
    if (bodySample) {
      const bodyGrid = make('div', 'sample-grid')
      addCodeBlock(bodyGrid, 'Corpo JSON', bodySample, 'Copiar JSON')
      exampleSection.append(bodyGrid)
    }
    root.append(exampleSection)

    const responseSection = make('section', 'doc-section')
    responseSection.append(make('h2', '', 'Respostas'))
    const responseInfo = make('div', 'info-note')
    responseInfo.append(document.createTextNode('Status documentados: '))
    responseInfo.append(document.createTextNode(responseCodes || 'não especificados'))
    responseInfo.append(document.createElement('br'))
    responseInfo.append(document.createTextNode('O backend não declara um schema de resposta estável para esta operação. Consulte a descrição e o status; nenhum dado real foi usado para compor exemplos.'))
    responseSection.append(responseInfo)
    if (operation.responses?.['200']?.content?.['application/json']?.example !== undefined) {
      const example = JSON.stringify(operation.responses['200'].content['application/json'].example, null, 2)
      const exampleGrid = make('div', 'sample-grid')
      addCodeBlock(exampleGrid, 'Exemplo ilustrativo de resposta JSON', example)
      responseSection.append(exampleGrid)
    }
    root.append(responseSection)
    content.replaceChildren(root)
  }

  function updateNavigation() {
    const query = search.value.trim().toLowerCase()
    const selectedMethod = methodFilter.value.toUpperCase()
    const filtered = operations.filter((operation) => {
      const methodMatches = selectedMethod === 'ALL' || operation.method === selectedMethod
      const searchable = `${operation.summary} ${operation.path} ${operation.description} ${operation.tags.join(' ')}`.toLowerCase()
      return methodMatches && searchable.includes(query)
    })
    const groups = new Map()
    for (const operation of filtered) {
      const category = operation.tags[0]
      if (!groups.has(category)) groups.set(category, [])
      groups.get(category).push(operation)
    }
    const fragment = document.createDocumentFragment()
    for (const [category, items] of groups) {
      const group = make('details', 'nav-group')
      group.dataset.category = category
      group.open = Boolean(query) || items.some((item) => item.operationId === window.location.hash.slice(1))
      const summary = make('summary')
      summary.append(make('span', '', category), make('span', 'nav-count', String(items.length)))
      group.append(summary)
      for (const operation of items) {
        const link = make('a', 'nav-link')
        link.href = `#${operation.operationId}`
        link.dataset.operation = operation.operationId
        link.append(
          make('span', `method-pill method-${operation.method.toLowerCase()}`, operation.method),
          make('span', 'nav-link-label', operation.summary),
        )
        link.addEventListener('click', (event) => {
          event.preventDefault()
          navigateTo(operation.operationId)
        })
        group.append(link)
      }
      fragment.append(group)
    }
    navigation.replaceChildren(fragment)
    if (!filtered.length) {
      const empty = make('div', 'empty-state')
      empty.append(make('p', '', 'Nenhum endpoint corresponde à pesquisa e ao filtro selecionados.'))
      navigation.append(empty)
    }
    if (window.location.hash) updateActiveLink(window.location.hash.slice(1))
  }

  function initializeTheme() {
    let saved
    try {
      saved = localStorage.getItem('clientmonitor-docs-theme')
    } catch {
      showToast('O navegador não permite restaurar a preferência de tema.')
    }
    const preferred = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
    document.documentElement.dataset.theme = saved || preferred
    themeToggle.addEventListener('click', () => {
      const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'
      document.documentElement.dataset.theme = next
      try {
        localStorage.setItem('clientmonitor-docs-theme', next)
      } catch {
        showToast('O tema foi alterado, mas a preferência não pôde ser salva.')
      }
    })
  }

  async function initialize() {
    initializeTheme()
    search.addEventListener('input', updateNavigation)
    methodFilter.addEventListener('change', updateNavigation)
    window.addEventListener('hashchange', () => {
      const operation = operations.find((item) => item.operationId === window.location.hash.slice(1))
      if (operation) {
        showOperation(operation)
        updateActiveLink(operation.operationId)
      } else showOverview()
    })
    menuToggle.addEventListener('click', () => {
      const isOpen = sidebar.classList.toggle('open')
      menuToggle.setAttribute('aria-expanded', String(isOpen))
    })

    try {
      const response = await fetch('/docs/openapi.json', { headers: { Accept: 'application/json' } })
      if (!response.ok) throw new Error(`OpenAPI respondeu HTTP ${response.status}`)
      specification = await response.json()
      operations = allOperations(specification)
      versionBadge.textContent = `v${specification.info.version} · ${specification['x-environment']}`
      updateNavigation()
      const selected = operations.find((item) => item.operationId === window.location.hash.slice(1))
      if (selected) showOperation(selected)
      else showOverview()
    } catch (error) {
      const failure = make('section', 'error-state')
      failure.append(
        make('h2', '', 'Não foi possível carregar a documentação'),
        make('p', '', error instanceof Error ? error.message : 'Erro desconhecido ao carregar OpenAPI.'),
      )
      content.replaceChildren(failure)
      versionBadge.textContent = 'OpenAPI indisponível'
    }
  }

  initialize()
})()
