'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';

interface Classroom {
  id: string;
  name: string;
  description: string;
  code: string;
  created_at: string;
}

export default function DashboardPage() {
  const [profile, setProfile] = useState<{ id: string; full_name: string; role: string } | null>(null);
  const [classrooms, setClassrooms] = useState<Classroom[]>([]);
  const [loading, setLoading] = useState(true);

  // State cho Modal / Form tạo lớp (Giáo viên)
  const [className, setClassName] = useState('');
  const [classDesc, setClassDesc] = useState('');
  const [isCreating, setIsCreating] = useState(false);

  // State cho Form tham gia lớp (Học sinh)
  const [joinCode, setJoinCode] = useState('');
  const [isJoining, setIsJoining] = useState(false);

  const router = useRouter();

  const fetchClassrooms = useCallback(async (userId: string, userRole: string) => {
    try {
      if (userRole === 'teacher') {
        const { data, error } = await supabase
          .from('classrooms')
          .select('*')
          .eq('teacher_id', userId)
          .order('created_at', { ascending: false });

        if (!error && data) {
          setClassrooms(data);
        } else {
          setClassrooms([]);
        }
      } else {
        // Học sinh: lấy các lớp đã tham gia thông qua bảng classroom_members
        const { data, error } = await supabase
          .from('classroom_members')
          .select('classrooms(*)')
          .eq('student_id', userId);

        if (!error && data) {
          const mappedClasses = data
            .map((item: { classrooms: unknown }) => item.classrooms)
            .filter(Boolean) as Classroom[];
          setClassrooms(mappedClasses);
        } else {
          setClassrooms([]);
        }
      }
    } catch (err) {
      console.warn('Lỗi khi tải danh sách lớp:', err);
      setClassrooms([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let ignore = false;

    async function initUser() {
      try {
        // 1. Kiểm tra session đăng nhập
        const {
          data: { user },
          error: authError,
        } = await supabase.auth.getUser();

        if (authError || !user) {
          router.push('/');
          return;
        }

        // 2. Lấy thông tin role từ profile trong database
        let userProfile: { id: string; full_name: string; role: string } | null = null;

        try {
          const { data: prof, error: profError } = await supabase
            .from('profiles')
            .select('*')
            .eq('id', user.id)
            .maybeSingle();

          if (!profError && prof) {
            userProfile = prof;
          }
        } catch {
          // Bảng profiles có thể chưa tạo hoặc chưa có dữ liệu
        }

        // Fallback: nếu bảng profiles chưa có bản ghi, lấy trực tiếp từ Auth metadata
        if (!userProfile) {
          userProfile = {
            id: user.id,
            full_name:
              user.user_metadata?.full_name ||
              user.email?.split('@')[0] ||
              'Người dùng',
            role: user.user_metadata?.role || 'student',
          };
        }

        if (!ignore && userProfile) {
          setProfile(userProfile);
          await fetchClassrooms(userProfile.id, userProfile.role);
        }
      } catch (err) {
        console.error('Lỗi khởi tạo người dùng:', err);
      } finally {
        if (!ignore) {
          setLoading(false);
        }
      }
    }

    initUser();

    return () => {
      ignore = true;
    };
  }, [fetchClassrooms, router]);

  // Hàm tạo lớp dành cho Giáo viên (sinh ngẫu nhiên mã code 6 ký tự)
  const handleCreateClass = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profile) return;
    setIsCreating(true);

    const randomCode = Math.random().toString(36).substring(2, 8).toUpperCase();

    const { error } = await supabase.from('classrooms').insert([
      {
        name: className,
        description: classDesc,
        code: randomCode,
        teacher_id: profile.id,
      },
    ]);

    setIsCreating(false);
    if (error) {
      alert(`Lỗi tạo lớp: ${error.message}`);
    } else {
      setClassName('');
      setClassDesc('');
      fetchClassrooms(profile.id, profile.role);
    }
  };

  // Hàm tham gia lớp dành cho Học sinh bằng mã code
  const handleJoinClass = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profile) return;
    setIsJoining(true);

    // Tìm lớp học theo mã code
    const { data: targetClass, error: findError } = await supabase
      .from('classrooms')
      .select('id')
      .eq('code', joinCode.trim().toUpperCase())
      .single();

    if (findError || !targetClass) {
      alert('Không tìm thấy lớp học với mã này!');
      setIsJoining(false);
      return;
    }

    // Ghi danh vào lớp
    const { error: joinError } = await supabase.from('classroom_members').insert([
      {
        classroom_id: targetClass.id,
        student_id: profile.id,
      },
    ]);

    setIsJoining(false);
    if (joinError) {
      alert(joinError.message.includes('duplicate') ? 'Bạn đã tham gia lớp này rồi!' : `Lỗi: ${joinError.message}`);
    } else {
      setJoinCode('');
      fetchClassrooms(profile.id, profile.role);
    }
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    router.push('/');
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 text-slate-500 font-medium">
        Đang tải dữ liệu không gian học tập...
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header thanh điều hướng */}
      <nav className="bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-800">Không Gian Học Tập</h1>
          <p className="text-xs text-slate-500">
            Xin chào, <span className="font-semibold text-slate-700">{profile?.full_name}</span> ({profile?.role === 'teacher' ? 'Giáo viên' : 'Học sinh'})
          </p>
        </div>
        <button
          onClick={handleLogout}
          className="px-3.5 py-1.5 text-xs font-semibold text-slate-600 hover:text-rose-600 hover:bg-rose-50 border border-slate-200 rounded-lg transition"
        >
          Đăng xuất
        </button>
      </nav>

      <main className="max-w-6xl mx-auto p-6">
        {/* Khu vực thao tác: Tạo lớp (Teacher) hoặc Tham gia (Student) */}
        <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm mb-8">
          {profile?.role === 'teacher' ? (
            <div>
              <h2 className="text-base font-bold text-slate-800 mb-1">Tạo lớp học mới</h2>
              <p className="text-xs text-slate-500 mb-4">Hệ thống sẽ tự động tạo một mã code riêng để học sinh tham gia.</p>
              
              <form onSubmit={handleCreateClass} className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <input
                  type="text"
                  required
                  placeholder="Tên lớp (ví dụ: Toán Cao Cấp A1)"
                  value={className}
                  onChange={(e) => setClassName(e.target.value)}
                  className="px-3.5 py-2 text-sm border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                />
                <input
                  type="text"
                  placeholder="Mô tả ngắn (tùy chọn)"
                  value={classDesc}
                  onChange={(e) => setClassDesc(e.target.value)}
                  className="px-3.5 py-2 text-sm border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                />
                <button
                  type="submit"
                  disabled={isCreating}
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold rounded-xl shadow-sm transition disabled:opacity-50"
                >
                  {isCreating ? 'Đang tạo...' : '+ Tạo lớp học'}
                </button>
              </form>
            </div>
          ) : (
            <div>
              <h2 className="text-base font-bold text-slate-800 mb-1">Tham gia lớp học</h2>
              <p className="text-xs text-slate-500 mb-4">Nhập mã code 6 ký tự do giáo viên cung cấp để vào lớp.</p>
              
              <form onSubmit={handleJoinClass} className="flex gap-3 max-w-md">
                <input
                  type="text"
                  required
                  maxLength={6}
                  placeholder="Ví dụ: A8K2F9"
                  value={joinCode}
                  onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                  className="w-full px-3.5 py-2 text-sm border border-slate-200 rounded-xl tracking-widest font-mono uppercase focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                />
                <button
                  type="submit"
                  disabled={isJoining}
                  className="whitespace-nowrap px-5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold rounded-xl shadow-sm transition disabled:opacity-50"
                >
                  {isJoining ? 'Đang vào...' : 'Vào lớp'}
                </button>
              </form>
            </div>
          )}
        </div>

        {/* Danh sách các lớp học hiện có */}
        <h2 className="text-lg font-bold text-slate-800 mb-4">
          {profile?.role === 'teacher' ? 'Danh sách lớp đang giảng dạy' : 'Danh sách lớp đang theo học'} ({classrooms.length})
        </h2>

        {classrooms.length === 0 ? (
          <div className="text-center py-12 bg-white border border-dashed border-slate-200 rounded-2xl">
            <p className="text-slate-500 text-sm">Chưa có lớp học nào được tìm thấy.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {classrooms.map((cls) => (
              <div
                key={cls.id}
                className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm hover:shadow-md transition flex flex-col justify-between"
              >
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[11px] font-mono px-2 py-0.5 bg-slate-100 text-slate-600 rounded-md font-semibold">
                      Mã lớp: {cls.code}
                    </span>
                  </div>
                  <h3 className="font-bold text-slate-900 text-base">{cls.name}</h3>
                  <p className="text-xs text-slate-500 mt-1 line-clamp-2">{cls.description || 'Không có mô tả'}</p>
                </div>

                <div className="mt-5 pt-3 border-t border-slate-100 flex items-center justify-end">
                  <Link
                    href={`/classrooms/${cls.id}`}
                    className="text-xs font-semibold text-indigo-600 hover:text-indigo-800 transition"
                  >
                    Vào lớp chi tiết &rarr;
                  </Link>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
