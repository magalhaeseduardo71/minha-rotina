/* Configuração pública do Firebase (não é segredo: o acesso é protegido pelas regras do Firestore).
   Preencha com os dados do app Web em: Console do Firebase › Configurações do projeto › Seus apps.
   Deixando apiKey vazio, o app funciona em modo local (dados só no aparelho). */
self.FIREBASE_CONFIG = {
  apiKey: "AIzaSyAxpMSBVYNLlrlmbz7qBc0WQi6r0FB5MvQ",
  authDomain: "rotina-magalhaes.firebaseapp.com",
  projectId: "rotina-magalhaes",
  storageBucket: "rotina-magalhaes.firebasestorage.app",
  messagingSenderId: "772553818588",
  appId: "1:772553818588:web:53a9b1afc7c90416274f19"
};
/* Opcional: chave Web Push própria. Vazio = usa a chave padrão do Firebase. */
self.VAPID_KEY = "";
