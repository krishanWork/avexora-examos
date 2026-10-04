import "dotenv/config";
import bcrypt from "bcryptjs";
import { ObjectId } from "mongodb";
import { db } from "./db.js";

async function seed() {
  console.log("Connecting to database for seeding...");
  const database = await db();

  const now = new Date().toISOString();
  const passwordHash = await bcrypt.hash("ChangeMe123!", 10);

  // 1. Clear existing test data cleanly (except system user if present)
  console.log("Cleaning up collections...");
  const collectionsToClean = [
    "Announcement",
    "AnswerKey",
    "AuditLog",
    "Examination",
    "Lead",
    "OMRSheet",
    "Payment",
    "PlatformBranding",
    "Result",
    "SchoolClass",
    "Student",
    "Subject",
    "SubscriptionPlan",
    "Teacher",
    "Tenant",
    "TenantAnnouncement",
  ];

  for (const c of collectionsToClean) {
    await database.collection(c).deleteMany({});
  }

  // Preserve platform super admin, remove test staff/students
  await database.collection("User").deleteMany({ email: { $ne: "admin@example.com" } });

  // 2. Ensure Super Admin
  const adminUser = await database.collection("User").findOneAndUpdate(
    { email: "admin@example.com" },
    {
      $set: {
        email: "admin@example.com",
        full_name: "Platform Administrator",
        password_hash: passwordHash,
        role: "admin",
        app_role: "super_admin",
        app_roles: ["super_admin"],
        // Seed data is created by the operator running the script, never by a
        // public signup, so it is verified by construction. Present in $set (not
        // only $setOnInsert) so re-seeding an existing collection repairs the flag
        // rather than leaving a stale unverified account behind.
        email_verified: true,
        updated_date: now,
      },
      $setOnInsert: { created_date: now },
    },
    { upsert: true, returnDocument: "after" }
  );

  // 3. Subscription Plans
  console.log("Seeding Subscription Plans...");
  const planStandard = {
    _id: new ObjectId(),
    name: "Standard Institution",
    price: 4999,
    billing_cycle: "month",
    student_limit: 1000,
    omr_sheet_limit: 5000,
    exam_limit: 50,
    white_label_enabled: true,
    hide_powered_by_enabled: false,
    ai_enabled: true,
    parent_portal_enabled: true,
    whatsapp_enabled: true,
    custom_domain_enabled: false,
    created_date: now,
    updated_date: now,
  };

  const planEnterprise = {
    _id: new ObjectId(),
    name: "Enterprise Pro",
    price: 12999,
    billing_cycle: "month",
    student_limit: 10000,
    omr_sheet_limit: 50000,
    exam_limit: 500,
    white_label_enabled: true,
    hide_powered_by_enabled: true,
    ai_enabled: true,
    parent_portal_enabled: true,
    whatsapp_enabled: true,
    custom_domain_enabled: true,
    created_date: now,
    updated_date: now,
  };

  await database.collection("SubscriptionPlan").insertMany([planStandard, planEnterprise]);

  // 4. Platform Branding
  console.log("Seeding Platform Branding...");
  await database.collection("PlatformBranding").insertOne({
    platform_name: "Avexora ExamOS",
    primary_color: "#2563EB",
    accent_color: "#0F172A",
    support_email: "support@avexora.com",
    created_date: now,
    updated_date: now,
  });

  // 5. Global Announcements
  console.log("Seeding Platform Announcements...");
  await database.collection("Announcement").insertMany([
    {
      title: "ExamOS v2.4 Released with Instant OMR Camera Scanning",
      message: "Teachers and coordinators can now directly scan physical OMR bubble sheets using any mobile or webcam with sub-second AI evaluation.",
      type: "update",
      is_active: true,
      created_date: now,
      updated_date: now,
    },
    {
      title: "Scheduled Maintenance Window",
      message: "Platform telemetry and database optimizations will run on Sunday from 2:00 AM to 3:00 AM IST. Exam portals will remain accessible.",
      type: "maintenance",
      is_active: true,
      created_date: now,
      updated_date: now,
    },
  ]);

  // 6. Inbound Leads
  console.log("Seeding Inbound Leads...");
  await database.collection("Lead").insertMany([
    {
      name: "Dr. Arvind Swaminathan",
      email: "principal@greenwoodhigh.edu.in",
      phone: "+91 9845012345",
      school_name: "Greenwood High International",
      student_count: 2400,
      type: "demo",
      status: "new",
      message: "We need an automated OMR evaluation system for our ICSE terminal exams.",
      created_date: new Date(Date.now() - 2 * 86400000).toISOString(),
      updated_date: now,
    },
    {
      name: "Meera Krishnan",
      email: "m.krishnan@dpsbangalore.org",
      phone: "+91 9711234567",
      school_name: "DPS Bangalore North",
      student_count: 3800,
      type: "contact",
      status: "contacted",
      message: "Interested in the Enterprise Pro tier with white-label parent portal integration.",
      created_date: new Date(Date.now() - 5 * 86400000).toISOString(),
      updated_date: now,
    },
    {
      name: "Col. Rajesh Bakshi",
      email: "director@armyps.edu.in",
      phone: "+91 9988776655",
      school_name: "Army Public School",
      student_count: 1500,
      type: "demo",
      status: "new",
      message: "Looking for instant report card generation and SMS notifications.",
      created_date: new Date(Date.now() - 1 * 86400000).toISOString(),
      updated_date: now,
    },
  ]);

  // 7. Seed 3 Institutional Tenants
  const tenantConfigs = [
    {
      name: "Delhi Public Academy",
      subdomain: "dpa",
      primary_color: "#1E40AF",
      plan_id: planEnterprise._id.toString(),
      plan_name: "Enterprise Pro",
      adminEmail: "admin@dpa.edu.in",
      adminName: "Dr. Suresh Verma",
    },
    {
      name: "St. Xavier's International School",
      subdomain: "stxaviers",
      primary_color: "#047857",
      plan_id: planStandard._id.toString(),
      plan_name: "Standard Institution",
      adminEmail: "admin@stxaviers.edu.in",
      adminName: "Sister Mary Teresa",
    },
    {
      name: "Oakridge Global Academy",
      subdomain: "oakridge",
      primary_color: "#7C3AED",
      plan_id: planEnterprise._id.toString(),
      plan_name: "Enterprise Pro",
      adminEmail: "admin@oakridge.edu.in",
      adminName: "Prof. Rohan Kapur",
    },
  ];

  for (const tc of tenantConfigs) {
    console.log(`Seeding Institution: ${tc.name}...`);
    const tenantDoc = {
      _id: new ObjectId(),
      name: tc.name,
      subdomain: tc.subdomain,
      custom_domain: `${tc.subdomain}.schoolportal.in`,
      custom_domain_status: "pending",
      custom_domain_verified: false,
      subscription_plan_id: tc.plan_id,
      plan_name: tc.plan_name,
      status: "active",
      white_label_enabled: true,
      powered_by_avexora: false,
      primary_color: tc.primary_color,
      logo_url: "https://images.unsplash.com/photo-1546410531-bb4caa6b424d?w=120&auto=format&fit=crop&q=80",
      created_date: new Date(Date.now() - 30 * 86400000).toISOString(),
      updated_date: now,
    };
    await database.collection("Tenant").insertOne(tenantDoc);
    const tenantId = tenantDoc._id.toString();

    // Payments for this tenant
    await database.collection("Payment").insertMany([
      {
        tenant_id: tenantId,
        amount: tc.plan_name === "Enterprise Pro" ? 12999 : 4999,
        currency: "INR",
        status: "paid",
        plan_name: tc.plan_name,
        payment_method: "Razorpay / UPI",
        created_date: new Date(Date.now() - 28 * 86400000).toISOString(),
      },
      {
        tenant_id: tenantId,
        amount: tc.plan_name === "Enterprise Pro" ? 12999 : 4999,
        currency: "INR",
        status: "paid",
        plan_name: tc.plan_name,
        payment_method: "Auto-Debit",
        created_date: new Date(Date.now() - 2 * 86400000).toISOString(),
      },
    ]);

    // School Admin User
    const schoolAdminUser = {
      _id: new ObjectId(),
      email: tc.adminEmail,
      full_name: tc.adminName,
      password_hash: passwordHash,
      role: "admin",
      app_role: "school_admin",
      app_roles: ["school_admin"],
      email_verified: true,
      tenant_id: tenantId,
      created_date: now,
      updated_date: now,
    };
    await database.collection("User").insertOne(schoolAdminUser);

    // Classes & Sections
    const class10 = {
      _id: new ObjectId(),
      tenant_id: tenantId,
      name: "Class 10",
      sections: ["A", "B", "C"],
      created_date: now,
      updated_date: now,
    };
    const class12 = {
      _id: new ObjectId(),
      tenant_id: tenantId,
      name: "Class 12",
      sections: ["Science", "Commerce"],
      created_date: now,
      updated_date: now,
    };
    await database.collection("SchoolClass").insertMany([class10, class12]);

    // Subjects
    const subjects = ["Mathematics", "Physics", "Chemistry", "English Literature", "Computer Science", "Biology"];
    const subjectDocs = [];
    for (const sub of subjects) {
      const subjectDoc = {
        _id: new ObjectId(),
        tenant_id: tenantId,
        name: sub,
        created_date: now,
        updated_date: now,
      };
      await database.collection("Subject").insertOne(subjectDoc);
      subjectDocs.push(subjectDoc);
    }

    // Teachers
    const teachersData = [
      { name: "Anita Deshmukh", email: `anita.${tc.subdomain}@school.test`, subject: "Mathematics", role: "teacher" },
      { name: "Kavita Nair", email: `kavita.${tc.subdomain}@school.test`, subject: "Physics", role: "teacher" },
      { name: "Pradeep Menon", email: `pradeep.${tc.subdomain}@school.test`, subject: "Chemistry", role: "exam_coordinator" },
      { name: "Sunil Joshi", email: `sunil.${tc.subdomain}@school.test`, subject: "English Literature", role: "teacher" },
    ];

    for (const t of teachersData) {
      const staffUser = {
        _id: new ObjectId(),
        email: t.email,
        full_name: t.name,
        password_hash: passwordHash,
        role: "user",
        app_role: t.role,
        app_roles: [t.role],
        email_verified: true,
        tenant_id: tenantId,
        created_date: now,
        updated_date: now,
      };
      await database.collection("User").insertOne(staffUser);
      const teacherDoc = {
        _id: new ObjectId(),
        tenant_id: tenantId,
        full_name: t.name,
        email: t.email,
        phone: "+91 98200" + Math.floor(10000 + Math.random() * 90000),
        user_id: staffUser._id.toString(),
        assigned_subject_ids: [subjectDocs.find((s) => s.name === t.subject)._id.toString()],
        assigned_class_ids: [class10._id.toString(), class12._id.toString()],
        status: "active",
        created_date: now,
        updated_date: now,
      };
      await database.collection("Teacher").insertOne(teacherDoc);

    }

    // Students (15 students per institution)
    const studentNames = [
      { first: "Aarav", last: "Patel", sec: "A", gen: "Male" },
      { first: "Ananya", last: "Sharma", sec: "A", gen: "Female" },
      { first: "Rohan", last: "Gupta", sec: "A", gen: "Male" },
      { first: "Diya", last: "Iyer", sec: "A", gen: "Female" },
      { first: "Kabir", last: "Mehta", sec: "B", gen: "Male" },
      { first: "Ishaan", last: "Verma", sec: "B", gen: "Male" },
      { first: "Sneha", last: "Reddy", sec: "B", gen: "Female" },
      { first: "Aditya", last: "Chopra", sec: "B", gen: "Male" },
      { first: "Tanvi", last: "Mukherjee", sec: "C", gen: "Female" },
      { first: "Vivaan", last: "Joshi", sec: "C", gen: "Male" },
      { first: "Riya", last: "Singhania", sec: "C", gen: "Female" },
      { first: "Manish", last: "Chawla", sec: "C", gen: "Male" },
    ];

    const studentDocs = [];
    for (let i = 0; i < studentNames.length; i++) {
      const s = studentNames[i];
      const roll = (i + 1).toString().padStart(2, "0");
      const adm = `ADM-${tc.subdomain.toUpperCase()}-${100 + i + 1}`;
      const sEmail = `${s.first.toLowerCase()}.${s.last.toLowerCase()}@student.${tc.subdomain}.test`;
      const pEmail = `parent.${s.last.toLowerCase()}@family.${tc.subdomain}.test`;

      const studentDoc = {
        _id: new ObjectId(),
        tenant_id: tenantId,
        full_name: `${s.first} ${s.last}`,
        admission_number: adm,
        roll_number: roll,
        school_class_id: class10._id.toString(),
        class_name: "Class 10",
        section: s.sec,
        gender: s.gen,
        student_email: sEmail,
        student_phone: "+91 99000" + Math.floor(10000 + Math.random() * 90000),
        parent_name: `Mr. & Mrs. ${s.last}`,
        parent_email: pEmail,
        parent_phone: "+91 98111" + Math.floor(10000 + Math.random() * 90000),
        status: "active",
        created_date: now,
        updated_date: now,
      };
      await database.collection("Student").insertOne(studentDoc);
      studentDocs.push(studentDoc);

      // Create student & parent portal user accounts
      await database.collection("User").insertMany([
        {
          email: sEmail,
          full_name: studentDoc.full_name,
          password_hash: passwordHash,
          role: "user",
          app_role: "student",
          app_roles: ["student"],
          email_verified: true,
          tenant_id: tenantId,
          linked_student_id: studentDoc._id.toString(),
          created_date: now,
          updated_date: now,
        },
        {
          email: pEmail,
          full_name: studentDoc.parent_name,
          password_hash: passwordHash,
          role: "user",
          app_role: "parent",
          app_roles: ["parent"],
          email_verified: true,
          tenant_id: tenantId,
          linked_student_id: studentDoc._id.toString(),
          linked_student_ids: [studentDoc._id.toString()],
          created_date: now,
          updated_date: now,
        },
      ]);
    }

    // Examinations (3 exams)
    const examMath = {
      _id: new ObjectId(),
      tenant_id: tenantId,
      name: "Mid-Term Mathematics Board Assessment 2026",
      subject: "Mathematics",
      class_name: "Class 10",
      class_names: ["Class 10"],
      school_class_ids: [class10._id.toString()],
      subject_ids: [subjectDocs.find((s) => s.name === "Mathematics")._id.toString()],
      exam_date: new Date(Date.now() - 10 * 86400000).toISOString().split("T")[0],
      duration_minutes: 90,
      num_questions: 50,
      marks_per_question: 2,
      negative_marks: 0.5,
      max_marks: 100,
      passing_marks: 35,
      paper_sets: ["A", "B"],
      status: "published",
      created_date: new Date(Date.now() - 14 * 86400000).toISOString(),
      updated_date: now,
    };

    const examScience = {
      _id: new ObjectId(),
      tenant_id: tenantId,
      name: "Science Term 1 Comprehensive Exam",
      subject: "Physics",
      class_name: "Class 10",
      class_names: ["Class 10"],
      school_class_ids: [class10._id.toString()],
      subject_ids: [subjectDocs.find((s) => s.name === "Physics")._id.toString()],
      exam_date: new Date(Date.now() - 5 * 86400000).toISOString().split("T")[0],
      duration_minutes: 60,
      num_questions: 50,
      marks_per_question: 2,
      negative_marks: 0,
      max_marks: 100,
      passing_marks: 35,
      paper_sets: ["A"],
      status: "published",
      created_date: new Date(Date.now() - 8 * 86400000).toISOString(),
      updated_date: now,
    };

    const examEnglish = {
      _id: new ObjectId(),
      tenant_id: tenantId,
      name: "English Grammar & Reading Proficiency Test",
      subject: "English Literature",
      class_name: "Class 10",
      class_names: ["Class 10"],
      school_class_ids: [class10._id.toString()],
      subject_ids: [subjectDocs.find((s) => s.name === "English Literature")._id.toString()],
      exam_date: new Date(Date.now() + 4 * 86400000).toISOString().split("T")[0],
      duration_minutes: 60,
      num_questions: 40,
      marks_per_question: 1,
      negative_marks: 0,
      max_marks: 40,
      passing_marks: 14,
      paper_sets: ["A"],
      status: "scheduled",
      created_date: now,
      updated_date: now,
    };

    await database.collection("Examination").insertMany([examMath, examScience, examEnglish]);

    // Answer Keys for Published Exams
    const opts = ["A", "B", "C", "D"];
    const mathAnswersA = {};
    const mathAnswersB = {};
    const sciAnswersA = {};

    for (let q = 1; q <= 50; q++) {
      mathAnswersA[String(q)] = opts[(q * 3) % 4];
      mathAnswersB[String(q)] = opts[(q * 2 + 1) % 4];
      sciAnswersA[String(q)] = opts[(q * 7) % 4];
    }

    await database.collection("AnswerKey").insertMany([
      {
        examination_id: examMath._id.toString(),
        paper_set: "A",
        answers: mathAnswersA,
        created_date: now,
        updated_date: now,
      },
      {
        examination_id: examMath._id.toString(),
        paper_set: "B",
        answers: mathAnswersB,
        created_date: now,
        updated_date: now,
      },
      {
        examination_id: examScience._id.toString(),
        paper_set: "A",
        answers: sciAnswersA,
        created_date: now,
        updated_date: now,
      },
    ]);

    // OMR Sheets & Evaluated Results for each student in the published exams
    const publishedExams = [
      { exam: examMath, key: mathAnswersA },
      { exam: examScience, key: sciAnswersA },
    ];

    for (const { exam, key } of publishedExams) {
      const examResults = [];

      for (let sIdx = 0; sIdx < studentDocs.length; sIdx++) {
        const student = studentDocs[sIdx];
        const studentAnswers = {};
        const confidenceScores = {};
        let correctCount = 0;
        let incorrectCount = 0;
        let blankCount = 0;

        // Realistic student scoring distribution (60% to 95% proficiency)
        const proficiency = 0.6 + (sIdx % 5) * 0.08;

        for (let q = 1; q <= exam.num_questions; q++) {
          const k = String(q);
          confidenceScores[k] = +(0.75 + Math.random() * 0.25).toFixed(3);
          if (Math.random() < proficiency) {
            studentAnswers[k] = key[k];
            correctCount++;
          } else if (Math.random() < 0.8) {
            studentAnswers[k] = opts[Math.floor(Math.random() * 4)];
            incorrectCount++;
          } else {
            studentAnswers[k] = "";
            blankCount++;
          }
        }

        const score = Math.max(0, +(correctCount * exam.marks_per_question - incorrectCount * (exam.negative_marks || 0)).toFixed(2));
        const percentage = +((score / exam.max_marks) * 100).toFixed(2);

        let grade = "F";
        if (percentage >= 90) grade = "A+";
        else if (percentage >= 80) grade = "A";
        else if (percentage >= 70) grade = "B+";
        else if (percentage >= 60) grade = "B";
        else if (percentage >= 50) grade = "C";
        else if (percentage >= 33) grade = "D";

        const omrSheet = {
          _id: new ObjectId(),
          tenant_id: tenantId,
          examination_id: exam._id.toString(),
          student_id: student._id.toString(),
          paper_set: "A",
          image_url: "https://images.unsplash.com/photo-1606326608606-aa0b62935f2b?w=600&auto=format&fit=crop&q=80",
          answers: studentAnswers,
          extracted_answers: studentAnswers,
          confidence_scores: confidenceScores,
          status: "completed",
          matched: true,
          flagged_questions: [],
          processed_at: exam.exam_date,
          created_date: exam.exam_date,
          updated_date: exam.exam_date,
        };
        await database.collection("OMRSheet").insertOne(omrSheet);

        examResults.push({
          examination_id: exam._id.toString(),
          student_id: student._id.toString(),
          tenant_id: tenantId,
          omr_sheet_id: omrSheet._id.toString(),
          total_marks: score,
          percentage,
          grade,
          passed: score >= exam.passing_marks,
          correct_answers: correctCount,
          incorrect_answers: incorrectCount,
          unattempted: blankCount,
          status: "published",
          created_date: exam.exam_date,
          updated_date: exam.exam_date,
        });
      }

      // Sort results and assign ranks + percentiles
      examResults.sort((a, b) => b.total_marks - a.total_marks);
      const n = examResults.length;
      examResults.forEach((r, idx) => {
        r.rank = idx + 1;
        const below = n - idx - 1;
        r.percentile = n > 1 ? +((below / (n - 1)) * 100).toFixed(2) : 100;
      });
      await database.collection("Result").insertMany(examResults);
    }

    // Tenant Announcements
    await database.collection("TenantAnnouncement").insertMany([
      {
        tenant_id: tenantId,
        title: "Mid-Term Examination Results Published",
        message: "Students and parents can now view the detailed subject-wise marks breakdown and download their official PDF report card from the portal.",
        is_active: true,
        created_date: now,
        updated_date: now,
      },
      {
        tenant_id: tenantId,
        title: "Upcoming Pre-Board & Practical Schedule",
        message: "Practical evaluations for Class 10 and 12 will commence next Monday. Please ensure admit cards are carried to examination halls.",
        is_active: true,
        created_date: now,
        updated_date: now,
      },
    ]);

    // Audit Logs. Must match the schema written by logServerAudit (server-side):
    // actor_name / actor_role (NOT user_email) — the Audit Logs page renders
    // row.actor_name (row.actor_role).
    await database.collection("AuditLog").insertMany([
      {
        tenant_id: tenantId,
        actor_name: tc.adminName,
        actor_role: "school_admin",
        action: "create",
        entity_type: "Examination",
        details: examMath.name,
        created_date: new Date(Date.now() - 14 * 86400000).toISOString(),
      },
      {
        tenant_id: tenantId,
        actor_name: tc.adminName,
        actor_role: "school_admin",
        action: "evaluate_omr",
        entity_type: "Examination",
        details: `Processed ${studentDocs.length} OMR sheets for ${examMath.name}`,
        created_date: new Date(Date.now() - 10 * 86400000).toISOString(),
      },
      {
        tenant_id: tenantId,
        actor_name: tc.adminName,
        actor_role: "school_admin",
        action: "publish_results",
        entity_type: "Result",
        details: `Published report cards for ${examMath.name}`,
        created_date: new Date(Date.now() - 9 * 86400000).toISOString(),
      },
    ]);
  }

  console.log("Seeding completed successfully!");
}

seed().catch((err) => {
  console.error("Seeding error:", err);
  process.exit(1);
}).then(() => process.exit(0));
