# HackerZ — Digital Underworld

Jogo educativo multiplayer sobre redes sociais, privacidade e saúde digital, para até 30 jogadores por sala.
Estética inspirada em Devil May Cry: preto, vermelho-sangue, blackletter e interface técnica.
**Tudo é fictício** — as mecânicas de ataque e defesa são parte do jogo, ninguém é invadido de verdade.

React + Vite + Supabase (Postgres/RPC) + Vercel.

## Como o jogo funciona

1. Alguém **cria a sala** e recebe um código de 6 caracteres. O criador **também joga**.
2. Os outros entram com o código. Entrada tardia é permitida; codinomes são únicos por sala.
3. O criador inicia a partida. **Todos recebem a mesma pergunta ao mesmo tempo**; o cronômetro usa o relógio do servidor.
4. Acertos rendem pontos e créditos. Com 50 créditos: **blindagem** (bloqueia um ataque) ou **ataque** (tira até 75 pontos de um rival, 1 por rodada; o atacante fica com metade).
5. A próxima rodada libera quando todos responderem ou o tempo acabar. Ao final, todos veem o **ranking**.

### Telas

| Rota | Para quem | O que é |
|---|---|---|
| `#/` | jogadores (inclusive o criador) | início, sala de espera, rodada, resultados |
| `#/operator/CÓDIGO` | operador | **painel de monitoramento, somente leitura** (não é tela de jogo) |
| `#/diag` | quem administra | diagnóstico: variáveis do build, API, funções e permissões do Supabase |

O painel do operador mostra: jogadores conectados, rodada atual, quem ataca quem, ataques recebidos, pontos perdidos,
defesas ativas, histórico de eventos, ranking em tempo real e a situação geral da partida. O criador abre o painel pelo
botão **Painel do operador** (outra aba) e continua jogando na aba de jogador.

## Executar localmente

```bash
npm install
cp .env.example .env     # preencha com a URL e a chave PÚBLICA do seu projeto Supabase
npm run dev
```

Sem as variáveis o site **não** abre em "modo demonstração": ele mostra uma tela explicando o que falta
(o multiplayer depende do servidor). Abra `#/diag` para ver exatamente o que está errado.

## Configurar o Supabase (ordem importa)

No **SQL Editor**, execute nesta ordem:

1. `supabase/schema.sql` — tabelas, views e RPCs seguras (tokens guardados só como hash).
2. `supabase/002_operator_events.sql` — eventos, ataque/defesa, presença e painel do operador.
   É **aditiva e idempotente** (não apaga dados; pode ser reexecutada).

Depois copie **Project URL** e a chave **anon/publishable** (Project Settings → API).
Nunca use a chave `service_role`/`secret` no frontend — o site se recusa a iniciar com ela.

## Publicar na Vercel

1. Importe o repositório (framework **Vite**; o `vercel.json` já define build e cabeçalhos).
2. **Settings → Environment Variables:** cadastre `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY`
   para **Production e Preview**.
3. **Faça um novo deploy.** As variáveis `VITE_*` são embutidas no site *na hora da compilação*:
   cadastrá-las depois do último deploy não muda o site já publicado.
4. Abra `https://SEU-SITE/#/diag` — todas as linhas devem estar verdes.

## Testes

```bash
cd tests && npm install
npm run test:sql      # 17 testes das regras do banco (Postgres em WASM, papel anon)
npm run test:config   # 6 cenários de variáveis de ambiente no navegador
npm run test:e2e      # partida completa com dois navegadores isolados
SHOTS=./capturas npm run test:e2e   # também salva capturas de tela
```

O teste ponta a ponta compila o front, sobe uma API local com o mesmo contrato do Supabase por cima do Postgres de
teste e joga uma partida com criador + convidado + painel do operador (60 verificações). Requer Google Chrome
(`CHROME=/caminho/do/chrome` se não estiver no local padrão).

## Segurança

- Tokens aleatórios de 256 bits por jogador e por operador; o banco guarda apenas o hash SHA-256.
- Tabelas fechadas para `anon`/`authenticated`; o navegador só lê views seguras (`room_state`, `player_roster`,
  `room_feed`) e chama RPCs que validam o token. A resposta certa e a explicação nunca saem da view antes de o jogador responder.
- Pontuação, ataque, defesa, limites de rodada e tempo são validados **no banco**, não no navegador.
- O link do painel do operador contém a chave de operador: não o compartilhe com jogadores.
- As views `room_state`/`player_roster`/`room_feed` e as RPCs são `SECURITY DEFINER` **de propósito** (é o que permite
  manter as tabelas fechadas); os avisos correspondentes do Supabase Advisor são esperados.

## Limites conhecidos

- A sincronização é por *polling* (1 chamada por segundo por jogador, 4 s com a aba em segundo plano), não por Realtime:
  é mais simples e robusto, e suficiente para 30 jogadores por sala.
- Salas criadas com versões anteriores do esquema devem ser substituídas por salas novas.
