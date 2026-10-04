import React from "react";

export default function WhyExamOS() {
  return (
    <section className="pb-24">
      <div className="relative rounded-3xl overflow-hidden bg-white/[0.04] backdrop-blur-xl border border-white/10 p-10 md:p-16 text-center">
        <div className="absolute -top-24 left-1/2 -translate-x-1/2 w-[400px] h-[300px] rounded-full bg-fuchsia-600/20 blur-[100px]" />
        <div className="relative max-w-3xl mx-auto">
          <div className="text-sm font-semibold text-violet-300 uppercase tracking-widest mb-4">Why Avexora ExamOS?</div>
          <h2 className="text-3xl md:text-4xl font-bold mb-6">One Platform. Complete Examination Management.</h2>
          <p className="text-stone-400 leading-relaxed mb-4">
            Managing examinations shouldn't require multiple software systems or hours of manual work. Avexora ExamOS centralizes every stage of the assessment process into one intelligent platform.
          </p>
          <p className="text-stone-400 leading-relaxed">
            Whether you're conducting a weekly class test or a statewide examination, our platform scales to meet your needs while maintaining speed, accuracy, and security.
          </p>
        </div>
      </div>
    </section>
  );
}