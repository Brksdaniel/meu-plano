# Meu Plano

App web (PWA) de proteína diária, alimentos, peso e checklist. Next.js + Supabase + Vercel.

## 1. Supabase (banco e login)
1. Crie um projeto grátis em https://supabase.com
2. Abra **SQL Editor > New query**, cole todo o conteúdo de `supabase/schema.sql` e clique em **Run**.
3. Vá em **Project Settings > API** e copie a **Project URL** e a chave **anon public**.
4. (Opcional, mais prático para uso pessoal) Em **Authentication > Providers > Email**, desligue "Confirm email" para a conta funcionar logo após criar.

## 2. Rodar no VS Code
```bash
npm install
cp .env.example .env.local   # preencha as duas variáveis com os dados do passo 1
npm run dev
```
Abra http://localhost:3000, crie a conta e teste.

## 3. Publicar na Vercel
1. Suba a pasta num repositório no GitHub (o `.env.local` NÃO sobe, já está no `.gitignore`).
2. Em https://vercel.com, **Add New > Project**, escolha o repositório.
3. Em **Environment Variables**, cadastre `NEXT_PUBLIC_SUPABASE_URL` e `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
4. **Deploy**. A cada `git push`, a Vercel atualiza sozinha.

## 4. Colocar no iPhone
Abra o link da Vercel no **Safari** > botão Compartilhar > **Adicionar à Tela de Início**.

## Observações
- A chave `anon` é pública por natureza; quem protege os dados são as regras RLS do `schema.sql`.
- Os valores de proteína das sugestões são aproximados. Ajuste na aba Alimentos conforme o rótulo.
