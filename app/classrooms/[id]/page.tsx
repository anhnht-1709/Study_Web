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

const formatForDateTimeLocal = (dateStr?: string | null): string => {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return '';
  const pad = (n: number) => n.toString().padStart(2, '0');
  const year = d.getFullYear();
  const month = pad(d.getMonth() + 1);
  const day = pad(d.getDate());
  const hours = pad(d.getHours());
  const minutes = pad(d.getMinutes());
  return `${year}-${month}-${day}T${hours}:${minutes}`;
};

// Helper trích xuất tài liệu đính kèm (ưu tiên column -> regex description -> direct URL)
const getAssignmentFile = (asm: Assignment): { url: string; name: string } | null => {
  // 1. Ưu tiên file_url và file_name trên bản ghi
  if (asm.file_url && !asm.file_url.startsWith('blob:')) {
    return {
      url: asm.file_url,
      name: asm.file_name || 'Tài liệu đính kèm',
    };
  }

  // 2. Quét trong description
  if (asm.description) {
    // Regex chuẩn: /(?:📎 Tài liệu đính kèm: |\[ATTACHMENT_FILE: )?([^(\n]+?)\s*\(((?:https?:\/\/|blob:)[^\s)]+)\)/
    const match = asm.description.match(
      /(?:📎 Tài liệu đính kèm:\s*|\[ATTACHMENT_FILE:\s*)?([^(\n]+?)\s*\(((?:https?:\/\/|blob:)[^\s)]+)\)/
    );
    if (match && match[2] && !match[2].startsWith('blob:')) {
      const rawName = match[1]?.trim();
      const cleanName = rawName ? rawName.replace(/^📎\s*(?:Tài liệu đính kèm:\s*)?/, '').trim() : '';
      return {
        url: match[2].trim(),
        name: cleanName || 'Tài liệu đính kèm',
      };
    }

    // Dự phòng dạng [File: fileName - url]
    const fileTagMatch = asm.description.match(/\[File:\s*(.*?)\s*-\s*((?:https?:\/\/)[^\s\]]+)\]/);
    if (fileTagMatch && fileTagMatch[2]) {
      return {
        url: fileTagMatch[2].trim(),
        name: fileTagMatch[1]?.trim() || 'Tài liệu đính kèm',
      };
    }

    // Dự phòng tìm URL trực tiếp trong description (loại trừ blob:)
    const urlMatch = asm.description.match(/(https?:\/\/[^\s)<>]+)/);
    if (urlMatch && !urlMatch[1].startsWith('blob:')) {
      return {
        url: urlMatch[1].trim(),
        name: 'Tài liệu đính kèm',
      };
    }
  }

  return null;
};

// Làm sạch mô tả bài tập để chỉ hiển thị nội dung đẹp mắt cho người dùng
const cleanAsmDescription = (desc?: string): string => {
  if (!desc) return '';
  return desc
    .replace(/(?:📎 Tài liệu đính kèm:.*$|\[ATTACHMENT_FILE:.*?\]|\[File:.*?\])/gm, '')
    .replace(/\s*\(((?:https?:\/\/|blob:)[^\s)]+)\)/g, '')
    .replace(/(?:^|\n)\s*https?:\/\/[^\s)]+\s*(?:\n|$)/g, '\n')
    .trim();
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
  const [isDeletingAsmId, setIsDeletingAsmId] = useState<string | null>(null);
  const [editingDueDateAsmId, setEditingDueDateAsmId] = useState<string | null>(null);
  const [tempDueDate, setTempDueDate] = useState<string>('');
  const [isUpdatingDueDate, setIsUpdatingDueDate] = useState(false);
  const [loading, setLoading] = useState(true);

  // Form tạo bài (Giáo viên)
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isCreating, setIsCreating] = useState(false);

  // Form nộp bài (Học sinh)
  const [activeSubmittingId, setActiveSubmittingId] = useState<string | null>(null);
  const [selectedSubmissionFile, setSelectedSubmissionFile] = useState<File | null>(null);
  const [submissionContent, setSubmissionContent] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Hàm upload file trực tiếp lên Supabase Storage bucket 'classroom-files'
  const uploadFileToSupabase = async (
    file: File,
    folder: string
  ): Promise<{ publicUrl: string; fileName: string }> => {
    const cleanFileName = file.name.replace(/[^a-zA-Z0-9.-]/g, '_');
    const filePath = `${folder}/${Date.now()}_${cleanFileName}`;

    const { error: uploadError } = await supabase.storage
      .from('classroom-files')
      .upload(filePath, file, { cacheControl: '3600', upsert: true });

    if (uploadError) {
      console.error('Supabase storage upload error:', uploadError.message);
      throw new Error(`Tải tệp lên thất bại: ${uploadError.message}`);
    }

    const { data } = supabase.storage.from('classroom-files').getPublicUrl(filePath);
    return {
      publicUrl: data.publicUrl,
      fileName: file.name,
    };
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
          const cleanSubContent = sub.content ? sub.content.replace(/\[File:.*?\]/g, '').trim() : '';
          const validFileUrl =
            sub.file_url && !sub.file_url.startsWith('blob:')
              ? sub.file_url
              : (!sub.content?.includes('blob:') ? sub.content?.match(/\[File:.*?-\s*(https?:\/\/[^\s\]]+)\]/)?.[1] : undefined);
          const embeddedFileName = sub.content?.match(/\[File:\s*(.*?)\s*-\s*https?:\/\/[^\s\]]+\]/)?.[1];
          subRecord[sub.assignment_id] = {
            id: sub.id,
            file_name:
              sub.file_name ||
              embeddedFileName ||
              (cleanSubContent ? (cleanSubContent.length > 30 ? cleanSubContent.substring(0, 30) + '...' : cleanSubContent) : 'Bài làm đã nộp'),
            file_url: validFileUrl,
            submitted_at: sub.created_at || sub.submitted_at || new Date().toISOString(),
            content: cleanSubContent,
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

    try {
      let fileUrl = '';
      let fileName = '';

      if (selectedFile) {
        const uploadResult = await uploadFileToSupabase(selectedFile, 'assignments');
        fileUrl = uploadResult.publicUrl;
        fileName = uploadResult.fileName;
      }

      const basePayload: Record<string, unknown> = {
        classroom_id: classroomId,
        title,
        description,
        due_date: dueDate ? new Date(dueDate).toISOString() : null,
      };

      let error: { message: string; code?: string } | null = null;

      if (!fileUrl) {
        const res = await supabase.from('assignments').insert([basePayload]);
        error = res.error;
      } else {
        // Tầng 1: Insert payload đầy đủ { file_url, file_name }
        const tier1Payload: Record<string, unknown> = {
          ...basePayload,
          file_url: fileUrl,
          file_name: fileName,
        };
        const res1 = await supabase.from('assignments').insert([tier1Payload]);
        error = res1.error;

        // Tầng 2: Nếu lỗi thiếu cột file_name, insert { file_url }
        if (
          error &&
          !error.message?.includes('file_url') &&
          (error.code === 'PGRST204' ||
            error.message?.toLowerCase().includes('column') ||
            error.message?.includes('file_name'))
        ) {
          console.warn('Assignments schema thiếu cột file_name, thử Tầng 2 chỉ lưu file_url');
          const tier2Payload: Record<string, unknown> = {
            ...basePayload,
            file_url: fileUrl,
          };
          const res2 = await supabase.from('assignments').insert([tier2Payload]);
          error = res2.error;
        }

        // Tầng 3: Nếu lỗi thiếu cột file_url, lưu link file và tên file vào description
        // dạng: description + '\n📎 Tài liệu đính kèm: ' + fileName + ' (' + fileUrl + ')'
        // và insert payload KHÔNG CÓ file_url/file_name. Đảm bảo 100% không bị chặn khi đăng bài!
        if (
          error &&
          (error.code === 'PGRST204' ||
            error.message?.toLowerCase().includes('column') ||
            error.message?.includes('file_url') ||
            error.message?.includes('file_name'))
        ) {
          console.warn('Assignments schema thiếu cột file_url/file_name, chuyển sang Tầng 3 lưu vào description');
          const attachmentText = '\n📎 Tài liệu đính kèm: ' + fileName + ' (' + fileUrl + ')';
          const tier3Description = description
            ? description + attachmentText
            : '📎 Tài liệu đính kèm: ' + fileName + ' (' + fileUrl + ')';
          const tier3Payload: Record<string, unknown> = {
            ...basePayload,
            description: tier3Description,
          };
          const res3 = await supabase.from('assignments').insert([tier3Payload]);
          error = res3.error;
        }
      }

      if (error) {
        alert(`Lỗi tạo bài tập: ${error.message}`);
      } else {
        setTitle('');
        setDescription('');
        setDueDate('');
        setSelectedFile(null);
        await fetchData();
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Có lỗi xảy ra khi tạo bài tập';
      alert(msg);
    } finally {
      setIsCreating(false);
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

    if (!selectedSubmissionFile && !submissionContent.trim()) {
      alert('Vui lòng chọn file bài làm hoặc nhập câu trả lời!');
      return;
    }
    setIsSubmitting(true);

    try {
      let fileUrl = '';
      let fileName = '';

      if (selectedSubmissionFile) {
        const uploadResult = await uploadFileToSupabase(selectedSubmissionFile, 'submissions');
        fileUrl = uploadResult.publicUrl;
        fileName = uploadResult.fileName;
      }

      const contentText = submissionContent.trim();

      const basePayload: Record<string, unknown> = {
        assignment_id: assignmentId,
        student_id: currentUserId,
        content: contentText,
      };

      // Xóa sạch bản ghi cũ (đề phòng còn sót) trước khi insert bài mới
      await supabase
        .from('submissions')
        .delete()
        .eq('assignment_id', assignmentId)
        .eq('student_id', currentUserId);

      let error: { message: string; code?: string } | null = null;
      let insertedData: { id: string }[] | null = null;

      if (!fileUrl) {
        const res = await supabase.from('submissions').insert([basePayload]).select();
        error = res.error;
        insertedData = res.data;
      } else {
        // Tầng 1: Insert payload đầy đủ { file_url, file_name }
        const tier1Payload: Record<string, unknown> = {
          ...basePayload,
          file_url: fileUrl,
          file_name: fileName,
        };
        const res1 = await supabase.from('submissions').insert([tier1Payload]).select();
        error = res1.error;
        insertedData = res1.data;

        // Tầng 2: Nếu lỗi thiếu cột file_name, insert { file_url }
        if (
          error &&
          !error.message?.includes('file_url') &&
          (error.code === 'PGRST204' ||
            error.message?.toLowerCase().includes('column') ||
            error.message?.includes('file_name'))
        ) {
          console.warn('Submissions schema thiếu cột file_name, thử Tầng 2 chỉ lưu file_url');
          const tier2Payload: Record<string, unknown> = {
            ...basePayload,
            file_url: fileUrl,
          };
          const res2 = await supabase.from('submissions').insert([tier2Payload]).select();
          error = res2.error;
          insertedData = res2.data;
        }

        // Tầng 3: Nếu bảng submissions chưa có cột file_url/file_name thì lưu vào content dạng:
        // contentText + ' [File: ' + fileName + ' - ' + fileUrl + ']'
        // và insert payload KHÔNG CÓ file_url/file_name
        if (
          error &&
          (error.code === 'PGRST204' ||
            error.message?.toLowerCase().includes('column') ||
            error.message?.includes('file_url') ||
            error.message?.includes('file_name'))
        ) {
          console.warn('Submissions schema thiếu cột file_url/file_name, chuyển sang Tầng 3 lưu vào content');
          const fileSuffix = ' [File: ' + fileName + ' - ' + fileUrl + ']';
          const tier3Content = contentText ? contentText + fileSuffix : '[File: ' + fileName + ' - ' + fileUrl + ']';
          const tier3Payload: Record<string, unknown> = {
            ...basePayload,
            content: tier3Content,
          };
          const res3 = await supabase.from('submissions').insert([tier3Payload]).select();
          error = res3.error;
          insertedData = res3.data;
        }
      }

      if (error) {
        alert(`Lỗi nộp bài: ${error.message}`);
      } else {
        const newSubmissionId = (insertedData && insertedData[0]?.id) || '';
        const submittedName = fileName || selectedSubmissionFile?.name || 'Bài làm đã nộp';
        setStudentSubmissions((prev) => ({
          ...prev,
          [assignmentId]: {
            id: newSubmissionId,
            file_name: submittedName,
            file_url: fileUrl || undefined,
            submitted_at: new Date().toISOString(),
            content: contentText,
          },
        }));

        setSubmissionContent('');
        setSelectedSubmissionFile(null);
        setActiveSubmittingId(null);
        await fetchData();
        alert('Nộp bài thành công!');
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Có lỗi xảy ra khi nộp bài';
      alert(msg);
    } finally {
      setIsSubmitting(false);
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
        setSelectedSubmissionFile(null);
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

  const removeStorageFile = async (filePath?: string) => {
    if (!filePath) return;
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
  };

  const handleDeleteAssignment = async (assignmentId: string) => {
    const confirmed = window.confirm(
      'Bạn có chắc chắn muốn xóa bài tập này không? Mọi bài nộp của học sinh cho bài này cũng sẽ bị xóa.'
    );
    if (!confirmed) return;

    setIsDeletingAsmId(assignmentId);

    try {
      // 1. Xóa file đính kèm trên Storage (nếu có)
      const targetAsm = assignments.find((a) => a.id === assignmentId);
      const asmFile = targetAsm ? getAssignmentFile(targetAsm) : null;
      await removeStorageFile(asmFile?.url || targetAsm?.file_url);

      // Xóa file đính kèm của các bài nộp thuộc bài tập này (nếu có)
      const relatedSubs = submissions.filter((s) => s.assignment_id === assignmentId);
      for (const sub of relatedSubs) {
        const subFileUrl =
          sub.file_url ||
          sub.content?.match(/\[File:.*?-\s*(https?:\/\/[^\s\]]+)\]/)?.[1];
        await removeStorageFile(subFileUrl);
      }

      // 2. Xóa các bản nộp thuộc bài tập trong bảng submissions
      const { error: subDeleteError } = await supabase
        .from('submissions')
        .delete()
        .eq('assignment_id', assignmentId);

      if (subDeleteError) {
        console.warn('Lỗi khi xóa submissions:', subDeleteError.message);
      }

      // 3. Xóa bài tập trong bảng assignments
      const { error: asmDeleteError } = await supabase
        .from('assignments')
        .delete()
        .eq('id', assignmentId);

      if (asmDeleteError) {
        alert(`Lỗi khi xóa bài tập: ${asmDeleteError.message}`);
        return;
      }

      // 4. Cập nhật state nội bộ
      setAssignments((prev) => prev.filter((a) => a.id !== assignmentId));
      setSubmissions((prev) => prev.filter((s) => s.assignment_id !== assignmentId));
      setStudentSubmissions((prev) => {
        const next = { ...prev };
        delete next[assignmentId];
        return next;
      });

      if (activeSubmittingId === assignmentId) {
        setActiveSubmittingId(null);
      }
      if (editingDueDateAsmId === assignmentId) {
        setEditingDueDateAsmId(null);
        setTempDueDate('');
      }

      // 5. Đồng bộ lại toàn bộ trang
      await fetchData();
      alert('Đã xóa bài tập thành công!');
    } catch (err) {
      console.error('Lỗi khi xóa bài tập:', err);
      alert('Có lỗi xảy ra khi xóa bài tập. Vui lòng thử lại!');
    } finally {
      setIsDeletingAsmId(null);
    }
  };

  const handleUpdateDueDate = async (assignmentId: string) => {
    setIsUpdatingDueDate(true);
    try {
      const newDueDateIso = tempDueDate ? new Date(tempDueDate).toISOString() : null;

      const { error } = await supabase
        .from('assignments')
        .update({ due_date: newDueDateIso })
        .eq('id', assignmentId);

      if (error) {
        alert(`Lỗi khi cập nhật hạn nộp: ${error.message}`);
        return;
      }

      setAssignments((prev) =>
        prev.map((a) => (a.id === assignmentId ? { ...a, due_date: newDueDateIso } : a))
      );

      setEditingDueDateAsmId(null);
      setTempDueDate('');

      await fetchData();
      alert('Đã cập nhật hạn nộp thành công!');
    } catch (err) {
      console.error('Lỗi khi cập nhật hạn nộp:', err);
      alert('Có lỗi xảy ra khi cập nhật hạn nộp. Vui lòng thử lại!');
    } finally {
      setIsUpdatingDueDate(false);
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
                        <span className="truncate">{selectedFile ? 'Đổi file khác' : 'Chọn tệp (PDF, Word, Ảnh...)'}</span>
                        <input
                          type="file"
                          className="hidden"
                          onChange={(e) => {
                            if (e.target.files && e.target.files[0]) {
                              setSelectedFile(e.target.files[0]);
                            }
                          }}
                        />
                      </label>
                      {selectedFile && (
                        <div className="flex items-center justify-between px-2.5 py-1.5 bg-indigo-50 border border-indigo-100 rounded-lg text-xs text-indigo-700">
                          <span className="truncate max-w-[180px] font-medium">📎 {selectedFile.name}</span>
                          <button
                            type="button"
                            onClick={() => setSelectedFile(null)}
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
                  const cleanMySubContent = mySub?.content ? mySub.content.replace(/\[File:.*?\]/g, '').trim() : '';
                  const mySubEmbeddedFileName = mySub?.content?.match(/\[File:\s*(.*?)\s*-\s*https?:\/\/[^\s\]]+\]/)?.[1];
                  const currentSubName = subRecord?.file_name || mySub?.file_name || mySubEmbeddedFileName || cleanMySubContent || 'Bài làm đã nộp';
                  const currentSubUrl =
                    (subRecord?.file_url && !subRecord.file_url.startsWith('blob:') ? subRecord.file_url : undefined) ||
                    (mySub?.file_url && !mySub.file_url.startsWith('blob:') ? mySub.file_url : undefined) ||
                    (!mySub?.content?.includes('blob:') ? mySub?.content?.match(/\[File:.*?-\s*(https?:\/\/[^\s\]]+)\]/)?.[1] : undefined);
                  const currentSubDate = subRecord?.submitted_at || mySub?.created_at || mySub?.submitted_at;
                  const displayAsmDescription = cleanAsmDescription(asm.description);

                  return (
                    <div
                      key={asm.id}
                      className="bg-white border border-slate-200/80 rounded-2xl p-5 shadow-sm space-y-4"
                    >
                      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
                        <div className="flex-1 min-w-0">
                          <h3 className="text-sm font-bold text-slate-900">{asm.title}</h3>
                          <p className="text-xs text-slate-600 mt-1 whitespace-pre-line leading-relaxed">
                            {displayAsmDescription || 'Không có mô tả thêm.'}
                          </p>
                          {(() => {
                            const fileInfo = getAssignmentFile(asm);
                            if (!fileInfo) return null;
                            return (
                              <a
                                href={fileInfo.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1.5 text-xs font-semibold text-indigo-600 hover:text-indigo-800 bg-indigo-50 px-2.5 py-1 rounded-md mt-2 w-fit"
                              >
                                📎 Xem / Tải tài liệu đính kèm ({fileInfo.name})
                              </a>
                            );
                          })()}
                        </div>

                        <div className="flex flex-col items-start sm:items-end gap-2.5 shrink-0">
                          {isTeacher && (
                            <button
                              type="button"
                              onClick={() => handleDeleteAssignment(asm.id)}
                              disabled={isDeletingAsmId === asm.id}
                              className="inline-flex items-center gap-1.5 text-rose-600 hover:bg-rose-50 border border-rose-200 rounded-lg px-2.5 py-1 text-xs font-semibold transition cursor-pointer disabled:opacity-50"
                              title="Xóa bài tập này"
                            >
                              {isDeletingAsmId === asm.id ? (
                                <>
                                  <svg className="animate-spin h-3.5 w-3.5 text-rose-600" fill="none" viewBox="0 0 24 24">
                                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"></path>
                                  </svg>
                                  <span>Đang xóa...</span>
                                </>
                              ) : (
                                <>
                                  <svg className="w-3.5 h-3.5 text-rose-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                  </svg>
                                  <span>Xóa</span>
                                </>
                              )}
                            </button>
                          )}

                          {isTeacher ? (
                            editingDueDateAsmId === asm.id ? (
                              <div className="flex flex-wrap items-center gap-1.5 bg-slate-50 p-2 rounded-xl border border-slate-200">
                                <input
                                  type="datetime-local"
                                  value={tempDueDate}
                                  onChange={(e) => setTempDueDate(e.target.value)}
                                  className="text-xs px-2 py-1 bg-white border border-slate-300 rounded-md focus:outline-hidden focus:ring-1 focus:ring-indigo-500 text-slate-800"
                                />
                                <button
                                  type="button"
                                  onClick={() => handleUpdateDueDate(asm.id)}
                                  disabled={isUpdatingDueDate}
                                  className="px-2.5 py-1 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold rounded-md transition cursor-pointer disabled:opacity-50"
                                >
                                  {isUpdatingDueDate ? 'Lưu...' : 'Lưu'}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setEditingDueDateAsmId(null);
                                    setTempDueDate('');
                                  }}
                                  disabled={isUpdatingDueDate}
                                  className="px-2 py-1 bg-white hover:bg-slate-100 text-slate-600 text-xs font-medium border border-slate-200 rounded-md transition cursor-pointer"
                                >
                                  Hủy
                                </button>
                              </div>
                            ) : (
                              <div className="flex flex-wrap items-center gap-1.5">
                                {asm.due_date ? (
                                  <span className="text-[11px] font-medium text-amber-700 bg-amber-50 px-2.5 py-0.5 rounded-md border border-amber-200/70 shrink-0">
                                    Hạn: {new Date(asm.due_date).toLocaleDateString('vi-VN')} {new Date(asm.due_date).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}
                                  </span>
                                ) : (
                                  <span className="text-[11px] font-medium text-slate-500 bg-slate-100 px-2.5 py-0.5 rounded-md border border-slate-200 shrink-0">
                                    Chưa có hạn nộp
                                  </span>
                                )}
                                <button
                                  type="button"
                                  onClick={() => {
                                    setEditingDueDateAsmId(asm.id);
                                    setTempDueDate(formatForDateTimeLocal(asm.due_date));
                                  }}
                                  className="text-[11px] font-semibold text-indigo-600 hover:text-indigo-800 hover:bg-indigo-50 border border-indigo-200 px-2 py-0.5 rounded-md transition cursor-pointer"
                                  title="Đổi hạn nộp"
                                >
                                  chỉnh sửa
                                </button>
                              </div>
                            )
                          ) : (
                            asm.due_date && (
                              <span className="text-[11px] font-medium text-amber-700 bg-amber-50 px-2.5 py-0.5 rounded-md border border-amber-200/70 shrink-0">
                                Hạn: {new Date(asm.due_date).toLocaleDateString('vi-VN')} {new Date(asm.due_date).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}
                              </span>
                            )
                          )}
                        </div>
                      </div>

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
                              {cleanMySubContent && cleanMySubContent !== currentSubName && (
                                <div className="text-slate-700 bg-white/90 p-2.5 rounded-lg border border-emerald-100/80">
                                  <span className="text-[11px] font-medium text-slate-500 block mb-0.5">Ghi chú bài nộp:</span>
                                  <p className="text-xs text-slate-800 leading-relaxed whitespace-pre-wrap">{cleanMySubContent}</p>
                                </div>
                              )}

                              {/* Nút xem/tải bài nộp */}
                              {currentSubUrl ? (
                                <div className="pt-0.5">
                                  <a
                                    href={currentSubUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold rounded-lg text-xs shadow-2xs transition"
                                  >
                                    <svg className="w-3.5 h-3.5 text-white shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                                    </svg>
                                    <span>📎 Xem / Tải bài nộp ({currentSubName || 'Tệp đính kèm'})</span>
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
                                setSelectedSubmissionFile(null);
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
                              {deduplicatedSubs.map((sub) => {
                                const cleanContent = sub.content?.replace(/\[File:.*?\]/g, '').trim();
                                const subFileUrl =
                                  (sub.file_url && !sub.file_url.startsWith('blob:') ? sub.file_url : undefined) ||
                                  (!sub.content?.includes('blob:') ? sub.content?.match(/\[File:.*?-\s*(https?:\/\/[^\s\]]+)\]/)?.[1] : undefined);
                                const subFileName =
                                  sub.file_name ||
                                  sub.content?.match(/\[File:\s*(.*?)\s*-\s*https?:\/\/[^\s\]]+\]/)?.[1];
                                return (
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
                                      {cleanContent && (
                                        <p className="text-slate-600 text-[11px] leading-relaxed whitespace-pre-line">{cleanContent}</p>
                                      )}
                                      {subFileUrl && (
                                        <div className="pt-1">
                                          <a
                                            href={subFileUrl}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold text-indigo-600 hover:text-indigo-800 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200/70 rounded-md transition w-fit"
                                          >
                                            📎 Xem / Tải bài nộp {subFileName ? `(${subFileName})` : ''}
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
                                            subFileUrl
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
                                );
                              })}
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
                  setSelectedSubmissionFile(null);
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
                    {selectedSubmissionFile ? 'Đổi file khác' : 'Nhấn để chọn file bài làm từ máy tính'}
                  </span>
                  <span className="text-[11px] text-slate-400 mt-1">Hỗ trợ các định dạng PDF, DOCX, PNG, JPG, ZIP</span>
                  <input
                    type="file"
                    className="hidden"
                    onChange={(e) => {
                      if (e.target.files && e.target.files[0]) {
                        setSelectedSubmissionFile(e.target.files[0]);
                      }
                    }}
                  />
                </label>

                {selectedSubmissionFile && (
                  <div className="mt-2 flex items-center justify-between p-2.5 bg-indigo-50 border border-indigo-100 rounded-lg text-xs text-indigo-700">
                    <div className="flex items-center gap-2 truncate">
                      <span>📄</span>
                      <span className="font-semibold truncate">{selectedSubmissionFile.name}</span>
                      <span className="text-[10px] text-indigo-500">
                        ({(selectedSubmissionFile.size / 1024).toFixed(1)} KB)
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => setSelectedSubmissionFile(null)}
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
                  setSelectedSubmissionFile(null);
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