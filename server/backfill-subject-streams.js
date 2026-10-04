import "dotenv/config";
import { db } from "./db.js";

// =========================================================================
// Backfill: Best-effort Subject -> stream tagging (NON-DESTRUCTIVE)
//
// Purpose: Senior Secondary subjects (Class 11/12) are now stream-aware.
// Existing tenants have subjects with `applicable_stages` but no `streams`
// linkage. This script assigns stream tags on a BEST-EFFORT, AMBIGUOUS basis
// so the Student form can filter subjects once a Section/stream is chosen.
//
// IMPORTANT: This is NOT authoritative curriculum truth. The mapping is
// heuristic, and admins can always refine subject streams later in
// Academic Setup. Only subjects that already carry `applicable_stages`
// including "senior_secondary" are considered.
//
// Rules (per approved decision):
//   1. If a subject already has a non-empty `streams` array -> PRESERVE
//      exactly. Never overwrite.
//   2. Science dept -> all three Science streams (historical data cannot
//      distinguish Bio / Non-Medical / PCMB).
//   3. Commerce dept -> Commerce.
//   4. Social Studies dept -> Humanities.
//   5. Languages dept -> all active Senior Secondary streams (shared
//      language core appears across every stream).
//   6. All other departments (Mathematics, IT, Physical Education, Arts,
//      Vocational, General, etc.) -> left untagged (ambiguous). Admin refines
//      later. Never guess.
//
// Stream ids mirror STREAM_DEFINITIONS / Section.stream used elsewhere in the
// codebase (Science-Bio, Science-Math, Science-PCMB, Commerce, Humanities).
// =========================================================================

const SCIENCE_STREAMS = ["Science-Bio", "Science-Math", "Science-PCMB"];
const ALL_SENIOR_STREAMS = ["Science-Bio", "Science-Math", "Science-PCMB", "Commerce", "Humanities"];

const streamForDept = (dept) => {
  const d = String(dept || "").trim().toLowerCase();
  if (d === "science") return SCIENCE_STREAMS;
  if (d === "commerce") return ["Commerce"];
  if (d === "social studies") return ["Humanities"];
  if (d === "languages") return ALL_SENIOR_STREAMS;
  return null;
};

async function main() {
  const database = await db();
  const coll = database.collection("Subject");

  const subjects = await coll.find({}).toArray();
  let preserved = 0;
  let tagged = 0;
  let skipped = 0;
  const taggedByDept = {};
  const report = [];

  for (const subj of subjects) {
    if (Array.isArray(subj.streams) && subj.streams.length > 0) {
      preserved++;
      continue;
    }

    const stages = Array.isArray(subj.applicable_stages) ? subj.applicable_stages : [];
    if (!stages.includes("senior_secondary")) {
      skipped++;
      continue;
    }

    const streams = streamForDept(subj.department);
    if (!streams) {
      skipped++;
      continue;
    }

    await coll.updateOne(
      { _id: subj._id },
      { $set: { streams, updated_date: new Date().toISOString() } }
    );
    tagged++;
    taggedByDept[subj.department] = (taggedByDept[subj.department] || 0) + 1;
    report.push({
      tenant_id: subj.tenant_id || "(platform)",
      name: subj.name,
      department: subj.department || "General",
      streams,
      source: "backfill_best_effort",
    });
  }

  console.log(`Subject->stream backfill complete.`);
  console.log(`  Preserved (already had streams): ${preserved}`);
  console.log(`  Tagged (best-effort):            ${tagged}`);
  console.log(`  Skipped (no senior stage / ambiguous dept): ${skipped}`);
  console.log("");
  console.log("Tagged by department:");
  for (const [dept, count] of Object.entries(taggedByDept)) {
    console.log(`  - ${dept}: ${count}`);
  }
  if (report.length) {
    console.log("");
    console.log("Mapped records (best-effort, NOT authoritative; refine via Academic Setup):");
    for (const r of report) {
      console.log(`  [${r.department}] ${r.name} -> ${r.streams.join(", ")} (source: ${r.source})`);
    }
  }
  console.log("");
  console.log("No records were modified that already had explicit streams. Existing data untouched otherwise.");
  process.exit(0);
}

main().catch((err) => {
  console.error("Backfill failed:", err);
  process.exit(1);
});