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

interface ClassroomMember {
  id: string;
  student_id: string;
  joined_at?: string;
  profiles?: { full_name: string };
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

interface Quiz {
  id: string;
  classroom_id: string;
  title: string;
  description?: string | null;
  duration_minutes?: number | null;
  time_limit?: number | null;
  questions?: unknown[] | null;
  questions_count?: number | null;
  created_at?: string;
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
  grade?: number | null;
  feedback?: string | null;
  graded_at?: string | null;
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
    // Regex chuẩn: /(?:(?:\u{1F4CE}\s*)?Tài liệu đính kèm: |\[ATTACHMENT_FILE: )?([^(\n]+?)\s*\(((?:https?:\/\/|blob:)[^\s)]+)\)/u
    const match = asm.description.match(
      /(?:(?:\u{1F4CE}\s*)?Tài liệu đính kèm:\s*|\[ATTACHMENT_FILE:\s*)?([^(\n]+?)\s*\(((?:https?:\/\/|blob:)[^\s)]+)\)/u
    );
    if (match && match[2] && !match[2].startsWith('blob:')) {
      const rawName = match[1]?.trim();
      const cleanName = rawName ? rawName.replace(/^(?:\u{1F4CE}\s*)?(?:Tài liệu đính kèm:\s*)?/u, '').trim() : '';
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
    .replace(/(?:(?:\u{1F4CE}\s*)?Tài liệu đính kèm:.*$|\[ATTACHMENT_FILE:.*?\]|\[File:.*?\])/gmu, '')
    .replace(/\s*\(((?:https?:\/\/|blob:)[^\s)]+)\)/g, '')
    .replace(/(?:^|\n)\s*https?:\/\/[^\s)]+\s*(?:\n|$)/g, '\n')
    .trim();
};

interface GradingInfo {
  grade: number | null;
  feedback: string | null;
  graded_at?: string | null;
}

// Helper trích xuất điểm và lời phê thông minh (fallback an toàn khi DB chưa có cột)
const getSubmissionGrading = (sub?: {
  grade?: number | null;
  feedback?: string | null;
  graded_at?: string | null;
  content?: string;
}): GradingInfo => {
  if (!sub) return { grade: null, feedback: null, graded_at: null };

  // 1. Nếu sub.grade !== undefined && sub.grade !== null thì lấy sub.grade và sub.feedback
  if (sub.grade !== undefined && sub.grade !== null) {
    const numericGrade = typeof sub.grade === 'number' ? sub.grade : parseFloat(String(sub.grade));
    return {
      grade: isNaN(numericGrade) ? null : numericGrade,
      feedback: sub.feedback || null,
      graded_at: sub.graded_at || null,
    };
  }

  // 2. Quét trong sub.content xem có chuỗi regex dạng [GRADE_FEEDBACK: (\d+(?:\.\d+)?) | (.*?)] để trích xuất fallback
  if (sub.content) {
    const match = sub.content.match(/\[GRADE_FEEDBACK:\s*([\d.]+)\s*\|\s*([\s\S]*?)\]/);
    if (match) {
      const g = parseFloat(match[1]);
      return {
        grade: isNaN(g) ? null : g,
        feedback: match[2]?.trim() || null,
        graded_at: null,
      };
    }
  }

  return { grade: null, feedback: null, graded_at: null };
};

// Làm sạch nội dung bài nộp (loại trừ [File: ...] và [GRADE_FEEDBACK: ...])
const cleanSubmissionContent = (content?: string): string => {
  if (!content) return '';
  return content
    .replace(/\[File:.*?\]/g, '')
    .replace(/\[GRADE_FEEDBACK:[\s\S]*?\]/g, '')
    .trim();
};

export default function ClassroomDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = use(params);
  const classroomId = resolvedParams.id;
  const router = useRouter();

  const [currentUserId, setCurrentUserId] = useState<string>('');
  const [classroom, setClassroom] = useState<Classroom | null>(null);
  const [activeTab, setActiveTab] = useState<'assignments' | 'members' | 'grades'>('assignments');
  const [members, setMembers] = useState<ClassroomMember[]>([]);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [quizzes, setQuizzes] = useState<Quiz[]>([]);
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [students, setStudents] = useState<{ id: string; full_name: string }[]>([]);
  const [copiedCode, setCopiedCode] = useState(false);
  const [isDeletingMemberId, setIsDeletingMemberId] = useState<string | null>(null);
  const [viewingAsmSubmissionsId, setViewingAsmSubmissionsId] = useState<string | null>(null);
  const [selectedStudentIdForGrading, setSelectedStudentIdForGrading] = useState<string | null>(null);
  const [studentSubmissions, setStudentSubmissions] = useState<
    Record<
      string,
      {
        id?: string;
        file_name: string;
        file_url?: string;
        submitted_at: string;
        content?: string;
        grade?: number | null;
        feedback?: string | null;
        graded_at?: string | null;
      }
    >
  >({});
  const [gradingInputs, setGradingInputs] = useState<
    Record<string, { grade: string; feedback: string }>
  >({});
  const [isGradingSubId, setIsGradingSubId] = useState<string | null>(null);
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

    // Lấy danh sách đề kiểm tra trắc nghiệm
    try {
      const { data: quizData, error: quizError } = await supabase
        .from('quizzes')
        .select('*')
        .eq('classroom_id', classroomId)
        .order('created_at', { ascending: false });

      if (quizError) {
        console.warn('Lỗi khi lấy danh sách quizzes:', quizError.message);
        const { data: fallbackQuiz } = await supabase
          .from('quizzes')
          .select('*')
          .eq('classroom_id', classroomId);
        setQuizzes((fallbackQuiz as Quiz[]) || []);
      } else {
        setQuizzes((quizData as Quiz[]) || []);
      }
    } catch (qErr) {
      console.warn('Exception khi lấy quizzes:', qErr);
      setQuizzes([]);
    }

    // Lấy bài nộp
    const { data: subs } = await supabase
      .from('submissions')
      .select('*, profiles(full_name)');

    const loadedSubs = (subs as Submission[]) || [];
    setSubmissions(loadedSubs);

    // Đồng bộ map bài nộp của học sinh hiện tại (ưu tiên bản ghi mới nhất)
    const subRecord: Record<
      string,
      {
        id?: string;
        file_name: string;
        file_url?: string;
        submitted_at: string;
        content?: string;
        grade?: number | null;
        feedback?: string | null;
        graded_at?: string | null;
      }
    > = {};
    loadedSubs.forEach((sub) => {
      if (sub.student_id === user.id) {
        const existing = subRecord[sub.assignment_id];
        const subTime = new Date(sub.created_at || sub.submitted_at || 0).getTime();
        const existingTime = existing ? new Date(existing.submitted_at || 0).getTime() : -1;
        if (!existing || subTime >= existingTime) {
          const cleanSubContent = cleanSubmissionContent(sub.content);
          const validFileUrl =
            sub.file_url && !sub.file_url.startsWith('blob:')
              ? sub.file_url
              : (!sub.content?.includes('blob:') ? sub.content?.match(/\[File:.*?-\s*(https?:\/\/[^\s\]]+)\]/)?.[1] : undefined);
          const embeddedFileName = sub.content?.match(/\[File:\s*(.*?)\s*-\s*https?:\/\/[^\s\]]+\]/)?.[1];
          const grading = getSubmissionGrading(sub);
          subRecord[sub.assignment_id] = {
            id: sub.id,
            file_name:
              sub.file_name ||
              embeddedFileName ||
              (cleanSubContent ? (cleanSubContent.length > 30 ? cleanSubContent.substring(0, 30) + '...' : cleanSubContent) : 'Bài làm đã nộp'),
            file_url: validFileUrl,
            submitted_at: sub.created_at || sub.submitted_at || new Date().toISOString(),
            content: cleanSubContent,
            grade: grading.grade,
            feedback: grading.feedback,
            graded_at: grading.graded_at,
          };
        }
      }
    });
    setStudentSubmissions(subRecord);

    // 3. Lấy danh sách thành viên lớp học từ bảng classroom_members kết nối profiles
    let memberData: ClassroomMember[] = [];
    const studentMap = new Map<string, string>();

    try {
      let rawMembers: unknown[] | null = null;
      const { data: initialMembers, error: membersError } = await supabase
        .from('classroom_members')
        .select('id, student_id, joined_at, profiles(id, full_name)')
        .eq('classroom_id', classroomId);
      rawMembers = initialMembers;

      if (membersError) {
        console.warn('Lỗi query classroom_members joined profiles:', membersError.message);
        const fallbackRes = await supabase
          .from('classroom_members')
          .select('id, student_id, profiles(id, full_name)')
          .eq('classroom_id', classroomId);
        rawMembers = fallbackRes.data;
      }

      if (rawMembers) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        memberData = rawMembers.map((m: any) => {
          let name = '';
          if (m.profiles) {
            if (Array.isArray(m.profiles) && m.profiles[0]) {
              name = m.profiles[0].full_name || '';
            } else if (typeof m.profiles === 'object') {
              name = m.profiles.full_name || '';
            }
          }
          return {
            id: m.id || m.student_id,
            student_id: m.student_id,
            joined_at: m.joined_at,
            profiles: name ? { full_name: name } : undefined,
          };
        });

        // Bỏ teacher nếu có trong classroom_members
        memberData = memberData.filter((m) => m.student_id !== classData?.teacher_id);

        memberData.forEach((m) => {
          if (m.student_id) {
            studentMap.set(m.student_id, m.profiles?.full_name || '');
          }
        });
      }
    } catch (mErr) {
      console.warn('Exception khi lấy classroom_members:', mErr);
    }

    // Đồng thời gộp thêm các student_id từ bảng submissions (đảm bảo không sót học sinh nào đã từng nộp bài)
    loadedSubs.forEach((sub) => {
      if (sub.student_id && sub.student_id !== classData?.teacher_id) {
        const existingName = studentMap.get(sub.student_id);
        const subName = sub.profiles?.full_name;
        if (!studentMap.has(sub.student_id) || (!existingName && subName)) {
          studentMap.set(sub.student_id, subName || existingName || '');
        }
      }
    });

    // Nếu còn học sinh chưa có tên, truy vấn bổ sung từ profiles
    const missingProfileIds = Array.from(studentMap.entries())
      .filter(([, name]) => !name || name.trim() === '')
      .map(([id]) => id);

    if (missingProfileIds.length > 0) {
      try {
        const { data: missingProfiles } = await supabase
          .from('profiles')
          .select('id, full_name')
          .in('id', missingProfileIds);

        if (missingProfiles) {
          missingProfiles.forEach((p: { id: string; full_name?: string }) => {
            if (p.full_name) {
              studentMap.set(p.id, p.full_name);
            }
          });
          memberData = memberData.map((m) => {
            const found = missingProfiles.find((p: { id: string }) => p.id === m.student_id);
            if (found && found.full_name && !m.profiles?.full_name) {
              return { ...m, profiles: { full_name: found.full_name } };
            }
            return m;
          });
        }
      } catch (profErr) {
        console.warn('Lỗi khi tải profiles bổ sung:', profErr);
      }
    }

    // Sắp xếp danh sách thành viên theo thứ tự bảng chữ cái ABC tiếng Việt
    memberData.sort((a, b) => {
      const nameA = a.profiles?.full_name || '';
      const nameB = b.profiles?.full_name || '';
      return nameA.localeCompare(nameB, 'vi', { sensitivity: 'base' });
    });
    setMembers(memberData);

    // Sắp xếp danh sách học sinh theo thứ tự bảng chữ cái ABC tiếng Việt
    const studentList: { id: string; full_name: string }[] = Array.from(studentMap.entries()).map(
      ([id, full_name], idx) => ({
        id,
        full_name: full_name?.trim() || `Học sinh ${idx + 1}`,
      })
    );

    studentList.sort((a, b) => a.full_name.localeCompare(b.full_name, 'vi', { sensitivity: 'base' }));
    setStudents(studentList);

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

  const handleRemoveMember = async (memberRecordId: string, memberName: string) => {
    if (!confirm(`Bạn có chắc chắn muốn xóa học sinh "${memberName}" khỏi lớp?`)) return;
    setIsDeletingMemberId(memberRecordId);
    try {
      const { error } = await supabase.from('classroom_members').delete().eq('id', memberRecordId);
      if (error) {
        alert(`Lỗi khi xóa: ${error.message}`);
      } else {
        alert('Đã xóa thành viên khỏi lớp.');
        await fetchData();
      }
    } catch (err: unknown) {
      alert(`Đã xảy ra lỗi: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setIsDeletingMemberId(null);
    }
  };

  const handleCopyCode = (code: string) => {
    navigator.clipboard.writeText(code);
    setCopiedCode(true);
    setTimeout(() => setCopiedCode(false), 2000);
  };

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
        // dạng: description + '\nTài liệu đính kèm: ' + fileName + ' (' + fileUrl + ')'
        // và insert payload KHÔNG CÓ file_url/file_name. Đảm bảo 100% không bị chặn khi đăng bài!
        if (
          error &&
          (error.code === 'PGRST204' ||
            error.message?.toLowerCase().includes('column') ||
            error.message?.includes('file_url') ||
            error.message?.includes('file_name'))
        ) {
          console.warn('Assignments schema thiếu cột file_url/file_name, chuyển sang Tầng 3 lưu vào description');
          const attachmentText = '\nTài liệu đính kèm: ' + fileName + ' (' + fileUrl + ')';
          const tier3Description = description
            ? description + attachmentText
            : 'Tài liệu đính kèm: ' + fileName + ' (' + fileUrl + ')';
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
            grade: null,
            feedback: null,
            graded_at: null,
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
    // Kiểm tra nếu bài nộp đã được chấm điểm thì không cho phép xóa
    const targetSub = submissions.find(
      (s) => s.assignment_id === assignmentId && s.student_id === currentUserId
    );
    const grading = targetSub
      ? getSubmissionGrading(targetSub)
      : studentSubmissions[assignmentId]?.grade !== undefined &&
        studentSubmissions[assignmentId]?.grade !== null
        ? { grade: studentSubmissions[assignmentId].grade, feedback: null }
        : null;

    if (grading && grading.grade !== null) {
      alert('Bài làm của bạn đã được giáo viên chấm điểm, không thể xóa để nộp lại!');
      return;
    }

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

  const handleGradeSubmission = async (
    submissionId: string,
    gradeInput: string,
    feedbackInput: string
  ) => {
    if (!gradeInput || !gradeInput.trim()) {
      alert('Vui lòng nhập điểm số từ 0 đến 10!');
      return;
    }

    const numericGrade = parseFloat(gradeInput);
    if (isNaN(numericGrade) || numericGrade < 0 || numericGrade > 10) {
      alert('Điểm số không hợp lệ! Vui lòng nhập điểm từ 0 đến 10 (thang điểm 10).');
      return;
    }

    setIsGradingSubId(submissionId);

    try {
      const cleanFeedback = feedbackInput.trim();
      const nowIso = new Date().toISOString();

      // Tầng 1: Cố gắng cập nhật bảng submissions: { grade: numericGrade, feedback: cleanFeedback, graded_at: nowIso }
      let { error } = await supabase
        .from('submissions')
        .update({
          grade: numericGrade,
          feedback: cleanFeedback,
          graded_at: nowIso,
        })
        .eq('id', submissionId);

      // Tầng 2: Nếu lỗi cột graded_at, update { grade: numericGrade, feedback: cleanFeedback }
      if (
        error &&
        (error.code === 'PGRST204' ||
          error.message?.toLowerCase().includes('column') ||
          error.message?.includes('graded_at'))
      ) {
        console.warn('Submissions schema thiếu cột graded_at, thử Tầng 2 cập nhật { grade, feedback }');
        const res2 = await supabase
          .from('submissions')
          .update({
            grade: numericGrade,
            feedback: cleanFeedback,
          })
          .eq('id', submissionId);
        error = res2.error;
      }

      // Tầng 3: Nếu lỗi thiếu cột grade/feedback, cập nhật vào trường content (thêm [GRADE_FEEDBACK: ...])
      if (
        error &&
        (error.code === 'PGRST204' ||
          error.message?.toLowerCase().includes('column') ||
          error.message?.includes('grade') ||
          error.message?.includes('feedback'))
      ) {
        console.warn('Submissions schema thiếu cột grade/feedback, chuyển sang Tầng 3 lưu vào content');
        const targetSub = submissions.find((s) => s.id === submissionId);
        const rawContent = targetSub?.content || '';
        // Gỡ bỏ tag GRADE_FEEDBACK cũ nếu có
        const strippedContent = rawContent.replace(/\[GRADE_FEEDBACK:[\s\S]*?\]/g, '').trim();
        const feedbackTag = `[GRADE_FEEDBACK: ${numericGrade} | ${cleanFeedback}]`;
        const updatedContent = strippedContent ? `${strippedContent}\n${feedbackTag}` : feedbackTag;

        const res3 = await supabase
          .from('submissions')
          .update({
            content: updatedContent,
          })
          .eq('id', submissionId);
        error = res3.error;
      }

      if (error) {
        alert(`Lỗi khi lưu điểm: ${error.message}`);
      } else {
        await fetchData();
        alert('Đã lưu điểm và lời phê thành công!');
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Có lỗi xảy ra khi chấm điểm';
      console.error('Lỗi khi chấm điểm bài nộp:', err);
      alert(msg);
    } finally {
      setIsGradingSubId(null);
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
      if (viewingAsmSubmissionsId === assignmentId) {
        setViewingAsmSubmissionsId(null);
        setSelectedStudentIdForGrading(null);
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

      {/* Thanh điều hướng 3 Tab */}
      <div className="bg-white border-b border-slate-200">
        <div className="max-w-5xl mx-auto px-6">
          <div className="flex items-center gap-1 sm:gap-4 -mb-px">
            {/* Tab 1: Bài tập */}
            <button
              type="button"
              onClick={() => setActiveTab('assignments')}
              className={`inline-flex items-center gap-2 py-3 px-3 sm:px-4 border-b-2 text-xs font-semibold transition cursor-pointer ${
                activeTab === 'assignments'
                  ? 'border-indigo-600 text-indigo-600'
                  : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300'
              }`}
            >
              <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
              </svg>
              <span>Bài tập ({assignments.length})</span>
            </button>

            {/* Tab 2: Thành viên */}
            <button
              type="button"
              onClick={() => setActiveTab('members')}
              className={`inline-flex items-center gap-2 py-3 px-3 sm:px-4 border-b-2 text-xs font-semibold transition cursor-pointer ${
                activeTab === 'members'
                  ? 'border-indigo-600 text-indigo-600'
                  : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300'
              }`}
            >
              <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
              </svg>
              <span>Thành viên ({members.length})</span>
            </button>

            {/* Tab 3: Bảng điểm tổng hợp (chỉ Giáo viên thấy) */}
            {isTeacher && (
              <button
                type="button"
                onClick={() => setActiveTab('grades')}
                className={`inline-flex items-center gap-2 py-3 px-3 sm:px-4 border-b-2 text-xs font-semibold transition cursor-pointer ${
                  activeTab === 'grades'
                    ? 'border-indigo-600 text-indigo-600'
                    : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300'
                }`}
              >
                <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                </svg>
                <span>Bảng điểm tổng hợp</span>
              </button>
            )}
          </div>
        </div>
      </div>

      <main className="max-w-5xl mx-auto px-6 mt-8">
        {activeTab === 'assignments' && (
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
                          <div className="flex items-center gap-1.5 truncate max-w-[180px]">
                            <svg className="w-3.5 h-3.5 text-indigo-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
                            </svg>
                            <span className="truncate font-medium">{selectedFile.name}</span>
                          </div>
                          <button
                            type="button"
                            onClick={() => setSelectedFile(null)}
                            className="text-indigo-400 hover:text-indigo-700 font-bold ml-1 text-sm cursor-pointer p-0.5 rounded hover:bg-indigo-100/50"
                            title="Xoá file"
                          >
                            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                            </svg>
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

                <div className="mt-4 pt-4 border-t border-slate-100">
                  <Link
                    href={`/classrooms/${classroomId}/create-quiz`}
                    className="w-full flex items-center justify-center gap-2 py-2 px-3 bg-violet-50 hover:bg-violet-100 text-violet-700 border border-violet-200 text-xs font-semibold rounded-lg shadow-2xs transition"
                  >
                    <svg className="w-4 h-4 text-violet-600 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                    </svg>
                    <span>+ Tạo đề trắc nghiệm tính giờ</span>
                  </Link>
                </div>
              </div>
            </div>
          )}

          {/* Cột Bài tập & Nộp bài */}
          <div className={isTeacher ? 'md:col-span-2' : 'md:col-span-3'}>
            {/* Khu vực Bài kiểm tra trắc nghiệm */}
            <div className="mb-8">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-lg bg-indigo-50 border border-indigo-100 flex items-center justify-center text-indigo-600">
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
                    </svg>
                  </div>
                  <div>
                    <h2 className="text-base font-bold text-slate-800">
                      Bài kiểm tra trắc nghiệm ({quizzes.length})
                    </h2>
                    <p className="text-xs text-slate-500">Đề thi tính giờ và tự động chấm điểm</p>
                  </div>
                </div>
                {isTeacher && (
                  <Link
                    href={`/classrooms/${classroomId}/create-quiz`}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 text-xs font-semibold rounded-lg transition"
                  >
                    <svg className="w-3.5 h-3.5 text-indigo-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                    </svg>
                    <span>+ Tạo đề trắc nghiệm tính giờ</span>
                  </Link>
                )}
              </div>

              {quizzes.length === 0 ? (
                <div className="bg-white border border-dashed border-slate-200 rounded-2xl p-6 text-center">
                  <p className="text-slate-400 text-xs">Lớp học chưa có đề kiểm tra trắc nghiệm nào.</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-3">
                  {quizzes.map((quiz) => {
                    const questionCount = Array.isArray(quiz.questions)
                      ? quiz.questions.length
                      : (typeof quiz.questions_count === 'number' ? quiz.questions_count : 0);
                    const duration = quiz.duration_minutes || quiz.time_limit || 0;

                    return (
                      <div
                        key={quiz.id}
                        className="bg-white border border-slate-200/80 rounded-2xl p-5 shadow-sm hover:border-indigo-200 transition flex flex-col sm:flex-row sm:items-center justify-between gap-4"
                      >
                        <div className="space-y-1.5 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider bg-violet-100 text-violet-700 rounded-md">
                              Trắc nghiệm
                            </span>
                            <h3 className="text-sm font-bold text-slate-900 truncate">
                              {quiz.title}
                            </h3>
                          </div>
                          {quiz.description && (
                            <p className="text-xs text-slate-600 line-clamp-1">
                              {quiz.description}
                            </p>
                          )}
                          <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500">
                            <span className="inline-flex items-center gap-1">
                              <svg className="w-3.5 h-3.5 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                              </svg>
                              <span>Thời lượng: <strong className="text-slate-700 font-semibold">{duration > 0 ? `${duration} phút` : 'Tự do'}</strong></span>
                            </span>
                            <span className="text-slate-300">•</span>
                            <span className="inline-flex items-center gap-1">
                              <svg className="w-3.5 h-3.5 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                              </svg>
                              <span>Số câu: <strong className="text-slate-700 font-semibold">{questionCount > 0 ? `${questionCount} câu` : 'Đang cập nhật'}</strong></span>
                            </span>
                          </div>
                        </div>

                        <div className="shrink-0 flex items-center gap-2">
                          {!isTeacher ? (
                            <Link
                              href={`/classrooms/${classroomId}/quiz/${quiz.id}`}
                              className="inline-flex items-center justify-center gap-1.5 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold rounded-lg shadow-sm transition"
                            >
                              <svg className="w-3.5 h-3.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                              </svg>
                              <span>Làm bài kiểm tra</span>
                            </Link>
                          ) : (
                            <div className="text-xs text-slate-500 font-medium px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-lg">
                              Đã phát hành ({duration > 0 ? `${duration} phút` : 'Tự do'})
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

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
                  const cleanMySubContent = cleanSubmissionContent(mySub?.content || subRecord?.content);
                  const mySubEmbeddedFileName = mySub?.content?.match(/\[File:\s*(.*?)\s*-\s*https?:\/\/[^\s\]]+\]/)?.[1];
                  const currentSubName = subRecord?.file_name || mySub?.file_name || mySubEmbeddedFileName || cleanMySubContent || 'Bài làm đã nộp';
                  const currentSubUrl =
                    (subRecord?.file_url && !subRecord.file_url.startsWith('blob:') ? subRecord.file_url : undefined) ||
                    (mySub?.file_url && !mySub.file_url.startsWith('blob:') ? mySub.file_url : undefined) ||
                    (!mySub?.content?.includes('blob:') ? mySub?.content?.match(/\[File:.*?-\s*(https?:\/\/[^\s\]]+)\]/)?.[1] : undefined);
                  const currentSubDate = subRecord?.submitted_at || mySub?.created_at || mySub?.submitted_at;
                  const displayAsmDescription = cleanAsmDescription(asm.description);

                  // Trích xuất điểm số và lời phê của học sinh
                  const myGrading = mySub
                    ? getSubmissionGrading(mySub)
                    : {
                      grade: subRecord?.grade ?? null,
                      feedback: subRecord?.feedback ?? null,
                      graded_at: subRecord?.graded_at ?? null,
                    };
                  const isMySubGraded = myGrading.grade !== null && myGrading.grade !== undefined;

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
                                className="inline-flex items-center gap-1.5 text-xs font-semibold text-indigo-600 hover:text-indigo-800 bg-indigo-50 hover:bg-indigo-100 px-2.5 py-1 rounded-md mt-2 w-fit transition"
                              >
                                <svg className="w-3.5 h-3.5 text-indigo-600 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
                                </svg>
                                <span>Xem / Tải tài liệu đính kèm ({fileInfo.name})</span>
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

                                {isMySubGraded ? (
                                  <span
                                    className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 text-slate-500 font-semibold border border-slate-200 rounded-lg text-xs cursor-not-allowed select-none"
                                    title="Bài đã được chấm điểm, không thể xóa để nộp lại"
                                  >
                                    <svg className="w-3.5 h-3.5 text-slate-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                                    </svg>
                                    <span>Đã chấm điểm (Không thể xóa)</span>
                                  </span>
                                ) : (
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
                                        <span>Xóa bài nộp để nộp lại</span>
                                      </>
                                    )}
                                  </button>
                                )}
                              </div>

                              {/* Khung Trạng thái Điểm số & Lời phê cho Học sinh */}
                              {isMySubGraded ? (
                                <div className="bg-gradient-to-r from-amber-50 to-orange-50 border-2 border-amber-300/80 rounded-xl p-3.5 space-y-2.5 shadow-2xs">
                                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-2 border-b border-amber-200/60">
                                    <div className="flex items-center gap-3">
                                      <div className="w-9 h-9 rounded-lg bg-amber-100 border border-amber-300/80 flex items-center justify-center text-amber-700 shrink-0">
                                        <svg className="w-5 h-5 text-amber-700" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4M7.835 4.697a3.42 3.42 0 001.946-.806 3.42 3.42 0 014.438 0 3.42 3.42 0 001.946.806 3.42 3.42 0 013.138 3.138 3.42 3.42 0 00.806 1.946 3.42 3.42 0 010 4.438 3.42 3.42 0 00-.806 1.946 3.42 3.42 0 01-3.138 3.138 3.42 3.42 0 00-1.946.806 3.42 3.42 0 01-4.438 0 3.42 3.42 0 00-1.946-.806 3.42 3.42 0 01-3.138-3.138 3.42 3.42 0 00-.806-1.946 3.42 3.42 0 010-4.438 3.42 3.42 0 00.806-1.946 3.42 3.42 0 013.138-3.138z" />
                                        </svg>
                                      </div>
                                      <div>
                                        <span className="text-xs font-semibold text-amber-900 block">
                                          Kết quả đánh giá của Giáo viên
                                        </span>
                                        <div className="flex items-baseline gap-1 mt-0.5">
                                          <span className="text-xs font-medium text-amber-700">Điểm số:</span>
                                          <span className="text-lg font-black text-amber-900 tracking-tight">
                                            {myGrading.grade}
                                          </span>
                                          <span className="text-xs font-bold text-amber-700">/ 10</span>
                                        </div>
                                      </div>
                                    </div>
                                    <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-amber-100 text-amber-900 font-bold text-xs rounded-full border border-amber-300 w-fit">
                                      <span className="w-1.5 h-1.5 rounded-full bg-amber-600"></span>
                                      <span>Đã có điểm chính thức</span>
                                    </span>
                                  </div>

                                  {myGrading.feedback ? (
                                    <div className="bg-white/95 rounded-lg p-3 border border-amber-200/80 space-y-1">
                                      <span className="text-xs font-bold text-amber-950 flex items-center gap-1.5">
                                        <svg className="w-3.5 h-3.5 text-amber-700 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                                        </svg>
                                        <span>Lời phê của Giáo viên:</span>
                                      </span>
                                      <p className="text-xs text-slate-800 leading-relaxed whitespace-pre-wrap pl-5 border-l-2 border-amber-400 italic">
                                        {myGrading.feedback}
                                      </p>
                                    </div>
                                  ) : (
                                    <p className="text-[11px] text-amber-800/80 italic">
                                      (Giáo viên chưa để lại lời phê bằng văn bản)
                                    </p>
                                  )}
                                </div>
                              ) : (
                                <div className="flex items-center gap-3 px-3.5 py-2.5 bg-amber-50/80 border border-amber-200/70 rounded-xl text-amber-800 text-xs">
                                  <div className="w-7 h-7 rounded-lg bg-amber-100 border border-amber-200 flex items-center justify-center text-amber-700 shrink-0">
                                    <svg className="w-4 h-4 text-amber-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                                    </svg>
                                  </div>
                                  <div className="flex-1">
                                    <span className="font-semibold text-amber-900">Trạng thái: </span>
                                    <span className="text-amber-800 font-medium">Chờ giáo viên chấm điểm</span>
                                    <p className="text-[11px] text-amber-700/80 mt-0.5">
                                      Bài làm của bạn đã được gửi thành công đến giáo viên và đang đợi chấm điểm.
                                    </p>
                                  </div>
                                </div>
                              )}

                              {/* Thông tin chi tiết bài nộp */}
                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-slate-700 bg-white/90 p-3 rounded-lg border border-emerald-100/80">
                                <div>
                                  <span className="text-[11px] font-medium text-slate-500 block mb-0.5">Tên file đã nộp:</span>
                                  <span className="font-semibold text-slate-800 text-xs break-all flex items-center gap-1.5">
                                    <svg className="w-3.5 h-3.5 text-slate-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                                    </svg>
                                    <span>{currentSubName || 'Bài làm đã nộp'}</span>
                                  </span>
                                </div>
                                <div>
                                  <span className="text-[11px] font-medium text-slate-500 block mb-0.5">Thời gian nộp:</span>
                                  <span className="text-xs font-semibold text-slate-700 flex items-center gap-1.5">
                                    <svg className="w-3.5 h-3.5 text-slate-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                                    </svg>
                                    <span>
                                      {formatSubmissionDate(mySub?.created_at, currentSubDate)}
                                    </span>
                                  </span>
                                </div>
                              </div>

                              {/* Ghi chú thêm nếu có */}
                              {cleanMySubContent && cleanMySubContent !== currentSubName && (
                                <div className="text-slate-700 bg-white/90 p-2.5 rounded-lg border border-emerald-100/80">
                                  <span className="text-[11px] font-medium text-slate-500 block mb-0.5">Ghi chú bài nộp của bạn:</span>
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
                                    <span>Xem / Tải bài nộp ({currentSubName || 'Tệp đính kèm'})</span>
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
                              <svg className="w-3.5 h-3.5 text-white shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                              </svg>
                              <span>Nộp bài tập</span>
                            </button>
                          )}
                        </div>
                      )}

                      {/* Khu vực Giáo viên theo dõi bài nộp & Chấm điểm - Thanh nút bấm gọn gàng */}
                      {isTeacher && (
                        <div className="pt-3 border-t border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-slate-50/70 p-3.5 rounded-xl border border-slate-200/70">
                          <div className="flex flex-wrap items-center gap-2 text-xs">
                            <span className="font-semibold text-slate-700">
                              Đã nộp:{' '}
                              <strong className="text-slate-900 font-bold">
                                {deduplicatedSubs.length}/{students.length > 0 ? students.length : deduplicatedSubs.length}
                              </strong>{' '}
                              học sinh
                            </span>
                            <span className="text-slate-300">•</span>
                            <span className="font-semibold text-slate-700">
                              Đã chấm:{' '}
                              <strong className="text-indigo-600 font-bold">
                                {deduplicatedSubs.filter((s) => getSubmissionGrading(s).grade !== null).length}/{deduplicatedSubs.length}
                              </strong>
                            </span>
                          </div>

                          <button
                            type="button"
                            onClick={() => {
                              setViewingAsmSubmissionsId(asm.id);
                              setSelectedStudentIdForGrading(null);
                            }}
                            className="inline-flex items-center justify-center gap-1.5 px-3.5 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold rounded-lg shadow-2xs transition cursor-pointer"
                          >
                            <svg className="w-3.5 h-3.5 text-white shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                            </svg>
                            <span>Xem danh sách học sinh & Chấm bài</span>
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
        )}

        {/* Tab 2: Thành viên */}
        {activeTab === 'members' && (
          <div className="space-y-6">
            {/* Card Mã lớp mời học sinh */}
            <div className="bg-gradient-to-r from-indigo-500 to-indigo-600 rounded-2xl p-6 text-white shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <span className="text-[11px] font-semibold uppercase tracking-wider text-indigo-200">
                  Mã tham gia lớp học
                </span>
                <h2 className="text-xl font-bold mt-0.5">Mời học sinh vào lớp</h2>
                <p className="text-xs text-indigo-100 mt-1 max-w-md">
                  Học sinh có thể sử dụng mã lớp này tại Không gian học tập để ghi danh vào lớp.
                </p>
              </div>
              <div className="flex items-center gap-3 bg-white/10 backdrop-blur-xs p-2.5 rounded-xl border border-white/20 self-start sm:self-auto">
                <div className="px-3 py-1 font-mono text-lg font-bold tracking-widest text-white">
                  {classroom.code}
                </div>
                <button
                  type="button"
                  onClick={() => handleCopyCode(classroom.code)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white text-indigo-700 hover:bg-indigo-50 text-xs font-semibold rounded-lg shadow-2xs transition cursor-pointer"
                >
                  {copiedCode ? (
                    <>
                      <svg className="w-3.5 h-3.5 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                      <span className="text-emerald-700">Đã chép!</span>
                    </>
                  ) : (
                    <>
                      <svg className="w-3.5 h-3.5 text-indigo-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                      </svg>
                      <span>Sao chép mã</span>
                    </>
                  )}
                </button>
              </div>
            </div>

            {/* Danh sách thành viên */}
            <div className="bg-white border border-slate-200/80 rounded-2xl shadow-sm overflow-hidden">
              <div className="p-5 border-b border-slate-100 flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-bold text-slate-900">Danh sách thành viên</h3>
                  <p className="text-xs text-slate-500 mt-0.5">Tổng số {members.length} học sinh trong lớp</p>
                </div>
                <span className="text-xs font-semibold px-2.5 py-1 bg-indigo-50 text-indigo-700 rounded-full border border-indigo-100">
                  {members.length} học sinh
                </span>
              </div>

              {members.length === 0 ? (
                <div className="p-12 text-center">
                  <div className="w-12 h-12 bg-slate-100 rounded-full flex items-center justify-center mx-auto mb-3 text-slate-400">
                    <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                    </svg>
                  </div>
                  <p className="text-sm font-semibold text-slate-700">Chưa có học sinh nào tham gia</p>
                  <p className="text-xs text-slate-500 mt-1 max-w-sm mx-auto">
                    Hãy chia sẻ mã lớp <span className="font-mono font-bold text-indigo-600">{classroom.code}</span> cho học sinh để cùng tham gia nhé!
                  </p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="bg-slate-50 border-b border-slate-100 text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                        <th className="py-3 px-4 w-12 text-center">STT</th>
                        <th className="py-3 px-4">Họ và tên</th>
                        <th className="py-3 px-4">Ngày tham gia</th>
                        <th className="py-3 px-4">Trạng thái</th>
                        {isTeacher && <th className="py-3 px-4 text-right">Thao tác</th>}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 text-xs text-slate-700">
                      {members.map((m, idx) => {
                        const memberName = m.profiles?.full_name || `Học sinh ${idx + 1}`;
                        const initials = memberName.trim().charAt(0).toUpperCase() || 'H';
                        const joinDateStr = m.joined_at
                          ? new Date(m.joined_at).toLocaleDateString('vi-VN', {
                              day: '2-digit',
                              month: '2-digit',
                              year: 'numeric',
                            })
                          : 'Đã tham gia';

                        return (
                          <tr key={m.id} className="hover:bg-slate-50/70 transition">
                            <td className="py-3.5 px-4 text-center font-medium text-slate-400 text-xs">
                              {idx + 1}
                            </td>
                            <td className="py-3.5 px-4">
                              <div className="flex items-center gap-3">
                                <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-indigo-500 to-indigo-600 text-white font-bold text-xs flex items-center justify-center shrink-0 shadow-2xs">
                                  {initials}
                                </div>
                                <div>
                                  <div className="font-semibold text-slate-900">{memberName}</div>
                                  <div className="text-[10px] text-slate-400 font-mono">{m.student_id.substring(0, 8)}...</div>
                                </div>
                              </div>
                            </td>
                            <td className="py-3.5 px-4 text-slate-500">
                              {joinDateStr}
                            </td>
                            <td className="py-3.5 px-4">
                              <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-medium bg-emerald-50 text-emerald-700 border border-emerald-100">
                                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                                Đã tham gia
                              </span>
                            </td>
                            {isTeacher && (
                              <td className="py-3.5 px-4 text-right">
                                <button
                                  type="button"
                                  onClick={() => handleRemoveMember(m.id, memberName)}
                                  disabled={isDeletingMemberId === m.id}
                                  className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold text-rose-600 hover:text-rose-700 bg-rose-50 hover:bg-rose-100 border border-rose-200 rounded-lg transition disabled:opacity-50 cursor-pointer"
                                  title={`Xóa học sinh ${memberName} khỏi lớp`}
                                >
                                  {isDeletingMemberId === m.id ? (
                                    <span>Đang xóa...</span>
                                  ) : (
                                    <>
                                      <svg className="w-3.5 h-3.5 text-rose-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                      </svg>
                                      <span>Xóa khỏi lớp</span>
                                    </>
                                  )}
                                </button>
                              </td>
                            )}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Tab 3: Bảng điểm tổng hợp (chỉ dành cho Giáo viên) */}
        {activeTab === 'grades' && isTeacher && (
          <div className="space-y-6">
            {/* Thẻ thống kê tổng quan */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="bg-white border border-slate-200/80 rounded-2xl p-4 shadow-sm">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-slate-500">Tổng số học sinh</span>
                  <div className="w-8 h-8 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center">
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
                    </svg>
                  </div>
                </div>
                <div className="text-2xl font-bold text-slate-900 mt-2">{students.length}</div>
              </div>

              <div className="bg-white border border-slate-200/80 rounded-2xl p-4 shadow-sm">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-slate-500">Tổng số bài tập</span>
                  <div className="w-8 h-8 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center">
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                  </div>
                </div>
                <div className="text-2xl font-bold text-slate-900 mt-2">{assignments.length}</div>
              </div>

              <div className="bg-white border border-slate-200/80 rounded-2xl p-4 shadow-sm">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-slate-500">Bài đã chấm điểm</span>
                  <div className="w-8 h-8 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center">
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </div>
                </div>
                <div className="text-2xl font-bold text-slate-900 mt-2">
                  {submissions.filter((s) => getSubmissionGrading(s).grade !== null).length} / {submissions.length}
                </div>
              </div>
            </div>

            {/* Bảng ma trận học sinh x bài tập */}
            <div className="bg-white border border-slate-200/80 rounded-2xl shadow-sm overflow-hidden">
              <div className="p-5 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div>
                  <h3 className="text-sm font-bold text-slate-900">Bảng điểm chi tiết toàn lớp</h3>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Nhấp vào ô bài nộp để xem chi tiết bài làm hoặc chấm điểm nhanh.
                  </p>
                </div>
                <div className="flex items-center gap-3 text-xs">
                  <span className="inline-flex items-center gap-1.5 text-slate-500">
                    <span className="w-2.5 h-2.5 rounded-full bg-slate-200"></span> Chưa nộp
                  </span>
                  <span className="inline-flex items-center gap-1.5 text-amber-600">
                    <span className="w-2.5 h-2.5 rounded-full bg-amber-400"></span> Đã nộp
                  </span>
                  <span className="inline-flex items-center gap-1.5 text-emerald-600">
                    <span className="w-2.5 h-2.5 rounded-full bg-emerald-500"></span> Đã chấm điểm
                  </span>
                </div>
              </div>

              {students.length === 0 ? (
                <div className="p-12 text-center">
                  <div className="w-12 h-12 bg-slate-100 rounded-full flex items-center justify-center mx-auto mb-3 text-slate-400">
                    <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
                    </svg>
                  </div>
                  <p className="text-sm font-semibold text-slate-700">Chưa có học sinh trong danh sách</p>
                  <p className="text-xs text-slate-500 mt-1">Khi học sinh tham gia lớp, bảng điểm sẽ hiển thị tại đây.</p>
                </div>
              ) : assignments.length === 0 ? (
                <div className="p-12 text-center">
                  <div className="w-12 h-12 bg-slate-100 rounded-full flex items-center justify-center mx-auto mb-3 text-slate-400">
                    <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                  </div>
                  <p className="text-sm font-semibold text-slate-700">Chưa có bài tập nào được giao</p>
                  <p className="text-xs text-slate-500 mt-1">Hãy chuyển sang tab &quot;Bài tập&quot; để giao bài tập đầu tiên cho lớp.</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="bg-slate-50 border-b border-slate-200 text-[11px] font-semibold text-slate-600 uppercase tracking-wider">
                        <th className="py-3 px-3 w-12 text-center sticky left-0 bg-slate-50 z-10 border-r border-slate-200">
                          STT
                        </th>
                        <th className="py-3 px-4 min-w-[160px] sticky left-12 bg-slate-50 z-10 border-r border-slate-200">
                          Học sinh
                        </th>
                        {assignments.map((asm) => (
                          <th key={asm.id} className="py-3 px-3 text-center min-w-[130px] border-r border-slate-200">
                            <div className="font-semibold text-slate-800 truncate max-w-[130px]" title={asm.title}>
                              {asm.title}
                            </div>
                            {asm.due_date && (
                              <div className="text-[10px] text-slate-400 font-normal lowercase">
                                Hạn: {new Date(asm.due_date).toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' })}
                              </div>
                            )}
                          </th>
                        ))}
                        <th className="py-3 px-4 text-center min-w-[100px] bg-indigo-50/50 text-indigo-900">
                          Điểm TB
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 text-xs">
                      {students.map((std, sIdx) => {
                        // Tính điểm trung bình của học sinh
                        const stdSubs = submissions.filter((s) => s.student_id === std.id);
                        const gradedSubs = stdSubs
                          .map((s) => getSubmissionGrading(s).grade)
                          .filter((g): g is number => g !== null && g !== undefined);
                        const avgGrade =
                          gradedSubs.length > 0
                            ? (gradedSubs.reduce((a, b) => a + b, 0) / gradedSubs.length).toFixed(1)
                            : null;

                        return (
                          <tr key={std.id} className="hover:bg-slate-50/70 transition">
                            <td className="py-3 px-3 text-center font-medium text-slate-400 sticky left-0 bg-white hover:bg-slate-50/70 border-r border-slate-200">
                              {sIdx + 1}
                            </td>
                            <td className="py-3 px-4 font-semibold text-slate-900 sticky left-12 bg-white hover:bg-slate-50/70 border-r border-slate-200">
                              <div className="truncate max-w-[160px]" title={std.full_name}>
                                {std.full_name}
                              </div>
                            </td>
                            {assignments.map((asm) => {
                              const asmSubs = submissions.filter(
                                (s) => s.assignment_id === asm.id && s.student_id === std.id
                              );
                              // Lấy bài nộp mới nhất
                              const sub =
                                asmSubs.length > 0
                                  ? asmSubs.sort(
                                      (a, b) =>
                                        new Date(b.created_at || b.submitted_at || 0).getTime() -
                                        new Date(a.created_at || a.submitted_at || 0).getTime()
                                    )[0]
                                  : null;

                              if (!sub) {
                                return (
                                  <td key={asm.id} className="py-3 px-3 text-center border-r border-slate-100">
                                    <span className="inline-block px-2 py-0.5 text-[11px] text-slate-400 bg-slate-50 border border-slate-200/60 rounded-md">
                                      Chưa nộp
                                    </span>
                                  </td>
                                );
                              }

                              const grading = getSubmissionGrading(sub);
                              const hasGrade = grading.grade !== null && grading.grade !== undefined;

                              return (
                                <td key={asm.id} className="py-3 px-3 text-center border-r border-slate-100">
                                  {hasGrade ? (
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setViewingAsmSubmissionsId(asm.id);
                                        setSelectedStudentIdForGrading(std.id);
                                      }}
                                      className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-bold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded-lg transition cursor-pointer shadow-2xs"
                                      title="Nhấp để xem bài và sửa điểm"
                                    >
                                      <svg className="w-3 h-3 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                      </svg>
                                      <span>{grading.grade}</span>
                                    </button>
                                  ) : (
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setViewingAsmSubmissionsId(asm.id);
                                        setSelectedStudentIdForGrading(std.id);
                                      }}
                                      className="inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-semibold text-amber-700 bg-amber-50 hover:bg-amber-100 border border-amber-200 rounded-full transition cursor-pointer"
                                      title="Nhấp để chấm bài"
                                    >
                                      <svg className="w-3 h-3 text-amber-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                                      </svg>
                                      <span>Đã nộp</span>
                                    </button>
                                  )}
                                </td>
                              );
                            })}
                            <td className="py-3 px-4 text-center font-bold bg-indigo-50/30 text-indigo-700">
                              {avgGrade !== null ? `${avgGrade}` : '-'}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}
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
                className="text-slate-400 hover:text-slate-600 p-1.5 rounded-lg hover:bg-slate-100 transition cursor-pointer"
                title="Đóng modal"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
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
                      <svg className="w-4 h-4 text-indigo-600 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                      </svg>
                      <span className="font-semibold truncate">{selectedSubmissionFile.name}</span>
                      <span className="text-[10px] text-indigo-500">
                        ({(selectedSubmissionFile.size / 1024).toFixed(1)} KB)
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => setSelectedSubmissionFile(null)}
                      className="text-indigo-400 hover:text-indigo-700 p-0.5 rounded hover:bg-indigo-100/50 ml-2 cursor-pointer"
                      title="Gỡ file"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
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

      {/* Modal to Quản lý danh sách học sinh & Chấm bài dành cho Giáo viên */}
      {viewingAsmSubmissionsId && (() => {
        const viewingAsm = assignments.find((a) => a.id === viewingAsmSubmissionsId);
        if (!viewingAsm) return null;

        const asmSubs = submissions.filter((s) => s.assignment_id === viewingAsm.id);
        const subMap = new Map<string, Submission>();
        asmSubs.forEach((s) => {
          const existing = subMap.get(s.student_id);
          if (!existing) {
            subMap.set(s.student_id, s);
          } else {
            const existingTime = new Date(existing.created_at || existing.submitted_at || 0).getTime();
            const newTime = new Date(s.created_at || s.submitted_at || 0).getTime();
            if (newTime > existingTime) {
              subMap.set(s.student_id, s);
            }
          }
        });

        const totalStudents = students.length > 0 ? students.length : subMap.size;
        const submittedCount = subMap.size;
        const unsubmittedCount = Math.max(0, totalStudents - submittedCount);
        const gradedCount = Array.from(subMap.values()).filter(
          (s) => getSubmissionGrading(s).grade !== null
        ).length;

        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-900/50 backdrop-blur-xs overflow-y-auto">
            <div className="bg-white rounded-2xl shadow-2xl max-w-4xl w-full border border-slate-200 overflow-hidden flex flex-col max-h-[90vh] my-auto">
              {/* Header */}
              <div className="flex items-start justify-between px-6 py-4 border-b border-slate-100 bg-slate-50/50">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-base sm:text-lg font-bold text-slate-900">
                      {viewingAsm.title}
                    </h3>
                    <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700 border border-indigo-200">
                      Quản lý bài nộp & Chấm điểm
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-3 mt-1 text-xs text-slate-500">
                    <span>
                      Hạn nộp:{' '}
                      <strong className="text-slate-700">
                        {viewingAsm.due_date
                          ? `${new Date(viewingAsm.due_date).toLocaleDateString('vi-VN')} ${new Date(viewingAsm.due_date).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}`
                          : 'Không giới hạn'}
                      </strong>
                    </span>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setViewingAsmSubmissionsId(null);
                    setSelectedStudentIdForGrading(null);
                  }}
                  className="text-slate-400 hover:text-slate-700 hover:bg-slate-100 p-1.5 rounded-lg transition cursor-pointer"
                  title="Đóng modal"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              {/* Thanh tóm tắt nhanh - Minimalist UI */}
              <div className="px-6 py-3.5 bg-slate-50/80 border-b border-slate-200/80 grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                <div className="bg-white p-3 rounded-xl border border-slate-200/90 shadow-2xs">
                  <p className="text-[11px] text-slate-500 font-medium">Tổng số học sinh</p>
                  <p className="text-xl font-bold text-slate-900 mt-1">{totalStudents}</p>
                </div>
                <div className="bg-white p-3 rounded-xl border border-emerald-200/90 shadow-2xs">
                  <p className="text-[11px] text-emerald-700 font-medium">Đã nộp bài</p>
                  <p className="text-xl font-bold text-emerald-600 mt-1">{submittedCount}</p>
                </div>
                <div className="bg-white p-3 rounded-xl border border-rose-200/90 shadow-2xs">
                  <p className="text-[11px] text-rose-700 font-medium">Chưa nộp bài</p>
                  <p className="text-xl font-bold text-rose-600 mt-1">{unsubmittedCount}</p>
                </div>
                <div className="bg-white p-3 rounded-xl border border-indigo-200/90 shadow-2xs">
                  <p className="text-[11px] text-indigo-700 font-medium">Đã chấm điểm</p>
                  <p className="text-xl font-bold text-indigo-600 mt-1">
                    {gradedCount} <span className="text-xs font-normal text-slate-400">/{submittedCount}</span>
                  </p>
                </div>
              </div>

              {/* Danh sách học sinh theo thứ tự ABC */}
              <div className="p-6 overflow-y-auto max-h-[60vh] space-y-2.5">
                {students.length === 0 ? (
                  <div className="text-center py-10 bg-slate-50 rounded-xl border border-dashed border-slate-200">
                    <p className="text-xs text-slate-500">Chưa có học sinh nào tham gia lớp học.</p>
                  </div>
                ) : (
                  students.map((std) => {
                    const sub = subMap.get(std.id);
                    const isSubmitted = Boolean(sub);
                    const isSelected = selectedStudentIdForGrading === std.id;
                    const grading = sub ? getSubmissionGrading(sub) : null;
                    const isGraded = Boolean(grading && grading.grade !== null);

                    const subFileUrl =
                      sub &&
                      ((sub.file_url && !sub.file_url.startsWith('blob:') ? sub.file_url : undefined) ||
                        (!sub.content?.includes('blob:') ? sub.content?.match(/\[File:.*?-\s*(https?:\/\/[^\s\]]+)\]/)?.[1] : undefined));
                    const subFileName =
                      sub &&
                      (sub.file_name ||
                        sub.content?.match(/\[File:\s*(.*?)\s*-\s*https?:\/\/[^\s\]]+\]/)?.[1]);
                    const cleanContent = sub ? cleanSubmissionContent(sub.content) : '';

                    const inputGrade = sub
                      ? (gradingInputs[sub.id]?.grade ?? (isGraded ? String(grading?.grade) : ''))
                      : '';
                    const inputFeedback = sub
                      ? (gradingInputs[sub.id]?.feedback ?? (grading?.feedback || ''))
                      : '';

                    const initialChar = (std.full_name || 'H').trim().charAt(0).toUpperCase();

                    return (
                      <div
                        key={std.id}
                        className={`border rounded-xl transition overflow-hidden ${isSelected
                            ? 'border-indigo-300 ring-2 ring-indigo-500/10 bg-indigo-50/20'
                            : 'border-slate-200 hover:border-slate-300 bg-white'
                          }`}
                      >
                        <div
                          onClick={() =>
                            setSelectedStudentIdForGrading((prev) => (prev === std.id ? null : std.id))
                          }
                          className="p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 cursor-pointer select-none"
                        >
                          {/* Cột trái: Tên học sinh, avatar chữ cái */}
                          <div className="flex items-center gap-3 min-w-0">
                            <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-indigo-500 to-indigo-600 text-white font-bold text-xs flex items-center justify-center shrink-0 shadow-2xs">
                              {initialChar}
                            </div>
                            <div className="min-w-0">
                              <p className="text-xs sm:text-sm font-bold text-slate-800 truncate">
                                {std.full_name}
                              </p>
                              <p className="text-[11px] text-slate-400 truncate">Mã HS: {std.id.substring(0, 8)}</p>
                            </div>
                          </div>

                          {/* Cột phải: Trạng thái nộp, Trạng thái chấm, Nút bấm mở rộng */}
                          <div className="flex flex-wrap items-center gap-2 self-start sm:self-center">
                            {/* Trạng thái nộp */}
                            {isSubmitted ? (
                              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200/80">
                                <span>Đã nộp</span>
                                <span className="text-[10px] text-emerald-600/80 font-normal">
                                  ({formatSubmissionDate(sub?.created_at, sub?.submitted_at)})
                                </span>
                              </span>
                            ) : (
                              <span className="inline-flex items-center px-2.5 py-1 rounded-md text-[11px] font-semibold bg-slate-100 text-slate-600 border border-slate-200">
                                Chưa nộp bài
                              </span>
                            )}

                            {/* Trạng thái chấm */}
                            {isSubmitted ? (
                              isGraded ? (
                                <span className="inline-flex items-center px-2.5 py-1 rounded-md text-[11px] font-bold bg-amber-50 text-amber-900 border border-amber-300">
                                  Điểm: {grading?.grade} / 10
                                </span>
                              ) : (
                                <span className="inline-flex items-center px-2.5 py-1 rounded-md text-[11px] font-medium bg-amber-50 text-amber-700 border border-amber-200">
                                  Chưa chấm
                                </span>
                              )
                            ) : (
                              <span className="text-slate-400 text-xs px-2">—</span>
                            )}

                            {/* Nút bấm mở rộng */}
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setSelectedStudentIdForGrading((prev) => (prev === std.id ? null : std.id));
                              }}
                              className={`inline-flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1 rounded-md border transition cursor-pointer ${isSelected
                                  ? 'bg-indigo-600 text-white border-indigo-600'
                                  : 'bg-white text-slate-700 hover:text-indigo-600 border-slate-200 hover:border-indigo-200'
                                }`}
                            >
                              <span>{isSelected ? 'Thu gọn' : 'Chi tiết & Chấm điểm'}</span>
                              <svg className={`w-3.5 h-3.5 transition-transform duration-200 ${isSelected ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                              </svg>
                            </button>
                          </div>
                        </div>

                        {/* Mở rộng chi tiết bài làm ngay dưới học sinh đó */}
                        {isSelected && (
                          <div className="border-t border-slate-200 bg-slate-50/70 p-4 space-y-3.5">
                            {!isSubmitted || !sub ? (
                              <div className="flex items-center gap-2 p-3 bg-white rounded-xl border border-slate-200 text-slate-600 text-xs">
                                <svg className="w-4 h-4 text-slate-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                                </svg>
                                <span>Học sinh này chưa nộp bài tập.</span>
                              </div>
                            ) : (
                              <div className="space-y-3">
                                {/* Thông tin nộp bài */}
                                <div className="bg-white p-3 rounded-xl border border-slate-200 space-y-2">
                                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1 text-xs text-slate-600 border-b border-slate-100 pb-2">
                                    <span className="font-medium inline-flex items-center gap-1.5">
                                      <svg className="w-3.5 h-3.5 text-slate-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                                      </svg>
                                      <span>Thời gian nộp: <strong>{formatSubmissionDate(sub.created_at, sub.submitted_at)}</strong></span>
                                    </span>
                                    {isGraded && (
                                      <span className="text-[11px] text-emerald-700 font-semibold bg-emerald-50 px-2 py-0.5 rounded-md border border-emerald-200 inline-flex items-center gap-1">
                                        <svg className="w-3 h-3 text-emerald-600 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                                        </svg>
                                        <span>Đã lưu điểm: {grading?.grade}/10</span>
                                      </span>
                                    )}
                                  </div>

                                  {/* Ghi chú hoặc trả lời của học sinh */}
                                  {cleanContent && (
                                    <div>
                                      <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1">
                                        Ghi chú bài nộp / Câu trả lời:
                                      </span>
                                      <p className="text-xs text-slate-800 leading-relaxed whitespace-pre-wrap bg-slate-50 p-2.5 rounded-lg border border-slate-100">
                                        {cleanContent}
                                      </p>
                                    </div>
                                  )}

                                  {/* File đính kèm */}
                                  {subFileUrl ? (
                                    <div className="pt-1">
                                      <a
                                        href={subFileUrl}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 font-semibold rounded-lg text-xs border border-indigo-200 transition"
                                      >
                                        <svg className="w-3.5 h-3.5 text-indigo-600 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                                        </svg>
                                        <span>Xem / Tải bài nộp ({subFileName || 'Tệp đính kèm'})</span>
                                      </a>
                                    </div>
                                  ) : (
                                    <p className="text-[11px] text-slate-400 italic">
                                      (Học sinh không đính kèm file)
                                    </p>
                                  )}
                                </div>

                                {/* Khu vực Chấm điểm & Ghi nhận xét */}
                                <div className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-2xs space-y-3">
                                  <span className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                                    <svg className="w-4 h-4 text-indigo-600 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                                    </svg>
                                    <span>Chấm điểm & Nhận xét của Giáo viên</span>
                                  </span>

                                  <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                                    <div className="sm:col-span-1">
                                      <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                                        Điểm (0 - 10)
                                      </label>
                                      <input
                                        type="number"
                                        min="0"
                                        max="10"
                                        step="0.1"
                                        placeholder="0 - 10"
                                        value={inputGrade}
                                        onChange={(e) =>
                                          setGradingInputs((prev) => ({
                                            ...prev,
                                            [sub.id]: {
                                              grade: e.target.value,
                                              feedback: inputFeedback,
                                            },
                                          }))
                                        }
                                        className="w-full px-3 py-1.5 text-xs font-bold text-indigo-700 bg-slate-50 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                                      />
                                    </div>

                                    <div className="sm:col-span-3">
                                      <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                                        Lời phê / Nhận xét
                                      </label>
                                      <textarea
                                        rows={2}
                                        placeholder="Nhập lời phê / nhận xét..."
                                        value={inputFeedback}
                                        onChange={(e) =>
                                          setGradingInputs((prev) => ({
                                            ...prev,
                                            [sub.id]: {
                                              grade: inputGrade,
                                              feedback: e.target.value,
                                            },
                                          }))
                                        }
                                        className="w-full px-3 py-1.5 text-xs text-slate-800 bg-slate-50 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 resize-none"
                                      />
                                    </div>
                                  </div>

                                  <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-slate-100">
                                    {/* Nút Xóa bài nộp */}
                                    <button
                                      type="button"
                                      onClick={() =>
                                        handleTeacherDeleteSubmission(
                                          sub.id,
                                          viewingAsm.id,
                                          std.id,
                                          std.full_name,
                                          subFileUrl
                                        )
                                      }
                                      disabled={isDeletingSubId === sub.id}
                                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-rose-600 hover:text-rose-700 bg-rose-50 hover:bg-rose-100 border border-rose-200 rounded-lg transition disabled:opacity-50 cursor-pointer"
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

                                    {/* Nút Lưu điểm */}
                                    <button
                                      type="button"
                                      disabled={isGradingSubId === sub.id}
                                      onClick={() =>
                                        handleGradeSubmission(sub.id, inputGrade, inputFeedback)
                                      }
                                      className="inline-flex items-center gap-1.5 px-3.5 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold rounded-lg shadow-2xs transition disabled:opacity-50 cursor-pointer"
                                    >
                                      {isGradingSubId === sub.id ? (
                                        <>
                                          <svg className="animate-spin h-3.5 w-3.5 text-white" fill="none" viewBox="0 0 24 24">
                                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"></path>
                                          </svg>
                                          <span>Đang lưu...</span>
                                        </>
                                      ) : (
                                        <>
                                          <svg className="w-3.5 h-3.5 text-white shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                          </svg>
                                          <span>Lưu điểm & Nhận xét</span>
                                        </>
                                      )}
                                    </button>
                                  </div>
                                </div>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>

              {/* Modal Footer */}
              <div className="flex justify-end px-6 py-3 bg-slate-50 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => {
                    setViewingAsmSubmissionsId(null);
                    setSelectedStudentIdForGrading(null);
                  }}
                  className="px-4 py-2 bg-slate-200 hover:bg-slate-300 text-slate-800 text-xs font-semibold rounded-lg transition cursor-pointer"
                >
                  Đóng
                </button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}