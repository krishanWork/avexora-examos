/**
 * ExamOS Predefined Curriculum Catalog Presets
 * 
 * Note: These presets represent ExamOS's predefined curriculum-oriented subject catalogs,
 * designed to accelerate school provisioning. They do not guarantee legal or regulatory
 * curriculum compliance, and can be customized or augmented by the institution.
 */

export const CURRICULUM_PRESETS = {
  cbse: {
    id: "cbse",
    name: "CBSE Preset",
    description: "ExamOS predefined CBSE-oriented subject catalog for Primary, Middle, Secondary, and Senior Secondary streams.",
    isAvailable: true,
    primary: [
      { name: "English", code: "ENG", department: "Languages", category: "Core", stages: ["primary"] },
      { name: "Hindi", code: "HIN", department: "Languages", category: "Core", stages: ["primary"] },
      { name: "Mathematics", code: "MATH", department: "Mathematics", category: "Core", stages: ["primary"] },
      { name: "Environmental Studies (EVS)", code: "EVS", department: "Science", category: "Core", stages: ["primary"] },
      { name: "Art & Craft", code: "ART", department: "Arts", category: "Elective", stages: ["primary"] }
    ],
    middle: [
      { name: "English", code: "ENG", department: "Languages", category: "Core", stages: ["middle"] },
      { name: "Hindi", code: "HIN", department: "Languages", category: "Core", stages: ["middle"] },
      { name: "Mathematics", code: "MATH", department: "Mathematics", category: "Core", stages: ["middle"] },
      { name: "Science", code: "SCI", department: "Science", category: "Core", stages: ["middle"] },
      { name: "Social Science", code: "SOC", department: "Social Studies", category: "Core", stages: ["middle"] },
      { name: "Computer Applications", code: "COMP", department: "IT", category: "Elective", stages: ["middle"] }
    ],
    secondary: [
      { name: "English Language & Literature", code: "ENG-184", department: "Languages", category: "Core", stages: ["secondary"] },
      { name: "Hindi Course-A", code: "HIN-002", department: "Languages", category: "Core", stages: ["secondary"] },
      { name: "Mathematics Standard", code: "MATH-041", department: "Mathematics", category: "Core", stages: ["secondary"] },
      { name: "Science", code: "SCI-086", department: "Science", category: "Core", stages: ["secondary"] },
      { name: "Social Science", code: "SOC-087", department: "Social Studies", category: "Core", stages: ["secondary"] },
      { name: "Information Technology", code: "IT-402", department: "IT", category: "Elective", stages: ["secondary"] }
    ],
    senior_secondary_streams: {
      "Science-Bio": [
        { name: "English Core", code: "ENG-301", department: "Languages", category: "Core", stages: ["senior_secondary"], stream: "Science-Bio" },
        { name: "Physics", code: "PHY-042", department: "Science", category: "Core", stages: ["senior_secondary"], stream: "Science-Bio" },
        { name: "Chemistry", code: "CHEM-043", department: "Science", category: "Core", stages: ["senior_secondary"], stream: "Science-Bio" },
        { name: "Biology", code: "BIO-044", department: "Science", category: "Core", stages: ["senior_secondary"], stream: "Science-Bio" },
        { name: "Physical Education", code: "PE-048", department: "Physical Education", category: "Elective", stages: ["senior_secondary"], stream: "Science-Bio" }
      ],
      "Science-Math": [
        { name: "English Core", code: "ENG-301", department: "Languages", category: "Core", stages: ["senior_secondary"], stream: "Science-Math" },
        { name: "Physics", code: "PHY-042", department: "Science", category: "Core", stages: ["senior_secondary"], stream: "Science-Math" },
        { name: "Chemistry", code: "CHEM-043", department: "Science", category: "Core", stages: ["senior_secondary"], stream: "Science-Math" },
        { name: "Mathematics", code: "MATH-041", department: "Mathematics", category: "Core", stages: ["senior_secondary"], stream: "Science-Math" },
        { name: "Computer Science", code: "CS-083", department: "IT", category: "Elective", stages: ["senior_secondary"], stream: "Science-Math" }
      ],
      "Science-PCMB": [
        { name: "English Core", code: "ENG-301", department: "Languages", category: "Core", stages: ["senior_secondary"], stream: "Science-PCMB" },
        { name: "Physics", code: "PHY-042", department: "Science", category: "Core", stages: ["senior_secondary"], stream: "Science-PCMB" },
        { name: "Chemistry", code: "CHEM-043", department: "Science", category: "Core", stages: ["senior_secondary"], stream: "Science-PCMB" },
        { name: "Mathematics", code: "MATH-041", department: "Mathematics", category: "Core", stages: ["senior_secondary"], stream: "Science-PCMB" },
        { name: "Biology", code: "BIO-044", department: "Science", category: "Core", stages: ["senior_secondary"], stream: "Science-PCMB" }
      ],
      "Commerce": [
        { name: "English Core", code: "ENG-301", department: "Languages", category: "Core", stages: ["senior_secondary"], stream: "Commerce" },
        { name: "Accountancy", code: "ACCT-055", department: "Commerce", category: "Core", stages: ["senior_secondary"], stream: "Commerce" },
        { name: "Business Studies", code: "BST-054", department: "Commerce", category: "Core", stages: ["senior_secondary"], stream: "Commerce" },
        { name: "Economics", code: "ECON-030", department: "Commerce", category: "Core", stages: ["senior_secondary"], stream: "Commerce" },
        { name: "Applied Mathematics", code: "AMATH-241", department: "Mathematics", category: "Elective", stages: ["senior_secondary"], stream: "Commerce" }
      ],
      "Humanities": [
        { name: "English Core", code: "ENG-301", department: "Languages", category: "Core", stages: ["senior_secondary"], stream: "Humanities" },
        { name: "History", code: "HIST-027", department: "Social Studies", category: "Core", stages: ["senior_secondary"], stream: "Humanities" },
        { name: "Political Science", code: "POL-028", department: "Social Studies", category: "Core", stages: ["senior_secondary"], stream: "Humanities" },
        { name: "Geography", code: "GEOG-029", department: "Social Studies", category: "Core", stages: ["senior_secondary"], stream: "Humanities" },
        { name: "Psychology", code: "PSY-037", department: "Social Studies", category: "Elective", stages: ["senior_secondary"], stream: "Humanities" }
      ]
    }
  },
  general: {
    id: "general",
    name: "General School Preset",
    description: "Standard comprehensive curriculum suitable for independent, foundational, and international institutions.",
    isAvailable: true,
    primary: [
      { name: "English", code: "ENG", department: "Languages", category: "Core", stages: ["primary"] },
      { name: "Mathematics", code: "MATH", department: "Mathematics", category: "Core", stages: ["primary"] },
      { name: "General Science", code: "SCI", department: "Science", category: "Core", stages: ["primary"] },
      { name: "Social Studies", code: "SST", department: "Social Studies", category: "Core", stages: ["primary"] },
      { name: "Arts & Music", code: "ART", department: "Arts", category: "Elective", stages: ["primary"] }
    ],
    middle: [
      { name: "English Language & Literature", code: "ENG", department: "Languages", category: "Core", stages: ["middle"] },
      { name: "Mathematics", code: "MATH", department: "Mathematics", category: "Core", stages: ["middle"] },
      { name: "Integrated Science", code: "SCI", department: "Science", category: "Core", stages: ["middle"] },
      { name: "World History & Geography", code: "SST", department: "Social Studies", category: "Core", stages: ["middle"] },
      { name: "Computer Literacy", code: "ICT", department: "IT", category: "Elective", stages: ["middle"] }
    ],
    secondary: [
      { name: "English", code: "ENG", department: "Languages", category: "Core", stages: ["secondary"] },
      { name: "Advanced Mathematics", code: "MATH", department: "Mathematics", category: "Core", stages: ["secondary"] },
      { name: "Physics & Chemistry", code: "SCI-PC", department: "Science", category: "Core", stages: ["secondary"] },
      { name: "Biology & Environment", code: "SCI-BIO", department: "Science", category: "Core", stages: ["secondary"] },
      { name: "Social Sciences", code: "SOC", department: "Social Studies", category: "Core", stages: ["secondary"] },
      { name: "Computer Science", code: "CS", department: "IT", category: "Elective", stages: ["secondary"] }
    ],
    senior_secondary_streams: {
      "Science-Bio": [
        { name: "English", code: "ENG", department: "Languages", category: "Core", stages: ["senior_secondary"], stream: "Science-Bio" },
        { name: "Physics", code: "PHY", department: "Science", category: "Core", stages: ["senior_secondary"], stream: "Science-Bio" },
        { name: "Chemistry", code: "CHEM", department: "Science", category: "Core", stages: ["senior_secondary"], stream: "Science-Bio" },
        { name: "Biology", code: "BIO", department: "Science", category: "Core", stages: ["senior_secondary"], stream: "Science-Bio" }
      ],
      "Science-Math": [
        { name: "English", code: "ENG", department: "Languages", category: "Core", stages: ["senior_secondary"], stream: "Science-Math" },
        { name: "Physics", code: "PHY", department: "Science", category: "Core", stages: ["senior_secondary"], stream: "Science-Math" },
        { name: "Chemistry", code: "CHEM", department: "Science", category: "Core", stages: ["senior_secondary"], stream: "Science-Math" },
        { name: "Calculus & Mathematics", code: "MATH", department: "Mathematics", category: "Core", stages: ["senior_secondary"], stream: "Science-Math" }
      ],
      "Commerce": [
        { name: "English", code: "ENG", department: "Languages", category: "Core", stages: ["senior_secondary"], stream: "Commerce" },
        { name: "Financial Accounting", code: "ACC", department: "Commerce", category: "Core", stages: ["senior_secondary"], stream: "Commerce" },
        { name: "Business Management", code: "MGMT", department: "Commerce", category: "Core", stages: ["senior_secondary"], stream: "Commerce" },
        { name: "Economics", code: "ECON", department: "Commerce", category: "Core", stages: ["senior_secondary"], stream: "Commerce" }
      ],
      "Humanities": [
        { name: "English Literature", code: "ENG", department: "Languages", category: "Core", stages: ["senior_secondary"], stream: "Humanities" },
        { name: "History", code: "HIST", department: "Social Studies", category: "Core", stages: ["senior_secondary"], stream: "Humanities" },
        { name: "Civics & Governance", code: "CIV", department: "Social Studies", category: "Core", stages: ["senior_secondary"], stream: "Humanities" },
        { name: "Psychology & Sociology", code: "SOC-PSY", department: "Social Studies", category: "Elective", stages: ["senior_secondary"], stream: "Humanities" }
      ]
    }
  },
  icse: {
    id: "icse",
    name: "ICSE / ISC Preset",
    description: "CISCE Indian Certificate of Secondary Education oriented catalog.",
    isAvailable: false,
    badge: "Coming Soon"
  },
  state_board: {
    id: "state_board",
    name: "State Board Presets",
    description: "Regional state board oriented catalogs.",
    isAvailable: false,
    badge: "Coming Soon"
  },
  custom: {
    id: "custom",
    name: "Custom Curriculum",
    description: "Start with an empty subject catalog and add institutional courses manually.",
    isAvailable: true,
    primary: [],
    middle: [],
    secondary: [],
    senior_secondary_streams: {}
  }
};

export const STREAM_DEFINITIONS = [
  { id: "Science-Bio", name: "Science — Medical / Biology", code: "SCI-BIO", badge: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  { id: "Science-Math", name: "Science — Non-Medical / Mathematics", code: "SCI-MATH", badge: "bg-indigo-50 text-indigo-700 border-indigo-200" },
  { id: "Science-PCMB", name: "Science — PCMB (Dual Science)", code: "SCI-PCMB", badge: "bg-indigo-50 text-indigo-700 border-indigo-200" },
  { id: "Commerce", name: "Commerce", code: "COMM", badge: "bg-amber-50 text-amber-700 border-amber-200" },
  { id: "Humanities", name: "Humanities / Arts", code: "HUM", badge: "bg-purple-50 text-purple-700 border-purple-200" }
];
