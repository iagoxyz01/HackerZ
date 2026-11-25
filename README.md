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
2. Execute `supabase/schema.sql` no SQL Editor. A migração atualiza o modelo de credenciais; jogadores que já estavam em salas antigas precisarão entrar em uma nova sala para receber uma sessão individual.
3. Copie Project URL e anon/public key em Project Settings → API.
4. Configure `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY` no ambiente.
5. Reinicie o servidor.

## Publicação
Importe o repositório na Vercel, cadastre as duas variáveis de ambiente e publique.

## Segurança e funcionamento
- Tokens aleatórios por jogador e operador; o banco armazena hashes, não os tokens.
- RPCs validam a sessão antes de aceitar respostas, pontuação ou ativação de blindagem.
- O ID público do jogador, sozinho, não autoriza ações.
- Limites de rodadas e tempo são verificados no backend.
- O token de sessão é guardado no sessionStorage para permitir recarregar a aba; ele não deve ser compartilhado.
- A mecânica antiga de adivinhar senha foi removida; a blindagem é uma habilidade fictícia do jogo.
- Salas e sessões criadas antes da migração devem ser substituídas por novas salas para que cada participante receba uma credencial própria.

Nunca coloque a chave service-role no frontend. A chave anon/public é a única chave Supabase esperada no navegador. Esta branch ainda precisa de execução real do SQL no projeto Supabase, build de produção e teste multiplayer antes de ser promovida para main.
