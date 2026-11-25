# HackerZ — Cyber Learning Arena
Jogo educativo com visual cyberpunk sobre **redes sociais e saúde mental**, pensado para até 30 jogadores por sala.

## O que já está no projeto
- Criar sala e entrar por código.
- Painel do operador, lista de participantes e limite de 30 jogadores.
- Perguntas com quatro alternativas e níveis Fácil, Normal, Média e Difícil.
- Banco inicial de 24 questões sobre autoestima, cyberbullying, algoritmos, sono, FOMO, privacidade, desinformação e bem-estar digital.
- Pontuação por dificuldade, cronômetro, feedback educativo e ranking.
- Estrutura Supabase para salas, jogadores, respostas, RPCs e eventos de ataque.
- Interface responsiva para computador e celular.

## Executar localmente
```bash
npm install
cp .env.example .env
npm run dev
```
Sem credenciais Supabase, o modo de demonstração abre localmente; não sincroniza entre celulares.

## Ativar multiplayer
1. Crie um projeto no Supabase.
2. Execute `supabase/schema.sql` no SQL Editor.
3. Copie Project URL e anon/public key em Project Settings → API.
4. Configure `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY` no ambiente.
5. Reinicie o servidor.

## Publicação
Importe o repositório na Vercel, cadastre as duas variáveis de ambiente e publique.

## Atenção sobre segurança
Esta é uma base avançada de MVP, ainda não auditada para produção pública. O próximo ciclo deve implementar identidade de sessão forte para jogadores, credenciais privadas separadas da tabela pública, recuperação/definição de senha de ataque, validação de identidade em cada RPC, encerramento automático de salas, sincronização completa de cronômetro e testes concorrentes. Nunca coloque a chave service-role no frontend. Antes de uso público, revise as políticas RLS e o modelo de autenticação.
