// services/host-classifier.service.ts

export interface OsData {
  type: string
  name: string
}

export interface ClassificacaoHost {
  categoria: string
  icone: string
  titulo: string
}

export interface ClassifyInput {
  hostid: bigint | number | string
  osData: OsData | null
  templates?: string[]
  services?: string[]
  groups?: string[]
  interfaceType?: string | null
}

export class HostClassifier {
  static classify(input: ClassifyInput): ClassificacaoHost {
    const templates = (input.templates ?? []).map((x) => String(x).toLowerCase())
    const services = (input.services ?? []).map((x) => String(x).toLowerCase())
    const groups = (input.groups ?? []).map((x) => String(x).toLowerCase())

    const templatesTxt = templates.join(' ')
    const servicesTxt = services.join(' ')
    const groupsTxt = groups.join(' ')

    // ───────── FIREWALLS ─────────
    if (templatesTxt.includes('fortigate')) {
      return { categoria: 'fortigate', icone: '🔒', titulo: 'Firewall Fortigate' }
    }
    if (templatesTxt.includes('sophos')) {
      return { categoria: 'sophos', icone: '🔒', titulo: 'Firewall Sophos' }
    }
    if (templatesTxt.includes('pfsense')) {
      return { categoria: 'pfsense', icone: '🔒', titulo: 'Firewall pfSense' }
    }

    // ───────── REDE ─────────
    if (templatesTxt.includes('mikrotik')) {
      return { categoria: 'mikrotik', icone: '📡', titulo: 'Mikrotik' }
    }
    if (templatesTxt.includes('cisco')) {
      return { categoria: 'cisco', icone: '📡', titulo: 'Cisco' }
    }

    // ───────── SAP ─────────
    if (servicesTxt.includes('sap')) {
      return { categoria: 'sap', icone: '🏢', titulo: 'Servidor SAP' }
    }

    // ───────── GOGLOBAL ─────────
    if (servicesTxt.includes('ggaps')) {
      return { categoria: 'goglobal', icone: '🖥️', titulo: 'Servidor GoGlobal' }
    }

    // ───────── SQL ─────────
    if (servicesTxt.includes('mssqlserver')) {
      return { categoria: 'sqlserver', icone: '🗄️', titulo: 'SQL Server' }
    }
    if (servicesTxt.includes('postgresql')) {
      return { categoria: 'postgresql', icone: '🐘', titulo: 'PostgreSQL' }
    }

    // ───────── VPN ─────────
    if (groupsTxt.includes('vpn') || templatesTxt.includes('vpn')) {
      return { categoria: 'vpn', icone: '🔐', titulo: 'VPN' }
    }

    // ───────── LINK INTERNET ─────────
    if (input.interfaceType === 'SNMP' && !input.osData) {
      return { categoria: 'link', icone: '🌐', titulo: 'Link Internet' }
    }

    // ───────── SISTEMA OPERACIONAL ─────────
    if (input.osData?.type === 'windows') {
      return { categoria: 'windows', icone: '💽', titulo: 'Servidor Windows' }
    }
    if (input.osData?.type === 'linux') {
      return { categoria: 'linux', icone: '🐧', titulo: 'Servidor Linux' }
    }

    return { categoria: 'unknown', icone: '❓', titulo: 'Desconhecido' }
  }
}