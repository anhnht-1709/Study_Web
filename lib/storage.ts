import { supabase } from './supabase';

/**
 * Tải file lên Supabase Storage và trả về đường dẫn URL công khai
 * @param file Đối tượng File lấy từ thẻ <input type="file" />
 * @param folder Thư mục phân loại (ví dụ: 'assignments' hoặc 'submissions')
 */
export async function uploadFileToSupabase(file: File, folder: string = 'general') {
  // 1. Chuẩn hóa tên file: timestamp + chuỗi ngẫu nhiên + đuôi mở rộng
  const fileExt = file.name.split('.').pop();
  const cleanFileName = `${Date.now()}-${Math.random().toString(36).substring(2, 7)}.${fileExt}`;
  const filePath = `${folder}/${cleanFileName}`;

  // 2. Tải file lên bucket 'classroom-files'
  const { error } = await supabase.storage
    .from('classroom-files')
    .upload(filePath, file, {
      cacheControl: '3600',
      upsert: false,
    });

  if (error) {
    throw new Error(`Lỗi tải file lên máy chủ: ${error.message}`);
  }

  // 3. Lấy đường dẫn công khai vĩnh viễn
  const { data: urlData } = supabase.storage
    .from('classroom-files')
    .getPublicUrl(filePath);

  return {
    publicUrl: urlData.publicUrl,
    fileName: file.name,
  };
}