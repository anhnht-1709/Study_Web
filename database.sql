-- 1. BẢNG HỒ SƠ NGƯỜI DÙNG (PROFILES)
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID REFERENCES auth.users ON DELETE CASCADE PRIMARY KEY,
  full_name TEXT,
  role TEXT CHECK (role IN ('teacher', 'student')),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Tự động sync profile khi người dùng đăng ký
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, role)
  VALUES (
    new.id, 
    new.raw_user_meta_data->>'full_name', 
    COALESCE(new.raw_user_meta_data->>'role', 'student')
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Tự động confirm email khi đăng ký
CREATE OR REPLACE FUNCTION public.auto_confirm_new_user()
RETURNS trigger AS $$
BEGIN
  NEW.email_confirmed_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE TRIGGER on_auth_user_auto_confirm
  BEFORE INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.auto_confirm_new_user();

-- 2. BẢNG LỚP HỌC (CLASSROOMS)
CREATE TABLE IF NOT EXISTS public.classrooms (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  code VARCHAR(6) UNIQUE NOT NULL,
  teacher_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 3. BẢNG THÀNH VIÊN LỚP HỌC (CLASSROOM_MEMBERS)
CREATE TABLE IF NOT EXISTS public.classroom_members (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  classroom_id UUID REFERENCES public.classrooms(id) ON DELETE CASCADE,
  student_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  joined_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(classroom_id, student_id)
);

-- 4. BẢNG BÀI TẬP (ASSIGNMENTS)
CREATE TABLE IF NOT EXISTS public.assignments (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  classroom_id UUID REFERENCES public.classrooms(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  due_date TIMESTAMPTZ,
  file_url TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Đảm bảo cột file_url tồn tại nếu bảng đã được tạo từ trước
ALTER TABLE public.assignments ADD COLUMN IF NOT EXISTS file_url TEXT;
ALTER TABLE public.submissions ADD COLUMN IF NOT EXISTS file_url TEXT;

-- 5. BẢNG BÀI NỘP (SUBMISSIONS)
CREATE TABLE IF NOT EXISTS public.submissions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  assignment_id UUID REFERENCES public.assignments(id) ON DELETE CASCADE,
  student_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  content TEXT,
  file_url TEXT,
  submitted_at TIMESTAMPTZ DEFAULT now()
);

-- 6. CẤP QUYỀN TRUY CẬP (ROW-LEVEL SECURITY)
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.classrooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.classroom_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.submissions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow select profiles" ON public.profiles FOR SELECT TO authenticated USING (true);
CREATE POLICY "Allow view classrooms" ON public.classrooms FOR SELECT TO authenticated USING (true);
CREATE POLICY "Allow create classrooms" ON public.classrooms FOR INSERT TO authenticated WITH CHECK (auth.uid() = teacher_id);
CREATE POLICY "Allow view classroom members" ON public.classroom_members FOR SELECT TO authenticated USING (true);
CREATE POLICY "Allow join classroom" ON public.classroom_members FOR INSERT TO authenticated WITH CHECK (auth.uid() = student_id);
CREATE POLICY "Allow view assignments" ON public.assignments FOR SELECT TO authenticated USING (true);
CREATE POLICY "Allow create assignments" ON public.assignments FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Allow view submissions" ON public.submissions FOR SELECT TO authenticated USING (true);
CREATE POLICY "Allow submit work" ON public.submissions FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Allow update submissions" ON public.submissions FOR UPDATE TO authenticated USING (true);