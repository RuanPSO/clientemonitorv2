export interface GraphUser {
  id?: string
  displayName?: string
  mail?: string | null
  companyName?: string | null
  jobTitle?: string | null
  department?: string | null
  officeLocation?: string | null
  mobilePhone?: string | null
  businessPhones?: string[]
  preferredLanguage?: string | null
  userPrincipalName?: string | null
  tenantId?: string
  tid?: string
  [key: string]: unknown
}

export function normalizeUserProfile(data: GraphUser, accountTenantId = '') {
  const normalized = {
    id: data.id ?? '',
    displayName: data.displayName ?? '',
    email: data.mail || data.userPrincipalName || '',
    companyName: data.companyName ?? '',
    jobTitle: data.jobTitle ?? '',
    department: data.department ?? '',
    officeLocation: data.officeLocation ?? '',
    mobilePhone: data.mobilePhone ?? '',
    businessPhones: data.businessPhones ?? '',
    preferredLanguage: data.preferredLanguage ?? '',
    userPrincipalName: data.userPrincipalName ?? '',
    tenantId: data.tenantId ?? data.tid ?? accountTenantId,
    raw: data,
  }

  return normalized
}
