'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';

export default function AuthPage() {
  const router = useRouter();
  // Step: 'select-role' (chọn vai trò trước) | 'auth' (đăng nhập / đăng ký)
  const [step, setStep] = useState<'select-role' | 'auth'>('select-role');
  const [role, setRole] = useState<'student' | 'teacher'>('student');
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [fullName, setFullName] = useState('');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSelectRole = (selectedRole: 'student' | 'teacher') => {
    setRole(selectedRole);
    setStep('auth');
    setMessage('');
  };

  const handleBackToSelectRole = () => {
    setStep('select-role');
    setMessage('');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setMessage('');

    try {
      if (isLogin) {
        const { data, error } = await supabase.auth.signInWithPassword({
          email,
          password,
        });
        if (error) throw error;

        const userRole = data.user?.user_metadata?.role;
        if (userRole && userRole !== role) {
          setMessage(
            `Đăng nhập thành công! (Lưu ý: Tài khoản của bạn mang vai trò ${
              userRole === 'teacher' ? 'Giáo viên' : 'Học sinh'
            }).`
          );
          router.push('/dashboard');
        } else {
          setMessage('Đăng nhập thành công! Đang chuyển hướng...');
          router.push('/dashboard');
        }
      } else {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: {
              full_name: fullName,
              role: role,
            },
          },
        });
        if (error) throw error;
        setMessage('Đăng ký thành công! Hãy chuyển sang Đăng nhập để vào hệ thống.');
      }
    } catch (err: unknown) {
      const errorMessage =
        err instanceof Error ? err.message : 'Có lỗi xảy ra, vui lòng thử lại!';
      setMessage(`Lỗi: ${errorMessage}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50/30 to-indigo-50/40 flex flex-col justify-center items-center p-4 sm:p-6">
      {/* Background decorative elements */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none -z-10">
        <div className="absolute top-1/4 -left-20 w-80 h-80 bg-blue-200/40 rounded-full blur-3xl"></div>
        <div className="absolute bottom-1/4 -right-20 w-80 h-80 bg-indigo-200/40 rounded-full blur-3xl"></div>
      </div>

      {step === 'select-role' ? (
        /* ================= BƯỚC 1: CHỌN VAI TRÒ ================= */
        <div className="w-full max-w-2xl bg-white rounded-2xl shadow-xl p-6 sm:p-10 border border-slate-100 transition-all">
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-blue-100 text-blue-600 mb-4 shadow-sm">
              <svg
                className="w-7 h-7"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  d="M12 14l9-5-9-5-9 5 9 5z"
                />
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  d="M12 14l6.16-3.422a12.083 12.083 0 01.665 6.479A11.952 11.952 0 0012 20.055a11.952 11.952 0 00-6.824-2.998 12.078 12.078 0 01.665-6.479L12 14z"
                />
              </svg>
            </div>
            <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-800 tracking-tight">
              Hệ Thống Lớp Học Trực Tuyến
            </h1>
            <p className="mt-2 text-slate-600 text-sm sm:text-base">
              Vui lòng chọn vai trò của bạn để tiếp tục đăng nhập
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            {/* Lựa chọn Học sinh */}
            <button
              type="button"
              onClick={() => handleSelectRole('student')}
              className="group relative flex flex-col items-center text-center p-6 sm:p-7 rounded-2xl border-2 border-slate-200 hover:border-blue-500 bg-white hover:bg-blue-50/40 transition-all duration-200 shadow-sm hover:shadow-md cursor-pointer text-left"
            >
              <div className="w-16 h-16 rounded-2xl bg-blue-100 group-hover:bg-blue-600 text-blue-600 group-hover:text-white flex items-center justify-center transition-colors mb-4 shadow-sm">
                <span className="text-3xl">🎓</span>
              </div>
              <span className="inline-block px-2.5 py-0.5 rounded-full text-xs font-semibold bg-blue-100 text-blue-700 mb-2">
                Dành cho người học
              </span>
              <h2 className="text-xl font-bold text-slate-800 group-hover:text-blue-600 transition-colors">
                Học sinh
              </h2>
              <p className="text-xs sm:text-sm text-slate-500 mt-2 line-clamp-3">
                Tham gia lớp học trực tuyến, xem tài liệu, nộp bài tập và theo dõi điểm số của mình.
              </p>
              <div className="mt-5 inline-flex items-center text-sm font-semibold text-blue-600 group-hover:translate-x-1 transition-transform">
                Đăng nhập với tư cách Học sinh
                <svg
                  className="w-4 h-4 ml-1.5"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                    d="M9 5l7 7-7 7"
                  />
                </svg>
              </div>
            </button>

            {/* Lựa chọn Giáo viên */}
            <button
              type="button"
              onClick={() => handleSelectRole('teacher')}
              className="group relative flex flex-col items-center text-center p-6 sm:p-7 rounded-2xl border-2 border-slate-200 hover:border-indigo-500 bg-white hover:bg-indigo-50/40 transition-all duration-200 shadow-sm hover:shadow-md cursor-pointer text-left"
            >
              <div className="w-16 h-16 rounded-2xl bg-indigo-100 group-hover:bg-indigo-600 text-indigo-600 group-hover:text-white flex items-center justify-center transition-colors mb-4 shadow-sm">
                <span className="text-3xl">👨‍🏫</span>
              </div>
              <span className="inline-block px-2.5 py-0.5 rounded-full text-xs font-semibold bg-indigo-100 text-indigo-700 mb-2">
                Dành cho người dạy
              </span>
              <h2 className="text-xl font-bold text-slate-800 group-hover:text-indigo-600 transition-colors">
                Giáo viên
              </h2>
              <p className="text-xs sm:text-sm text-slate-500 mt-2 line-clamp-3">
                Quản lý lớp học, chia sẻ bài giảng, giao bài kiểm tra và chấm điểm đánh giá học sinh.
              </p>
              <div className="mt-5 inline-flex items-center text-sm font-semibold text-indigo-600 group-hover:translate-x-1 transition-transform">
                Đăng nhập với tư cách Giáo viên
                <svg
                  className="w-4 h-4 ml-1.5"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                    d="M9 5l7 7-7 7"
                  />
                </svg>
              </div>
            </button>
          </div>

          <div className="mt-8 pt-5 border-t border-slate-100 text-center text-xs text-slate-400">
            Bạn có thể dễ dàng thay đổi vai trò sau khi vào màn hình đăng nhập.
          </div>
        </div>
      ) : (
        /* ================= BƯỚC 2: FORM ĐĂNG NHẬP / ĐĂNG KÝ ================= */
        <div className="w-full max-w-md bg-white rounded-2xl shadow-xl p-6 sm:p-8 border border-slate-100 transition-all">
          {/* Nút quay lại chọn vai trò */}
          <div className="flex items-center justify-between mb-5">
            <button
              type="button"
              onClick={handleBackToSelectRole}
              className="inline-flex items-center text-xs sm:text-sm font-medium text-slate-500 hover:text-slate-800 transition"
            >
              <svg
                className="w-4 h-4 mr-1"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  d="M15 19l-7-7 7-7"
                />
              </svg>
              Đổi vai trò khác
            </button>

            <span
              className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold ${
                role === 'student'
                  ? 'bg-blue-100 text-blue-700'
                  : 'bg-indigo-100 text-indigo-700'
              }`}
            >
              <span>{role === 'student' ? '🎓' : '👨‍🏫'}</span>
              <span>{role === 'student' ? 'Học sinh' : 'Giáo viên'}</span>
            </span>
          </div>

          <div className="text-center mb-6">
            <h1 className="text-2xl font-bold text-slate-800">
              {isLogin ? 'Đăng nhập tài khoản' : 'Đăng ký tài khoản'}
            </h1>
            <p className="text-sm text-slate-500 mt-1">
              {isLogin
                ? `Chào mừng ${role === 'student' ? 'bạn học sinh' : 'thầy/cô'} quay trở lại!`
                : `Tạo tài khoản mới cho ${role === 'student' ? 'Học sinh' : 'Giáo viên'}`}
            </p>
          </div>

          {/* Tab chuyển đổi nhanh vai trò trực tiếp */}
          <div className="bg-slate-100 p-1 rounded-xl mb-5 flex">
            <button
              type="button"
              onClick={() => {
                setRole('student');
                setMessage('');
              }}
              className={`flex-1 py-1.5 text-xs sm:text-sm font-medium rounded-lg transition-all flex items-center justify-center gap-1.5 ${
                role === 'student'
                  ? 'bg-white text-blue-600 shadow-sm font-semibold'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <span>🎓</span> Học sinh
            </button>
            <button
              type="button"
              onClick={() => {
                setRole('teacher');
                setMessage('');
              }}
              className={`flex-1 py-1.5 text-xs sm:text-sm font-medium rounded-lg transition-all flex items-center justify-center gap-1.5 ${
                role === 'teacher'
                  ? 'bg-white text-indigo-600 shadow-sm font-semibold'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <span>👨‍🏫</span> Giáo viên
            </button>
          </div>

          {/* Thông báo kết quả */}
          {message && (
            <div
              className={`p-3 rounded-xl text-sm mb-4 leading-relaxed ${
                message.startsWith('Lỗi')
                  ? 'bg-red-50 text-red-600 border border-red-200'
                  : 'bg-green-50 text-green-700 border border-green-200'
              }`}
            >
              {message}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            {!isLogin && (
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Họ và tên
                </label>
                <input
                  type="text"
                  required
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  className="w-full px-3.5 py-2.5 border border-slate-300 rounded-xl text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition"
                  placeholder={role === 'student' ? 'Nguyễn Văn A' : 'Thầy/Cô Nguyễn Văn A'}
                />
              </div>
            )}

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                Email
              </label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-3.5 py-2.5 border border-slate-300 rounded-xl text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition"
                placeholder={
                  role === 'student' ? 'hocsinh@gmail.com' : 'giaovien@truonghoc.edu.vn'
                }
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                Mật khẩu
              </label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full px-3.5 py-2.5 pr-10 border border-slate-300 rounded-xl text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition"
                  placeholder="••••••••"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition"
                  tabIndex={-1}
                >
                  {showPassword ? (
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth="2"
                        d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l18 18"
                      />
                    </svg>
                  ) : (
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth="2"
                        d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                      />
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth="2"
                        d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
                      />
                    </svg>
                  )}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className={`w-full py-2.5 px-4 font-medium rounded-xl text-white transition-all shadow hover:shadow-md disabled:opacity-50 cursor-pointer ${
                role === 'student'
                  ? 'bg-blue-600 hover:bg-blue-700'
                  : 'bg-indigo-600 hover:bg-indigo-700'
              }`}
            >
              {loading
                ? 'Đang xử lý...'
                : isLogin
                ? `Đăng nhập (${role === 'student' ? 'Học sinh' : 'Giáo viên'})`
                : `Đăng ký (${role === 'student' ? 'Học sinh' : 'Giáo viên'})`}
            </button>
          </form>

          {/* Chuyển đổi giữa Đăng nhập và Đăng ký */}
          <div className="mt-6 text-center text-sm text-slate-600">
            {isLogin ? 'Chưa có tài khoản? ' : 'Đã có tài khoản? '}
            <button
              type="button"
              onClick={() => {
                setIsLogin(!isLogin);
                setMessage('');
              }}
              className="text-blue-600 font-semibold hover:underline cursor-pointer"
            >
              {isLogin ? 'Đăng ký ngay' : 'Đăng nhập tại đây'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
