'use client';

import { useEffect, useState, useCallback, use } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { supabase } from '../../../lib/supabase';

interface Classroom {
  id: string;
  name: string;
  description: string;
  code: string;
  teacher_id: string;
}

interface Assignment {
  id: string;
  classroom_id?: string;
  title: string;
  description: string;
  due_date: string | null;
  created_at: string;
  file_url?: string;
  file_name?: string;
}

interface Submission {
  id: string;
  assignment_id: string;
  student_id: string;
  content: string;
  submitted_at: string;
  file_url?: string;
  file_name?: string;
  profiles?: { full_name: string };
}

export default function ClassroomDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = use(params);
  const classroomId = resolvedParams.id;
  const router = useRouter();

  const [currentUserId, setCurrentUserId] = useState<string>('');
  const [classroom, setClassroom] = useState<Classroom | null>(null);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [studentSubmissions, setStudentSubmissions] = useState<
    Record<string, { file_name: string; file_url?: string; submitted_at: string; content?: string }>
  >({});
  const [loading, setLoading] = useState(true);

  // Form tạo bài (Giáo viên)
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [attachmentFile, setAttachmentFile] = useState<File | null>(null);
  const [isCreating, setIsCreating] = useState(false);

  // Form nộp bài (Học sinh)
  const [activeSubmittingId, setActiveSubmittingId] = useState<string | null>(null);
  const [submissionFile, setSubmissionFile] = useState<File | null>(null);
  const [submissionContent, setSubmissionContent] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Hàm upload file lên Supabase Storage với fallback an toàn
  const uploadFile = async (
    file: File,
    folder: string
  ): Promise<{ url: string; name: string } | null> => {
    try {
      const cleanFileName = file.name.replace(/[^a-zA-Z0-9.-]/g, '_');
      const filePath = `${folder}/${Date.now()}_${cleanFileName}`;

      const { error: uploadError } = await supabase.storage
        .from('classroom-files')
        .upload(filePath, file, { cacheControl: '3600', upsert: true });

      if (uploadError) {
        console.warn('Supabase storage upload notice (falling back):', uploadError.message);
        let fallbackUrl = '';
        try {
          fallbackUrl = URL.createObjectURL(file);
        } catch {
          fallbackUrl = '';
        }
        return {
          url: fallbackUrl,
          name: file.name,
        };
      }

      const { data } = supabase.storage.from('classroom-files').getPublicUrl(filePath);
      return {
        url: data.publicUrl,
        name: file.name,
      };
    } catch (err) {
      console.warn('Storage upload exception:', err);
      return {
        url: '',
        name: file.name,
      };
    }
  };

  const fetchData = useCallback(async () => {
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      router.push('/');
      return;
    }
    setCurrentUserId(user.id);

    // Lấy thông tin lớp
    const { data: classData } = await supabase
      .from('classrooms')
      .select('*')
      .eq('id', classroomId)
      .single();

    if (classData) setClassroom(classData);

    // Lấy bài tập
    const { data: asms } = await supabase
      .from('assignments')
      .select('*')
      .eq('classroom_id', classroomId)
      .order('created_at', { ascending: false });

    setAssignments(asms || []);

    // Lấy bài nộp
    const { data: subs } = await supabase
      .from('submissions')
      .select('*, profiles(full_name)');

    const loadedSubs = (subs as Submission[]) || [];
    setSubmissions(loadedSubs);

    // Đồng bộ map bài nộp của học sinh hiện tại
    const subRecord: Record<
      string,
      { file_name: string; file_url?: string; submitted_at: string; content?: string }
    > = {};
    loadedSubs.forEach((sub) => {
      if (sub.student_id === user.id) {
        subRecord[sub.assignment_id] = {
          file_name:
            sub.file_name ||
            (sub.content ? (sub.content.length > 30 ? sub.content.substring(0, 30) + '...' : sub.content) : 'Bài làm đã nộp'),
          file_url: sub.file_url,
          submitted_at: sub.submitted_at,
          content: sub.content,
        };
      }
    });
    setStudentSubmissions(subRecord);

    setLoading(false);
  }, [classroomId, router]);

  useEffect(() => {
    let ignore = false;

    async function initialize() {
      if (!ignore) {
        await fetchData();
      }
    }

    void initialize();

    return () => {
      ignore = true;
    };
  }, [fetchData]);

  const isTeacher = classroom?.teacher_id === currentUserId;

  const handleCreateAssignment = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsCreating(true);

    let uploadedFileInfo: { url: string; name: string } | null = null;
    if (attachmentFile) {
      uploadedFileInfo = await uploadFile(attachmentFile, 'assignments');
    }

    const payload: Record<string, unknown> = {
      classroom_id: classroomId,
      title,
      description,
      due_date: dueDate ? new Date(dueDate).toISOString() : null,
    };

    if (uploadedFileInfo) {
      payload.file_url = uploadedFileInfo.url;
      payload.file_name = uploadedFileInfo.name;
    }

    let { error } = await supabase.from('assignments').insert([payload]);

    // Fallback nếu database schema chưa có cột file_url/file_name
    if (
      error &&
      (error.message.includes('column') ||
        error.code === 'PGRST204' ||
        error.message.includes('file_url') ||
        error.message.includes('file_name'))
    ) {
      const fallbackDesc = uploadedFileInfo
        ? `${description}\n\n📎 Tài liệu đính kèm: ${uploadedFileInfo.name} (${uploadedFileInfo.url})`
        : description;

      const fallbackPayload = {
        classroom_id: classroomId,
        title,
        description: fallbackDesc,
        due_date: dueDate ? new Date(dueDate).toISOString() : null,
      };
      const fallbackRes = await supabase.from('assignments').insert([fallbackPayload]);
      error = fallbackRes.error;
    }

    setIsCreating(false);
    if (error) {
      alert(`Lỗi tạo bài tập: ${error.message}`);
    } else {
      setTitle('');
      setDescription('');
      setDueDate('');
      setAttachmentFile(null);
      await fetchData();
    }
  };

  const handleSubmitWork = async (assignmentId: string) => {
    if (!submissionFile && !submissionContent.trim()) {
      alert('Vui lòng chọn file bài làm hoặc nhập câu trả lời!');
      return;
    }
    setIsSubmitting(true);

    let uploadedFileInfo: { url: string; name: string } | null = null;
    if (submissionFile) {
      uploadedFileInfo = await uploadFile(submissionFile, 'submissions');
    }

    const contentText =
      submissionContent.trim() ||
      (uploadedFileInfo ? `Đã nộp bài: ${uploadedFileInfo.name}` : 'Đã nộp bài tập');

    // Kiểm tra và xoá bản ghi cũ nếu học sinh nộp lại
    const existingSub = submissions.find(
      (s) => s.assignment_id === assignmentId && s.student_id === currentUserId
    );
    if (existingSub) {
      await supabase.from('submissions').delete().eq('id', existingSub.id);
    }

    const payload: Record<string, unknown> = {
      assignment_id: assignmentId,
      student_id: currentUserId,
      content: contentText,
    };

    if (uploadedFileInfo) {
      payload.file_url = uploadedFileInfo.url;
      payload.file_name = uploadedFileInfo.name;
    }

    let { error } = await supabase.from('submissions').insert([payload]);

    // Fallback nếu schema submissions chưa có cột file_url/file_name
    if (
      error &&
      (error.message.includes('column') ||
        error.code === 'PGRST204' ||
        error.message.includes('file_url') ||
        error.message.includes('file_name'))
    ) {
      const fallbackContent = uploadedFileInfo
        ? `${contentText} [File: ${uploadedFileInfo.name} - ${uploadedFileInfo.url}]`
        : contentText;

      const fallbackPayload = {
        assignment_id: assignmentId,
        student_id: currentUserId,
        content: fallbackContent,
      };
      const fallbackRes = await supabase.from('submissions').insert([fallbackPayload]);
      error = fallbackRes.error;
    }

    setIsSubmitting(false);
    if (error) {
      alert(`Lỗi nộp bài: ${error.message}`);
    } else {
      const submittedName = uploadedFileInfo?.name || submissionFile?.name || 'Bài làm đã nộp';
      setStudentSubmissions((prev) => ({
        ...prev,
        [assignmentId]: {
          file_name: submittedName,
          file_url: uploadedFileInfo?.url,
          submitted_at: new Date().toISOString(),
          content: contentText,
        },
      }));

      setSubmissionContent('');
      setSubmissionFile(null);
      setActiveSubmittingId(null);
      await fetchData();
      alert('Nộp bài thành công!');
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 text-slate-500 font-medium">
        Đang nạp thông tin lớp học...
      </div>
    );
  }

  if (!classroom) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-slate-50">
        <p className="text-slate-600 mb-4">Không tìm thấy thông tin lớp học.</p>
        <Link href="/dashboard" className="text-sm font-semibold text-indigo-600 hover:underline">
          &larr; Trở về Dashboard
        </Link>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 pb-16">
      {/* Banner */}
      <div className="bg-white border-b border-slate-200">
        <div className="max-w-5xl mx-auto px-6 py-6">
          <Link
            href="/dashboard"
            className="text-xs font-semibold text-slate-500 hover:text-slate-800 transition block mb-3"
          >
            &larr; Quay lại Không gian học tập
          </Link>

          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-2xl font-bold text-slate-900 tracking-tight">{classroom.name}</h1>
                <span className="text-[11px] font-semibold px-2.5 py-0.5 rounded-full bg-slate-100 text-slate-600 border border-slate-200">
                  {isTeacher ? 'Giáo viên sở hữu' : 'Học sinh'}
                </span>
              </div>
              <p className="text-xs text-slate-500 mt-1">{classroom.description || 'Không có mô tả'}</p>
            </div>

            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-slate-500">Mã lớp:</span>
              <span className="font-mono text-xs font-bold px-3 py-1 bg-indigo-50 text-indigo-700 border border-indigo-200/70 rounded-lg">
                {classroom.code}
              </span>
            </div>
          </div>
        </div>
      </div>

      <main className="max-w-5xl mx-auto px-6 mt-8">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          {/* Cột Giáo viên: Giao bài */}
          {isTeacher && (
            <div className="md:col-span-1">
              <div className="bg-white border border-slate-200/80 rounded-2xl p-5 shadow-sm sticky top-6">
                <h2 className="text-sm font-bold text-slate-800 mb-1">Giao bài tập mới</h2>
                <p className="text-xs text-slate-500 mb-4">Gửi nhiệm vụ và tài liệu cho lớp.</p>

                <form onSubmit={handleCreateAssignment} className="space-y-3">
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">Tiêu đề bài</label>
                    <input
                      type="text"
                      required
                      placeholder="VD: Viết đoạn văn ngắn"
                      value={title}
                      onChange={(e) => setTitle(e.target.value)}
                      className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">Hạn nộp</label>
                    <input
                      type="datetime-local"
                      value={dueDate}
                      onChange={(e) => setDueDate(e.target.value)}
                      className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">Yêu cầu chi tiết</label>
                    <textarea
                      rows={3}
                      placeholder="Nhập nội dung yêu cầu học sinh thực hiện..."
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                      className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 resize-none"
                    />
                  </div>

                  {/* Input đính kèm file cho Giáo viên */}
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      Tài liệu đính kèm (Đề bài, slide, tài liệu...)
                    </label>
                    <div className="space-y-1.5">
                      <label className="cursor-pointer flex items-center justify-center gap-2 px-3 py-2 text-xs font-medium text-slate-700 bg-slate-50 hover:bg-slate-100 border border-dashed border-slate-300 rounded-lg transition">
                        <svg className="w-4 h-4 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
                        </svg>
                        <span className="truncate">{attachmentFile ? 'Đổi file khác' : 'Chọn tệp (PDF, Word, Ảnh...)'}</span>
                        <input
                          type="file"
                          className="hidden"
                          onChange={(e) => {
                            if (e.target.files && e.target.files[0]) {
                              setAttachmentFile(e.target.files[0]);
                            }
                          }}
                        />
                      </label>
                      {attachmentFile && (
                        <div className="flex items-center justify-between px-2.5 py-1.5 bg-indigo-50 border border-indigo-100 rounded-lg text-xs text-indigo-700">
                          <span className="truncate max-w-[180px] font-medium">📎 {attachmentFile.name}</span>
                          <button
                            type="button"
                            onClick={() => setAttachmentFile(null)}
                            className="text-indigo-400 hover:text-indigo-700 font-bold ml-1 text-sm"
                            title="Xoá file"
                          >
                            ✕
                          </button>
                        </div>
                      )}
                    </div>
                  </div>

                  <button
                    type="submit"
                    disabled={isCreating}
                    className="w-full py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold rounded-lg shadow-sm transition disabled:opacity-50"
                  >
                    {isCreating ? 'Đang tải file & tạo...' : '+ Đăng bài tập'}
                  </button>
                </form>
              </div>
            </div>
          )}

          {/* Cột Bài tập & Nộp bài */}
          <div className={isTeacher ? 'md:col-span-2' : 'md:col-span-3'}>
            <h2 className="text-base font-bold text-slate-800 mb-4">
              Danh sách bài tập ({assignments.length})
            </h2>

            {assignments.length === 0 ? (
              <div className="bg-white border border-dashed border-slate-200 rounded-2xl p-10 text-center">
                <p className="text-slate-400 text-xs">Lớp học chưa có bài tập nào.</p>
              </div>
            ) : (
              <div className="space-y-4">
                {assignments.map((asm) => {
                  const assignmentSubs = submissions.filter((s) => s.assignment_id === asm.id);
                  const mySub = assignmentSubs.find((s) => s.student_id === currentUserId);
                  const subRecord = studentSubmissions[asm.id];
                  const hasSubmitted = Boolean(mySub || subRecord);
                  const currentSubName = subRecord?.file_name || mySub?.file_name || mySub?.content;
                  const currentSubUrl = subRecord?.file_url || mySub?.file_url;
                  const currentSubDate = subRecord?.submitted_at || mySub?.submitted_at;

                  return (
                    <div
                      key={asm.id}
                      className="bg-white border border-slate-200/80 rounded-2xl p-5 shadow-sm space-y-4"
                    >
                      <div className="flex items-start justify-between gap-4">
                        <div>
                          <h3 className="text-sm font-bold text-slate-900">{asm.title}</h3>
                          <p className="text-xs text-slate-600 mt-1 whitespace-pre-line leading-relaxed">
                            {asm.description || 'Không có mô tả thêm.'}
                          </p>
                        </div>
                        {asm.due_date && (
                          <span className="text-[11px] font-medium text-amber-700 bg-amber-50 px-2.5 py-0.5 rounded-md border border-amber-200/70 shrink-0">
                            Hạn: {new Date(asm.due_date).toLocaleDateString('vi-VN')} {new Date(asm.due_date).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}
                          </span>
                        )}
                      </div>

                      {/* Nút / Badge tải tài liệu đính kèm của giáo viên nếu có */}
                      {(asm.file_url || asm.file_name) && (
                        <div className="pt-1">
                          <a
                            href={asm.file_url || '#'}
                            target={asm.file_url ? '_blank' : undefined}
                            rel="noopener noreferrer"
                            download={asm.file_name || true}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-indigo-700 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200/80 rounded-lg transition"
                          >
                            <svg className="w-3.5 h-3.5 text-indigo-600 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                            </svg>
                            <span>📎 Tải tài liệu đính kèm: <strong>{asm.file_name || 'Tài liệu bài tập'}</strong></span>
                          </a>
                        </div>
                      )}

                      {/* Khu vực Học sinh nộp bài */}
                      {!isTeacher && (
                        <div className="pt-3 border-t border-slate-100">
                          {hasSubmitted ? (
                            <div className="bg-emerald-50/90 border border-emerald-200 rounded-xl p-3.5 text-xs space-y-2">
                              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                                <span className="inline-flex items-center gap-1.5 font-bold text-emerald-800">
                                  <span className="w-2 h-2 rounded-full bg-emerald-500 inline-block"></span>
                                  ✅ Đã nộp: {currentSubName || 'Bài làm đã nộp'}
                                </span>
                                <div className="flex items-center gap-2">
                                  {currentSubDate && (
                                    <span className="text-[11px] text-emerald-600">
                                      {new Date(currentSubDate).toLocaleDateString('vi-VN')} {new Date(currentSubDate).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}
                                    </span>
                                  )}
                                  <button
                                    onClick={() => {
                                      setActiveSubmittingId(asm.id);
                                      setSubmissionContent(mySub?.content || subRecord?.content || '');
                                      setSubmissionFile(null);
                                    }}
                                    className="px-2.5 py-1 bg-white hover:bg-emerald-100/70 text-emerald-700 font-semibold border border-emerald-300 rounded-md transition text-[11px] shadow-2xs"
                                  >
                                    🔄 Nộp lại
                                  </button>
                                </div>
                              </div>

                              {mySub?.content && mySub.content !== currentSubName && (
                                <p className="text-slate-700 bg-white p-2 rounded-lg border border-emerald-100">
                                  {mySub.content}
                                </p>
                              )}

                              {currentSubUrl && (
                                <div className="pt-0.5">
                                  <a
                                    href={currentSubUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    download={currentSubName || true}
                                    className="inline-flex items-center gap-1.5 text-emerald-700 hover:text-emerald-900 font-semibold underline text-[11px]"
                                  >
                                    📎 Tải/Xem file bài nộp đã gửi ({currentSubName})
                                  </a>
                                </div>
                              )}
                            </div>
                          ) : (
                            <button
                              onClick={() => {
                                setActiveSubmittingId(asm.id);
                                setSubmissionContent('');
                                setSubmissionFile(null);
                              }}
                              className="inline-flex items-center gap-2 px-3.5 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold rounded-lg shadow-sm transition"
                            >
                              <span>📤 Nộp bài tập</span>
                            </button>
                          )}
                        </div>
                      )}

                      {/* Khu vực Giáo viên theo dõi bài nộp */}
                      {isTeacher && (
                        <div className="pt-3 border-t border-slate-100">
                          <p className="text-xs font-semibold text-slate-700 mb-2">
                            Danh sách học sinh đã nộp ({assignmentSubs.length})
                          </p>
                          {assignmentSubs.length === 0 ? (
                            <p className="text-xs text-slate-400 italic">Chưa có học sinh nào nộp bài.</p>
                          ) : (
                            <div className="space-y-2">
                              {assignmentSubs.map((sub) => (
                                <div
                                  key={sub.id}
                                  className="bg-slate-50 border border-slate-200/80 rounded-xl p-3 text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-2"
                                >
                                  <div className="space-y-1">
                                    <div className="flex items-center gap-1.5">
                                      <span className="font-bold text-slate-800">
                                        {sub.profiles?.full_name || 'Học sinh'}
                                      </span>
                                      <span className="text-[10px] text-slate-400">
                                        &bull; {new Date(sub.submitted_at).toLocaleDateString('vi-VN')} {new Date(sub.submitted_at).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}
                                      </span>
                                    </div>
                                    {sub.content && (
                                      <p className="text-slate-600 text-[11px] leading-relaxed">{sub.content}</p>
                                    )}
                                    {(sub.file_url || sub.file_name) && (
                                      <div className="pt-0.5">
                                        <a
                                          href={sub.file_url || '#'}
                                          target={sub.file_url ? '_blank' : undefined}
                                          rel="noopener noreferrer"
                                          download={sub.file_name || true}
                                          className="inline-flex items-center gap-1 text-[11px] font-semibold text-indigo-600 hover:text-indigo-800 hover:underline"
                                        >
                                          📎 Tải bài nộp: <strong>{sub.file_name || 'Tệp bài làm'}</strong>
                                        </a>
                                      </div>
                                    )}
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </main>

      {/* Modal nộp bài tập dành cho Học sinh */}
      {activeSubmittingId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-xs">
          <div className="bg-white rounded-2xl shadow-xl max-w-lg w-full p-6 border border-slate-100 space-y-4">
            <div className="flex items-start justify-between border-b border-slate-100 pb-3">
              <div>
                <h3 className="text-sm font-bold text-slate-900">
                  {studentSubmissions[activeSubmittingId] ? 'Nộp lại bài tập' : 'Nộp bài tập'}
                </h3>
                <p className="text-xs text-slate-500 mt-0.5 font-medium">
                  {assignments.find((a) => a.id === activeSubmittingId)?.title}
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setActiveSubmittingId(null);
                  setSubmissionFile(null);
                  setSubmissionContent('');
                }}
                className="text-slate-400 hover:text-slate-600 text-base font-bold p-1 leading-none"
              >
                ✕
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1.5">
                  File bài làm (PDF, Word, Ảnh, ZIP...)
                </label>
                <label className="cursor-pointer border-2 border-dashed border-slate-200 hover:border-indigo-400 bg-slate-50 hover:bg-indigo-50/30 rounded-xl p-4 flex flex-col items-center justify-center text-center transition">
                  <svg className="w-8 h-8 text-indigo-500 mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                  </svg>
                  <span className="text-xs font-semibold text-slate-700">
                    {submissionFile ? 'Đổi file khác' : 'Nhấn để chọn file bài làm từ máy tính'}
                  </span>
                  <span className="text-[11px] text-slate-400 mt-1">Hỗ trợ các định dạng PDF, DOCX, PNG, JPG, ZIP</span>
                  <input
                    type="file"
                    className="hidden"
                    onChange={(e) => {
                      if (e.target.files && e.target.files[0]) {
                        setSubmissionFile(e.target.files[0]);
                      }
                    }}
                  />
                </label>

                {submissionFile && (
                  <div className="mt-2 flex items-center justify-between p-2.5 bg-indigo-50 border border-indigo-100 rounded-lg text-xs text-indigo-700">
                    <div className="flex items-center gap-2 truncate">
                      <span>📄</span>
                      <span className="font-semibold truncate">{submissionFile.name}</span>
                      <span className="text-[10px] text-indigo-500">
                        ({(submissionFile.size / 1024).toFixed(1)} KB)
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => setSubmissionFile(null)}
                      className="text-indigo-400 hover:text-indigo-700 font-bold ml-2 text-sm"
                      title="Gỡ file"
                    >
                      ✕
                    </button>
                  </div>
                )}
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Ghi chú hoặc câu trả lời (tuỳ chọn)
                </label>
                <textarea
                  rows={3}
                  placeholder="Nhập ghi chú thêm cho thầy cô hoặc dán link tài liệu bổ sung..."
                  value={submissionContent}
                  onChange={(e) => setSubmissionContent(e.target.value)}
                  className="w-full p-2.5 text-xs border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 resize-none"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
              <button
                type="button"
                onClick={() => {
                  setActiveSubmittingId(null);
                  setSubmissionFile(null);
                  setSubmissionContent('');
                }}
                disabled={isSubmitting}
                className="px-4 py-2 text-xs font-medium text-slate-600 hover:text-slate-800 rounded-lg transition disabled:opacity-50"
              >
                Huỷ bỏ
              </button>
              <button
                type="button"
                onClick={() => handleSubmitWork(activeSubmittingId)}
                disabled={isSubmitting}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold rounded-lg shadow-sm transition disabled:opacity-50 flex items-center gap-1.5"
              >
                {isSubmitting ? (
                  <>
                    <svg className="animate-spin h-3.5 w-3.5 text-white" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"></path>
                    </svg>
                    <span>Đang tải file & nộp bài...</span>
                  </>
                ) : (
                  <span>Xác nhận nộp bài</span>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}