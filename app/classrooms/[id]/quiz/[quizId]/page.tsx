'use client';

import { useEffect, useState, useCallback, use, useRef } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';

interface Quiz {
  id: string;
  classroom_id: string;
  title: string;
  description?: string | null;
  time_limit_minutes?: number | null;
  created_at?: string;
}

interface QuizQuestion {
  id: string | number;
  quiz_id?: string;
  question_text: string;
  options: string[];
  correct_index: number;
}

interface QuizSubmission {
  id?: string;
  quiz_id: string;
  student_id: string;
  score: number;
  answers?: Record<string, number> | null;
  correct_count?: number | null;
  total_questions?: number | null;
  submitted_at?: string;
}

const OPTION_LABELS = ['A', 'B', 'C', 'D', 'E', 'F'];

export default function TakeQuizPage({
  params,
}: {
  params: Promise<{ id: string; quizId: string }>;
}) {
  const router = useRouter();
  const resolvedParams = use(params);
  const classroomId = resolvedParams.id;
  const quizId = resolvedParams.quizId;

  const [currentUserId, setCurrentUserId] = useState<string>('');
  const [quiz, setQuiz] = useState<Quiz | null>(null);
  const [questions, setQuestions] = useState<QuizQuestion[]>([]);
  const [userAnswers, setUserAnswers] = useState<Record<string, number>>({});
  const [isSubmitted, setIsSubmitted] = useState<boolean>(false);
  const [submittedResult, setSubmittedResult] = useState<{
    score: number;
    correctCount: number;
    totalQuestions: number;
    submittedAt?: string;
  } | null>(null);

  const [timeLeft, setTimeLeft] = useState<number | null>(null);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [showConfirmModal, setShowConfirmModal] = useState<boolean>(false);

  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const hasAutoSubmittedRef = useRef<boolean>(false);
  const answersRef = useRef<Record<string, number>>({});

  useEffect(() => {
    answersRef.current = userAnswers;
  }, [userAnswers]);

  // Xử lý nộp bài
  const submitQuiz = useCallback(
    async (answersToSubmit: Record<string, number>, isAuto: boolean = false) => {
      if (hasAutoSubmittedRef.current || isSubmitting) return;
      hasAutoSubmittedRef.current = true;
      setIsSubmitting(true);

      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }

      try {
        let correctCount = 0;
        questions.forEach((q, index) => {
          const qKey = String(q.id || index);
          if (answersToSubmit[qKey] === q.correct_index) {
            correctCount += 1;
          }
        });

        const totalQuestions = questions.length;
        const calculatedScore =
          totalQuestions > 0 ? Number(((correctCount / totalQuestions) * 10).toFixed(1)) : 0;
        const submittedAt = new Date().toISOString();

        // 1. Lưu vào bảng quiz_submissions trên Supabase
        const submissionPayload: {
          quiz_id: string;
          student_id: string;
          score: number;
          answers: Record<string, number>;
          correct_count: number;
          total_questions: number;
          submitted_at: string;
        } = {
          quiz_id: quizId,
          student_id: currentUserId,
          score: calculatedScore,
          answers: answersToSubmit,
          correct_count: correctCount,
          total_questions: totalQuestions,
          submitted_at: submittedAt,
        };

        const { error: insertError } = await supabase
          .from('quiz_submissions')
          .insert([submissionPayload]);

        if (insertError) {
          // Thử fallback lược bớt cột nếu DB chưa có cột correct_count hoặc total_questions
          const fallbackPayload = {
            quiz_id: quizId,
            student_id: currentUserId,
            score: calculatedScore,
            answers: answersToSubmit,
            submitted_at: submittedAt,
          };
          const { error: fallbackError } = await supabase
            .from('quiz_submissions')
            .insert([fallbackPayload]);

          if (fallbackError) {
            console.error('Lỗi khi nộp bài:', fallbackError);
          }
        }

        setSubmittedResult({
          score: calculatedScore,
          correctCount,
          totalQuestions,
          submittedAt,
        });
        setIsSubmitted(true);
        setShowConfirmModal(false);

        if (isAuto) {
          alert('Hết thời gian làm bài! Hệ thống đã tự động thu bài và tính điểm cho bạn.');
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Có lỗi xảy ra khi nộp bài.';
        alert(`Lỗi khi nộp bài: ${msg}`);
      } finally {
        setIsSubmitting(false);
      }
    },
    [currentUserId, isSubmitting, questions, quizId]
  );

  // Tải dữ liệu ban đầu
  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      setErrorMessage(null);

      try {
        // 1. Kiểm tra xác thực người dùng
        const {
          data: { user },
          error: authError,
        } = await supabase.auth.getUser();

        if (authError || !user) {
          router.push('/login');
          return;
        }
        setCurrentUserId(user.id);

        // 2. Tải thông tin bài trắc nghiệm
        const { data: quizData, error: quizError } = await supabase
          .from('quizzes')
          .select('*')
          .eq('id', quizId)
          .single();

        if (quizError || !quizData) {
          setErrorMessage('Không tìm thấy bài trắc nghiệm hoặc bài kiểm tra đã bị xóa.');
          setLoading(false);
          return;
        }

        setQuiz(quizData as Quiz);

        // 3. Tải bộ câu hỏi từ quiz_questions
        const { data: questionsData, error: questionsError } = await supabase
          .from('quiz_questions')
          .select('*')
          .eq('quiz_id', quizId)
          .order('id', { ascending: true });

        let loadedQuestions: QuizQuestion[] = [];
        if (!questionsError && questionsData && questionsData.length > 0) {
          loadedQuestions = questionsData as QuizQuestion[];
        } else if (Array.isArray(quizData.questions) && quizData.questions.length > 0) {
          loadedQuestions = quizData.questions as QuizQuestion[];
        }

        setQuestions(loadedQuestions);

        // 4. Kiểm tra bài nộp cũ trong quiz_submissions
        const { data: subData, error: subError } = await supabase
          .from('quiz_submissions')
          .select('*')
          .eq('quiz_id', quizId)
          .eq('student_id', user.id)
          .order('submitted_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (!subError && subData) {
          const submission = subData as QuizSubmission;
          setIsSubmitted(true);

          let correctCount = submission.correct_count ?? 0;
          if (submission.correct_count === null || submission.correct_count === undefined) {
            // Tự tính lại nếu chưa lưu trường correct_count
            const subAnswers = submission.answers || {};
            correctCount = loadedQuestions.filter((q, idx) => {
              const qKey = String(q.id || idx);
              return subAnswers[qKey] === q.correct_index;
            }).length;
          }

          setSubmittedResult({
            score: submission.score,
            correctCount,
            totalQuestions: loadedQuestions.length,
            submittedAt: submission.submitted_at,
          });

          if (submission.answers) {
            setUserAnswers(submission.answers);
          }
        } else {
          // Chưa nộp: Thiết lập thời gian đếm ngược
          const limitMinutes = Number(quizData.time_limit_minutes) || 15;
          setTimeLeft(limitMinutes * 60);
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Có lỗi xảy ra khi nạp đề thi.';
        setErrorMessage(msg);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [quizId, router]);

  // Bộ đếm ngược thời gian
  useEffect(() => {
    if (isSubmitted || timeLeft === null) return;

    if (timeLeft <= 0) {
      if (!hasAutoSubmittedRef.current) {
        submitQuiz(answersRef.current, true);
      }
      return;
    }

    timerRef.current = setInterval(() => {
      setTimeLeft((prev) => {
        if (prev === null) return null;
        if (prev <= 1) {
          if (timerRef.current) clearInterval(timerRef.current);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
    };
  }, [isSubmitted, timeLeft, submitQuiz]);

  // Format hiển thị thời gian MM:SS
  const formatTime = (seconds: number | null): string => {
    if (seconds === null || seconds < 0) return '00:00';
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    const pad = (n: number) => n.toString().padStart(2, '0');
    return `${pad(m)}:${pad(s)}`;
  };

  const handleSelectOption = (questionKey: string, optionIndex: number) => {
    if (isSubmitted) return;
    setUserAnswers((prev) => ({
      ...prev,
      [questionKey]: optionIndex,
    }));
  };

  const answeredCount = Object.keys(userAnswers).length;
  const totalCount = questions.length;
  const progressPercent = totalCount > 0 ? Math.round((answeredCount / totalCount) * 100) : 0;
  const isTimeCritical = timeLeft !== null && timeLeft <= 60 && !isSubmitted;

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center p-6">
        <div className="w-10 h-10 border-4 border-indigo-200 border-t-indigo-600 rounded-full animate-spin"></div>
        <p className="mt-4 text-xs font-semibold text-slate-500">Đang chuẩn bị đề thi trắc nghiệm...</p>
      </div>
    );
  }

  if (errorMessage || !quiz) {
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center p-6">
        <div className="max-w-md w-full bg-white border border-rose-200 rounded-2xl p-6 text-center shadow-sm">
          <div className="w-12 h-12 mx-auto rounded-full bg-rose-50 flex items-center justify-center text-rose-500 mb-4">
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          </div>
          <h2 className="text-base font-bold text-slate-900 mb-2">Thông báo</h2>
          <p className="text-xs text-slate-600 mb-6">{errorMessage || 'Không tìm thấy dữ liệu đề thi.'}</p>
          <Link
            href={`/classrooms/${classroomId}`}
            className="inline-flex items-center justify-center gap-2 px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold rounded-lg transition"
          >
            Quay lại lớp học
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 pb-20">
      {/* Top Header thanh điều hướng */}
      <header className="sticky top-0 z-30 bg-white/95 backdrop-blur-md border-b border-slate-200">
        <div className="max-w-4xl mx-auto px-4 py-3 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <Link
              href={`/classrooms/${classroomId}`}
              className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition shrink-0"
              title="Quay lại lớp học"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
              </svg>
            </Link>
            <div className="truncate">
              <h1 className="text-sm font-bold text-slate-900 truncate">{quiz.title}</h1>
              <p className="text-[11px] text-slate-500 truncate">
                {isSubmitted
                  ? 'Đã hoàn thành bài kiểm tra'
                  : `Đã làm ${answeredCount}/${totalCount} câu hỏi (${progressPercent}%)`}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            {/* Bộ đếm ngược thời gian (Chuẩn 0 emoji, SVG vector) */}
            {!isSubmitted ? (
              <div
                className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-xl border font-mono text-xs font-bold transition shadow-xs ${
                  isTimeCritical
                    ? 'bg-rose-50 text-rose-600 border-rose-300 animate-pulse'
                    : 'bg-indigo-50 text-indigo-700 border-indigo-200'
                }`}
              >
                <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <span>Thời gian: {formatTime(timeLeft)}</span>
              </div>
            ) : (
              <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs font-semibold">
                <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                <span>Đã nộp</span>
              </div>
            )}

            {!isSubmitted && (
              <button
                type="button"
                onClick={() => setShowConfirmModal(true)}
                disabled={isSubmitting}
                className="inline-flex items-center gap-1.5 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-xs font-bold rounded-xl shadow-xs transition cursor-pointer"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <span>Nộp bài</span>
              </button>
            )}
          </div>
        </div>

        {/* Thanh tiến độ làm bài */}
        {!isSubmitted && (
          <div className="w-full bg-slate-100 h-1">
            <div
              className="bg-indigo-600 h-1 transition-all duration-300"
              style={{ width: `${progressPercent}%` }}
            ></div>
          </div>
        )}
      </header>

      {/* Main Content */}
      <main className="max-w-4xl mx-auto px-4 py-8 space-y-6">
        {/* Banner kết quả điểm số nếu đã nộp */}
        {isSubmitted && submittedResult && (
          <section className="bg-white border border-slate-200/80 rounded-2xl p-6 md:p-8 shadow-sm">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 pb-6 border-b border-slate-100">
              <div className="space-y-1">
                <span className="inline-block text-[11px] font-bold text-indigo-600 uppercase tracking-wider bg-indigo-50 px-2.5 py-1 rounded-md mb-1">
                  Kết quả kiểm tra
                </span>
                <h2 className="text-xl font-extrabold text-slate-900">Tổng kết bài làm của bạn</h2>
                <p className="text-xs text-slate-500">
                  {submittedResult.submittedAt
                    ? `Hoàn thành lúc: ${new Date(submittedResult.submittedAt).toLocaleTimeString('vi-VN')} ngày ${new Date(submittedResult.submittedAt).toLocaleDateString('vi-VN')}`
                    : 'Đã hoàn thành bài trắc nghiệm'}
                </p>
              </div>

              {/* Thẻ hiển thị điểm số thang 10 */}
              <div className="flex items-center gap-4 bg-slate-50 border border-slate-200/80 rounded-2xl p-4 shrink-0">
                <div className="text-center px-2">
                  <div className="text-3xl font-black text-indigo-600">
                    {submittedResult.score.toFixed(1)}
                  </div>
                  <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mt-0.5">
                    Thang điểm 10
                  </div>
                </div>

                <div className="h-10 w-px bg-slate-200"></div>

                <div className="text-left pr-2">
                  <div className="text-sm font-bold text-slate-800">
                    {submittedResult.correctCount} / {submittedResult.totalQuestions}
                  </div>
                  <div className="text-xs text-slate-500">Câu trả lời đúng</div>
                  <div className="text-[11px] font-semibold text-emerald-600 mt-0.5">
                    Đạt {submittedResult.totalQuestions > 0 ? Math.round((submittedResult.correctCount / submittedResult.totalQuestions) * 100) : 0}%
                  </div>
                </div>
              </div>
            </div>

            <div className="mt-4 flex items-center justify-between text-xs text-slate-500">
              <p>Xem lại chi tiết các câu trả lời bên dưới để nắm vững kiến thức.</p>
              <Link
                href={`/classrooms/${classroomId}`}
                className="inline-flex items-center gap-1.5 font-semibold text-indigo-600 hover:text-indigo-800 transition"
              >
                <span>Quay lại bảng tin lớp</span>
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
                </svg>
              </Link>
            </div>
          </section>
        )}

        {/* Thông tin mô tả bài thi */}
        {!isSubmitted && quiz.description && (
          <div className="bg-white border border-slate-200/80 rounded-xl p-4 shadow-2xs">
            <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider mb-1">
              Hướng dẫn làm bài
            </h3>
            <p className="text-xs text-slate-600 whitespace-pre-line leading-relaxed">
              {quiz.description}
            </p>
          </div>
        )}

        {/* Bảng điều hướng câu hỏi nhanh (Question Palette) */}
        {questions.length > 0 && (
          <div className="bg-white border border-slate-200/80 rounded-xl p-4 shadow-2xs">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-bold text-slate-700">Mục lục câu hỏi</span>
              <span className="text-xs text-slate-500">
                {isSubmitted
                  ? `${submittedResult?.correctCount || 0}/${totalCount} đúng`
                  : `${answeredCount}/${totalCount} đã chọn`}
              </span>
            </div>
            <div className="flex flex-wrap gap-2">
              {questions.map((q, idx) => {
                const qKey = String(q.id || idx);
                const isAnswered = userAnswers[qKey] !== undefined;
                const isCorrect = isSubmitted && userAnswers[qKey] === q.correct_index;
                const isWrong = isSubmitted && isAnswered && !isCorrect;

                let badgeStyle = 'bg-slate-100 text-slate-600 border-slate-200';
                if (isSubmitted) {
                  if (isCorrect) {
                    badgeStyle = 'bg-emerald-50 text-emerald-700 border-emerald-300 font-bold';
                  } else if (isWrong) {
                    badgeStyle = 'bg-rose-50 text-rose-700 border-rose-300 font-bold';
                  } else {
                    badgeStyle = 'bg-slate-100 text-slate-400 border-slate-200';
                  }
                } else if (isAnswered) {
                  badgeStyle = 'bg-indigo-50 text-indigo-700 border-indigo-300 font-bold';
                }

                return (
                  <a
                    key={qKey}
                    href={`#question-${idx + 1}`}
                    className={`w-8 h-8 rounded-lg border text-xs flex items-center justify-center transition hover:scale-105 ${badgeStyle}`}
                  >
                    {idx + 1}
                  </a>
                );
              })}
            </div>
          </div>
        )}

        {/* Danh sách câu hỏi */}
        <section className="space-y-6">
          {questions.length === 0 ? (
            <div className="bg-white border border-slate-200/80 rounded-2xl p-10 text-center">
              <p className="text-xs text-slate-500">Bài kiểm tra hiện chưa có câu hỏi nào.</p>
            </div>
          ) : (
            questions.map((question, qIdx) => {
              const qKey = String(question.id || qIdx);
              const selectedOpt = userAnswers[qKey];
              const isCorrectAnswer = isSubmitted && selectedOpt === question.correct_index;

              return (
                <div
                  key={qKey}
                  id={`question-${qIdx + 1}`}
                  className="bg-white border border-slate-200/80 rounded-2xl p-5 md:p-6 shadow-sm transition scroll-mt-24"
                >
                  {/* Tiêu đề câu hỏi */}
                  <div className="flex items-start justify-between gap-4 mb-4">
                    <div className="flex items-start gap-3">
                      <span className="shrink-0 px-2.5 py-1 rounded-lg bg-slate-100 text-slate-700 text-xs font-bold">
                        Câu {qIdx + 1}
                      </span>
                      <h3 className="text-sm font-semibold text-slate-900 leading-relaxed">
                        {question.question_text}
                      </h3>
                    </div>

                    {isSubmitted && (
                      <span
                        className={`shrink-0 inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold ${
                          isCorrectAnswer
                            ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                            : 'bg-rose-50 text-rose-700 border border-rose-200'
                        }`}
                      >
                        {isCorrectAnswer ? (
                          <>
                            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                            </svg>
                            <span>Đúng</span>
                          </>
                        ) : (
                          <>
                            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
                            </svg>
                            <span>Sai</span>
                          </>
                        )}
                      </span>
                    )}
                  </div>

                  {/* Lựa chọn đáp án */}
                  <div className="space-y-2.5 pl-0 md:pl-2">
                    {question.options.map((optText, optIdx) => {
                      const isSelected = selectedOpt === optIdx;
                      const isOptionCorrect = isSubmitted && optIdx === question.correct_index;
                      const isWrongChoice = isSubmitted && isSelected && !isOptionCorrect;

                      let rowStyle = 'border-slate-200 hover:border-slate-300 hover:bg-slate-50/70 text-slate-700';
                      let circleStyle = 'border-slate-300 text-slate-500 bg-white';

                      if (isSubmitted) {
                        if (isOptionCorrect) {
                          rowStyle = 'border-emerald-400 bg-emerald-50/80 text-emerald-900 font-semibold ring-1 ring-emerald-400';
                          circleStyle = 'border-emerald-600 bg-emerald-600 text-white font-bold';
                        } else if (isWrongChoice) {
                          rowStyle = 'border-rose-300 bg-rose-50/80 text-rose-900 ring-1 ring-rose-300';
                          circleStyle = 'border-rose-600 bg-rose-600 text-white font-bold';
                        } else {
                          rowStyle = 'border-slate-200 opacity-60 text-slate-500';
                          circleStyle = 'border-slate-200 text-slate-400 bg-slate-50';
                        }
                      } else if (isSelected) {
                        rowStyle = 'border-indigo-600 bg-indigo-50/60 text-indigo-950 font-semibold ring-1 ring-indigo-500';
                        circleStyle = 'border-indigo-600 bg-indigo-600 text-white font-bold';
                      }

                      return (
                        <label
                          key={optIdx}
                          onClick={() => handleSelectOption(qKey, optIdx)}
                          className={`flex items-center gap-3.5 p-3 rounded-xl border transition text-xs select-none ${
                            isSubmitted ? 'cursor-default' : 'cursor-pointer'
                          } ${rowStyle}`}
                        >
                          <input
                            type="radio"
                            name={`question-${qKey}`}
                            value={optIdx}
                            checked={isSelected}
                            disabled={isSubmitted}
                            onChange={() => handleSelectOption(qKey, optIdx)}
                            className="sr-only"
                          />
                          <div
                            className={`w-6 h-6 rounded-full border flex items-center justify-center text-[11px] shrink-0 transition ${circleStyle}`}
                          >
                            {OPTION_LABELS[optIdx] || optIdx + 1}
                          </div>
                          <span className="flex-1 leading-relaxed">{optText}</span>

                          {isSubmitted && isOptionCorrect && (
                            <span className="text-[11px] font-bold text-emerald-700 bg-emerald-100/80 px-2 py-0.5 rounded-md shrink-0">
                              Đáp án chính xác
                            </span>
                          )}
                          {isSubmitted && isWrongChoice && (
                            <span className="text-[11px] font-bold text-rose-700 bg-rose-100/80 px-2 py-0.5 rounded-md shrink-0">
                              Lựa chọn của bạn
                            </span>
                          )}
                        </label>
                      );
                    })}
                  </div>
                </div>
              );
            })
          )}
        </section>

        {/* Nút nộp bài cuối trang */}
        {!isSubmitted && questions.length > 0 && (
          <div className="pt-4 flex items-center justify-between bg-white border border-slate-200/80 rounded-2xl p-6 shadow-sm">
            <div>
              <div className="text-xs font-bold text-slate-900">
                Bạn đã hoàn thành {answeredCount} / {totalCount} câu hỏi
              </div>
              <p className="text-[11px] text-slate-500 mt-0.5">
                {answeredCount < totalCount
                  ? `Còn ${totalCount - answeredCount} câu chưa trả lời. Bạn có thể kiểm tra lại trước khi nộp.`
                  : 'Bạn đã chọn đủ đáp án cho tất cả câu hỏi!'}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setShowConfirmModal(true)}
              disabled={isSubmitting}
              className="inline-flex items-center gap-2 px-6 py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-xs font-bold rounded-xl shadow-xs transition cursor-pointer"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span>{isSubmitting ? 'Đang nộp...' : 'Nộp bài kiểm tra'}</span>
            </button>
          </div>
        )}
      </main>

      {/* Modal xác nhận nộp bài */}
      {showConfirmModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-xs">
          <div className="bg-white border border-slate-200 rounded-2xl max-w-sm w-full p-6 shadow-xl space-y-4">
            <div className="w-12 h-12 mx-auto rounded-full bg-indigo-50 flex items-center justify-center text-indigo-600">
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <div className="text-center">
              <h3 className="text-sm font-bold text-slate-900">Xác nhận nộp bài?</h3>
              <p className="text-xs text-slate-500 mt-1">
                {answeredCount < totalCount ? (
                  <span className="text-amber-600 font-semibold">
                    Cảnh báo: Bạn còn {totalCount - answeredCount} câu chưa trả lời!
                  </span>
                ) : (
                  'Bạn đã trả lời đầy đủ các câu hỏi.'
                )}
                {' '}Sau khi nộp, hệ thống sẽ tự động chấm điểm và bạn không thể sửa lại câu trả lời.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-3 pt-2">
              <button
                type="button"
                onClick={() => setShowConfirmModal(false)}
                className="w-full px-4 py-2 border border-slate-200 hover:bg-slate-50 text-slate-700 text-xs font-semibold rounded-xl transition"
              >
                Tiếp tục làm
              </button>
              <button
                type="button"
                onClick={() => submitQuiz(userAnswers, false)}
                disabled={isSubmitting}
                className="w-full px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-xs font-semibold rounded-xl transition shadow-xs"
              >
                {isSubmitting ? 'Đang nộp...' : 'Đồng ý nộp'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
