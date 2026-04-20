// fix-members.js
// Lance avec : node fix-members.js
// Ce script resynchronise les membres de tous les projets depuis OpenProject

require("dotenv").config({ path: require("path").resolve(__dirname, ".env") });

const { db, getSessionByUser, upsertUser, upsertProjectMember, getMemberRole } = require("./src/database/db");
const axios = require("axios");

const BASE_URL = process.env.OP_BASE_URL;

function makeAuthHeader(opToken) {
  return {
    Authorization: "Basic " + Buffer.from(`apikey:${opToken}`).toString("base64"),
    "Content-Type": "application/json",
  };
}

async function fixMembers() {
  console.log("🔧 Démarrage de la correction des membres...\n");

  // 1. Récupère tous les users avec leur session
  const users = db.prepare("SELECT * FROM users").all();
  console.log(`👥 Users trouvés : ${users.length}`);

  // 2. Trouve un token valide (admin de préférence)
  let opToken = null;
  let tokenUser = null;

  for (const user of users) {
    const session = getSessionByUser(user.op_user_id);
    if (session?.op_token) {
      opToken = session.op_token;
      tokenUser = user;
      console.log(`✅ Token trouvé via : ${user.name}`);
      break;
    }
  }

  if (!opToken) {
    console.error("❌ Aucun token valide trouvé. Reconnecte-toi d'abord.");
    process.exit(1);
  }

  // 3. Récupère tous les projets depuis OpenProject
  console.log("\n📁 Récupération des projets depuis OpenProject...");
  const projectsRes = await axios.get(`${BASE_URL}/api/v3/projects?pageSize=50`, {
    headers: makeAuthHeader(opToken),
    timeout: 10000,
  });
  const projects = projectsRes.data._embedded.elements;
  console.log(`✅ ${projects.length} projets trouvés\n`);

  // 4. Pour chaque projet, récupère les membres et les insère en base
  for (const project of projects) {
    console.log(`\n🔄 Projet : ${project.name} (id: ${project.id})`);

    try {
      const filters = encodeURIComponent(
        JSON.stringify([{ project: { operator: "=", values: [String(project.id)] } }])
      );
      const membRes = await axios.get(
        `${BASE_URL}/api/v3/memberships?filters=${filters}&pageSize=100`,
        { headers: makeAuthHeader(opToken), timeout: 10000 }
      );
      const memberships = membRes.data._embedded?.elements || [];
      console.log(`   ${memberships.length} membership(s) trouvé(s)`);

      for (const m of memberships) {
        const userHref = m._links?.principal?.href;
        if (!userHref) continue;
        const userId = Number(userHref.split("/").pop());
        if (!userId || isNaN(userId)) continue;

        // Détermine le rôle (cherche "manager" dans les rôles OP)
        const roles = m._links?.roles || [];
        const isManager = roles.some((r) =>
          r.title?.toLowerCase().includes("manager") ||
          r.title?.toLowerCase().includes("project admin") ||
          r.title?.toLowerCase().includes("chef")
        );
        const role = isManager ? "manager" : "member";

        // Récupère les infos user depuis OP si pas encore en base
        let userInDb = db.prepare("SELECT * FROM users WHERE op_user_id = ?").get(userId);
        if (!userInDb) {
          try {
            const userRes = await axios.get(`${BASE_URL}${userHref}`, {
              headers: makeAuthHeader(opToken),
              timeout: 8000,
            });
            const u = userRes.data;
            upsertUser(userId, {
              name: u.name || u.login || `User #${userId}`,
              email: u.email || `user${userId}@openproject.local`,
              isAdmin: false,
            });
            console.log(`   ➕ User créé : ${u.name}`);
          } catch {
            console.log(`   ⚠️  User ${userId} inaccessible, skip`);
            continue;
          }
        }

        // Insère le membre dans project_members
        upsertProjectMember(userId, project.id, { role });
        console.log(`   ✅ Membre ajouté : userId=${userId} role=${role}`);
      }

    } catch (err) {
      console.log(`   ⚠️  Erreur pour ce projet : ${err.message}`);
    }
  }

  // 5. Résultat final
  console.log("\n\n=== RÉSULTAT FINAL ===");
  const allMembers = db.prepare("SELECT * FROM project_members").all();
  console.log(`✅ ${allMembers.length} entrée(s) dans project_members`);
  console.log(allMembers);

  // 6. Marque maria comme admin dans project_members aussi (si elle est manager)
  const maria = users.find(u => u.is_admin === 1);
  if (maria) {
    console.log(`\n👑 Admin détecté : ${maria.name} (id: ${maria.op_user_id})`);
    for (const project of projects) {
      const existing = getMemberRole(maria.op_user_id, project.id);
      if (!existing) {
        upsertProjectMember(maria.op_user_id, project.id, { role: "manager" });
        console.log(`   ✅ ${maria.name} ajouté comme manager dans projet ${project.id}`);
      }
    }
  }

  console.log("\n✅ Correction terminée ! Rafraîchis l'application.");
}

fixMembers().catch((err) => {
  console.error("❌ Erreur fatale :", err.message);
  process.exit(1);
});