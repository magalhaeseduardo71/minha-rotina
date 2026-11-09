/* Configuração pública do Firebase (não é segredo: o acesso é protegido pelas regras do Firestore).
   Preencha com os dados do app Web em: Console do Firebase › Configurações do projeto › Seus apps.
   Deixando apiKey vazio, o app funciona em modo local (dados só no aparelho). */
self.FIREBASE_CONFIG = {
  apiKey: "",
  authDomain: "",
  projectId: "",
  storageBucket: "",
  messagingSenderId: "",
  appId: ""
};
/* Opcional: chave Web Push própria. Vazio = usa a chave padrão do Firebase. */
self.VAPID_KEY = "";
