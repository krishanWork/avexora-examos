import React, { useState, useMemo } from "react";
import { appClient } from "@/api/appClient";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/components/ui/use-toast";
import { CURRICULUM_PRESETS, STREAM_DEFINITIONS } from "@/data/curriculumPresets";
import {
  Wand2, Calendar, Layers, BookOpen, CheckCircle2, ChevronRight,
  ChevronLeft, Users, Building2, Plus, AlertCircle, Sparkles, ShieldCheck,
  Copy
} from "lucide-react";

const ALL_GRADES = [
  { id: "Nursery", name: "Nursery", stage: "pre_primary", level: -2 },
  { id: "LKG", name: "LKG", stage: "pre_primary", level: -1 },
  { id: "UKG", name: "UKG", stage: "pre_primary", level: 0 },
  { id: "Class 1", name: "Class 1", stage: "primary", level: 1 },
  { id: "Class 2", name: "Class 2", stage: "primary", level: 2 },
  { id: "Class 3", name: "Class 3", stage: "primary", level: 3 },
  { id: "Class 4", name: "Class 4", stage: "primary", level: 4 },
  { id: "Class 5", name: "Class 5", stage: "primary", level: 5 },
  { id: "Class 6", name: "Class 6", stage: "middle", level: 6 },
  { id: "Class 7", name: "Class 7", stage: "middle", level: 7 },
  { id: "Class 8", name: "Class 8", stage: "middle", level: 8 },
  { id: "Class 9", name: "Class 9", stage: "secondary", level: 9 },
  { id: "Class 10", name: "Class 10", stage: "secondary", level: 10 },
  { id: "Class 11", name: "Class 11", stage: "senior_secondary", level: 11 },
  { id: "Class 12", name: "Class 12", stage: "senior_secondary", level: 12 },
];

const SECTION_LETTERS = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J"];

export default function AcademicWizardModal({ open, onOpenChange, onComplete }) {
  const { toast } = useToast();
  const [currentStep, setCurrentStep] = useState(1);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [resultData, setResultData] = useState(null);

  // Step 1: Academic Year
  const currentYear = new Date().getFullYear();
  const [academicYear, setAcademicYear] = useState({
    name: `${currentYear}–${currentYear + 1}`,
    start_date: `${currentYear}-04-01`,
    end_date: `${currentYear + 1}-03-31`,
    is_current: true,
  });

  // Step 2: Grade Span & Default Multipliers
  const [startGradeId, setStartGradeId] = useState("Class 1");
  const [endGradeId, setEndGradeId] = useState("Class 12");
  const [defaultSectionsCount, setDefaultSectionsCount] = useState(4);
  const [defaultCapacity, setDefaultCapacity] = useState(40);
  const [gradeOverrides, setGradeOverrides] = useState({});

  // Step 3: Stream Configuration (Independent for Class 11 and Class 12)
  const [gradeStreamConfigs, setGradeStreamConfigs] = useState({
    "Class 11": [
      { id: "Science-Bio", name: "Science — Medical / Biology", sectionsCount: 2, capacity: 40 },
      { id: "Science-Math", name: "Science — Non-Medical / Mathematics", sectionsCount: 2, capacity: 40 },
      { id: "Commerce", name: "Commerce", sectionsCount: 2, capacity: 40 },
    ],
    "Class 12": [
      { id: "Science-Bio", name: "Science — Medical / Biology", sectionsCount: 2, capacity: 40 },
      { id: "Science-Math", name: "Science — Non-Medical / Mathematics", sectionsCount: 2, capacity: 40 },
      { id: "Commerce", name: "Commerce", sectionsCount: 2, capacity: 40 },
    ],
  });

  const [activeSeniorGrade, setActiveSeniorGrade] = useState("Class 11");

  // Step 4: Curriculum Preset & Subject Catalog
  const [selectedPresetId, setSelectedPresetId] = useState("cbse");
  const [selectedSubjects, setSelectedSubjects] = useState([]);
  const [customSubjectDialogOpen, setCustomSubjectDialogOpen] = useState(false);
  const [customSubject, setCustomSubject] = useState({
    name: "",
    code: "",
    department: "General",
    category: "Core",
    credits: 1,
  });

  // Calculate active grades based on start and end
  const activeGrades = useMemo(() => {
    const startIndex = ALL_GRADES.findIndex((g) => g.id === startGradeId);
    const endIndex = ALL_GRADES.findIndex((g) => g.id === endGradeId);
    if (startIndex === -1 || endIndex === -1 || startIndex > endIndex) {
      return ALL_GRADES.filter((g) => g.level >= 1 && g.level <= 12);
    }
    return ALL_GRADES.slice(startIndex, endIndex + 1);
  }, [startGradeId, endGradeId]);

  const seniorSecondaryGrades = useMemo(() => {
    return activeGrades.filter((g) => g.stage === "senior_secondary");
  }, [activeGrades]);

  const hasHighSchool = useMemo(() => {
    return seniorSecondaryGrades.length > 0;
  }, [seniorSecondaryGrades]);

  // Keep activeSeniorGrade aligned with active grade range
  React.useEffect(() => {
    if (seniorSecondaryGrades.length > 0) {
      if (!seniorSecondaryGrades.some((g) => g.name === activeSeniorGrade)) {
        setActiveSeniorGrade(seniorSecondaryGrades[0].name);
      }
    }
  }, [seniorSecondaryGrades, activeSeniorGrade]);

  // Combine all active streams across Senior Secondary grades for subject recommendations
  const allActiveStreamIds = useMemo(() => {
    const set = new Set();
    for (const g of seniorSecondaryGrades) {
      const streams = gradeStreamConfigs[g.name] || [];
      for (const s of streams) set.add(s.id);
    }
    return Array.from(set);
  }, [seniorSecondaryGrades, gradeStreamConfigs]);

  // Sync subjects when preset or grade range changes
  React.useEffect(() => {
    const preset = CURRICULUM_PRESETS[selectedPresetId];
    if (!preset || !preset.isAvailable) return;

    const list = [];
    const hasPrimary = activeGrades.some((g) => g.stage === "primary" || g.stage === "pre_primary");
    const hasMiddle = activeGrades.some((g) => g.stage === "middle");
    const hasSecondary = activeGrades.some((g) => g.stage === "secondary");
    const hasSenior = activeGrades.some((g) => g.stage === "senior_secondary");

    if (hasPrimary && preset.primary) {
      list.push(...preset.primary.map((s) => ({ ...s, id: `p_${s.code || s.name}` })));
    }
    if (hasMiddle && preset.middle) {
      list.push(...preset.middle.map((s) => ({ ...s, id: `m_${s.code || s.name}` })));
    }
    if (hasSecondary && preset.secondary) {
      list.push(...preset.secondary.map((s) => ({ ...s, id: `s_${s.code || s.name}` })));
    }
    if (hasSenior && preset.senior_secondary_streams) {
      for (const streamId of allActiveStreamIds) {
        const streamSubs = preset.senior_secondary_streams[streamId] || [];
        for (const sub of streamSubs) {
          const existingIdx = list.findIndex((existing) => existing.name.toLowerCase() === sub.name.toLowerCase());
          if (existingIdx >= 0) {
            const existing = list[existingIdx];
            const existingStreams = existing.streams?.length
              ? existing.streams
              : existing.stream
                ? [existing.stream]
                : [];
            if (sub.stream && !existingStreams.includes(sub.stream)) {
              list[existingIdx] = { ...existing, stream: undefined, streams: [...existingStreams, sub.stream] };
            }
          } else {
            list.push({ ...sub, id: `ss_${streamId}_${sub.code || sub.name}` });
          }
        }
      }
    }
    setSelectedSubjects(list);
  }, [selectedPresetId, activeGrades, allActiveStreamIds]);

  // Derived Classes and Sections Structure for Step 5 Review
  const calculatedStructure = useMemo(() => {
    let totalSections = 0;
    let totalCapacity = 0;

    const classesList = activeGrades.map((g, idx) => {
      const isSeniorSec = g.stage === "senior_secondary";
      let sections = [];

      if (isSeniorSec) {
        // Stream-based sections specific to this exact grade
        const streamsForGrade = gradeStreamConfigs[g.name] || gradeStreamConfigs["Class 11"] || [];
        if (streamsForGrade.length > 0) {
          for (const st of streamsForGrade) {
            const streamDef = STREAM_DEFINITIONS.find((d) => d.id === st.id);
            const prefix = streamDef?.code?.replace("SCI-", "Sci-") || st.id;
            const count = st.sectionsCount || 1;
            const cap = st.capacity || 40;

            for (let sIdx = 0; sIdx < count; sIdx++) {
              const letter = SECTION_LETTERS[sIdx] || `S${sIdx + 1}`;
              sections.push({
                name: count > 1 ? `${prefix}-${letter}` : prefix,
                capacity: cap,
                stream: st.id,
              });
              totalSections++;
              totalCapacity += cap;
            }
          }
        } else {
          const override = gradeOverrides[g.id];
          const count = override?.sectionsCount ?? defaultSectionsCount;
          const cap = override?.capacity ?? defaultCapacity;
          for (let sIdx = 0; sIdx < count; sIdx++) {
            const letter = SECTION_LETTERS[sIdx] || `S${sIdx + 1}`;
            sections.push({ name: letter, capacity: cap, stream: null });
            totalSections++;
            totalCapacity += cap;
          }
        }
      } else {
        // Standard lettered sections
        const override = gradeOverrides[g.id];
        const count = override?.sectionsCount ?? defaultSectionsCount;
        const cap = override?.capacity ?? defaultCapacity;

        for (let sIdx = 0; sIdx < count; sIdx++) {
          const letter = SECTION_LETTERS[sIdx] || `S${sIdx + 1}`;
          sections.push({
            name: letter,
            capacity: cap,
            stream: null,
          });
          totalSections++;
          totalCapacity += cap;
        }
      }

      return {
        name: g.name,
        grade_level: g.stage,
        stage: g.stage,
        order: idx + 1,
        sections,
      };
    });

    return {
      classes: classesList,
      totalClasses: classesList.length,
      totalSections,
      totalCapacity,
    };
  }, [activeGrades, defaultSectionsCount, defaultCapacity, gradeOverrides, gradeStreamConfigs]);

  // Handlers for Per-Grade Stream Toggling & Config
  const handleToggleStreamForGrade = (gradeName, streamDef) => {
    const currentList = gradeStreamConfigs[gradeName] || [];
    const exists = currentList.some((s) => s.id === streamDef.id);
    if (exists) {
      if (currentList.length === 1) {
        toast({ title: `At least one stream must be active for ${gradeName}`, variant: "destructive" });
        return;
      }
      setGradeStreamConfigs({
        ...gradeStreamConfigs,
        [gradeName]: currentList.filter((s) => s.id !== streamDef.id),
      });
    } else {
      setGradeStreamConfigs({
        ...gradeStreamConfigs,
        [gradeName]: [
          ...currentList,
          { id: streamDef.id, name: streamDef.name, sectionsCount: 2, capacity: 40 },
        ],
      });
    }
  };

  const handleUpdateStreamForGrade = (gradeName, streamId, field, value) => {
    const currentList = gradeStreamConfigs[gradeName] || [];
    setGradeStreamConfigs({
      ...gradeStreamConfigs,
      [gradeName]: currentList.map((s) =>
        s.id === streamId ? { ...s, [field]: Number(value) || 1 } : s
      ),
    });
  };

  const handleCopyStreamConfig = (sourceGrade, targetGrade) => {
    const source = gradeStreamConfigs[sourceGrade] || [];
    setGradeStreamConfigs({
      ...gradeStreamConfigs,
      [targetGrade]: source.map((s) => ({ ...s })),
    });
    toast({
      title: `Copied ${sourceGrade} settings to ${targetGrade}`,
      description: `${targetGrade} now has the same streams and section counts as ${sourceGrade}.`,
    });
  };

  const handleToggleSubject = (sub) => {
    const exists = selectedSubjects.some((s) => s.name === sub.name && s.code === sub.code);
    if (exists) {
      setSelectedSubjects(selectedSubjects.filter((s) => !(s.name === sub.name && s.code === sub.code)));
    } else {
      setSelectedSubjects([...selectedSubjects, sub]);
    }
  };

  const handleAddCustomSubject = (e) => {
    e.preventDefault();
    if (!customSubject.name.trim()) {
      toast({ title: "Subject name is required", variant: "destructive" });
      return;
    }
    setSelectedSubjects([
      ...selectedSubjects,
      {
        ...customSubject,
        id: `custom_${Date.now()}`,
        name: customSubject.name.trim(),
        code: customSubject.code.trim() || undefined,
      },
    ]);
    setCustomSubject({ name: "", code: "", department: "General", category: "Core", credits: 1 });
    setCustomSubjectDialogOpen(false);
    toast({ title: "Custom subject added to list" });
  };

  const handleProvisionSchool = async () => {
    setIsSubmitting(true);
    try {
      const payload = {
        academic_year: academicYear,
        classes: calculatedStructure.classes,
        subjects: selectedSubjects,
      };

      const res = await appClient.functions.invoke("setupAcademicStructure", payload);
      const data = res?.data || res;
      setResultData(data);
      toast({
        title: "Academic Structure Provisioned!",
        description: `Successfully configured ${data?.created?.total_classes_count || calculatedStructure.totalClasses} classes and ${data?.created?.total_sections_count || calculatedStructure.totalSections} sections.`,
      });
      if (onComplete) onComplete(data);
    } catch (err) {
      console.error("Setup provisioning failed:", err);
      toast({
        title: "Academic setup failed",
        description: err.message || "An unexpected error occurred during school provisioning",
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const resetAndClose = () => {
    setResultData(null);
    setCurrentStep(1);
    onOpenChange(false);
  };

  const handleNext = () => {
    const startIndex = ALL_GRADES.findIndex((g) => g.id === startGradeId);
    const endIndex = ALL_GRADES.findIndex((g) => g.id === endGradeId);
    if (startIndex > endIndex) {
      toast({
        title: "Invalid grade span",
        description: "Starting grade must come before the ending grade.",
        variant: "destructive",
      });
      return;
    }
    setCurrentStep(currentStep + 1);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] flex flex-col p-0 overflow-hidden bg-stone-50 border border-stone-200">
        {/* Wizard Header */}
        <div className="bg-white border-b border-stone-200 px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 to-indigo-700 flex items-center justify-center text-white shadow-sm">
              <Wand2 className="w-5 h-5" />
            </div>
            <div>
              <DialogTitle className="text-lg font-semibold text-stone-900">
                School Academic Setup Wizard
              </DialogTitle>
              <DialogDescription className="text-xs text-stone-500">
                Automated, large-scale provisioning for institutions with 1,000+ students
              </DialogDescription>
            </div>
          </div>
          <Badge variant="outline" className="bg-indigo-50 text-indigo-700 border-indigo-200 font-medium">
            Step {currentStep} of 5
          </Badge>
        </div>

        {/* Stepper Progress Indicator */}
        <div className="bg-stone-100/70 border-b border-stone-200 px-6 py-2.5">
          <div className="flex items-center justify-between">
            {[
              { num: 1, label: "Academic Year", icon: Calendar },
              { num: 2, label: "Grades & Scale", icon: Layers },
              { num: 3, label: "Streams", icon: Building2 },
              { num: 4, label: "Subjects", icon: BookOpen },
              { num: 5, label: "Review & Build", icon: CheckCircle2 },
            ].map((s) => {
              const isActive = currentStep === s.num;
              const isPast = currentStep > s.num;
              return (
                <div key={s.num} className="flex items-center gap-2">
                  <div
                    className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold transition-all ${
                      isActive
                        ? "bg-indigo-600 text-white shadow-sm ring-2 ring-indigo-200"
                        : isPast
                        ? "bg-emerald-600 text-white"
                        : "bg-stone-200 text-stone-500"
                    }`}
                  >
                    {isPast ? "✓" : s.num}
                  </div>
                  <span
                    className={`text-xs font-medium hidden md:inline ${
                      isActive ? "text-indigo-900 font-semibold" : isPast ? "text-emerald-800" : "text-stone-400"
                    }`}
                  >
                    {s.label}
                  </span>
                  {s.num < 5 && <div className="w-6 h-[1px] bg-stone-200 hidden md:block mx-1" />}
                </div>
              );
            })}
          </div>
        </div>

        {/* Step Body Content */}
        <div className="flex-1 overflow-y-auto p-6 bg-stone-50/50">
          {resultData ? (
            /* Result Success View */
            <div className="py-8 text-center space-y-4">
              <div className="w-16 h-16 rounded-2xl bg-emerald-100 text-emerald-600 flex items-center justify-center mx-auto shadow-sm">
                <CheckCircle2 className="w-8 h-8" />
              </div>
              <h3 className="text-xl font-bold text-stone-900">Academic Structure Successfully Configured!</h3>
              <p className="text-sm text-stone-600 max-w-md mx-auto">
                Your school structure is ready for student enrollments, teacher assignments, and examinations.
              </p>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 max-w-xl mx-auto pt-4 text-left">
                <div className="bg-white p-3.5 rounded-xl border border-stone-200 shadow-sm">
                  <div className="text-xs text-stone-500 font-medium">Academic Year</div>
                  <div className="text-base font-bold text-stone-900 mt-1">{resultData.academic_year?.name}</div>
                  <Badge className="mt-1.5 bg-emerald-50 text-emerald-700 text-[11px] border-emerald-200">
                    {resultData.academic_year?.action === "created" ? "Newly Created" : "Reused"}
                  </Badge>
                </div>
                <div className="bg-white p-3.5 rounded-xl border border-stone-200 shadow-sm">
                  <div className="text-xs text-stone-500 font-medium">Classes Provisioned</div>
                  <div className="text-base font-bold text-indigo-700 mt-1">
                    {resultData.created?.total_classes_count}
                  </div>
                  <div className="text-[11px] text-stone-400 mt-1">
                    {resultData.skipped?.classes?.length || 0} skipped
                  </div>
                </div>
                <div className="bg-white p-3.5 rounded-xl border border-stone-200 shadow-sm">
                  <div className="text-xs text-stone-500 font-medium">Sections Created</div>
                  <div className="text-base font-bold text-indigo-700 mt-1">
                    {resultData.created?.total_sections_count}
                  </div>
                  <div className="text-[11px] text-stone-400 mt-1">
                    {resultData.skipped?.sections?.length || 0} skipped
                  </div>
                </div>
                <div className="bg-white p-3.5 rounded-xl border border-stone-200 shadow-sm">
                  <div className="text-xs text-stone-500 font-medium">Campus Capacity</div>
                  <div className="text-base font-bold text-purple-700 mt-1">
                    {resultData.created?.total_capacity?.toLocaleString()} seats
                  </div>
                  <div className="text-[11px] text-stone-400 mt-1">Server derived</div>
                </div>
              </div>

              <div className="pt-6">
                <Button onClick={resetAndClose} className="bg-indigo-600 hover:bg-indigo-700 text-white px-8">
                  View Academic Dashboard
                </Button>
              </div>
            </div>
          ) : (
            <>
              {/* STEP 1: Academic Year */}
              {currentStep === 1 && (
                <div className="space-y-6 max-w-xl mx-auto py-2">
                  <div className="text-center space-y-1">
                    <h3 className="text-base font-semibold text-stone-900">Define Academic Cycle</h3>
                    <p className="text-xs text-stone-500">
                      Configure the operational academic year for schedules, rosters, and examinations.
                    </p>
                  </div>

                  <div className="bg-white p-5 rounded-xl border border-stone-200 shadow-sm space-y-4">
                    <div>
                      <Label htmlFor="wiz-ay-name" className="text-xs font-semibold text-stone-700">
                        Academic Year Label *
                      </Label>
                      <Input
                        id="wiz-ay-name"
                        value={academicYear.name}
                        onChange={(e) => setAcademicYear({ ...academicYear, name: e.target.value })}
                        placeholder="e.g. 2026–2027"
                        className="mt-1"
                      />
                      <p className="text-[11px] text-stone-400 mt-1">
                        Standard format: YYYY–YYYY (e.g. 2026–2027)
                      </p>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <Label htmlFor="wiz-ay-start" className="text-xs font-semibold text-stone-700">
                          Session Start Date
                        </Label>
                        <Input
                          id="wiz-ay-start"
                          type="date"
                          value={academicYear.start_date}
                          onChange={(e) => setAcademicYear({ ...academicYear, start_date: e.target.value })}
                          className="mt-1 text-xs"
                        />
                      </div>
                      <div>
                        <Label htmlFor="wiz-ay-end" className="text-xs font-semibold text-stone-700">
                          Session End Date
                        </Label>
                        <Input
                          id="wiz-ay-end"
                          type="date"
                          value={academicYear.end_date}
                          onChange={(e) => setAcademicYear({ ...academicYear, end_date: e.target.value })}
                          className="mt-1 text-xs"
                        />
                      </div>
                    </div>

                    <div className="pt-2 border-t border-stone-100 flex items-center justify-between">
                      <div>
                        <div className="text-xs font-semibold text-stone-800">Set as Current Active Session</div>
                        <div className="text-[11px] text-stone-400">
                          Makes this the default session for attendance, grading, and portals.
                        </div>
                      </div>
                      <Switch
                        checked={academicYear.is_current}
                        onCheckedChange={(val) => setAcademicYear({ ...academicYear, is_current: val })}
                      />
                    </div>
                  </div>
                </div>
              )}

              {/* STEP 2: Grade Span & Capacity Quick-Tweak Grid */}
              {currentStep === 2 && (
                <div className="space-y-6">
                  <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 bg-white p-4 rounded-xl border border-stone-200 shadow-sm">
                    <div className="space-y-1">
                      <h3 className="text-sm font-semibold text-stone-900">Grade Span & Infrastructure Presets</h3>
                      <p className="text-xs text-stone-500">
                        Choose the operational range of classes and baseline section multiplier.
                      </p>
                    </div>
                    {/* Live Campus Capacity Pill */}
                    <div className="bg-indigo-50 border border-indigo-200 rounded-lg px-3 py-2 flex items-center gap-3">
                      <Users className="w-4 h-4 text-indigo-600" />
                      <div>
                        <div className="text-[11px] uppercase font-bold tracking-wider text-indigo-600">
                          Campus Seat Capacity
                        </div>
                        <div className="text-sm font-bold text-indigo-900">
                          {calculatedStructure.totalCapacity.toLocaleString()} Students
                          <span className="text-xs font-normal text-indigo-600 ml-1.5">
                            ({calculatedStructure.totalClasses} classes, {calculatedStructure.totalSections} sections)
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Range Selectors */}
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3 bg-white p-4 rounded-xl border border-stone-200 shadow-sm">
                    <div>
                      <Label className="text-xs text-stone-600">Starting Grade</Label>
                      <Select value={startGradeId} onValueChange={setStartGradeId}>
                        <SelectTrigger className="mt-1 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="Nursery">Nursery</SelectItem>
                          <SelectItem value="LKG">LKG</SelectItem>
                          <SelectItem value="UKG">UKG</SelectItem>
                          <SelectItem value="Class 1">Class 1 (Primary)</SelectItem>
                          <SelectItem value="Class 2">Class 2 (Primary)</SelectItem>
                          <SelectItem value="Class 3">Class 3 (Primary)</SelectItem>
                          <SelectItem value="Class 4">Class 4 (Primary)</SelectItem>
                          <SelectItem value="Class 5">Class 5 (Primary)</SelectItem>
                          <SelectItem value="Class 6">Class 6 (Middle)</SelectItem>
                          <SelectItem value="Class 7">Class 7 (Middle)</SelectItem>
                          <SelectItem value="Class 8">Class 8 (Middle)</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div>
                      <Label className="text-xs text-stone-600">Ending Grade</Label>
                      <Select value={endGradeId} onValueChange={setEndGradeId}>
                        <SelectTrigger className="mt-1 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="Class 5">Class 5 (Primary)</SelectItem>
                          <SelectItem value="Class 8">Class 8 (Middle)</SelectItem>
                          <SelectItem value="Class 10">Class 10 (Secondary)</SelectItem>
                          <SelectItem value="Class 12">Class 12 (Senior Secondary)</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div>
                      <Label className="text-xs text-stone-600">Default Sections/Grade</Label>
                      <Select
                        value={String(defaultSectionsCount)}
                        onValueChange={(val) => setDefaultSectionsCount(Number(val))}
                      >
                        <SelectTrigger className="mt-1 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="2">2 Sections (A, B)</SelectItem>
                          <SelectItem value="3">3 Sections (A, B, C)</SelectItem>
                          <SelectItem value="4">4 Sections (A, B, C, D)</SelectItem>
                          <SelectItem value="5">5 Sections (A–E)</SelectItem>
                          <SelectItem value="6">6 Sections (A–F)</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div>
                      <Label className="text-xs text-stone-600">Default Capacity/Section</Label>
                      <Input
                        type="number"
                        min="10"
                        max="100"
                        value={defaultCapacity}
                        onChange={(e) => setDefaultCapacity(Number(e.target.value) || 40)}
                        className="mt-1 text-xs"
                      />
                    </div>
                  </div>

                  {/* Quick-Tweak Grid */}
                  <div className="bg-white rounded-xl border border-stone-200 shadow-sm overflow-hidden">
                    <div className="px-4 py-3 bg-stone-50 border-b border-stone-200 flex items-center justify-between">
                      <div className="text-xs font-semibold text-stone-700">
                        Class-by-Class Customizer ({activeGrades.length} Grades)
                      </div>
                      <span className="text-[11px] text-stone-400">
                        Tweak section counts or capacity for specific grades as needed
                      </span>
                    </div>

                    <div className="max-h-60 overflow-y-auto divide-y divide-stone-100">
                      {activeGrades.map((g) => {
                        const override = gradeOverrides[g.id] || {};
                        const secCount = override.sectionsCount ?? defaultSectionsCount;
                        const cap = override.capacity ?? defaultCapacity;
                        const isSenior = g.stage === "senior_secondary";

                        return (
                          <div key={g.id} className="px-4 py-2.5 flex items-center justify-between text-xs hover:bg-stone-50/50">
                            <div className="flex items-center gap-2 min-w-[120px]">
                              <span className="font-semibold text-stone-800">{g.name}</span>
                              <Badge
                                variant="outline"
                                className={`text-[11px] capitalize ${
                                  g.stage === "senior_secondary"
                                    ? "bg-purple-50 text-purple-700 border-purple-200"
                                    : g.stage === "secondary"
                                    ? "bg-indigo-50 text-indigo-700 border-indigo-200"
                                    : g.stage === "middle"
                                    ? "bg-amber-50 text-amber-700 border-amber-200"
                                    : "bg-emerald-50 text-emerald-700 border-emerald-200"
                                }`}
                              >
                                {g.stage.replace("_", " ")}
                              </Badge>
                            </div>

                            {isSenior ? (
                              <div className="flex items-center gap-2 text-[11px]">
                                <span className="text-purple-700 font-medium">
                                  {(gradeStreamConfigs[g.name] || []).length} streams ·{" "}
                                  {(gradeStreamConfigs[g.name] || []).reduce((a, s) => a + (s.sectionsCount || 0), 0)} sections
                                </span>
                                <span className="text-stone-300">·</span>
                                <span className="text-stone-600 font-semibold">
                                  {(gradeStreamConfigs[g.name] || []).reduce(
                                    (a, s) => a + ((s.sectionsCount || 0) * (s.capacity || 40)),
                                    0
                                  )}{" "}
                                  seats
                                </span>
                              </div>
                            ) : (
                              <div className="flex items-center gap-4">
                                <div className="flex items-center gap-1.5">
                                  <span className="text-stone-400 text-[11px]">Sections:</span>
                                  <input
                                    type="number"
                                    min="1"
                                    max="12"
                                    value={secCount}
                                    onChange={(e) => {
                                      const val = Math.max(1, Number(e.target.value) || 1);
                                      setGradeOverrides({
                                        ...gradeOverrides,
                                        [g.id]: { ...override, sectionsCount: val },
                                      });
                                    }}
                                    className="w-12 h-7 px-2 border border-stone-200 rounded text-center text-xs"
                                  />
                                </div>
                                <div className="flex items-center gap-1.5">
                                  <span className="text-stone-400 text-[11px]">Seats/Sec:</span>
                                  <input
                                    type="number"
                                    min="10"
                                    max="100"
                                    value={cap}
                                    onChange={(e) => {
                                      const val = Math.max(10, Number(e.target.value) || 40);
                                      setGradeOverrides({
                                        ...gradeOverrides,
                                        [g.id]: { ...override, capacity: val },
                                      });
                                    }}
                                    className="w-14 h-7 px-2 border border-stone-200 rounded text-center text-xs"
                                  />
                                </div>
                                <div className="text-[11px] text-stone-500 font-medium min-w-[70px] text-right">
                                  {secCount * cap} seats
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              )}

              {/* STEP 3: Senior Secondary Streams (Independent 11th & 12th) */}
              {currentStep === 3 && (
                <div className="space-y-6">
                  {!hasHighSchool ? (
                    <div className="bg-amber-50 border border-amber-200 rounded-xl p-6 text-center space-y-2">
                      <AlertCircle className="w-8 h-8 text-amber-600 mx-auto" />
                      <h4 className="text-sm font-semibold text-amber-900">High School Not In Selected Span</h4>
                      <p className="text-xs text-amber-700 max-w-md mx-auto">
                        Your selected grade span ends at {endGradeId}. Classes 11 & 12 are not included in this setup.
                        Click Next to proceed directly to Curriculum & Subjects.
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      <div className="space-y-1">
                        <h3 className="text-sm font-semibold text-stone-900">
                          Senior Secondary Stream Configuration (Independent for 11th & 12th)
                        </h3>
                        <p className="text-xs text-stone-500">
                          Configure academic streams, section counts, and seat capacities independently for Class 11 and Class 12.
                        </p>
                      </div>

                      {/* Grade Tabs & Copy Button */}
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white p-3 rounded-xl border border-stone-200 shadow-sm">
                        <div className="flex items-center gap-2">
                          {seniorSecondaryGrades.map((g) => {
                            const isTabActive = activeSeniorGrade === g.name;
                            const streamsList = gradeStreamConfigs[g.name] || [];
                            const totalSecs = streamsList.reduce((acc, s) => acc + (s.sectionsCount || 0), 0);
                            const totalSeats = streamsList.reduce(
                              (acc, s) => acc + ((s.sectionsCount || 0) * (s.capacity || 40)),
                              0
                            );

                            return (
                              <button
                                key={g.name}
                                type="button"
                                onClick={() => setActiveSeniorGrade(g.name)}
                                className={`px-4 py-2 rounded-lg text-xs font-semibold transition-all flex items-center gap-2 ${
                                  isTabActive
                                    ? "bg-indigo-600 text-white shadow-sm"
                                    : "bg-stone-100 text-stone-600 hover:bg-stone-200"
                                }`}
                              >
                                <span>{g.name}</span>
                                <Badge
                                  variant="secondary"
                                  className={`text-[11px] ${
                                    isTabActive ? "bg-indigo-700 text-white" : "bg-white text-stone-700"
                                  }`}
                                >
                                  {streamsList.length} streams · {totalSecs} secs ({totalSeats} seats)
                                </Badge>
                              </button>
                            );
                          })}
                        </div>

                        {seniorSecondaryGrades.length > 1 && (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              const targetGrade = activeSeniorGrade === "Class 11" ? "Class 12" : "Class 11";
                              handleCopyStreamConfig(activeSeniorGrade, targetGrade);
                            }}
                            className="text-xs text-indigo-600 border-indigo-200 hover:bg-indigo-50 h-8"
                          >
                            <Copy className="w-3.5 h-3.5 mr-1.5" />
                            Copy {activeSeniorGrade} to {activeSeniorGrade === "Class 11" ? "Class 12" : "Class 11"}
                          </Button>
                        )}
                      </div>

                      {/* Stream Cards for Selected Senior Secondary Grade */}
                      <div className="bg-stone-100/50 p-3.5 rounded-xl border border-stone-200 space-y-3">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-bold text-stone-800">
                            Available Streams in {activeSeniorGrade}
                          </span>
                          <span className="text-[11px] text-stone-500">
                            Total: {(gradeStreamConfigs[activeSeniorGrade] || []).reduce((a, s) => a + (s.sectionsCount || 0), 0)} sections ·{" "}
                            {(gradeStreamConfigs[activeSeniorGrade] || []).reduce(
                              (a, s) => a + ((s.sectionsCount || 0) * (s.capacity || 40)),
                              0
                            )}{" "}
                            seats
                          </span>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                          {STREAM_DEFINITIONS.map((streamDef) => {
                            const currentGradeStreams = gradeStreamConfigs[activeSeniorGrade] || [];
                            const isSelected = currentGradeStreams.some((s) => s.id === streamDef.id);
                            const config = currentGradeStreams.find((s) => s.id === streamDef.id);
                            const count = config?.sectionsCount || 2;
                            const cap = config?.capacity || 40;
                            const prefix = streamDef.code.replace("SCI-", "Sci-");

                            return (
                              <div
                                key={streamDef.id}
                                className={`p-4 rounded-xl border transition-all ${
                                  isSelected
                                    ? "bg-white border-indigo-300 ring-2 ring-indigo-100 shadow-sm"
                                    : "bg-white/60 border-stone-200 opacity-70 hover:opacity-100"
                                }`}
                              >
                                <div className="flex items-start justify-between">
                                  <div className="flex items-center gap-2">
                                    <Checkbox
                                      id={`str-${activeSeniorGrade}-${streamDef.id}`}
                                      checked={isSelected}
                                      onCheckedChange={() => handleToggleStreamForGrade(activeSeniorGrade, streamDef)}
                                    />
                                    <label
                                      htmlFor={`str-${activeSeniorGrade}-${streamDef.id}`}
                                      className="text-xs font-bold text-stone-900 cursor-pointer"
                                    >
                                      {streamDef.name}
                                    </label>
                                  </div>
                                  <Badge className={`text-[11px] ${streamDef.badge}`}>
                                    {streamDef.code}
                                  </Badge>
                                </div>

                                {isSelected && (
                                  <div className="mt-3 pt-3 border-t border-stone-100 space-y-2.5">
                                    <div className="grid grid-cols-2 gap-3 text-xs">
                                      <div>
                                        <span className="text-[11px] text-stone-500 block mb-1">
                                          Sections in {activeSeniorGrade}:
                                        </span>
                                        <Input
                                          type="number"
                                          min="1"
                                          max="8"
                                          value={count}
                                          onChange={(e) =>
                                            handleUpdateStreamForGrade(
                                              activeSeniorGrade,
                                              streamDef.id,
                                              "sectionsCount",
                                              e.target.value
                                            )
                                          }
                                          className="h-7 text-xs"
                                        />
                                      </div>
                                      <div>
                                        <span className="text-[11px] text-stone-500 block mb-1">Seats / Section:</span>
                                        <Input
                                          type="number"
                                          min="10"
                                          max="80"
                                          value={cap}
                                          onChange={(e) =>
                                            handleUpdateStreamForGrade(
                                              activeSeniorGrade,
                                              streamDef.id,
                                              "capacity",
                                              e.target.value
                                            )
                                          }
                                          className="h-7 text-xs"
                                        />
                                      </div>
                                    </div>

                                    {/* Section Names Preview */}
                                    <div className="flex items-center gap-1.5 flex-wrap pt-1">
                                      <span className="text-[11px] text-stone-400">Sections:</span>
                                      {Array.from({ length: count }).map((_, sIdx) => {
                                        const letter = SECTION_LETTERS[sIdx] || `S${sIdx + 1}`;
                                        return (
                                          <Badge
                                            key={letter}
                                            variant="secondary"
                                            className="text-[9px] px-1.5 py-0 bg-stone-100 text-stone-600"
                                          >
                                            {count > 1 ? `${prefix}-${letter}` : prefix} ({cap})
                                          </Badge>
                                        );
                                      })}
                                    </div>
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* STEP 4: Curriculum Preset & Subjects */}
              {currentStep === 4 && (
                <div className="space-y-5">
                  <div className="space-y-1">
                    <h3 className="text-sm font-semibold text-stone-900">Curriculum & Subject Catalog</h3>
                    <p className="text-xs text-stone-500">
                      Choose a predefined catalog preset or build a custom curriculum. You can freely toggle subjects or add custom offerings.
                    </p>
                  </div>

                  {/* Preset Selector Cards */}
                  <div className="grid grid-cols-1 md:grid-cols-4 gap-2.5">
                    {Object.values(CURRICULUM_PRESETS).map((preset) => {
                      const isSelected = selectedPresetId === preset.id;
                      const isDisabled = !preset.isAvailable;

                      return (
                        <div
                          key={preset.id}
                          onClick={() => !isDisabled && setSelectedPresetId(preset.id)}
                          className={`p-3 rounded-xl border text-left transition-all ${
                            isDisabled
                              ? "bg-stone-100 border-stone-200 opacity-60 cursor-not-allowed"
                              : isSelected
                              ? "bg-white border-indigo-600 ring-2 ring-indigo-100 shadow-sm cursor-pointer"
                              : "bg-white border-stone-200 hover:border-stone-300 cursor-pointer"
                          }`}
                        >
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-bold text-stone-900">{preset.name}</span>
                            {preset.badge && (
                              <Badge variant="outline" className="text-[9px] bg-stone-200 text-stone-600 border-stone-300">
                                {preset.badge}
                              </Badge>
                            )}
                          </div>
                          <p className="text-[11px] text-stone-500 mt-1 line-clamp-2">{preset.description}</p>
                        </div>
                      );
                    })}
                  </div>

                  {/* Subject List & Action Bar */}
                  <div className="bg-white rounded-xl border border-stone-200 shadow-sm p-4 space-y-4">
                    <div className="flex items-center justify-between">
                      <div className="text-xs font-semibold text-stone-800">
                        Selected Subjects ({selectedSubjects.length})
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setCustomSubjectDialogOpen(true)}
                        className="text-xs text-indigo-600 border-indigo-200 hover:bg-indigo-50"
                      >
                        <Plus className="w-3.5 h-3.5 mr-1" /> Add Custom Subject
                      </Button>
                    </div>

                    {selectedSubjects.length === 0 ? (
                      <div className="p-8 text-center space-y-1.5">
                        <div className="text-xs font-medium text-stone-500">
                          No subjects configured for the selected grade span.
                        </div>
                        <div className="text-[11px] text-stone-400">
                          Select a curriculum preset above ({activeGrades.map((g) => g.name).join(", ")}) or click "Add Custom Subject".
                        </div>
                      </div>
                    ) : (
                      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2 max-h-64 overflow-y-auto p-1">
                        {selectedSubjects.map((sub, idx) => (
                          <div
                            key={sub.id || idx}
                            className="p-2.5 rounded-lg border border-stone-200 flex items-start justify-between bg-stone-50/50 hover:bg-stone-50"
                          >
                            <div className="space-y-0.5">
                              <div className="text-xs font-semibold text-stone-900">{sub.name}</div>
                              <div className="flex items-center gap-1.5">
                                {sub.code && (
                                  <Badge variant="outline" className="text-[9px] px-1 py-0 bg-white">
                                    {sub.code}
                                  </Badge>
                                )}
                                <span className="text-[11px] text-stone-400">{sub.department}</span>
                              </div>
                            </div>
                            <Button
                              size="icon"
                              variant="ghost"
                              onClick={() => handleToggleSubject(sub)}
                              className="h-6 w-6 text-stone-400 hover:text-red-600"
                            >
                              ✕
                            </Button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* STEP 5: Review & Build */}
              {currentStep === 5 && (
                <div className="space-y-6">
                  <div className="space-y-1">
                    <h3 className="text-sm font-semibold text-stone-900">Review School Structure</h3>
                    <p className="text-xs text-stone-500">
                      Verify generated academic entities before committing the atomic setup transaction.
                    </p>
                  </div>

                  {/* Summary Metric Cards */}
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    <div className="bg-white p-3.5 rounded-xl border border-stone-200 shadow-sm">
                      <div className="text-[11px] text-stone-400 font-medium">Session Cycle</div>
                      <div className="text-sm font-bold text-stone-900 mt-1">{academicYear.name}</div>
                      <div className="text-[11px] text-emerald-600 font-medium mt-1">
                        {academicYear.is_current ? "Active Academic Year" : "Scheduled"}
                      </div>
                    </div>

                    <div className="bg-white p-3.5 rounded-xl border border-stone-200 shadow-sm">
                      <div className="text-[11px] text-stone-400 font-medium">Grades & Classes</div>
                      <div className="text-sm font-bold text-indigo-700 mt-1">
                        {calculatedStructure.totalClasses} Grades
                      </div>
                      <div className="text-[11px] text-stone-500 mt-1">
                        {startGradeId} to {endGradeId}
                      </div>
                    </div>

                    <div className="bg-white p-3.5 rounded-xl border border-stone-200 shadow-sm">
                      <div className="text-[11px] text-stone-400 font-medium">Sections & Rooms</div>
                      <div className="text-sm font-bold text-indigo-700 mt-1">
                        {calculatedStructure.totalSections} Sections
                      </div>
                      <div className="text-[11px] text-stone-500 mt-1">
                        {hasHighSchool ? `${allActiveStreamIds.length} stream tracks` : "Standard division"}
                      </div>
                    </div>

                    <div className="bg-white p-3.5 rounded-xl border border-stone-200 shadow-sm">
                      <div className="text-[11px] text-stone-400 font-medium">Total Student Capacity</div>
                      <div className="text-sm font-bold text-purple-700 mt-1">
                        {calculatedStructure.totalCapacity.toLocaleString()} Seats
                      </div>
                      <div className="text-[11px] text-stone-500 mt-1">{selectedSubjects.length} subjects configured</div>
                    </div>
                  </div>

                  {/* Visual Structure Tree Preview */}
                  <div className="bg-white rounded-xl border border-stone-200 shadow-sm p-4 space-y-3">
                    <div className="text-xs font-semibold text-stone-800">Generated Class Structure Preview</div>
                    <div className="max-h-56 overflow-y-auto space-y-2 pr-1">
                      {calculatedStructure.classes.map((c) => (
                        <div key={c.name} className="p-2.5 rounded-lg border border-stone-100 bg-stone-50/60 flex items-center justify-between text-xs">
                          <div className="flex items-center gap-2">
                            <span className="font-semibold text-stone-900">{c.name}</span>
                            <Badge variant="outline" className="text-[11px] capitalize">
                              {c.stage.replace("_", " ")}
                            </Badge>
                          </div>
                          <div className="flex flex-wrap gap-1.5 max-w-[60%] justify-end">
                            {c.sections.map((sec) => (
                              <Badge
                                key={sec.name}
                                variant="secondary"
                                className="text-[11px] bg-white border border-stone-200 text-stone-700"
                              >
                                {sec.name} ({sec.capacity} seats)
                              </Badge>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Safe Additive Guarantee Alert */}
                  <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3.5 flex items-start gap-3">
                    <ShieldCheck className="w-5 h-5 text-emerald-600 mt-0.5 flex-shrink-0" />
                    <div className="text-xs text-emerald-900 space-y-0.5">
                      <span className="font-semibold">Safe Additive Provisioning Active</span>
                      <p className="text-[11px] text-emerald-700">
                        Existing classes, sections, and subjects will not be overwritten. Existing student enrollments are strictly preserved.
                      </p>
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* Wizard Footer Controls */}
        {!resultData && (
          <div className="bg-white border-t border-stone-200 px-6 py-3.5 flex items-center justify-between">
            <Button
              variant="outline"
              size="sm"
              onClick={() => (currentStep === 1 ? onOpenChange(false) : setCurrentStep(currentStep - 1))}
              disabled={isSubmitting}
              className="text-xs"
            >
              {currentStep === 1 ? "Cancel" : <><ChevronLeft className="w-4 h-4 mr-1" /> Back</>}
            </Button>

            <div className="flex items-center gap-2">
              {currentStep < 5 ? (
                <Button
                  size="sm"
                  onClick={handleNext}
                  className="bg-indigo-600 hover:bg-indigo-700 text-white text-xs"
                >
                  Next <ChevronRight className="w-4 h-4 ml-1" />
                </Button>
              ) : (
                <Button
                  size="sm"
                  onClick={handleProvisionSchool}
                  disabled={isSubmitting}
                  className="bg-gradient-to-r from-indigo-600 to-indigo-800 hover:from-indigo-700 hover:to-indigo-900 text-white text-xs shadow-sm font-semibold"
                >
                  {isSubmitting ? (
                    <>Provisioning Structure...</>
                  ) : (
                    <>
                      <Sparkles className="w-3.5 h-3.5 mr-1.5" /> Generate Complete School Setup
                    </>
                  )}
                </Button>
              )}
            </div>
          </div>
        )}
      </DialogContent>

      {/* Inline Custom Subject Modal */}
      <Dialog open={customSubjectDialogOpen} onOpenChange={setCustomSubjectDialogOpen}>
        <DialogContent className="max-w-md bg-white">
          <DialogHeader>
            <DialogTitle className="text-base font-semibold">Add Custom Subject</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleAddCustomSubject} className="space-y-3 pt-2 text-xs">
            <div>
              <Label className="text-xs">Subject Name *</Label>
              <Input
                value={customSubject.name}
                onChange={(e) => setCustomSubject({ ...customSubject, name: e.target.value })}
                placeholder="e.g. Robotics & AI"
                className="mt-1 text-xs"
                required
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Subject Code</Label>
                <Input
                  value={customSubject.code}
                  onChange={(e) => setCustomSubject({ ...customSubject, code: e.target.value })}
                  placeholder="e.g. ROB-101"
                  className="mt-1 text-xs"
                />
              </div>
              <div>
                <Label className="text-xs">Department</Label>
                <Input
                  value={customSubject.department}
                  onChange={(e) => setCustomSubject({ ...customSubject, department: e.target.value })}
                  placeholder="e.g. Technology"
                  className="mt-1 text-xs"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Category</Label>
                <Select
                  value={customSubject.category}
                  onValueChange={(val) => setCustomSubject({ ...customSubject, category: val })}
                >
                  <SelectTrigger className="mt-1 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Core">Core</SelectItem>
                    <SelectItem value="Elective">Elective</SelectItem>
                    <SelectItem value="Language">Language</SelectItem>
                    <SelectItem value="Vocational">Vocational</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Credits</Label>
                <Input
                  type="number"
                  min="1"
                  max="10"
                  value={customSubject.credits}
                  onChange={(e) => setCustomSubject({ ...customSubject, credits: Number(e.target.value) || 1 })}
                  className="mt-1 text-xs"
                />
              </div>
            </div>
            <DialogFooter className="pt-3">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setCustomSubjectDialogOpen(false)}
                className="text-xs"
              >
                Cancel
              </Button>
              <Button type="submit" size="sm" className="bg-indigo-600 hover:bg-indigo-700 text-white text-xs">
                Add Subject
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </Dialog>
  );
}
