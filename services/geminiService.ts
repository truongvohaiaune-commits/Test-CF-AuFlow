import { GoogleGenAI } from "@google/genai";
import { FileData } from "../types";
import { supabase } from "./supabaseClient";

// --- SECURITY & UTILS ---

// KHÓA BÍ MẬT (Phải khớp với v_secret trong SQL function)
const XOR_SECRET = 'OPZEN_SUPER_SECRET_2025';

// Hàm xóa API Key khỏi chuỗi văn bản để bảo mật log
const scrubErrorText = (text: string): string => {
    if (!text) return "";
    return text
        .replace(/AIza[A-Za-z0-9_-]{35}/g, '***')
        .replace(/api_key:[A-Za-z0-9_-]+/g, 'api_key:***')
        .replace(/Consumer 'api_key:[^']+'/g, "API Key");
};

// Hàm giải mã XOR từ chuỗi Base64
const decryptCode = (encryptedBase64: string): string => {
    try {
        if (!encryptedBase64) return "";
        const binaryString = atob(encryptedBase64);
        let decrypted = '';
        for (let i = 0; i < binaryString.length; i++) {
            const secretChar = XOR_SECRET.charCodeAt(i % XOR_SECRET.length);
            const encryptedChar = binaryString.charCodeAt(i);
            decrypted += String.fromCharCode(encryptedChar ^ secretChar);
        }
        return decrypted;
    } catch (e) {
        console.error("Lỗi giải mã API Key:", e);
        return encryptedBase64;
    }
};

const normalizeCode = (code: string): string => {
    if (!code) return "";
    return code.trim().replace(/[\n\r\s]/g, '');
};

// --- API KEY MANAGEMENT ---

const getGeminiApiKey = async (): Promise<string> => {
    try {
        // 1. Ưu tiên biến môi trường Vite (Development/Local)
        // @ts-ignore
        if (typeof import.meta !== 'undefined' && import.meta.env) {
            // @ts-ignore
            if (import.meta.env.VITE_API_KEY) return import.meta.env.VITE_API_KEY;
            // @ts-ignore
            if (import.meta.env.API_KEY) return import.meta.env.API_KEY;
        }

        // 2. Fallback process.env
        if (typeof process !== 'undefined' && process.env) {
             if (process.env.VITE_API_KEY) return process.env.VITE_API_KEY;
             if (process.env.API_KEY) return process.env.API_KEY;
        }

        // 3. Gọi RPC để lấy key ngẫu nhiên từ Supabase (Production)
        const { data: encryptedKey, error } = await supabase.rpc('get_random_api_key');

        if (error) {
            // Fallback: Nếu không có RPC, query trực tiếp bảng api_keys
            if (error.message?.includes('function') && error.message?.includes('not found')) {
                 const { data: keys } = await supabase
                    .from('api_keys')
                    .select('key_value')
                    .eq('is_active', true);
                 
                 if (keys && keys.length > 0) {
                     const randomIndex = Math.floor(Math.random() * keys.length);
                     return keys[randomIndex].key_value;
                 }
            }
            console.error("Supabase RPC/DB Error:", error);
            throw new Error("Không thể kết nối đến hệ thống cấp Key.");
        }

        if (!encryptedKey) throw new Error("Hệ thống đang bận, vui lòng thử lại sau giây lát.");
        
        // Giải mã key nhận được
        const apiKey = normalizeCode(decryptCode(encryptedKey));
        
        if (!apiKey || apiKey.length < 10) {
             // Fallback nếu giải mã ra chuỗi rỗng (trường hợp key chưa encrypt trong DB cũ)
             if (encryptedKey.startsWith("AIza")) return encryptedKey;
             throw new Error("API Key không hợp lệ.");
        }

        return apiKey;
    } catch (err: any) {
        throw new Error(err.message || "Lỗi lấy API Key.");
    }
};

export const getDynamicAIClient = async (): Promise<GoogleGenAI> => {
    const key = await getGeminiApiKey();
    if (!key) {
        console.error("CRITICAL ERROR: API Key is missing.");
        throw new Error("API Key configuration missing. Please check console for details.");
    }
    return new GoogleGenAI({ apiKey: key });
};

export const processContentResponseAsync = async (response: any): Promise<string> => {
    if (!response.candidates || !response.candidates[0]) return "";
    for (const part of response.candidates[0].content.parts) {
        if (part.inlineData) return `data:${part.inlineData.mimeType || "image/png"};base64,${part.inlineData.data}`;
    }
    return "";
};

export const generateCreativeViewPrompt = async (
    image: FileData, 
    viewName: string, 
    category: string, 
    lang: 'vi' | 'en' = 'vi'
): Promise<string> => {
    const ai = await getDynamicAIClient();
    const model = 'gemini-flash-lite-latest';
    
    let systemInstruction = "";
    
    if (lang === 'vi') {
        systemInstruction = `Bạn là một Nhiếp ảnh gia Kiến trúc chuyên nghiệp cho tạp chí cao cấp (AD Magazine).
        NHIỆM VỤ: Phân tích ảnh thiết kế đầu vào và viết mô tả prompt (3-4 câu) cho góc máy: "${viewName}".

        YÊU CẦU BẮT BUỘC ĐỂ ĐẢM BẢO TÍNH THỰC TẾ:
        1. SOI CHI TIẾT THẬT: Nhìn kỹ ảnh mẫu để nhận diện đích danh vật liệu (ví dụ: đá Marble trắng vân mây, gỗ Sồi màu hạt dẻ, kim loại đồng xước...). Tuyệt đối không dùng từ chung chung.
        2. KỸ THUẬT GÓC MÁY THEO SLOT:
           - TỔNG THỂ 1: Phối cảnh từ trên cao nhìn xuống chéo một góc 45 độ (Bird's eye), bao quát toàn bộ khối tích dự án.
           - TỔNG THỂ 2: Góc nhìn mở rộng tổng thể phối cảnh Hero Shot 3/4, nhấn mạnh sự cân đối và ngôn ngữ thiết kế chính.
           - TỔNG THỂ 3: Góc nhìn thấp từ dưới lên (Low angle), sử dụng ống kính góc rộng hoặc tầm nhìn mắt người thực quan sát công trình hùng vĩ.
           - CẬN CẢNH 1: Đặc tả sự tinh xảo của các đường nét và giao điểm cấu tạo, kết nối khối hình và tỷ lệ chuẩn xác.
           - CẬN CẢNH 2: Tập trung vào sự sắp đặt decor và trang trí tinh tế, tạo cảm giác cao cấp và Lifestyle.
           - CẬN CẢNH 3: Đặc tả một loại vật liệu cao cấp đặc trưng (vân đá, thớ gỗ) dưới ánh sáng studio chuyên nghiệp.
           - LẤY NÉT 1: Macro Focus vào một chi tiết trang trí đặc biệt, độ sâu trường ảnh mỏng, xóa phông hoàn toàn hậu cảnh.
           - LẤY NÉT 2: Góc lấy nét kịch tính với xóa phông tiền cảnh (Foreground Bokeh) mạnh mẽ, dẫn dắt ánh nhìn vào điểm hội tụ duy nhất.
           - LẤY NÉT 3: Góc chụp siêu cận (Extreme Close-up), zoom sát vào một bề mặt vật liệu hoặc giao điểm cấu tạo tinh vi để soi rõ vân và kết cấu bề mặt. Sử dụng ánh sáng studio tạt ngang để nhấn mạnh độ nổi khối (texture) và bóng đổ kịch tính, phong cách nhiếp ảnh nghệ thuật Magazine.
        3. THỐNG NHẤT: Giữ 100% phong cách, màu sắc và linh hồn từ ảnh gốc.
        4. TRẢ VỀ: Tiếng Việt, chỉ nội dung mô tả prompt, không lời dẫn.`;
    } else {
        systemInstruction = `You are a Professional Architectural Photographer for high-end magazines.
        TASK: Analyze the source image and write a descriptive prompt (3-4 sentences) for the view: "${viewName}".

        STRICT REQUIREMENTS:
        1. IDENTIFY REAL MATERIALS: Specify exact materials found in the source (e.g., Calacatta Marble, Walnut wood, brushed brass). Avoid generic terms.
        2. SHOT SPECIFICATIONS:
           - OVERALL 1: 45-degree Bird's Eye view from above.
           - OVERALL 2: Expanded Hero Shot 3/4 perspective.
           - OVERALL 3: Low Angle wide-lens perspective, majestic human eye level.
           - CLOSE-UP 1: Focus on craftsmanship of lines and structural intersections.
           - CLOSE-UP 2: Focus on curated styling and high-end decor arrangements.
           - CLOSE-UP 3: Detailed material study (grain, veins) under professional studio lighting.
           - FOCUSED 1: Artistic Macro Focus on a decorative detail, shallow DOF, blurred background.
           - FOCUSED 2: Dramatic focus with strong FOREGROUND bokeh, leading eyes to a convergent point.
           - FOCUSED 3: Extreme Close-up / Super Macro. Zoom in tightly on a specific material surface or intersection to reveal intricate textures. Use dramatic side lighting for high contrast and texture definition, high-end magazine photography style.
        3. CONSISTENCY: Maintain 100% style and palette from source.
        4. RETURN: English, only the prompt content, no conversational filler.`;
    }

    return retryOperation(async () => {
        try {
            const response = await ai.models.generateContent({
                model: model,
                contents: {
                    parts: [
                        { text: systemInstruction },
                        { inlineData: { mimeType: image.mimeType, data: image.base64 } }
                    ]
                }
            });
            return response.text?.trim() || "";
        } catch (e: any) { throw new Error("Lỗi phân tích hình ảnh."); }
    });
};

export const handleGeminiError = (error: any) => {
    let msg = error?.message || error?.toString() || "";
    // Xóa key khỏi thông báo lỗi
    msg = scrubErrorText(msg);
    
    console.error("Gemini Error Detail:", msg);
    
    if (msg.includes("SAFETY") || msg.includes("blocked")) {
        throw new Error("SAFETY_POLICY_VIOLATION");
    }
    if (msg.includes("403") || msg.includes("API key")) {
        throw new Error("API Key Invalid or Expired");
    }
    if (msg.includes('Requested entity was not found')) {
        throw new Error("Lỗi: Không tìm thấy thực thực thể yêu cầu.");
    }
    
    throw new Error(msg);
};

export const retryOperation = async <T>(operation: () => Promise<T>, retries = 2): Promise<T> => {
    for (let i = 0; i < retries; i++) {
        try {
            return await operation();
        } catch (e: any) {
            if (i === retries - 1) throw e;
            await new Promise(r => setTimeout(r, 1000 * (i + 1)));
        }
    }
    throw new Error("Retry failed");
};

export const getFileDataFromUrl = async (url: string): Promise<FileData> => {
    try {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`Failed to fetch image: ${res.statusText}`);
        const blob = await res.blob();
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => {
                const res = reader.result as string;
                resolve({
                    base64: res.split(',')[1],
                    mimeType: blob.type,
                    objectURL: url
                });
            };
            reader.onerror = reject;
            reader.readAsDataURL(blob);
        });
    } catch (e) {
        console.error("getFileDataFromUrl Error:", e);
        throw e;
    }
};

// --- IMAGE GENERATION FUNCTIONS ---

export const generateStandardImage = async (prompt: string, aspectRatio: string, image?: FileData): Promise<string[]> => {
    const ai = await getDynamicAIClient();
    const model = 'gemini-2.5-flash-image';
    
    return retryOperation(async () => {
        try {
            const parts: any[] = [{ text: prompt }];
            if (image) {
                parts.push({ inlineData: { mimeType: image.mimeType, data: image.base64 } });
            }
            
            const response = await ai.models.generateContent({
                model,
                contents: { parts },
                config: {
                    imageConfig: { aspectRatio: aspectRatio as any }
                }
            });
            const url = await processContentResponseAsync(response);
            return url ? [url] : [];
        } catch (e) {
            handleGeminiError(e);
            return [];
        }
    });
};

export const generateHighQualityImage = async (
    prompt: string, 
    aspectRatio: string, 
    resolution: string, 
    image?: FileData, 
    jobId?: string,
    additionalImages?: FileData[]
): Promise<string[]> => {
    const ai = await getDynamicAIClient();
    const model = 'gemini-3-pro-image-preview'; 
    
    let imageSize: "1K" | "2K" | "4K" = "1K";
    if (resolution === '2K') imageSize = "2K";
    if (resolution === '4K') imageSize = "4K";

    return retryOperation(async () => {
        try {
            const parts: any[] = [{ text: prompt }];
            if (image) {
                parts.push({ inlineData: { mimeType: image.mimeType, data: image.base64 } });
            }
            if (additionalImages) {
                additionalImages.forEach(img => {
                    parts.push({ inlineData: { mimeType: img.mimeType, data: img.base64 } });
                });
            }

            const response = await ai.models.generateContent({
                model,
                contents: { parts },
                config: {
                    imageConfig: { 
                        aspectRatio: aspectRatio as any,
                        imageSize: imageSize
                    }
                }
            });
            
            const url = await processContentResponseAsync(response);
            return url ? [url] : [];
        } catch (e) {
            handleGeminiError(e);
            return [];
        }
    });
};

export const editImage = async (prompt: string, image: FileData, count: number = 1): Promise<{ imageUrl: string }[]> => {
    const urls = await generateStandardImage(prompt, "1:1", image);
    return urls.map(u => ({ imageUrl: u }));
};

// --- TEXT GENERATION FUNCTIONS ---

export const generateText = async (prompt: string): Promise<string> => {
    const ai = await getDynamicAIClient();
    // Use Flash Lite for lowest cost text generation
    const model = 'gemini-flash-lite-latest';
    
    return retryOperation(async () => {
        try {
            const response = await ai.models.generateContent({
                model: model,
                contents: [{ parts: [{ text: prompt }] }]
            });
            return response.text || "";
        } catch (e: any) {
            handleGeminiError(e);
            throw e;
        }
    });
};

export const generateArchitecturalPrompt = async (image: FileData, lang: 'vi' | 'en' = 'vi'): Promise<string> => {
    const ai = await getDynamicAIClient();
    // Fixed: Updated model name to 'gemini-flash-lite-latest' as per coding guidelines for flash lite models.
    const model = 'gemini-flash-lite-latest';
    
    let prompt = "";
    if (lang === 'vi') {
        prompt = `Phân tích hình ảnh kiến trúc này và tạo một mô tả ngắn gọn bằng tiếng Việt theo đúng cấu trúc sau: 'Biến thành ảnh chụp thực tế công trình [Loại công trình] + [Điểm nhấn: Vật liệu, màu sắc, chi tiết] + [Cảnh quan xung quanh] + [Thời gian/Thời tiết] + yêu cầu giữ nguyên góc nhìn ảnh ban đầu'.
        Ví dụ: 'Biến thành ảnh chụp thực tế công trình nhà phố hiện đại, tone màu trắng xám, ốp gỗ và kính, có cổng rào sắt, dây leo trên sân thượng, cảnh quan đường phố Việt Nam, thời gian ban ngày nắng đẹp, yêu cầu giữ nguyên góc nhìn ảnh ban đầu'.
        Chỉ trả về nội dung text, không thêm giải thích.`;
    } else {
        prompt = `Analyze this architectural image and create a concise description in English following this structure: 'Transform into a realistic photo of [Building Type] + [Highlights: Materials, colors, details] + [Surrounding landscape] + [Time/Weather] + maintain the original perspective'.
        Example: 'Transform into a realistic photo of a modern townhouse, white and gray tone, wood cladding and glass, iron gate, vines on the terrace, Vietnamese street landscape, sunny daytime, maintain the original perspective'.
        Return only the text content, no explanations.`;
    }

    return retryOperation(async () => {
        try {
            const response = await ai.models.generateContent({
                model: model,
                contents: {
                    parts: [
                        { text: prompt },
                        { inlineData: { mimeType: image.mimeType, data: image.base64 } }
                    ]
                }
            });
            return response.text?.trim() || "";
        } catch (e: any) {
            console.error("Failed to generate architectural prompt", e);
            throw e;
        }
    });
};

export const generatePlanningPrompt = async (image: FileData, lang: 'vi' | 'en' = 'vi'): Promise<string> => {
    const ai = await getDynamicAIClient();
    const model = 'gemini-flash-lite-latest';
    
    let prompt = "";
    if (lang === 'vi') {
        prompt = `Phân tích hình ảnh này và tạo một mô tả chi tiết bằng tiếng Việt theo cấu trúc sau:
        'Biến thành ảnh chụp thực tế dự án/Tô màu mặt bằng 2D góc nhìn tổng mặt bằng nhìn từ trên cao xuống quy hoạch dự án [Thể loại dự án], Có các khu vực quan trọng gồm: [liệt kê các khu vực như nhà ở, thương mại, vui chơi, cổng...], xung quanh được bao bọc bởi [cảnh quan xung quanh kiểu Việt Nam], thời gian [thời gian/thời tiết]. Yêu cầu bám sát chi tiết và góc nhìn của ảnh ban đầu'.
        Ví dụ: 'Biến thành ảnh chụp thực tế dự án nghỉ dưỡng sinh thái, Có khu vực hồ nước là hồ câu cá ở trung tâm, có khu vực bungalow mái rơm, có nhà hàng và quán cafe, khu vực đỗ xe, xung quanh được bao bọc bởi các con đường lớn và cánh đồng lúa việt nam, thời gian ban ngày nắng đẹp. Yêu cầu bám sát chi tiết và góc nhìn của ảnh ban đầu'.
        Chỉ trả về nội dung text, không thêm giải thích.`;
    } else {
        prompt = `Analyze this planning/landscape image and create a detailed description in English following this structure:
        'Transform into a realistic project photo/Colorize 2D site plan with a top-down aerial view of [Project Type], featuring key areas: [list key areas like residential, commercial, recreation, gates...], surrounded by [Vietnamese style landscape], during [time/weather]. Request to strictly adhere to the details and perspective of the original image'.
        Example: 'Transform into a realistic project photo of an eco-resort, featuring a central fishing lake, straw-roofed bungalows, a restaurant and café, a parking area, surrounded by main roads and Vietnamese rice fields, during a beautiful sunny day. Request to strictly adhere to the details and perspective of the original image'.
        Return only the text content, no explanations.`;
    }

    return retryOperation(async () => {
        try {
            const response = await ai.models.generateContent({
                model: model,
                contents: {
                    parts: [
                        { text: prompt },
                        { inlineData: { mimeType: image.mimeType, data: image.base64 } }
                    ]
                }
            });
            return response.text?.trim() || "";
        } catch (e: any) {
            console.error("Failed to generate planning prompt", e);
            throw e;
        }
    });
};

/**
 * Generates an architectural renovation prompt based on an image analysis.
 * Follows the specific structure requested by the user.
 */
export const generateRenovationPrompt = async (image: FileData, lang: 'vi' | 'en' = 'vi'): Promise<string> => {
    const ai = await getDynamicAIClient();
    const model = 'gemini-flash-lite-latest';
    
    let prompt = "";
    if (lang === 'vi') {
        prompt = `Phân tích hình ảnh khu đất/công trình này và tạo một mô tả chi tiết bằng tiếng Việt theo đúng cấu trúc sau:
        'Thêm công trình [Thể loại công trình] [Phong cách thiết kế] [Mô tả đặc điểm công trình: vật liệu, số tầng, chi tiết kiến trúc] [Mô tả về bố trí xung quanh công trình: sân vườn, hồ bơi, cổng rào...] vào khu đất trống, [Thời gian/Thời tiết]. Yêu cầu giữ nguyên cảnh quan xung quanh và góc nhìn của ảnh ban đầu'.
        Ví dụ: 'Thêm công trình villa nhiệt đới hiện đại ốp gỗ và đá, có 3 tầng, có hồ bơi và sân vườn Nhật, có chỗ đậu xe ô tô, xung quanh được bao bọc với hàng rào đá tối màu và cổng rào hiện đại vào khu đất trống, thời gian ban ngày nắng đẹp. Yêu cầu giữ nguyên cảnh quan xung quanh và góc nhìn của ảnh ban đầu'.
        Chỉ trả về nội dung text, không thêm giải thích hay tiêu đề.`;
    } else {
        prompt = `Analyze this plot/building image and create a detailed description in English following this exact structure:
        'Add [Building Type] [Design Style] [Building features: materials, floors, architectural details] [Surroundings/Layout: garden, pool, fence...] into the empty plot, [Time/Weather]. Maintain the original surrounding landscape and perspective of the original image'.
        Example: 'Add a modern tropical villa clad in wood and stone, 3 floors, featuring a swimming pool and Japanese garden, parking space, surrounded by a dark stone fence and modern gate into the empty plot, during sunny daytime. Maintain the original surrounding landscape and perspective of the original image'.
        Return only the text content, no explanations or headers.`;
    }

    return retryOperation(async () => {
        try {
            const response = await ai.models.generateContent({
                model: model,
                contents: {
                    parts: [
                        { text: prompt },
                        { inlineData: { mimeType: image.mimeType, data: image.base64 } }
                    ]
                }
            });
            return response.text?.trim() || "";
        } catch (e: any) {
            console.error("Failed to generate renovation prompt", e);
            throw e;
        }
    });
};

export const generateFloorPlanPrompt = async (
    image: FileData, 
    planType: 'architecture' | 'interior' | 'urban' | 'landscape' = 'architecture',
    renderMode: 'top-down' | 'perspective' = 'top-down',
    lang: 'vi' | 'en' = 'vi'
): Promise<string> => {
    const ai = await getDynamicAIClient();
    const model = 'gemini-flash-lite-latest';
    
    let prompt = "";
    const isVi = lang === 'vi';
    
    if (planType === 'interior') {
        if (renderMode === 'perspective') {
            if (isVi) {
                prompt = `Phân tích hình ảnh bản vẽ mặt bằng này và xác định luồng giao thông hoặc góc nhìn tiềm năng. Tạo một mô tả ngắn gọn bằng tiếng Việt theo cấu trúc sau: 'Góc nhìn 3D cận cảnh [Loại phòng] với góc nhìn từ [Vị trí bắt đầu/Chủ thể gần] nhìn sang [Vị trí kết thúc/Chủ thể xa]'. 
            Ví dụ: 'Góc nhìn 3D cận cảnh phòng khách với góc nhìn từ bộ bàn ăn nhìn sang khu vực sofa'.`;
            } else {
                prompt = `Analyze this floor plan image and identify the traffic flow or potential perspectives. Create a concise description in English following this structure: 'Close-up 3D view of [Room Type] with a view from [Starting Position/Near Subject] looking towards [Ending Position/Far Subject]'. Example: 'Close-up 3D view of the living room with a view from the dining set looking towards the sofa area'.`;
            }
        } else {
            if (isVi) {
                prompt = `Phân tích hình ảnh mặt bằng nội thất này và tạo một mô tả ngắn gọn bằng tiếng Việt theo đúng cấu trúc sau:
            'Biến thành ảnh chụp thực tế nội thất [Thể loại công trình] + [Điểm nhấn mặt bằng: phong cách thiết kế, mô tả các khu vực quan trọng, vật liệu, đồ nội thất] + yêu cầu bám sát chi tiết và góc nhìn của ảnh ban đầu'.

            Ví dụ: 'Biến thành ảnh chụp thực tế nội thất công trình nhà ở, phong cách thiết kế hiện đại, có phòng khách và 2 phòng ngủ, 2wc. Yêu cầu bám sát chi tiết và góc nhìn của ảnh ban đầu'.`;
            } else {
                prompt = `Analyze this interior floor plan image and create a concise description in English according to the following structure: 'Transform into a realistic interior photo of [Project Type] + [Floor plan highlights: design style, description of key areas, materials, furniture] + request to strictly adhere to the details and perspective of the original image'.

            Example: 'Transform into a realistic interior photo of a residential project, modern design style, featuring a living room, 2 bedrooms, and 2 bathrooms. Request to strictly adhere to the details and perspective of the original image'.`;
            }
        }
    } else if (planType === 'urban') {
        if (isVi) {
            prompt = `Phân tích hình ảnh mặt bằng quy hoạch đô thị này và tạo một mô tả ngắn gọn bằng tiếng Việt theo đúng cấu trúc sau:
            'Biến thành ảnh chụp thực tế dự án quy hoạch [Loại dự án] + [Điểm nhấn: mật độ xây dựng, hạ tầng giao thông, mảng xanh, mặt nước] + [Bối cảnh xung quanh] + yêu cầu bám sát chi tiết và góc nhìn của ảnh ban đầu'.
            Ví dụ: 'Biến thành ảnh chụp thực tế dự án quy hoạch khu đô thị ven sông, mật độ xây dựng thấp với các biệt thự sân vườn, hệ thống đường nội khu lát đá, có công viên trung tâm và bến du thuyền, xung quanh là cảnh quan đồi núi, yêu cầu bám sát chi tiết và góc nhìn của ảnh ban đầu'.`;
        } else {
            prompt = `Analyze this urban planning map and create a concise description in English following this structure:
            'Transform into a realistic urban planning photo of [Project Type] + [Highlights: building density, infrastructure, green spaces, water features] + [Surrounding context] + request to strictly adhere to the details and perspective of the original image'.
            Example: 'Transform into a realistic urban planning photo of a riverside residential project, low density with garden villas, stone-paved internal roads, central park and marina, surrounded by mountain landscape, strictly adhere to the details and perspective of the original image'.`;
        }
    } else if (planType === 'landscape') {
        if (isVi) {
            prompt = `Phân tích hình ảnh mặt bằng cảnh quan sân vườn này và tạo một mô tả ngắn gọn bằng tiếng Việt theo đúng cấu trúc sau:
            'Biến thành ảnh chụp thực tế sân vườn [Loại sân vườn] + [Điểm nhấn: loại cây xanh, mặt nước, lối đi, vật liệu ngoài trời] + [Thời gian/Ánh sáng] + yêu cầu bám sát chi tiết và góc nhìn của ảnh ban đầu'.
            Ví dụ: 'Biến thành ảnh chụp thực tế sân vườn biệt thự phong cách Nhật Bản, có hồ cá Koi lớn, lối đi bằng đá cuội giữa thảm cỏ nhung, cây tùng bonsai và đèn đá, thời gian ban ngày nắng dịu, yêu cầu bám sát chi tiết và góc nhìn của ảnh ban đầu'.`;
        } else {
            prompt = `Analyze this landscape/garden site plan and create a concise description in English following this structure:
            'Transform into a realistic garden photo of [Garden Type] + [Highlights: plant types, water features, pathways, outdoor materials] + [Time/Lighting] + request to strictly adhere to the details and perspective of the original image'.
            Example: 'Transform into a realistic garden photo of a Japanese style villa garden, featuring a large Koi pond, pebble pathways through velvet grass, bonsai pine trees and stone lanterns, soft daylight, strictly adhere to the details and perspective of the original image'.`;
        }
    } else {
        // Default architecture
        if (isVi) {
            prompt = `Phân tích hình ảnh mặt bằng/quy hoạch này và tạo một mô tả ngắn gọn bằng tiếng Việt theo đúng cấu trúc sau: 
        'Biến thành ảnh chụp thực tế dự án [Thể loại dự án] + [Các khu vực quan trọng: nhà ở, thương mại, vui chơi, cổng, hồ nước...] + [Cảnh quan xung quanh (phong cách Việt Nam)] + [Thời gian/Thời tiết] + yêu cầu bám sát chi tiết và góc nhìn của ảnh ban đầu'.
        
        Ví dụ: 'Biến thành ảnh chụp thực tế dự án nghỉ dưỡng sinh thái, Có khu vực hồ nước là hồ câu cá ở trung tâm, có khu vực bungalow mái rơm, có nhà hàng và quán cafe, khu vực đỗ xe, xung quanh được bao bọc bởi các con đường lớn và cánh đồng lúa việt nam, thời gian ban ngày nắng đẹp. Yêu cầu bám sát chi tiết và góc nhìn của ảnh ban đầu'.`;
        } else {
             prompt = `Analyze this site plan/master plan image and create a concise description in Englisg following this exact structure: 'Transform into a realistic project photo of [Project Type] + [Key areas: residential, commercial, recreation, gates, lakes...] + [Surrounding landscape (Vietnamese style)] + [Time/Weather] + request to strictly adhere to the details and perspective of the original image'.

        Example: 'Transform into a realistic photo of an eco-resort project, featuring a central fishing lake, straw-roofed bungalows, a restaurant and café, a parking area, surrounded by main roads and Vietnamese rice fields, during a beautiful sunny day. Request to strictly adhere to the details and perspective of the original image'.`;
        }
    }
    
    prompt += isVi ? `\nChỉ trả về nội dung text, không thêm giải thích.` : `\nReturn only the text content, no explanations.`;

    return retryOperation(async () => {
        try {
            const response = await ai.models.generateContent({
                model: model,
                contents: {
                    parts: [
                        { text: prompt },
                        { inlineData: { mimeType: image.mimeType, data: image.base64 } }
                    ]
                }
            });
            return response.text?.trim() || "";
        } catch (e: any) {
            console.error("Failed to generate floor plan prompt", e);
            throw e;
        }
    });
};

export const generateInteriorPrompt = async (image: FileData, lang: 'vi' | 'en' = 'vi'): Promise<string> => {
    const ai = await getDynamicAIClient();
    const model = 'gemini-flash-lite-latest';
    
    let prompt = "";
    if (lang === 'vi') {
        prompt = `Phân tích hình ảnh nội thất này và tạo một mô tả chi tiết bằng tiếng Việt theo đúng cấu trúc sau:
        'Biến thành ảnh chụp nội thất thực tế [tên loại phòng] [phong cách thiết kế] [loại dự án]. [Mô tả đặc điểm thiết kế: vật liệu, bố trí, ánh sáng, màu sắc...] Giữ nguyên bố cục và góc nhìn của ảnh ban đầu.'
        
        Ví dụ: 'Biến thành ảnh chụp nội thất thực tế của một căn penthouse thông tầng cao cấp, không gian trần cao hai tầng. Cầu thang bê tông với lan can kính, tay vịn kim loại mảnh tối giản, sơn đen. Trần thạch cao phẳng, đèn led dài mảnh nhìn thanh thoát nhẹ nhàng. Màn vải lùa 2 lớp cho khung kính tiếp giáp bên ngoài. Tường trần hoàn thiện sơn hiệu ứng wabi-sabi, có vị trí tường nhấn đá sần tự nhiên. Đèn trần và đèn tường tạo điểm sáng nhấn. Giữ nguyên bố cục và góc nhìn của ảnh ban đầu.'
        
        Chỉ trả về nội dung text, không thêm giải thích hay tiêu đề.`;
    } else {
        prompt = `Analyze this interior image and create a detailed description in English following this exact structure:
        'Transform into a realistic interior photo of [room name] [design style] [project type]. [Design features description: materials, layout, lighting, colors...] Maintain the original composition and perspective of the original image.'
        
        Example: 'Transform into a realistic interior photo of a luxury duplex penthouse, high-ceiling space. Concrete stairs with glass railings, minimalist thin metal handrails painted black. Flat gypsum ceiling, thin long LED lights looking elegant and light. 2-layer sliding fabric curtains for the adjacent glass frame. Walls and ceilings finished with wabi-sabi effect paint, with natural rough stone accent walls. Ceiling and wall lights create focal points. Maintain the original composition and perspective of the original image.'
        
        Return only the text content, no explanations or headers.`;
    }

    return retryOperation(async () => {
        try {
            const response = await ai.models.generateContent({
                model: model,
                contents: {
                    parts: [
                        { text: prompt },
                        { inlineData: { mimeType: image.mimeType, data: image.base64 } }
                    ]
                }
            });
            return response.text?.trim() || "";
        } catch (e: any) {
            console.error("Failed to generate interior prompt", e);
            throw e;
        }
    });
};

export const generatePromptSuggestions = async (
    image: FileData, 
    subject: string, 
    count: number,
    customInstruction: string = '',
    lang: 'vi' | 'en' = 'vi'
): Promise<Record<string, string[]> | null> => {
    const ai = await getDynamicAIClient();
    // Fixed: Updated model name to 'gemini-flash-lite-latest' as per coding guidelines for flash lite models.
    const model = 'gemini-flash-lite-latest';
    
    const isVi = lang === 'vi';
    
    const allCategoriesVi = [
        "Góc toàn cảnh", 
        "Góc trung cảnh", 
        "Góc lấy nét", 
        "Chi tiết kiến trúc"
    ];
    
    const allCategoriesEn = [
        "Wide Angle",
        "Medium Shot",
        "Focused Angle",
        "Architectural Details"
    ];

    const allCategories = isVi ? allCategoriesVi : allCategoriesEn;
    const langName = isVi ? "Vietnamese" : "English";

    let systemPrompt = "";

    if (subject === 'all') {
        systemPrompt = `Analyze the provided image and generate prompt suggestions for EACH of the following 4 categories: ${allCategories.join(', ')}. 
        For each category, provide exactly ${count} distinct prompts in ${langName}.`;
    } else {
        systemPrompt = `Analyze the provided image and generate exactly ${count} distinct prompt suggestions focusing specifically on the category: "${subject}". Provide prompts in ${langName}.`;
    }

    const fullPrompt = `${systemPrompt}
    ${customInstruction ? `Additional user requirement: ${customInstruction}` : ''}
    
    IMPORTANT FORMATTING RULES:
    1. Language: ${langName}.
    2. **Conciseness**: Each prompt must be short and impactful (approx 2-4 lines of text).
    3. **Structure**: Combine all details (lighting, angle, materials, mood) into **ONE single, coherent sentence** or a short paragraph. Do NOT use bullet points or lists within a suggestion.
    4. **Goal**: Create a prompt suitable for "View Sync" (consistent style transfer).

    RETURN FORMAT: Strictly a raw JSON object (no markdown, no code blocks).
    Keys must be the category names (exactly as listed above if 'all', or the specific subject name).
    Values must be arrays of strings (the prompts).
    `;

    return retryOperation(async () => {
        try {
            const response = await ai.models.generateContent({
                model: model,
                contents: {
                    parts: [
                        { text: fullPrompt },
                        { inlineData: { mimeType: image.mimeType, data: image.base64 } }
                    ]
                },
                config: { 
                    responseMimeType: "application/json"
                }
            });

            const text = response.text || "{}";
            return JSON.parse(text);
        } catch (e: any) {
            console.error("Failed to generate/parse suggestions", e);
            return null; 
        }
    });
};

export const enhancePrompt = async (userInput: string, image?: FileData): Promise<string> => {
    const ai = await getDynamicAIClient();
    // Fixed: Updated model name to 'gemini-flash-lite-latest' as per coding guidelines for flash lite models.
    const model = 'gemini-flash-lite-latest';
    
    const parts: any[] = [{ text: `Act as an expert architectural prompt engineer. Enhance the following user input into a detailed, professional prompt suitable for high-quality AI rendering (like Midjourney or Gemini). Focus on lighting, materials, atmosphere, and camera specifications. \n\nUser Input: "${userInput}"` }];
    
    if (image) {
        parts.push({ inlineData: { mimeType: image.mimeType, data: image.base64 } });
        parts[0].text += " \n\nAlso use the visual style of the attached image as a reference.";
    }

    return retryOperation(async () => {
        try {
            const response = await ai.models.generateContent({
                model,
                contents: { parts }
            });
            return response.text || "";
        } catch (e: any) {
            handleGeminiError(e);
            throw e;
        }
    });
};

export const generateVideoPromptFromImage = async (image: FileData, lang: 'vi' | 'en' = 'vi'): Promise<string> => {
    const ai = await getDynamicAIClient();
    // Fixed: Updated model name to 'gemini-flash-lite-latest' as per coding guidelines for flash lite models.
    const model = 'gemini-flash-lite-latest';
    
    let prompt = "";
    if (lang === 'vi') {
        prompt = `Phân tích hình ảnh kiến trúc hoặc nội thất này. Hãy viết một prompt (lời nhắc) bằng Tiếng Việt thật chi tiết, đậm chất điện ảnh để tạo video ngắn từ hình ảnh này bằng AI. 
    Tập trung mô tả chuyển động camera, thay đổi ánh sáng, và các yếu tố khí quyển. Giữ prompt dưới 60 từ.
    QUAN TRỌNG: CHỈ TRẢ VỀ NỘI DUNG PROMPT BẰNG TIẾNG VIỆT.`;
    } else {
        prompt = `Analyze this architectural or interior image. Write a detailed, cinematic prompt in English to generate a short AI video from this image. 
    Focus on camera movement, lighting changes, and atmospheric elements. Keep the prompt under 60 words.
    IMPORTANT: RETURN ONLY THE PROMPT CONTENT IN ENGLISH.`;
    }

    return retryOperation(async () => {
        try {
            const response = await ai.models.generateContent({
                model: model,
                contents: {
                    parts: [
                        { text: prompt },
                        { inlineData: { mimeType: image.mimeType, data: image.base64 } }
                    ]
                }
            });
            const fallback = lang === 'vi' ? "Video kiến trúc điện ảnh với chuyển động camera chậm." : "Cinematic architectural video with slow camera movement.";
            return response.text?.trim() || fallback;
        } catch (e: any) {
            console.error("Failed to generate video prompt from image", e);
            const fallback = lang === 'vi' ? "Video kiến trúc điện ảnh with chuyển động camera chậm." : "Cinematic architectural video with slow camera movement.";
            return fallback;
        }
    });
};