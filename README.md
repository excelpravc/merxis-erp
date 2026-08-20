# ERP Varejo — SaaS multiempresa para supermercados e varejo

**Fase 1 concluída:** estrutura do projeto, frontend base, banco Turso, autenticação,
empresas/filiais e RBAC (perfis e permissões). As fases seguintes (produtos, estoque,
compras, vendas/PDV, financeiro, fiscal, relatórios, planos/assinaturas) serão
construídas em cima desta fundação, conforme o plano de fases do briefing original.

---

## 1. Tecnologias

- **Frontend:** React 18 + TypeScript + Vite + Tailwind CSS + React Router
- **Backend:** Funções serverless em `/api` (padrão Vercel), TypeScript
- **Banco de dados:** Turso (libSQL / SQLite distribuído) — único banco do projeto
- **Autenticação:** cookie de sessão `httpOnly` assinado com JWT + senha com hash `bcrypt`
- **Validação:** [zod](https://zod.dev) no backend

## 2. Estrutura de pastas

Conforme a regra do projeto, **apenas a raiz e `/api`** existem — sem subpastas:

```
/
  index.html, main.tsx, App.tsx, index.css       -> bootstrap do frontend
  AuthProvider.tsx, ProtectedRoute.tsx            -> autenticação/roteamento
  auth.ts, api.ts, permissions.ts, types.ts       -> lógica compartilhada do frontend
  Login.tsx, Layout.tsx, Dashboard.tsx            -> telas
  Companies.tsx, Users.tsx, Roles.tsx, SettingsPage.tsx
  package.json, vite.config.ts, tsconfig*.json, tailwind.config.ts

/api
  _db.ts, _auth.ts, _http.ts, _tenant.ts, _audit.ts   -> helpers compartilhados
                                                          (prefixo "_" = não vira rota)
  schema.sql, _migrate.ts                              -> schema e seed do Turso
  auth.ts, companies.ts, users.ts, roles.ts            -> endpoints (1 arquivo = 1 rota)
```

Cada arquivo em `/api` sem `_` inicial vira automaticamente uma rota (`/api/auth`,
`/api/companies`, etc.) no padrão de Vercel Functions. Como não podemos ter
subpastas, cada arquivo trata múltiplas ações relacionadas via `action` no
corpo/query da requisição (ex.: `POST /api/auth { action: "login" }`).

## 3. Instalação local

```bash
npm install
cp .env.example .env
```

Preencha o `.env` com as credenciais do seu banco Turso (veja seção 4) e os
segredos de sessão (veja seção 5).

```bash
npm run migrate   # cria as tabelas no Turso
npm run seed       # cria permissões, perfis de sistema, planos e um tenant de demonstração
npm run dev        # inicia o Vite em http://localhost:5173
```

Para a API funcionar localmente junto com o frontend, use a CLI da Vercel:

```bash
npm i -g vercel
vercel dev
```

O `vercel dev` sobe frontend e funções de `/api` juntos. Se preferir rodar só o
`vite`, o `vite.config.ts` já contém um proxy de `/api` apontando para
`http://localhost:3000` — ajuste conforme onde suas funções estiverem servidas.

## 4. Configurando o Turso

1. Crie uma conta em [turso.tech](https://turso.tech) e instale a CLI.
2. Crie o banco:
   ```bash
   turso db create erp-varejo
   turso db show erp-varejo --url
   turso db tokens create erp-varejo
   ```
3. Copie a URL e o token para `TURSO_DATABASE_URL` e `TURSO_AUTH_TOKEN` no `.env`.
4. Rode `npm run migrate` (ou `npm run seed` para já popular dados iniciais).

## 5. Variáveis de ambiente

Veja `.env.example` para a lista completa. As essenciais para a Fase 1:

| Variável | Descrição |
|---|---|
| `TURSO_DATABASE_URL` | URL do banco Turso (ex: `libsql://erp-varejo-org.turso.io`) |
| `TURSO_AUTH_TOKEN` | Token de autenticação do banco |
| `JWT_SECRET` | Segredo para assinar o cookie de sessão — gere com `openssl rand -base64 48` |
| `SESSION_EXPIRATION_MINUTES` | Duração da sessão (padrão: 480 = 8h) |
| `LOGIN_MAX_ATTEMPTS` / `LOGIN_LOCKOUT_MINUTES` | Política de bloqueio por tentativas de login |

Nunca coloque valores reais no `.env.example` nem no controle de versão.

## 6. Criando o primeiro tenant, empresa e usuário

Duas formas:

**A) Via seed (recomendado para o primeiro ambiente):**
```bash
SEED_ADMIN_EMAIL=voce@suaempresa.com.br SEED_ADMIN_PASSWORD="uma-senha-forte" npm run seed
```
Isso cria um tenant de demonstração com um usuário Super Administrador.
Troque a senha imediatamente após o primeiro login.

**B) Via auto-cadastro (fluxo comercial normal de um SaaS):**
`POST /api/auth { action: "register", tenantName, adminName, email, password }`
cria uma nova conta (tenant), sua primeira empresa/administrador com o perfil
`company_admin`, e já inicia a sessão. Esse é o fluxo que uma tela pública de
"Criar conta" usaria.

Depois de logado, cadastre a empresa (razão social, CNPJ, regime tributário)
em **Empresas e filiais** — a matriz já vem com uma filial "001" criada
automaticamente.

## 7. Modelo de multiempresa (multi-tenancy)

- Todo registro sensível carrega `tenant_id`.
- O `tenant_id` nunca é aceito vindo do frontend: ele é sempre resolvido no
  backend a partir do cookie de sessão (`resolveSession` em `api/_tenant.ts`).
- Toda query do backend filtra explicitamente por `tenant_id = ?`.
- Um usuário do tenant A jamais enxerga dados do tenant B — isso é reforçado em
  cada endpoint (`companies.ts`, `users.ts`, `roles.ts`).

## 8. RBAC — perfis e permissões

- Permissões são pares `módulo:ação` (ex.: `companies:edit`, `users:manage_users`).
- **Perfis de sistema** (`roles.tenant_id IS NULL`) são modelos globais
  (Super Administrador, Administrador da Empresa, Gerente, Vendedor, etc.) com
  permissões padrão definidas no seed (`api/_migrate.ts`). Eles não podem ser
  editados por um tenant específico, pois isso afetaria todas as contas.
- **Perfis personalizados** (`roles.tenant_id = <tenant>`) são criados pelo
  próprio tenant na tela **Perfis e permissões** e podem ter qualquer
  combinação de permissões.
- O perfil `super_admin` tem acesso irrestrito (bypass) e é destinado à equipe
  da plataforma, não a clientes finais.

## 9. Segurança implementada nesta fase

- Senhas com hash `bcrypt` (nunca texto puro).
- Cookie de sessão `httpOnly`, `SameSite=Lax`, `Secure` em produção.
- Bloqueio temporário de conta após N tentativas de login incorretas
  (`LOGIN_MAX_ATTEMPTS` / `LOGIN_LOCKOUT_MINUTES`).
- Mensagens de erro genéricas em login (não revelam se o e-mail existe).
- Erros internos nunca vazam stack trace/SQL ao cliente (`api/_http.ts`).
- Toda escrita sensível é registrada em `audit_logs` (quem, quando, o quê,
  valor anterior/novo).
- Validação de entrada com `zod` em todos os endpoints.

## 10. O que ainda depende de configuração/integração externa

- **Emissão fiscal (NF-e/NFC-e):** não implementada nesta fase. Quando chegar
  na Fase 6 do plano, será necessária uma conta em um provedor autorizado
  (ex.: Focus NFe, eNotas) — variáveis `FISCAL_PROVIDER_*` já reservadas no
  `.env.example`.
- **Pagamentos/PIX:** idem, variável `PAYMENT_GATEWAY_API_KEY` reservada.
- **E-mail transacional** (recuperação de senha): variáveis `SMTP_*`
  reservadas; o endpoint de "esqueci minha senha" ainda não foi implementado
  nesta fase.
- **Backup do Turso:** siga a documentação oficial do Turso
  (`turso db shell <banco> .dump` ou o recurso de point-in-time recovery do
  plano contratado). Nenhum backup é simulado por este projeto.

## 11. Build e deploy

```bash
npm run build     # gera /dist (frontend) — tsc -b garante checagem de tipos
```

No deploy pela Vercel, configure as variáveis de ambiente do `.env.example`
no painel do projeto. As funções em `/api` são detectadas automaticamente;
arquivos prefixados com `_` não geram rotas públicas.

## 12. Troubleshooting

| Sintoma | Causa provável |
|---|---|
| `TURSO_DATABASE_URL não configurada` | `.env` não copiado/preenchido, ou variável não carregada pelo `vercel dev` |
| Login retorna 401 mesmo com senha certa | Rode `npm run seed` para garantir que os perfis de sistema existem |
| `403 Perfis de sistema não podem ser editados` | Esperado — crie um perfil personalizado em vez de editar um perfil de sistema |
| Sessão expira rápido demais | Ajuste `SESSION_EXPIRATION_MINUTES` no `.env` |

## 13. Próximas fases (não incluídas aqui)

Produtos/categorias/estoque · Compras e entrada de NF-e · Lotes/validade/
endereçamento · Vendas e PDV · Financeiro (contas a pagar/receber, fluxo de
caixa) · Documentos fiscais · Relatórios e dashboards avançados · Planos,
assinaturas e painel Super Admin da plataforma · Auditoria avançada, LGPD e
testes automatizados.
