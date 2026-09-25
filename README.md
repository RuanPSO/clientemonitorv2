# Portal Interno Backend

Backend responsável por fornecer APIs para os projetos internos, centralizando autenticação, regras de negócio, integrações e acesso aos dados necessários para o funcionamento do portal e dos sistemas conectados.

Esta branch representa a evolução da solução em migração de Python para TypeScript, com foco em maior organização, manutenção, tipagem, performance e padronização do código. O objetivo é manter o mesmo funcionamento do backend atual, porém com uma arquitetura mais moderna, escalável e adequada ao ecossistema atual da aplicação.

## Objetivo
- Expor endpoints para consumo por outros projetos e aplicações;
- Centralizar integrações com bancos de dados, autenticação e serviços externos;
- Suportar o portal interno com acesso via Microsoft Entra ID;
- Modernizar a base de código em TypeScript durante a migração do backend.

## Stack principal
- Node.js + TypeScript
- Express
- Prisma
- PostgreSQL
- JWT / autenticação
- Microsoft Entra ID

## Nome sugerido para a branch ou projeto
- portal-interno-backend
- portal-interno-api
- backend-portal-interno

- Atualização - parametro de desenvolvimento ativos para adicionar novas funções e novas rotas para aplicações
> Sugestão principal: portal-interno-backend
