# Minha Rotina

App de rotina diária para iPhone (PWA): entrada com Face ID, atividades do dia,
dias anteriores somente leitura e lembretes push (inclusive com a tela bloqueada).

## Como funciona
- **App** (`index.html`, `app.js`, `styles.css`, `sw.js`): publicado no GitHub Pages.
- **Dados**: Firebase Auth (e-mail/senha, uma vez por aparelho) + Firestore.
- **Lembretes**: a função `lembretes` (Cloud Functions, a cada minuto) envia push via
  Firebase Cloud Messaging às 9h do dia, 1 hora antes e/ou na hora.
- **Regra**: só o dia de hoje pode ser marcado como concluído.

## Configuração (uma vez)
1. Criar o projeto no Firebase e ativar o plano Blaze.
2. Gerar a chave da conta de serviço e colocar no GitHub como secret `FIREBASE_SERVICE_ACCOUNT`.
3. No IAM do Google Cloud, dar o papel **Proprietário** a essa conta de serviço.
4. Rodar o workflow **Configurar e publicar Firebase**: ele ativa os serviços, cria o Firestore,
   liga o login por e-mail/senha, autoriza o domínio, registra o app Web e publica regras e lembretes.
5. Copiar a configuração mostrada no log para `firebase-config.js`.

## No iPhone
Abra o endereço no Safari › Compartilhar › **Adicionar à Tela de Início** › abra pelo ícone ›
entre na conta › ative o Face ID › Ajustes (sino) › **Ativar** notificações › **Testar**.
