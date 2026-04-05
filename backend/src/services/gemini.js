// Importer la librairie officielle pour utiliser l'API Gemini (Google AI)
const { GoogleGenerativeAI } = require("@google/generative-ai");
// Créer une instance de l'API Gemini en utilisant la clé API stockée dans .env
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
// Fonction qui analyse un projet avec l'IA
async function analyzeProject(title, description) {
    // Sélectionner le modèle Gemini utilisé
  const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash-lite" });
// Construire le prompt envoyé à l'IA
  const prompt = `
Tu es un assistant de gestion de projet professionnel.

Voici un projet :
- Titre : ${title}
- Description : ${description}

Ta mission :
1. Corriger l'orthographe et reformuler la description en français professionnel.
2. Proposer une liste de tâches structurées pour ce projet.

Réponds UNIQUEMENT en JSON valide, sans texte avant ou après, avec ce format exact :
{
  "correctedDescription": "description corrigée et reformulée",
  "tasks": [
    {
      "title": "Titre de la tâche",
      "description": "Description courte de la tâche",
      "estimatedHours": 8,
      "type": "Analyse"
    }
  ]
}

Types possibles : Analyse, Développement, Test, Documentation, Réunion, Déploiement.
Propose entre 4 et 8 tâches réalistes.
`;
  try {
  const result = await model.generateContent(prompt);
  const text = result.response.text();

  const cleaned = text.replace(/```json|```/g, "").trim();
  const parsed = JSON.parse(cleaned);  // ← stocker dans parsed

  // Vérifier le format
  if (!parsed.correctedDescription || !Array.isArray(parsed.tasks)) {
    throw new Error("Format de réponse IA invalide");
  }

  return parsed;  // ← un seul return à la fin

} catch (err) {
  if (err.message?.includes("429") || err.message?.includes("quota")) {
    throw new Error("Quota Gemini dépassé — génère une nouvelle clé sur aistudio.google.com");
  }
  if (err instanceof SyntaxError) {
    throw new Error("L'IA n'a pas retourné un JSON valide — réessaie");
  }
  throw err;
}}

module.exports = { analyzeProject };