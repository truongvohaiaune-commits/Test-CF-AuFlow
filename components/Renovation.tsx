
import React, { useState, useMemo, useEffect, useRef } from 'react';
import { FileData, Tool, AspectRatio, ImageResolution } from '../types';
import { RenovationState } from '../state/toolState';
import * as geminiService from '../services/geminiService';
import * as historyService from '../services/historyService';
import * as jobService from '../services/jobService';
import * as externalVideoService from '../services/externalVideoService';
import { refundCredits } from '../services/paymentService';
import { supabase } from '../services/supabaseClient';
import Spinner from './Spinner';
import ImageUpload from './common/ImageUpload';
import ImageComparator from './ImageComparator';
import NumberOfImagesSelector from './common/NumberOfImagesSelector';
import ResultGrid from './common/ResultGrid';
import AspectRatioSelector from './common/AspectRatioSelector';
import ImagePreviewModal from './common/ImagePreviewModal';
import MaskingModal from './MaskingModal';
import ResolutionSelector from './common/ResolutionSelector';
import MultiImageUpload from './common/MultiImageUpload';
import OptionSelector from './common/OptionSelector';
import SafetyWarningModal from './common/SafetyWarningModal';
import { useLanguage } from '../hooks/useLanguage';

interface RenovationProps {
    state: RenovationState;
    onStateChange: (newState: Partial<RenovationState>) => void;
    userCredits?: number;
    onDeductCredits?: (amount: number, description: string) => Promise<string>;
    onInsufficientCredits?: () => void;
}

const Renovation: React.FC<RenovationProps> = ({ state, onStateChange, userCredits = 0, onDeductCredits, onInsufficientCredits }) => {
    const { t, language } = useLanguage();
    const { renoMode, prompt, sourceImage, referenceImages, maskImage, isLoading, error, renovatedImages, numberOfImages, aspectRatio, resolution } = state;
    
    const [previewImage, setPreviewImage] = useState<string | null>(null);
    const [isMaskingModalOpen, setIsMaskingModalOpen] = useState<boolean>(false);
    const [statusMessage, setStatusMessage] = useState<string | null>(null);
    const [isDownloading, setIsDownloading] = useState(false);
    const [showSafetyModal, setShowSafetyModal] = useState(false);
    const [selectedIndex, setSelectedIndex] = useState(0);
    const [isAutoPromptLoading, setIsAutoPromptLoading] = useState(false);

    // Mode Selection State
    const [isModeSelected, setIsModeSelected] = useState(false);
    const [isModeDropdownOpen, setIsModeDropdownOpen] = useState(false);
    const modeDropdownRef = useRef<HTMLDivElement>(null);

    // Calculate Cost
    const cost = numberOfImages * (resolution === '4K' ? 30 : resolution === '2K' ? 20 : resolution === '1K' ? 10 : 5);

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (modeDropdownRef.current && !modeDropdownRef.current.contains(event.target as Node)) {
                setIsModeDropdownOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    useEffect(() => {
        if (renovatedImages.length > 0) setSelectedIndex(0);
    }, [renovatedImages.length]);

    // --- MODE DATA ---
    const renoModes = useMemo(() => [
        {
            id: 'interior',
            label: t('reno.mode.interior'),
            desc: t('reno.mode.interior_desc'),
            icon: 'chair',
            image: 'https://mtlomjjlgvsjpudxlspq.supabase.co/storage/v1/object/public/background-imgs/Renovation-Caption/architecture-render-result-1%20(7).png'
        },
        {
            id: 'exterior',
            label: t('reno.mode.exterior'),
            desc: t('reno.mode.exterior_desc'),
            icon: 'apartment',
            image: 'https://mtlomjjlgvsjpudxlspq.supabase.co/storage/v1/object/public/background-imgs/Renovation-Caption/architecture-render-result-3%20(11).png'
        },
        {
            id: 'landscape',
            label: t('reno.mode.landscape'),
            desc: t('reno.mode.landscape_desc'),
            icon: 'park',
            image: 'https://mtlomjjlgvsjpudxlspq.supabase.co/storage/v1/object/public/background-imgs/Renovation-Caption/architecture-render-result-3%20(8).png'
        },
        {
            id: 'spatial',
            label: t('reno.mode.spatial'),
            desc: t('reno.mode.spatial_desc'),
            icon: 'architecture',
            image: 'https://mtlomjjlgvsjpudxlspq.supabase.co/storage/v1/object/public/background-imgs/Renovation-Caption/architecture-render-result-1%20(8).png'
        }
    ], [t]);

    const handleSelectMode = (mode: string) => {
        onStateChange({ renoMode: mode as any });
        setIsModeSelected(true);
        onStateChange({ renovatedImages: [] });
    };

    const handleBackToDashboard = () => setIsModeSelected(false);

    // --- DYNAMIC SUGGESTIONS (OPTIMIZED PROMPTS) ---
    const renovationSuggestions = useMemo(() => {
        const isVi = language === 'vi';
        
        const perMode: Record<string, any[]> = {
            exterior: [
                { 
                    label: isVi ? 'Thiết kế mới hoàn toàn' : 'Redesign completed building', 
                    prompt: isVi 
                        ? 'Thiết kế mới hoàn toàn dựa trên phác thảo, kiến trúc hiện đại, thay đổi hoàn toàn hình khối nhưng vẫn giữ đúng phạm vi khu đất.' 
                        : 'Complete architectural redesign focusing on radical massing transformation and modern aesthetics while strictly respecting the site footprint.' 
                },
                { 
                    label: isVi ? 'Thiết kế theo công trình cũ' : 'Redesign old building', 
                    prompt: isVi 
                        ? 'Cải tạo giữ nguyên hình khối công trình cũ, nâng cấp vật liệu mặt tiền cao cấp, thay thế hệ thống cửa kính hiện đại.' 
                        : 'Renovate existing structure by upgrading facade with premium materials and high-performance modern glazing systems.' 
                },
                { 
                    label: isVi ? 'Thay đổi màu sơn' : 'Change paint color', 
                    prompt: isVi 
                        ? 'Thay đổi bảng màu sơn ngoại thất sang tone màu hiện đại, kết hợp hệ thống ánh sáng mặt tiền nghệ thuật ban đêm.' 
                        : 'Refresh the exterior color palette to a contemporary scheme, integrated with artistic facade lighting effects for a premium look.' 
                },
                { 
                    label: isVi ? 'Thiết kế nâng thêm tầng' : 'Add floor level', 
                    prompt: isVi 
                        ? 'Thiết kế nâng thêm tầng cho công trình hiện hữu, đảm bảo sự đồng nhất về phong cách kiến trúc giữa khối cũ và khối mới.' 
                        : 'Architectural expansion: add an additional floor ensuring stylistic harmony and structural consistency with the original building design.' 
                },
            ],
            interior: [
                { 
                    label: isVi ? 'Thêm đồ nội thất có sẵn' : 'Virtual staging', 
                    prompt: isVi 
                        ? 'Đặt các đồ nội thất này vào không gian một cách hợp lý và tự nhiên, thêm rèm cửa sổ ' 
                        : 'Virtual staging: Populate the empty space with contemporary furniture pieces, optimizing the functional layout and spatial flow.' 
                },
                { 
                    label: isVi ? 'Thêm vật liệu có sẵn' : 'Surface material swap', 
                    prompt: isVi 
                        ? 'Giữ nguyên đồ đạc hiện có, thay đổi toàn bộ vật liệu bề mặt sàn, ốp tường và trần theo phong cách sang trọng.' 
                        : 'Maintain existing furniture layout but replace all surface finishes with premium wood, stone, and luxury textures for floors and walls.' 
                },
                { 
                    label: isVi ? 'Cải tạo công trình cũ' : 'Dated space makeover', 
                    prompt: isVi 
                        ? 'Lột xác không gian cũ kỹ thành nội thất hiện đại, cải tạo triệt để ánh sáng và màu sắc để làm mới căn phòng.' 
                        : 'Comprehensive interior renovation: transform dated spaces into high-end modern living environments with updated lighting and palette.' 
                },
                { 
                    label: isVi ? 'Cải tạo công trình đang xây' : 'Finish raw construction', 
                    prompt: isVi 
                        ? 'Hoàn thiện thiết kế cho công trình đang xây thô, lấp đầy không gian bằng vật liệu hoàn thiện và bố trí đồ nội thất.' 
                        : 'Finish interior design for a building in rough construction stage, applying all surface finishes and realistic furniture placement.' 
                },
            ],
            landscape: [
                { 
                    label: isVi ? 'Cải tạo sân vườn cũ' : 'Refresh old garden', 
                    prompt: isVi 
                        ? 'Cải tạo quy hoạch lại sân vườn cũ, sắp xếp lại vị trí cây xanh, lối đi và bổ sung thêm các khu vực thư giãn ngoài trời.' 
                        : 'Garden revitalization: re-planning existing landscape, reorganizing greenery, pedestrian paths, and adding outdoor living zones.' 
                },
                { 
                    label: isVi ? 'Cải tạo sân vườn trống' : 'New garden design', 
                    prompt: isVi 
                        ? 'Thiết kế cảnh quan mới hoàn toàn trên nền đất trống, bao gồm thảm cỏ, hồ nước, tiểu cảnh và hệ thống cây xanh nghệ thuật.' 
                        : 'Comprehensive landscape design from scratch for empty land, including lawns, hardscaping, water features, and lush vegetation.' 
                },
                { 
                    label: isVi ? 'Thêm cây cảnh' : 'Add greenery', 
                    prompt: isVi 
                        ? 'Bổ sung thêm hệ thống cây cảnh, hoa nghệ thuật và tiểu cảnh để tăng mảng xanh và tính thẩm mỹ cho sân vườn hiện tại.' 
                        : 'Supplement existing garden with curated ornamental plants, artistic flora, and micro-landscape features to maximize greenery.' 
                },
            ],
            spatial: [
                { 
                    label: isVi ? 'Đưa thêm mẫu 3D công trình' : 'Integrate 3D model', 
                    prompt: isVi 
                        ? 'Lấy mẫu công trình từ ảnh tham chiếu và lồng ghép một cách chân thực vào bối cảnh thực tế của ảnh gốc, giữ đúng tỷ lệ.' 
                        : 'Extract architectural model from reference and realistically integrate it into the source environment, matching perspective and scale.' 
                },
                { 
                    label: isVi ? 'Đưa thêm khối công trình' : 'Develop sketch mass', 
                    prompt: isVi 
                        ? 'Phát triển các khối công trình phác thảo thành kiến trúc thực tế, đặt đúng vào vị trí quy hoạch trong không gian ảnh chụp.' 
                        : 'Develop conceptual building masses into realistic architectural structures aligned with spatial planning and site constraints.' 
                },
            ]
        };

        return perMode[renoMode] || [];
    }, [language, renoMode]);

    // Handle Default Prompt Logic - Enhanced for language and mode sync
    useEffect(() => {
        const isVi = language === 'vi';
        
        // Define all mode-specific default prompts
        const defaultPrompts = {
            interior: {
                vi: 'Cải tạo không gian nội thất này theo phong cách hiện đại, tone màu ấm.',
                en: 'Renovate this interior space in a modern style with warm tones.'
            },
            exterior: {
                vi: 'Cải tạo mặt tiền công trình theo phong cách tối giản, sử dụng vật liệu gỗ và kính.',
                en: 'Renovate the building facade in a minimalist style, using wood and glass elements.'
            },
            landscape: {
                vi: 'Cải tạo sân vườn hiện trạng thành khu vườn nhiệt đới với nhiều cây xanh và hồ nước.',
                en: 'Transform current garden into a lush tropical landscape with diverse plants and water features.'
            },
            spatial: {
                vi: 'Sắp xếp lại bố cục không gian để tối ưu hóa diện tích sử dụng và ánh sáng tự nhiên.',
                en: 'Rearrange spatial layout to optimize area efficiency and natural lighting exposure.'
            }
        };

        const currentDefaults = defaultPrompts[renoMode] || defaultPrompts.interior;
        const targetPrompt = isVi ? currentDefaults.vi : currentDefaults.en;

        // Check if the current prompt is either empty or belongs to ANY of the default prompts (from any mode or language)
        // to determine if we should auto-update it.
        const allPossibleDefaults = Object.values(defaultPrompts).flatMap(d => [d.vi, d.en]);
        
        // Legacy defaults from previous versions
        const legacyDefaults = [
            'Cải tạo nội thất', 'Interior renovation', 'Cải tạo ngoại thất', 'Exterior renovation', 
            'Cải tạo mặt tiền ngôi nhà này theo phong cách hiện đại, tối giản. Sử dụng vật liệu gỗ, kính và bê tông. Thêm nhiều cây xanh xung quanh.',
            'Renovate the facade of this house in a modern, minimalist style. Use wood, glass, and concrete materials. Add plenty of greenery around.'
        ];

        const shouldUpdate = !prompt || allPossibleDefaults.includes(prompt) || legacyDefaults.some(ld => prompt.includes(ld));

        if (shouldUpdate) {
            onStateChange({ prompt: targetPrompt });
        }
    }, [renoMode, language]);

    const handleAutoPrompt = async () => {
        if (!sourceImage) return;
        setIsAutoPromptLoading(true);
        try {
            // New logic: Generate structured renovation prompt via Gemini
            let newPrompt = "";
            if (renoMode === 'exterior') {
                newPrompt = await geminiService.generateRenovationPrompt(sourceImage, language);
            } else if (renoMode === 'interior') {
                newPrompt = await geminiService.generateInteriorPrompt(sourceImage, language);
            } else {
                newPrompt = await geminiService.generateArchitecturalPrompt(sourceImage, language);
            }
            onStateChange({ prompt: newPrompt });
        } catch (err: any) {
            console.error("Failed to generate auto prompt:", err);
        } finally {
            setIsAutoPromptLoading(false);
        }
    };

    const handleGenerate = async () => {
        if (onDeductCredits && userCredits < cost) {
             if (onInsufficientCredits) onInsufficientCredits();
             return;
        }
        if (!prompt || !sourceImage) return;

        onStateChange({ isLoading: true, error: null, renovatedImages: [] });
        setStatusMessage(t('common.processing'));
        let logId: string | null = null;

        try {
            if (onDeductCredits) {
                logId = await onDeductCredits(cost, `Cải tạo AI (${renoMode})`);
            }
            
            const modelName = resolution === 'Standard' ? "GEM_PIX" : "GEM_PIX_2";
            const modePrefix = {
                interior: "Expert Interior Renovation:",
                exterior: "Expert Architectural Facade Renovation:",
                landscape: "Expert Landscape Gardening and Outdoor Design:",
                spatial: "Expert Spatial Integration and Functional Design:"
            }[renoMode];

            let finalPrompt = `${modePrefix} ${prompt}. Maintain design logic and site constraints. Aspect ratio: ${aspectRatio}.`;
            
            let baseImages: FileData[] = [sourceImage];
            if (maskImage) {
                const composite = await (async (source: FileData, mask: FileData): Promise<FileData> => {
                    return new Promise((resolve, reject) => {
                        const imgS = new Image(); const imgM = new Image();
                        imgS.crossOrigin = "Anonymous"; imgM.crossOrigin = "Anonymous";
                        imgS.onload = () => {
                            const canvas = document.createElement('canvas');
                            canvas.width = imgS.width; canvas.height = imgS.height;
                            const ctx = canvas.getContext('2d');
                            if (!ctx) { reject(); return; }
                            ctx.drawImage(imgS, 0, 0);
                            imgM.onload = () => {
                                ctx.drawImage(imgM, 0, 0, canvas.width, canvas.height);
                                const du = canvas.toDataURL('image/png');
                                resolve({ base64: du.split(',')[1], mimeType: 'image/png', objectURL: du });
                            };
                            imgM.src = mask.objectURL;
                        };
                        imgS.src = source.objectURL;
                    });
                })(sourceImage, maskImage);
                baseImages = [sourceImage, composite];
                finalPrompt += " Apply changes ONLY to the RED MASKED region.";
            }
            const inputImages = [...baseImages, ...referenceImages].filter(Boolean) as FileData[];

            const promises = Array.from({ length: numberOfImages }).map(async (_, idx) => {
                const result = await externalVideoService.generateFlowImage(
                    finalPrompt, inputImages, aspectRatio, 1, modelName,
                    (msg) => setStatusMessage(`${t('common.processing')} (${idx+1}/${numberOfImages})`)
                );
                if (result.imageUrls && result.imageUrls.length > 0) {
                    let finalUrl = result.imageUrls[0];
                    if ((resolution === '2K' || resolution === '4K') && result.mediaIds?.[0]) {
                        const targetRes = resolution === '4K' ? 'UPSAMPLE_IMAGE_RESOLUTION_4K' : 'UPSAMPLE_IMAGE_RESOLUTION_2K';
                        const upResult = await externalVideoService.upscaleFlowImage(result.mediaIds[0], result.projectId, targetRes, aspectRatio);
                        if (upResult?.imageUrl) finalUrl = upResult.imageUrl;
                    }
                    return finalUrl;
                }
                return null;
            });

            const results = await Promise.all(promises);
            const successfulUrls = results.filter((url): url is string => url !== null);
            if (successfulUrls.length > 0) {
                onStateChange({ renovatedImages: successfulUrls });
                successfulUrls.forEach(url => historyService.addToHistory({ 
                    tool: Tool.Renovation, prompt: prompt, sourceImageURL: sourceImage.objectURL, resultImageURL: url 
                }));
            } else throw new Error("Gen failed");
        } catch (err: any) {
            const rawMsg = err.message || ""; const friendlyKey = jobService.mapFriendlyErrorMessage(rawMsg);
            if (friendlyKey === "SAFETY_POLICY_VIOLATION") setShowSafetyModal(true); else onStateChange({ error: t(friendlyKey) });
            if (logId && onDeductCredits) {
                const { data: { user } } = await supabase.auth.getUser();
                if (user) await refundCredits(user.id, cost, `Refund: Reno Error`, logId);
            }
        } finally { onStateChange({ isLoading: false }); }
    };

    const handleDownload = async () => {
        if (renovatedImages[selectedIndex]) {
            setIsDownloading(true);
            await externalVideoService.forceDownload(renovatedImages[selectedIndex], "renovation.png");
            setIsDownloading(false);
        }
    };

    if (!isModeSelected) {
        return (
            <div className="max-w-7xl mx-auto pb-10 px-4">
                <div className="mb-8 md:mb-12 text-center animate-fade-in-up">
                    <h2 className="text-2xl sm:text-3xl md:text-4xl font-extrabold text-text-primary dark:text-white mb-3 md:mb-4">
                        {language === 'vi' ? 'Bạn muốn Cải tạo không gian nào?' : 'What space do you want to Renovate?'}
                    </h2>
                    <p className="text-text-secondary dark:text-gray-400 max-w-2xl mx-auto text-sm sm:text-base md:text-lg leading-relaxed px-4">
                        {language === 'vi' ? 'Chọn chế độ cải tạo để AI tập trung tối ưu hóa các thành phần không gian phù hợp.' : 'Select a renovation mode to help AI focus on optimizing the right spatial components.'}
                    </p>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6">
                    {renoModes.map((m, idx) => (
                        <button key={m.id} onClick={() => handleSelectMode(m.id)} className="group relative flex flex-col h-64 sm:h-72 md:h-80 rounded-2xl border border-gray-200 dark:border-white/5 overflow-hidden transition-all duration-500 hover:-translate-y-2 hover:shadow-2xl shadow-xl">
                            <img src={m.image} alt={m.label} className="absolute inset-0 w-full h-full object-cover transition-transform duration-1000 group-hover:scale-110" />
                            <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/40 to-transparent"></div>
                            <div className="relative z-10 flex flex-col h-full p-6 sm:p-8 justify-end text-left">
                                <div className="flex items-center gap-3 sm:gap-4 mb-2 sm:mb-3">
                                    <div className="p-2 sm:p-3 rounded-xl bg-white/10 backdrop-blur-xl text-white border border-white/20 group-hover:bg-[#7f13ec]">
                                        <span className="material-symbols-outlined text-xl sm:text-2xl notranslate">{m.icon}</span>
                                    </div>
                                    <h3 className="text-xl sm:text-2xl font-black text-white group-hover:text-[#E0E0E0]">{m.label}</h3>
                                </div>
                                <p className="text-xs sm:text-sm text-gray-300 line-clamp-2">{m.desc}</p>
                                <div className="mt-4 flex items-center text-[10px] sm:text-xs font-bold text-white/50 group-hover:text-white uppercase tracking-widest">
                                    {language === 'vi' ? 'Bắt đầu ngay' : 'Start now'}
                                    <span className="material-symbols-outlined text-sm ml-2 group-hover:translate-x-1 transition-transform">arrow_forward</span>
                                </div>
                            </div>
                        </button>
                    ))}
                </div>
            </div>
        );
    }

    return (
        <div className="flex flex-col lg:flex-row gap-4 sm:gap-6 md:gap-8 max-w-[1920px] mx-auto items-stretch px-2 sm:px-4">
            <SafetyWarningModal isOpen={showSafetyModal} onClose={() => setShowSafetyModal(false)} />
            {previewImage && <ImagePreviewModal imageUrl={previewImage} onClose={() => setPreviewImage(null)} />}
            {isMaskingModalOpen && sourceImage && (
                <MaskingModal image={sourceImage} initialMask={maskImage} onClose={() => setIsMaskingModalOpen(false)} onApply={(m) => { onStateChange({ maskImage: m }); setIsMaskingModalOpen(false); }} maskColor="rgba(239, 68, 68, 0.5)" />
            )}
            
            <aside className="w-full lg:w-[350px] xl:w-[380px] flex-shrink-0 flex flex-col bg-white dark:bg-[#1A1A1A] border border-border-color dark:border-[#302839] rounded-2xl shadow-sm relative overflow-visible lg:h-[calc(100vh-130px)] lg:sticky lg:top-[120px]">
                <div className="p-3 space-y-4 flex-1 lg:overflow-y-auto custom-sidebar-scroll overflow-visible">
                    <div className="px-1 pt-1">
                        <button onClick={handleBackToDashboard} className="flex items-center gap-2 text-text-secondary dark:text-gray-400 hover:text-[#7f13ec] transition-all font-bold text-xs sm:text-sm group">
                            <span className="material-symbols-outlined group-hover:-translate-x-1 transition-transform">arrow_back</span>
                            <span>{t('common.back')}</span>
                        </button>
                    </div>

                    <div className="relative z-20" ref={modeDropdownRef}>
                        <button onClick={() => setIsModeDropdownOpen(!isModeDropdownOpen)} className="w-full bg-[#7f13ec]/5 dark:bg-[#7f13ec]/10 p-3 sm:p-4 rounded-2xl border border-[#7f13ec]/20 flex items-center justify-between hover:bg-[#7f13ec]/10 transition-colors">
                            <div className="flex items-center gap-3">
                                <div className="p-1.5 sm:p-2 bg-[#7f13ec] rounded-lg text-white">
                                    <span className="material-symbols-outlined text-base sm:text-lg notranslate">{renoModes.find(m => m.id === renoMode)?.icon || 'auto_awesome'}</span>
                                </div>
                                <div className="text-left">
                                    <span className="block text-[8px] sm:text-[10px] font-bold text-[#7f13ec] uppercase tracking-wider">{language === 'vi' ? 'Chế độ (Nhấn để đổi)' : 'Mode (Click to switch)'}</span>
                                    <span className="block text-xs sm:text-sm font-black text-text-primary dark:text-white">{renoModes.find(m => m.id === renoMode)?.label}</span>
                                </div>
                            </div>
                            <span className={`material-symbols-outlined text-[#7f13ec] transition-transform ${isModeDropdownOpen ? 'rotate-180' : ''}`}>expand_more</span>
                        </button>
                        {isModeDropdownOpen && (
                            <div className="absolute top-full left-0 right-0 mt-2 bg-white dark:bg-[#1E1E1E] rounded-xl shadow-2xl border border-border-color dark:border-[#302839] overflow-hidden animate-fade-in p-1.5 z-50">
                                {renoModes.map((m) => (
                                    <button key={m.id} onClick={() => { handleSelectMode(m.id); setIsModeDropdownOpen(false); }} className={`w-full flex items-center gap-3 p-2 rounded-lg transition-colors text-left ${renoMode === m.id ? 'bg-[#7f13ec]/10 text-[#7f13ec]' : 'hover:bg-gray-100 dark:hover:bg-[#2A2A2A] text-text-primary dark:text-gray-200'}`}>
                                        <span className="material-symbols-outlined text-lg">{m.icon}</span>
                                        <span className="text-xs sm:text-sm font-bold">{m.label}</span>
                                        {renoMode === m.id && <span className="material-symbols-outlined text-sm ml-auto">check</span>}
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>

                    <div className="bg-gray-100 dark:bg-black/20 p-3 sm:p-4 rounded-2xl space-y-4 border border-gray-200 dark:border-white/5">
                        <label className="block text-xs sm:text-sm font-extrabold text-text-primary dark:text-white mb-2">{t('reno.step1')}</label>
                        <ImageUpload onFileSelect={(f) => onStateChange({ sourceImage: f, renovatedImages: [], maskImage: null })} previewUrl={sourceImage?.objectURL} maskPreviewUrl={maskImage?.objectURL} />
                        {sourceImage && (
                            <div className="flex gap-2">
                                <button onClick={() => setIsMaskingModalOpen(true)} className="flex-1 py-2 px-3 bg-gray-800 dark:bg-gray-700 hover:bg-black text-white rounded-lg text-[11px] sm:text-xs font-bold flex items-center justify-center gap-2">
                                    <span className="material-symbols-outlined text-sm">draw</span> {maskImage ? t('reno.edit_mask') : t('reno.draw_mask')}
                                </button>
                                {maskImage && <button onClick={() => onStateChange({ maskImage: null })} className="p-2 bg-red-500/10 text-red-500 rounded-lg hover:bg-red-500"><span className="material-symbols-outlined text-sm">delete</span></button>}
                            </div>
                        )}
                    </div>

                    <div className="bg-gray-100 dark:bg-black/20 p-3 sm:p-4 rounded-2xl space-y-4 border border-gray-200 dark:border-white/5">
                        <OptionSelector 
                            id="reno-sugg" 
                            label={t('reno.step3')} 
                            options={renovationSuggestions.map(s => ({ value: s.prompt, label: s.label }))} 
                            value={renovationSuggestions.find(s => s.prompt === prompt)?.prompt || ""} 
                            onChange={(val) => onStateChange({ prompt: val })} 
                            variant="select" 
                        />
                        <div>
                            <label className="block text-xs sm:text-sm font-extrabold text-text-primary dark:text-white mb-2">{t('reno.step4')}</label>
                            <div className="p-3 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-[#121212] shadow-inner">
                                <textarea rows={6} className="w-full bg-transparent outline-none text-xs sm:text-sm resize-none font-medium text-text-primary dark:text-white" placeholder={t('reno.prompt_placeholder')} value={prompt} onChange={(e) => onStateChange({ prompt: e.target.value })} />
                            </div>
                            <button
                                type="button"
                                onClick={handleAutoPrompt}
                                disabled={!sourceImage || isAutoPromptLoading || isLoading}
                                className="mt-2 w-full flex items-center justify-center gap-2 py-2 sm:py-2.5 rounded-lg text-[10px] sm:text-xs font-bold transition-all bg-gray-800 dark:bg-gray-700 hover:bg-black dark:hover:bg-gray-600 text-white shadow-sm disabled:bg-gray-200 dark:disabled:bg-gray-800 disabled:text-gray-400"
                            >
                                {isAutoPromptLoading ? <Spinner /> : <><span className="material-symbols-outlined text-sm sm:text-base">auto_awesome</span> <span>{t('img_gen.auto_prompt')}</span></>}
                            </button>
                        </div>
                    </div>

                    <div className="bg-gray-100 dark:bg-black/20 p-3 sm:p-4 rounded-2xl space-y-5 border border-gray-200 dark:border-white/5">
                        <label className="block text-xs sm:text-sm font-extrabold text-text-primary dark:text-white mb-2">{t('img_gen.ref_images')}</label>
                        {resolution === 'Standard' ? (
                            <div className="p-4 bg-white dark:bg-[#121212] border border-gray-200 rounded-xl flex flex-col items-center justify-center text-center gap-2 h-28 shadow-inner"><span className="material-symbols-outlined text-yellow-500 text-xl">lock</span><p className="text-[10px] text-text-secondary dark:text-gray-400 px-2 leading-tight">{t('img_gen.ref_lock')}</p><button onClick={() => onStateChange({ resolution: '1K' })} className="text-[10px] text-[#7f13ec] hover:underline font-bold uppercase">{t('img_gen.upgrade')}</button></div>
                        ) : (
                            <MultiImageUpload onFilesChange={(fs) => onStateChange({ referenceImages: fs })} maxFiles={5} />
                        )}
                        <AspectRatioSelector value={aspectRatio} onChange={(v) => onStateChange({ aspectRatio: v })} />
                        <ResolutionSelector value={resolution} onChange={(v) => onStateChange({ resolution: v })} />
                        <NumberOfImagesSelector value={numberOfImages} onChange={(v) => onStateChange({ numberOfImages: v })} />
                    </div>
                </div>
                <div className="p-4 bg-white dark:bg-[#1A1A1A] border-t border-border-color dark:border-[#302839] lg:sticky lg:bottom-0 z-10 shadow-[0_-8px_20px_rgba(0,0,0,0.05)]">
                    <button onClick={handleGenerate} disabled={isLoading || !sourceImage} className="w-full flex justify-center items-center gap-2 bg-[#7f13ec] hover:bg-[#690fca] text-white font-bold py-3 sm:py-4 rounded-xl transition-all shadow-lg active:scale-95 text-sm sm:text-base">
                        {isLoading ? <><Spinner /> <span>{statusMessage}</span></> : <><span>{t('reno.btn_generate')} <span className="opacity-70 ml-1">| {cost}</span></span> <span className="material-symbols-outlined text-yellow-400 text-base sm:text-lg align-middle notranslate">monetization_on</span></>}
                    </button>
                </div>
            </aside>
            <main className="flex-1 flex flex-col bg-white dark:bg-[#1A1A1A] border border-border-color dark:border-[#302839] rounded-2xl shadow-sm overflow-hidden min-h-[400px] sm:min-h-[500px] lg:h-[calc(100vh-130px)] lg:sticky lg:top-[120px]">
                <div className="flex flex-col h-full overflow-hidden">
                    <div className="flex-1 bg-gray-100 dark:bg-[#121212] relative overflow-hidden flex items-center justify-center min-h-[300px]">
                        {renovatedImages.length > 0 ? (
                            <div className="w-full h-full p-2 animate-fade-in flex flex-col items-center justify-center relative">
                                <div className="w-full h-full flex items-center justify-center overflow-hidden">{sourceImage ? <ImageComparator originalImage={sourceImage.objectURL} resultImage={renovatedImages[selectedIndex]} /> : <img src={renovatedImages[selectedIndex]} alt="Result" className="max-w-full max-h-full object-contain" />}</div>
                                <div className="absolute top-4 right-4 flex flex-col gap-2 z-10">
                                    <button onClick={handleDownload} className="group/btn relative p-1.5 sm:p-2 bg-white/90 dark:bg-black/50 rounded-xl shadow-lg hover:text-blue-600 transition-all backdrop-blur-sm border border-white/20"><span className="material-symbols-outlined text-base sm:text-lg notranslate">download</span></button>
                                    <button onClick={() => setPreviewImage(renovatedImages[selectedIndex])} className="group/btn relative p-1.5 sm:p-2 bg-white/90 dark:bg-black/50 rounded-xl shadow-lg hover:text-green-600 transition-all backdrop-blur-sm border border-white/20"><span className="material-symbols-outlined text-base sm:text-lg notranslate">zoom_in</span></button>
                                </div>
                            </div>
                        ) : (
                            <div className="w-full h-full flex flex-col items-center justify-center opacity-20 select-none bg-main-bg dark:bg-[#121212] p-8 text-center"><span className="material-symbols-outlined text-4xl sm:text-6xl mb-4">home_work</span><p className="text-sm sm:text-base font-medium">{t('msg.no_result_render')}</p></div>
                        )}
                        {isLoading && (
                            <div className="absolute inset-0 bg-[#121212]/80 backdrop-blur-sm z-20 flex flex-col items-center justify-center p-6 text-center"><Spinner /><p className="text-white mt-4 font-bold animate-pulse text-sm sm:text-base">{statusMessage}</p></div>
                        )}
                    </div>
                    {renovatedImages.length > 0 && !isLoading && (
                        <div className="flex-shrink-0 w-full p-2 bg-white dark:bg-[#1A1A1A] border-t border-border-color dark:border-[#302839]"><div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide justify-center items-center">{renovatedImages.map((url, idx) => (<button key={url} onClick={() => setSelectedIndex(idx)} className={`flex-shrink-0 w-12 sm:w-16 md:w-20 aspect-square rounded-lg border-2 transition-all overflow-hidden ${selectedIndex === idx ? 'border-[#7f13ec] ring-2 ring-purple-500/20 scale-105' : 'border-transparent opacity-60 hover:opacity-100'}`}><img src={url} className="w-full h-full object-cover" alt={`Result ${idx + 1}`} /></button>))}</div></div>
                    )}
                </div>
            </main>
        </div>
    );
};

export default Renovation;
