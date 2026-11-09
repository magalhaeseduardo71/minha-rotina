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
1. Firebase: criar projeto, ativar o plano Blaze, ativar Authentication › E-mail/senha,
   criar o Firestore, adicionar um app Web e gerar o certificado Web Push (Cloud Messaging).
2. Preencher `firebase-config.js` (dados públicos) e `firebase/.firebaserc`.
3. No GitHub (Settings › Secrets and variables › Actions):
   - Secret `FIREBASE_SERVICE_ACCOUNT`: JSON da conta de serviço do projeto.
   - Variable `FIREBASE_PROJECT_ID`: id do projeto.
4. Settings › Pages › Source: **GitHub Actions**.
5. No Firebase Authentication › Settings › Domínios autorizados: adicionar `magalhaeseduardo71.github.io`.

## No iPhone
Abra o endereço no Safari › Compartilhar › **Adicionar à Tela de Início** › abra pelo ícone ›
entre na conta › ative o Face ID › Ajustes (sino) › **Ativar** notificações › **Testar**.
