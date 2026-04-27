const Groq = require("groq-sdk");

function getClient() {
  const key = process.env.GROQ_API_KEY;
  if (!key || key === "gsk_ta_cle_ici") {
    throw new Error("GROQ_API_KEY non configurée dans .env");
  }
  return new Groq({ apiKey: key });
}

async function callGroq(prompt) {
  console.log("🤖 Appel Groq...");
  const client = getClient();
  const response = await client.chat.completions.create({
    model: "llama-3.3-70b-versatile",
    messages: [{ role: "user", content: prompt }],
    temperature: 0.1,
    max_tokens: 1024,
  });
  console.log("✅ Réponse Groq reçue");
  return response.choices[0].message.content;
}

function extractJSON(text) {
  const cleaned = text.replace(/```json|```/g, "").trim();
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("Format IA invalide — JSON introuvable");
  try {
    return JSON.parse(match[0]);
  } catch {
    throw new Error("Format IA invalide — JSON mal formé");
  }
}

// ── 1. Générer les tâches d'un projet ──────────────────────────
async function analyzeProject(title, description) {
  const prompt = `Tu es un assistant de gestion de projet professionnel. Réponds UNIQUEMENT en JSON valide, sans texte avant ou après.
Projet :
- Titre : ${title}
- Description : ${description}
JSON attendu :
{
  "correctedDescription": "description corrigée en français professionnel",
  "tasks": [
    {"title": "Titre tâche", "description": "Description courte", "estimatedHours": 4, "type": "Développement"}
  ]
}
Analyse attentivement la description du projet et génère le nombre de tâches EXACT nécessaire pour réaliser ce projet complètement.
Ne génère ni trop peu ni trop — si le projet est simple génère 2-3 tâches, si il est complexe génère 10-15 tâches ou plus.
Le nombre de tâches doit être justifié par la complexité réelle du projet décrit.
Types autorisés : Analyse, Développement, Test, Documentation, Déploiement.`;


  const text = await callGroq(prompt);
  const parsed = extractJSON(text);
  if (!parsed.correctedDescription || !Array.isArray(parsed.tasks)) {
    throw new Error("Format IA invalide");
  }
  return parsed;
}

// ── 2. Analyser le risque d'un projet ──────────────────────────
async function analyzeProjectRisk(project) {
  const prompt = `Tu es un expert en gestion de projet. Réponds UNIQUEMENT en JSON valide.
Données du projet :
- Nom : ${project.name}
- Tâches totales : ${project.totalTasks}
- Tâches terminées : ${project.doneTasks}
- Tâches en retard : ${project.lateTasks}
- Progression : ${project.progress}%
JSON attendu :
{"riskScore": 25, "status": "bon", "explanation": "explication en français"}
Règles : bon = 0-33, attention = 34-66, danger = 67-100`;

  const text = await callGroq(prompt);
  return extractJSON(text);
}

// ── 3. Chat IA sur un projet ───────────────────────────────────
async function chatWithAI(projectContext, question) {
  const prompt = `Tu es un assistant de gestion de projet. Réponds en français en 2-3 phrases max.
Contexte : ${JSON.stringify(projectContext)}
Question : ${question}`;

  const text = await callGroq(prompt);
  return { answer: text.trim() };
}

// ── 4. Rapport hebdomadaire ────────────────────────────────────
async function generateWeeklyReport(projects) {
  const prompt = `Génère un rapport hebdomadaire professionnel. Réponds UNIQUEMENT en JSON valide.
Projets : ${JSON.stringify(projects)}
JSON attendu :
{
  "summary": "résumé général",
  "positives": ["point positif 1", "point positif 2"],
  "warnings": ["alerte 1"],
  "recommendations": ["conseil 1", "conseil 2"]
}`;

  const text = await callGroq(prompt);
  return extractJSON(text);
}

// ── 5. Plan de travail pour une tâche ─────────────────────────
async function generateTaskPlan(task) {
  const prompt = `Tu es un assistant de gestion de projet. Réponds UNIQUEMENT en JSON valide.
Voici une tâche assignée à un étudiant :
- Titre : ${task.title}
- Description : ${task.description}
- Type : ${task.type || "Développement"}
- Heures estimées : ${task.estimatedHours || "non défini"}
Génère un plan de travail détaillé.
JSON attendu :
{
  "summary": "résumé en 1 phrase de ce que l'étudiant doit faire",
  "steps": [
    {"order": 1, "title": "Titre étape", "description": "Ce qu'il faut faire", "duration": "30 min"}
  ],
  "tips": ["conseil pratique 1", "conseil pratique 2"],
  "tools": ["outil recommandé"]
}
Génère entre 4 et 6 étapes réalistes.`;

  const text = await callGroq(prompt);
  return extractJSON(text);
}

// ── 6. Guide Q&R automatique pour une tâche ───────────────────
async function generateTaskGuide(task) {
  const prompt = `Tu es un assistant pédagogique pour étudiants en informatique. Réponds UNIQUEMENT en JSON valide.
Tâche :
- Titre : ${task.title}
- Description : ${task.description}
Génère automatiquement 4 questions-réponses qui aident l'étudiant à comprendre et réaliser cette tâche.
JSON attendu :
{
  "introduction": "phrase d'introduction motivante en français",
  "qna": [
    {"question": "Question clé", "answer": "Réponse claire en français"}
  ],
  "motivation": "phrase de motivation finale"
}
Génère exactement 4 questions-réponses pédagogiques.`;

  const text = await callGroq(prompt);
  return extractJSON(text);
}

// ── 7. Détection de blocage d'une tâche ───────────────────────
async function detectTaskBlockage(task) {
  const prompt = `Tu es un expert en gestion de projet. Réponds UNIQUEMENT en JSON valide.
Une tâche semble bloquée :
- Titre : ${task.title}
- Description : ${task.description}
- Statut actuel : ${task.status}
- Jours sans avancement : ${task.daysStuck || "inconnu"}
Analyse la situation et propose des solutions concrètes.
JSON attendu :
{
  "isBlocked": true,
  "reason": "raison probable du blocage en français",
  "solutions": [
    {"title": "Solution 1", "description": "explication concrète", "priority": "haute"}
  ],
  "urgency": "faible"
}
urgency : "faible", "moyenne", "haute"
Génère 3 solutions concrètes.`;

  const text = await callGroq(prompt);
  return extractJSON(text);
}

// ── 8. Résumé personnalisé pour un membre ─────────────────────
async function generateMemberSummary(member) {
  const prompt = `Tu es un assistant de gestion de projet. Réponds UNIQUEMENT en JSON valide.
Voici les données d'un membre de l'équipe :
- Nom : ${member.name}
- Tâches assignées : ${member.totalTasks}
- Tâches terminées : ${member.doneTasks}
- Tâches en retard : ${member.lateTasks}
- Tâches en cours : ${member.inProgressTasks}
Liste des tâches : ${JSON.stringify(member.tasks || [])}
Génère un résumé personnalisé et motivant.
JSON attendu :
{
  "greeting": "message personnalisé avec le prénom",
  "accomplished": "ce qu'il a accompli cette semaine",
  "inProgress": "ce qu'il est en train de faire",
  "nextPriority": "la prochaine tâche prioritaire à faire",
  "encouragement": "message d'encouragement personnalisé",
  "alert": "alerte si des tâches sont en retard, sinon null"
}`;

  const text = await callGroq(prompt);
  return extractJSON(text);
}

module.exports = {
  analyzeProject,
  analyzeProjectRisk,
  chatWithAI,
  generateWeeklyReport,
  generateTaskPlan,
  generateTaskGuide,
  detectTaskBlockage,
  generateMemberSummary,
};