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
  submitted_at?: string;
  created_at?: string;
  file_url?: string;
  file_name?: string;
  profiles?: { full_name: string };
}

const formatSubmissionDate = (createdAt?: string, submittedAt?: string) => {
  const getValidDate = (str?: string) => {
    if (!str) return null;
    const d = new Date(str);
    const time = d.getTime();
    if (isNaN(time) || time < 946684800000) return null; // trước năm 2000 coi như không hợp lệ (1970 epoch)
    return d;
  };

  const validD = getValidDate(createdAt) || getValidDate(submittedAt);
  if (!validD) return 'Vừa xong';
  return `${validD.toLocaleDateString('vi-VN')} ${validD.toLocaleTimeString('vi-VN', {
    hour: '2-digit',
    minute: '2-digit',
  })}`;
};

export default function ClassroomDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = use(params);
  const classroomId = resolvedParams.id;
  const router = useRouter();

  const [currentUserId, setCurrentUserId] = useState<string>('');
  const [classroom, setClassroom] = useState<Classroom | null>(null);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [studentSubmissions, setStudentSubmissions] = useState<
    Record<
      string,
      { id?: string; file_name: string; file_url?: string; submitted_at: string; content?: string }
    >
  >({});
  const [isDeletingSubId, setIsDeletingSubId] = useState<string | null>(null);
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

    // Đồng bộ map bài nộp của học sinh hiện tại (ưu tiên bản ghi mới nhất)
    const subRecord: Record<
      string,
      { id?: string; file_name: string; file_url?: string; submitted_at: string; content?: string }
    > = {};
    loadedSubs.forEach((sub) => {
      if (sub.student_id === user.id) {
        const existing = subRecord[sub.assignment_id];
        const subTime = new Date(sub.created_at || sub.submitted_at || 0).getTime();
        const existingTime = existing ? new Date(existing.submitted_at || 0).getTime() : -1;
        if (!existing || subTime >= existingTime) {
          subRecord[sub.assignment_id] = {
            id: sub.id,
            file_name:
              sub.file_name ||
              (sub.content ? (sub.content.length > 30 ? sub.content.substring(0, 30) + '...' : sub.content) : 'Bài làm đã nộp'),
            file_url: sub.file_url,
            submitted_at: sub.created_at || sub.submitted_at || new Date().toISOString(),
            content: sub.content,
          };
        }
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
    // Quy định: Mỗi học sinh CHỈ ĐƯỢC nộp bài 1 lần cho mỗi bài tập
    const existingSub = submissions.find(
      (s) => s.assignment_id === assignmentId && s.student_id === currentUserId
    );
    if (existingSub || studentSubmissions[assignmentId]) {
      alert('Mỗi học sinh chỉ được nộp bài 1 lần cho mỗi bài tập. Vui lòng xóa bài nộp cũ nếu muốn nộp lại!');
      return;
    }

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

    const payload: Record<string, unknown> = {
      assignment_id: assignmentId,
      student_id: currentUserId,
      content: contentText,
    };

    if (uploadedFileInfo) {
      payload.file_url = uploadedFileInfo.url;
      payload.file_name = uploadedFileInfo.name;
    }

    // Xóa sạch bản ghi cũ (đề phòng còn sót) trước khi insert bài mới
    await supabase
      .from('submissions')
      .delete()
      .eq('assignment_id', assignmentId)
      .eq('student_id', currentUserId);

    const insertRes = await supabase.from('submissions').insert([payload]).select();
    let error = insertRes.error;
    const insertedData = insertRes.data;

    // Fallback nếu schema submissions chưa có cột file_url/file_name
    let fallbackId = '';
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
      const fallbackRes = await supabase.from('submissions').insert([fallbackPayload]).select();
      error = fallbackRes.error;
      fallbackId = fallbackRes.data?.[0]?.id || '';
    }

    setIsSubmitting(false);
    if (error) {
      alert(`Lỗi nộp bài: ${error.message}`);
    } else {
      const newSubmissionId = (insertedData && insertedData[0]?.id) || fallbackId || '';
      const submittedName = uploadedFileInfo?.name || submissionFile?.name || 'Bài làm đã nộp';
      setStudentSubmissions((prev) => ({
        ...prev,
        [assignmentId]: {
          id: newSubmissionId,
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

  const handleDeleteSubmission = async (
    submissionId: string,
    assignmentId: string,
    filePath?: string
  ) => {
    const confirmed = window.confirm(
      'Bạn có chắc chắn muốn xóa bài nộp này để nộp lại không? Dữ liệu bài làm cũ sẽ bị xóa hoàn toàn.'
    );
    if (!confirmed) return;

    setIsDeletingSubId(assignmentId);

    try {
      // 1. Xóa file trên Storage nếu có
      if (filePath) {
        let storagePath = filePath;
        if (storagePath.includes('/classroom-files/')) {
          storagePath = storagePath.split('/classroom-files/')[1];
        }
        storagePath = storagePath.split('?')[0];
        if (
          storagePath &&
          !storagePath.startsWith('blob:') &&
          !storagePath.startsWith('http://') &&
          !storagePath.startsWith('https://')
        ) {
          try {
            await supabase.storage.from('classroom-files').remove([storagePath]);
          } catch (storageErr) {
            console.warn('Lỗi khi xóa file trên Storage:', storageErr);
          }
        }
      }

      // 2. Xóa triệt để TẤT CẢ các bản nộp của học sinh cho bài tập đó trên Supabase
      const { error } = await supabase
        .from('submissions')
        .delete()
        .eq('assignment_id', assignmentId)
        .eq('student_id', currentUserId);

      if (error) {
        alert(`Lỗi khi xóa bài nộp: ${error.message}`);
        setIsDeletingSubId(null);
        return;
      }

      // 3. Cập nhật state nội bộ để bài tập chuyển về trạng thái Chưa nộp
      setStudentSubmissions((prev) => {
        const next = { ...prev };
        delete next[assignmentId];
        return next;
      });

      setSubmissions((prev) =>
        prev.filter((s) => !(s.assignment_id === assignmentId && s.student_id === currentUserId))
      );

      // Đóng modal nộp bài nếu đang mở cho bài này
      if (activeSubmittingId === assignmentId) {
        setActiveSubmittingId(null);
        setSubmissionFile(null);
        setSubmissionContent('');
      }

      // 4. Đồng bộ lại dữ liệu toàn bộ trang
      await fetchData();

      alert('Đã xóa bài nộp thành công! Bạn có thể nộp bài tập mới ngay bây giờ.');
    } catch (err) {
      console.error('Lỗi khi xóa bài nộp:', err);
      alert('Có lỗi xảy ra khi xóa bài nộp. Vui lòng thử lại!');
    } finally {
      setIsDeletingSubId(null);
    }
  };

  const handleTeacherDeleteSubmission = async (
    submissionId: string,
    assignmentId: string,
    studentId: string,
    studentName: string,
    filePath?: string
  ) => {
    const confirmed = window.confirm(
      `Bạn có chắc chắn muốn xóa bài nộp của "${studentName}" không? Dữ liệu bài làm sẽ bị xóa hoàn toàn.`
    );
    if (!confirmed) return;

    setIsDeletingSubId(submissionId);

    try {
      // 1. Xóa file trên Storage nếu có
      if (filePath) {
        let storagePath = filePath;
        if (storagePath.includes('/classroom-files/')) {
          storagePath = storagePath.split('/classroom-files/')[1];
        }
        storagePath = storagePath.split('?')[0];
        if (
          storagePath &&
          !storagePath.startsWith('blob:') &&
          !storagePath.startsWith('http://') &&
          !storagePath.startsWith('https://')
        ) {
          try {
            await supabase.storage.from('classroom-files').remove([storagePath]);
          } catch (storageErr) {
            console.warn('Lỗi khi xóa file trên Storage:', storageErr);
          }
        }
      }

      // 2. Xóa triệt để bản nộp của học sinh này trên bài tập
      const { error } = await supabase
        .from('submissions')
        .delete()
        .eq('assignment_id', assignmentId)
        .eq('student_id', studentId);

      if (error) {
        alert(`Lỗi khi xóa bài nộp: ${error.message}`);
        return;
      }

      // 3. Đồng bộ lại dữ liệu toàn bộ trang
      await fetchData();
      alert('Đã xóa bài nộp thành công!');
    } catch (err) {
      console.error('Lỗi khi xóa bài nộp của học sinh:', err);
      alert('Có lỗi xảy ra khi xóa bài nộp. Vui lòng thử lại!');
    } finally {
      setIsDeletingSubId(null);
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

                  // Lọc deduplicate: Mỗi học sinh CHỈ HIỂN THỊ 1 BÀI NỘP DUY NHẤT (bản nộp mới nhất theo created_at hoặc submitted_at)
                  const uniqueSubsMap = new Map<string, Submission>();
                  assignmentSubs.forEach((sub) => {
                    const existing = uniqueSubsMap.get(sub.student_id);
                    if (!existing) {
                      uniqueSubsMap.set(sub.student_id, sub);
                    } else {
                      const existingTime = new Date(existing.created_at || existing.submitted_at || 0).getTime();
                      const newTime = new Date(sub.created_at || sub.submitted_at || 0).getTime();
                      if (newTime > existingTime) {
                        uniqueSubsMap.set(sub.student_id, sub);
                      }
                    }
                  });
                  const deduplicatedSubs = Array.from(uniqueSubsMap.values()).sort((a, b) => {
                    const timeA = new Date(a.created_at || a.submitted_at || 0).getTime();
                    const timeB = new Date(b.created_at || b.submitted_at || 0).getTime();
                    return timeB - timeA;
                  });

                  const mySub = assignmentSubs.find((s) => s.student_id === currentUserId);
                  const subRecord = studentSubmissions[asm.id];
                  const hasSubmitted = Boolean(mySub || subRecord);
                  const currentSubId = mySub?.id || subRecord?.id || '';
                  const currentSubName = subRecord?.file_name || mySub?.file_name || mySub?.content;
                  const currentSubUrl =
                    subRecord?.file_url ||
                    mySub?.file_url ||
                    (mySub?.content?.match(/\[File:.*?-\s*(https?:\/\/[^\s\]]+)\]/)?.[1] ?? undefined);
                  const currentSubDate = subRecord?.submitted_at || mySub?.created_at || mySub?.submitted_at;

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
                            <div className="bg-emerald-50/90 border border-emerald-200/90 rounded-xl p-4 text-xs space-y-3">
                              {/* Header trạng thái & Nút Xóa bài nộp để nộp lại */}
                              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 pb-2.5 border-b border-emerald-100">
                                <div className="flex items-center gap-2">
                                  <span className="flex h-2.5 w-2.5 relative">
                                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                                    <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-600"></span>
                                  </span>
                                  <span className="font-bold text-emerald-900 text-xs">
                                    Đã nộp bài (Mỗi học sinh chỉ nộp 1 lần)
                                  </span>
                                </div>
                                <button
                                  type="button"
                                  onClick={() =>
                                    handleDeleteSubmission(
                                      currentSubId,
                                      asm.id,
                                      currentSubUrl
                                    )
                                  }
                                  disabled={isDeletingSubId === asm.id}
                                  className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white hover:bg-rose-50 text-rose-600 hover:text-rose-700 font-semibold border border-rose-200 hover:border-rose-300 rounded-lg transition text-xs shadow-2xs cursor-pointer disabled:opacity-50"
                                  title="Xóa bài nộp cũ để được nộp lại"
                                >
                                  {isDeletingSubId === asm.id ? (
                                    <>
                                      <svg className="animate-spin h-3.5 w-3.5 text-rose-600" fill="none" viewBox="0 0 24 24">
                                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"></path>
                                      </svg>
                                      <span>Đang xóa bài...</span>
                                    </>
                                  ) : (
                                    <>
                                      <svg className="w-3.5 h-3.5 text-rose-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                      </svg>
                                      <span>🗑️ Xóa bài nộp để nộp lại</span>
                                    </>
                                  )}
                                </button>
                              </div>

                              {/* Thông tin chi tiết bài nộp */}
                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-slate-700 bg-white/90 p-3 rounded-lg border border-emerald-100/80">
                                <div>
                                  <span className="text-[11px] font-medium text-slate-500 block mb-0.5">Tên file đã nộp:</span>
                                  <span className="font-semibold text-slate-800 text-xs break-all flex items-center gap-1.5">
                                    <span>📄</span>
                                    <span>{currentSubName || 'Bài làm đã nộp'}</span>
                                  </span>
                                </div>
                                <div>
                                  <span className="text-[11px] font-medium text-slate-500 block mb-0.5">Thời gian nộp:</span>
                                  <span className="text-xs font-semibold text-slate-700 flex items-center gap-1.5">
                                    <span>🕒</span>
                                    <span>
                                      {formatSubmissionDate(mySub?.created_at, currentSubDate)}
                                    </span>
                                  </span>
                                </div>
                              </div>

                              {/* Ghi chú thêm nếu có */}
                              {mySub?.content && mySub.content !== currentSubName && (
                                <div className="text-slate-700 bg-white/90 p-2.5 rounded-lg border border-emerald-100/80">
                                  <span className="text-[11px] font-medium text-slate-500 block mb-0.5">Ghi chú bài nộp:</span>
                                  <p className="text-xs text-slate-800 leading-relaxed whitespace-pre-wrap">{mySub.content}</p>
                                </div>
                              )}

                              {/* Nút xem/tải file đã nộp */}
                              {currentSubUrl ? (
                                <div className="pt-0.5">
                                  <a
                                    href={currentSubUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    download={currentSubName || true}
                                    className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold rounded-lg text-xs shadow-2xs transition"
                                  >
                                    <svg className="w-3.5 h-3.5 text-white shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                                    </svg>
                                    <span>Xem / Tải file đã nộp ({currentSubName || 'Tệp đính kèm'})</span>
                                  </a>
                                </div>
                              ) : (
                                <div className="text-[11px] text-slate-500 italic">
                                  (Bài nộp không có file đính kèm)
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
                            Danh sách học sinh đã nộp ({deduplicatedSubs.length})
                          </p>
                          {deduplicatedSubs.length === 0 ? (
                            <p className="text-xs text-slate-400 italic">Chưa có học sinh nào nộp bài.</p>
                          ) : (
                            <div className="space-y-2">
                              {deduplicatedSubs.map((sub) => (
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
                                        &bull; {formatSubmissionDate(sub.created_at, sub.submitted_at)}
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

                                  {/* Nút xóa bài nộp trực tiếp dành cho Giáo viên */}
                                  <div className="flex items-center gap-2 shrink-0 self-end sm:self-center">
                                    <button
                                      type="button"
                                      onClick={() =>
                                        handleTeacherDeleteSubmission(
                                          sub.id,
                                          asm.id,
                                          sub.student_id,
                                          sub.profiles?.full_name || 'Học sinh',
                                          sub.file_url
                                        )
                                      }
                                      disabled={isDeletingSubId === sub.id}
                                      className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-semibold text-rose-600 hover:text-rose-700 bg-white hover:bg-rose-50 border border-rose-200 hover:border-rose-300 rounded-lg transition disabled:opacity-50 cursor-pointer shadow-2xs"
                                      title="Xóa bài nộp của học sinh này"
                                    >
                                      {isDeletingSubId === sub.id ? (
                                        <span>Đang xóa...</span>
                                      ) : (
                                        <>
                                          <svg className="w-3.5 h-3.5 text-rose-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                          </svg>
                                          <span>Xóa bài nộp</span>
                                        </>
                                      )}
                                    </button>
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
                  Nộp bài tập
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