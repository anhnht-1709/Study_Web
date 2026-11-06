'use client';

import { useState, use } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '../../../../lib/supabase';

interface QuestionForm {
  question_text: string;
  options: string[];
  correct_index: number;
}

export default function CreateQuizPage({ params }: { params: Promise<{ id: string }> }) {
  const router = useRouter();
  const resolvedParams = use(params);
  const classroomId = resolvedParams.id;

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [timeLimit, setTimeLimit] = useState(15);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [questions, setQuestions] = useState<QuestionForm[]>([
    {
      question_text: '',
      options: ['', '', '', ''],
      correct_index: 0,
    },
  ]);

  const handleAddQuestion = () => {
    setQuestions([
      ...questions,
      {
        question_text: '',
        options: ['', '', '', ''],
        correct_index: 0,
      },
    ]);
  };

  const handleRemoveQuestion = (index: number) => {
    if (questions.length === 1) return;
    setQuestions(questions.filter((_, i) => i !== index));
  };

  const handleOptionChange = (qIndex: number, optIndex: number, value: string) => {
    const updated = [...questions];
    updated[qIndex].options[optIndex] = value;
    setQuestions(updated);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);

    try {
      // 1. Tạo bài trắc nghiệm
      const { data: quizData, error: quizError } = await supabase
        .from('quizzes')
        .insert([
          {
            classroom_id: classroomId,
            title,
            description,
            time_limit_minutes: timeLimit,
          },
        ])
        .select()
        .single();

      if (quizError) throw quizError;

      // 2. Chèn bộ câu hỏi
      const questionsToInsert = questions.map((q) => ({
        quiz_id: quizData.id,
        question_text: q.question_text,
        options: q.options,
        correct_index: q.correct_index,
      }));

      const { error: questionsError } = await supabase
        .from('quiz_questions')
        .insert(questionsToInsert);

      if (questionsError) throw questionsError;

      alert('Đã tạo đề trắc nghiệm thành công!');
      router.push(`/classrooms/${classroomId}`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Có lỗi xảy ra khi tạo đề!';
      alert(`Lỗi tạo đề: ${msg}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 py-10 px-4">
      <div className="max-w-3xl mx-auto bg-white border border-slate-200/80 rounded-2xl p-6 md:p-8 shadow-sm">
        <div className="flex items-center justify-between border-b border-slate-100 pb-4 mb-6">
          <div>
            <h1 className="text-xl font-bold text-slate-900">Tạo đề thi trắc nghiệm mới</h1>
            <p className="text-xs text-slate-500 mt-1">Cấu hình thời gian làm bài và các câu hỏi lựa chọn.</p>
          </div>
          <button
            type="button"
            onClick={() => router.back()}
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-slate-800 transition"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
            </svg>
            <span>Huỷ bỏ</span>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Thông tin chung */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="md:col-span-2 space-y-1">
              <label className="text-xs font-semibold text-slate-700">Tiêu đề bài kiểm tra</label>
              <input
                type="text"
                required
                placeholder="VD: Kiểm tra 15 phút - Chương 1"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-semibold text-slate-700">Thời gian làm (phút)</label>
              <input
                type="number"
                min="1"
                max="180"
                required
                value={timeLimit}
                onChange={(e) => setTimeLimit(parseInt(e.target.value) || 15)}
                className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 font-mono"
              />
            </div>
            <div className="md:col-span-3 space-y-1">
              <label className="text-xs font-semibold text-slate-700">Mô tả hoặc ghi chú</label>
              <textarea
                rows={2}
                placeholder="Nhập hướng dẫn làm bài..."
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 resize-none"
              />
            </div>
          </div>

          <hr className="border-slate-100" />

          {/* Danh sách câu hỏi */}
          <div className="space-y-6">
            <div className="flex justify-between items-center">
              <h2 className="text-sm font-bold text-slate-800">
                Bộ câu hỏi ({questions.length})
              </h2>
              <button
                type="button"
                onClick={handleAddQuestion}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-indigo-50 text-indigo-600 hover:bg-indigo-100 text-xs font-semibold rounded-lg transition"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                <span>Thêm câu hỏi</span>
              </button>
            </div>

            {questions.map((q, qIndex) => (
              <div
                key={qIndex}
                className="p-5 bg-slate-50 border border-slate-200 rounded-xl space-y-3 relative"
              >
                <div className="flex justify-between items-center">
                  <span className="font-bold text-xs text-indigo-600 uppercase">
                    Câu {qIndex + 1}
                  </span>
                  {questions.length > 1 && (
                    <button
                      type="button"
                      onClick={() => handleRemoveQuestion(qIndex)}
                      className="inline-flex items-center gap-1 text-[11px] text-rose-500 hover:text-rose-700 font-medium transition"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                      <span>Xóa câu này</span>
                    </button>
                  )}
                </div>

                <input
                  type="text"
                  required
                  placeholder="Nhập nội dung câu hỏi..."
                  value={q.question_text}
                  onChange={(e) => {
                    const updated = [...questions];
                    updated[qIndex].question_text = e.target.value;
                    setQuestions(updated);
                  }}
                  className="w-full px-3 py-2 text-xs border border-slate-200 bg-white rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                />

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-2">
                  {q.options.map((opt, optIndex) => (
                    <div
                      key={optIndex}
                      className={`flex items-center gap-2 p-2 rounded-lg border bg-white ${
                        q.correct_index === optIndex
                          ? 'border-emerald-500 ring-1 ring-emerald-500'
                          : 'border-slate-200'
                      }`}
                    >
                      <input
                        type="radio"
                        name={`correct-${qIndex}`}
                        checked={q.correct_index === optIndex}
                        onChange={() => {
                          const updated = [...questions];
                          updated[qIndex].correct_index = optIndex;
                          setQuestions(updated);
                        }}
                        className="text-emerald-600 focus:ring-emerald-500"
                      />
                      <span className="font-bold text-[11px] text-slate-400 w-4">
                        {String.fromCharCode(65 + optIndex)}
                      </span>
                      <input
                        type="text"
                        required
                        placeholder={`Lựa chọn ${String.fromCharCode(65 + optIndex)}`}
                        value={opt}
                        onChange={(e) => handleOptionChange(qIndex, optIndex, e.target.value)}
                        className="w-full text-xs border-0 p-0 focus:outline-none focus:ring-0"
                      />
                    </div>
                  ))}
                </div>
                <p className="text-[10px] text-slate-400 italic">
                  * Tích chọn vào nút tròn để đánh dấu đáp án đúng.
                </p>
              </div>
            ))}
          </div>

          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold rounded-xl shadow-sm transition disabled:opacity-50"
          >
            {isSubmitting ? 'Đang lưu đề thi...' : 'Hoàn tất & Đăng đề trắc nghiệm'}
          </button>
        </form>
      </div>
    </div>
  );
}
