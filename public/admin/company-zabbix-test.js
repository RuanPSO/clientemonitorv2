const loading = document.getElementById('loading')
const login = document.getElementById('login')
const errorMessage = document.getElementById('error')
const authenticated = document.getElementById('authenticated')
const simulationForm = document.getElementById('simulation-form')

function showError(message) {
  errorMessage.textContent = message
  errorMessage.hidden = false
}

function showLogin() {
  login.hidden = false
}

function renderMapping(result, target, jsonTarget) {
  const companyName = result.companyName || '(empresa vazia)'
  const destination = result.groupName
    ? result.groupName
    : result.groups.length > 0
      ? `todos os grupos: ${result.groups.join(', ')}`
      : 'sem grupo'
  const policy = result.fallbackPolicy ? ` (${result.fallbackPolicy})` : ''
  target.textContent = `${companyName} → ${destination}${policy}`
  jsonTarget.textContent = JSON.stringify(result, null, 2)
}

async function loadSession() {
  try {
    const response = await fetch('/auth/me', { cache: 'no-store' })
    if (response.status === 401) {
      showLogin()
      return
    }
    if (!response.ok) {
      throw new Error(`/auth/me respondeu HTTP ${response.status}`)
    }

    const data = await response.json()
    const user = data?.user
    if (!user || typeof user !== 'object') {
      throw new Error('/auth/me não retornou o perfil esperado.')
    }

    document.getElementById('display-name').textContent = user.displayName || ''
    document.getElementById('email').textContent = user.email || ''
    document.getElementById('company-name').textContent = user.companyName || ''
    document.getElementById('job-title').textContent = user.jobTitle || ''

    const resultResponse = await fetch('/admin/company-zabbix-test/result', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      cache: 'no-store',
      body: JSON.stringify({}),
    })
    if (resultResponse.status === 401) {
      showLogin()
      return
    }
    if (!resultResponse.ok) {
      throw new Error(`O diagnóstico respondeu HTTP ${resultResponse.status}`)
    }

    const result = await resultResponse.json()
    if (result.actual.companyName !== (user.companyName || '')) {
      throw new Error('A sessão mudou durante a consulta. Atualize a página para conferir novamente.')
    }

    renderMapping(result.actual, document.getElementById('actual-result'), document.getElementById('actual-json'))
    authenticated.hidden = false
  } catch (error) {
    showError(error instanceof Error ? error.message : 'Não foi possível carregar o diagnóstico.')
  } finally {
    loading.hidden = true
  }
}

simulationForm.addEventListener('submit', async (event) => {
  event.preventDefault()
  const input = document.getElementById('simulate-company')
  const resultTarget = document.getElementById('simulation-result')
  const jsonTarget = document.getElementById('simulation-json')
  resultTarget.textContent = 'Calculando...'
  jsonTarget.textContent = ''

  try {
    const response = await fetch('/admin/company-zabbix-test/result', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      cache: 'no-store',
      body: JSON.stringify({ simulateCompanyName: input.value }),
    })
    if (response.status === 401) {
      authenticated.hidden = true
      showLogin()
      return
    }
    if (!response.ok) {
      throw new Error(`A simulação respondeu HTTP ${response.status}`)
    }

    const result = await response.json()
    renderMapping(result.simulation, resultTarget, jsonTarget)
  } catch (error) {
    resultTarget.textContent = error instanceof Error ? error.message : 'Não foi possível simular.'
  }
})

loadSession()
