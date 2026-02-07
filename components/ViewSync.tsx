
import React, { useState, useRef, useEffect, useMemo } from 'react';
import * as geminiService from '../services/geminiService';
import * as historyService from '../services/historyService';
import * as jobService from '../services/jobService';
import * as externalVideoService from '../services/externalVideoService';
import { FileData, Tool, AspectRatio, ImageResolution } from '../types';
import { ViewSyncState } from '../state/toolState';
import { refundCredits } from '../services/paymentService';
import { supabase } from '../services/supabaseClient';
import Spinner from './Spinner';
import ImageUpload from './common/ImageUpload';
import AspectRatioSelector from './common/AspectRatioSelector';
import OptionSelector from './common/OptionSelector';
import ResolutionSelector from './common/ResolutionSelector';
import NumberOfImagesSelector from './common/NumberOfImagesSelector';
import SafetyWarningModal from './common/SafetyWarningModal';
import ImagePreviewModal from './common/ImagePreviewModal';
import ImageComparator from './ImageComparator';
import { useLanguage } from '../hooks/useLanguage';

interface ViewSyncProps {
    state: ViewSyncState;
    onStateChange: (newState: Partial<ViewSyncState>) => void;
    userCredits?: number;
    onDeductCredits?: (amount: number, description: string) => Promise<string>;
    onInsufficientCredits?: () => void;
}

interface CreativeSlot {
    id: string;
    name: string;
    icon: string;
    sub?: string;
    action?: string;
    promptDescription?: string;
    groupType?: 'overall' | 'closeup' | 'focused';
}

const ViewSync: React.FC<ViewSyncProps> = ({ state, onStateChange, userCredits = 0, onDeductCredits, onInsufficientCredits }) => {
    const { t, language } = useLanguage();
    const {
        sourceImage, directionImage, characterImage, isLoading, error, resultImages, numberOfImages, sceneType,
        aspectRatio, customPrompt, selectedPerspective, selectedAtmosphere,
        selectedFraming, selectedInteriorAngle, resolution,
        activeTab = 'sync', creativeOption = 'interior', creativeResults = {}, creativePrompts = {}
    } = state;

    const [statusMessage, setStatusMessage] = useState<string | null>(null);
    const [showSafetyModal, setShowSafetyModal] = useState(false);
    const [previewImage, setPreviewImage] = useState<string | null>(null);
    const [isDownloading, setIsDownloading] = useState(false);
    const [selectedIndex, setSelectedIndex] = useState(0);
    
    const [isCreativeModeSelected, setIsCreativeModeSelected] = useState(false);
    const [generatingViews, setGeneratingViews] = useState<Set<string>>(new Set());
    const [analyzingViews, setAnalyzingViews] = useState<Set<string>>(new Set());
    const [isBatchGenerating, setIsBatchGenerating] = useState(false);

    const [isModeDropdownOpen, setIsModeDropdownOpen] = useState(false);
    const modeDropdownRef = useRef<HTMLDivElement>(null);

    const latestResultsRef = useRef(creativeResults);
    useEffect(() => { latestResultsRef.current = creativeResults; }, [creativeResults]);

    const latestPromptsRef = useRef(creativePrompts);
    useEffect(() => { latestPromptsRef.current = creativePrompts; }, [creativePrompts]);

    useEffect(() => {
        if (resultImages.length > 0) setSelectedIndex(0);
    }, [resultImages.length]);

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (modeDropdownRef.current && !modeDropdownRef.current.contains(event.target as Node)) {
                setIsModeDropdownOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    // --- OPTIONS FOR SYNC TAB ---
    const perspectiveAngles = useMemo(() => [
        { id: 'default', label: t('sync.angle.default'), promptClause: "the same general perspective as the source image" },
        { id: 'front', label: t('sync.angle.front'), promptClause: "Straight-on front elevation view, symmetrical composition. Flat facade focusing on geometric shapes and materials." },
        { id: 'left-side', label: t('sync.angle.left'), promptClause: "a 3/4 perspective view from the front-left, showing depth and dimension of the building massing." },
        { id: 'right-side', label: t('sync.angle.right'), promptClause: "a 3/4 perspective view from the front-right, showing both the front and right facades" },
        { id: 'wide-frame', label: t('sync.angle.wide'), promptClause: "Wide-angle shot capturing the building within its surrounding context and landscape. Spacious atmosphere, expanded field of view." },
        { id: 'panoramic', label: t('sync.angle.pano'), promptClause: "Panoramic view, ultra-wide horizontal composition. Cinematic wide shot." },
        { id: 'top-down', label: t('sync.angle.topdown'), promptClause: "Aerial bird's-eye view looking down from above. Drone photography showing the site layout." },
        { id: 'low-angle', label: t('sync.angle.low'), promptClause: "Low angle worm's-eye view looking up at the building. Imposing stature." },
        { id: 'close-up', label: t('sync.angle.closeup'), promptClause: "Macro close-up shot of architectural details. Focus on textures and materials." },
    ], [t]);

    const atmosphericAngles = useMemo(() => [
        { id: 'default', label: t('sync.atm.default'), promptClause: "with standard daylight lighting" },
        { id: 'early-morning', label: t('sync.atm.morning'), promptClause: "in the early morning, with soft, gentle sunrise light and long shadows" },
        { id: 'midday-sun', label: t('sync.atm.midday'), promptClause: "at midday under bright, direct sunlight with strong, short shadows" },
        { id: 'late-afternoon', label: t('sync.atm.sunset'), promptClause: "during the late afternoon (golden hour), with warm, orange-hued light and dramatic shadows" },
        { id: 'night', label: t('sync.atm.night'), promptClause: "at night, with interior and exterior lights turned on" },
        { id: 'rainy', label: t('sync.atm.rainy'), promptClause: "during a gentle rain, with wet surfaces and a slightly overcast sky" },
        { id: 'misty', label: t('sync.atm.misty'), promptClause: "on a misty or foggy morning, creating a soft atmosphere" },
        { id: 'after-rain', label: t('sync.atm.after_rain'), promptClause: "just after a rain shower, with wet ground reflecting the sky" },
    ], [t]);

    const framingAngles = useMemo(() => [
        { id: 'none', label: t('sync.frame.none'), promptClause: "" },
        { id: 'through-trees', label: t('sync.frame.trees'), promptClause: "Seen through a foreground of trees or foliage, creating a natural framing effect." },
        { id: 'through-window', label: t('sync.frame.window'), promptClause: "Seen from inside a room looking out through a large glass window frame." },
        { id: 'through-flowers', label: t('sync.frame.flowers'), promptClause: "Viewed through a foreground of colorful flowers, soft framing effect." },
        { id: 'through-car-window', label: t('sync.frame.car'), promptClause: "Seen from the perspective of looking out from a car parked nearby." },
    ], [t]);

    const interiorViewAngles = useMemo(() => [
        { id: 'default', label: t('sync.int.default'), prompt: "Maintain the same camera perspective as the source image." },
        { id: 'wide-angle', label: t('sync.int.wide'), prompt: "Generate a wide-angle view of the interior space, capturing as much of the room as possible." },
        { id: 'from-corner', label: t('sync.int.corner'), prompt: "Generate a view from a corner of the room, looking towards the center." },
        { id: 'detail-shot', label: t('sync.int.detail'), prompt: "Generate a close-up detail shot of a key furniture piece or decorative element." },
        { id: 'towards-window', label: t('sync.int.window'), prompt: "Generate a view from inside the room looking towards the main window." },
        { id: 'night-view', label: t('sync.int.night'), prompt: "Generate a view of the interior space at night, with artificial lighting turned on." },
        { id: 'top-down-interior', label: t('sync.int.topdown'), prompt: "Generate a top-down view of the room's layout, similar to a 3D floor plan." },
    ], [t]);

    // --- CREATIVE MODE SLOTS ---
    const creativeOptions = useMemo(() => [
        { id: 'interior', label: t('sync.creative.opt.interior'), icon: 'chair', desc: t('sync.creative.opt.interior_desc'), longDesc: t('sync.creative.opt.interior_long'), bg: 'https://images.unsplash.com/photo-1618221195710-dd6b41faaea6?q=80&w=800&auto=format&fit=crop' },
        { id: 'architecture', label: t('sync.creative.opt.arch'), icon: 'apartment', desc: t('sync.creative.opt.arch_desc'), longDesc: t('sync.creative.opt.arch_long'), bg: 'https://mtlomjjlgvsjpudxlspq.supabase.co/storage/v1/object/public/background-imgs/view-sync-exterior.jpeg' },
        { id: 'interior-from-arch', label: t('sync.creative.opt.int_from_arch'), icon: 'foundation', desc: t('sync.creative.opt.int_from_arch_desc'), longDesc: t('sync.creative.opt.int_from_arch_long'), bg: 'https://mtlomjjlgvsjpudxlspq.supabase.co/storage/v1/object/public/background-imgs/arch-to-in.jpeg' },
        { id: 'marketing-showcase', label: t('sync.creative.opt.marketing'), icon: 'stars', desc: t('sync.creative.opt.marketing_desc'), longDesc: t('sync.creative.opt.marketing_long'), bg: 'https://images.unsplash.com/photo-1554995207-c18c203602cb?q=80&w=800&auto=format&fit=crop' }
    ], [t]);

    const interiorSlots: CreativeSlot[] = useMemo(() => [
        { id: 'living_room', name: t('sync.creative.slot.living_room'), icon: 'chair', action: t('sync.creative.action.living_room') },
        { id: 'bedroom', name: t('sync.creative.slot.bedroom'), icon: 'bed', action: t('sync.creative.action.bedroom') },
        { id: 'kitchen', name: t('sync.creative.slot.kitchen'), icon: 'kitchen', action: t('sync.creative.action.kitchen') },
        { id: 'dining', name: t('sync.creative.slot.dining'), icon: 'dining', action: t('sync.creative.action.dining') },
        { id: 'reading', name: t('sync.creative.slot.reading'), icon: 'menu_book', action: t('sync.creative.action.reading') },
        { id: 'bathroom', name: t('sync.creative.slot.bathroom'), icon: 'bathtub', action: t('sync.creative.action.bathroom') },
        { id: 'corridor', name: t('sync.creative.slot.corridor'), icon: 'door_sliding', action: t('sync.creative.action.corridor') },
        { id: 'closeup', name: t('sync.creative.slot.closeup'), icon: 'center_focus_strong', action: t('sync.creative.action.closeup') },
        { id: 'balcony', name: t('sync.creative.slot.balcony'), icon: 'deck', action: t('sync.creative.action.balcony') }
    ], [t]);

    const architectureSlots: CreativeSlot[] = useMemo(() => [
        { id: 'pano1', name: t('sync.creative.slot.pano1'), sub: t('sync.creative.sub.sunrise'), icon: 'wb_twilight', promptDescription: t('sync.creative.desc.pano1') },
        { id: 'pano2', name: t('sync.creative.slot.pano2'), sub: t('sync.creative.sub.sunset'), icon: 'wb_sunny', promptDescription: t('sync.creative.desc.pano2') },
        { id: 'pano3', name: t('sync.creative.slot.pano3'), sub: t('sync.creative.sub.birdseye'), icon: 'flight', promptDescription: t('sync.creative.desc.pano3') },
        { id: 'close1', name: t('sync.creative.slot.close1'), sub: t('sync.creative.sub.material'), icon: 'texture', promptDescription: t('sync.creative.desc.close1') },
        { id: 'close2', name: t('sync.creative.slot.close2'), sub: t('sync.creative.sub.structure'), icon: 'construction', promptDescription: t('sync.creative.desc.close2') },
        { id: 'close3', name: t('sync.creative.slot.close3'), sub: t('sync.creative.sub.entrance'), icon: 'door_front', promptDescription: t('sync.creative.desc.close3') },
        { id: 'close4', name: t('sync.creative.slot.close4'), sub: t('sync.creative.sub.corner'), icon: 'camera_alt', promptDescription: t('sync.creative.desc.close4') },
        { id: 'art1', name: t('sync.creative.slot.art1'), sub: t('sync.creative.sub.bokeh'), icon: 'blur_on', promptDescription: t('sync.creative.desc.art1') },
        { id: 'art2', name: t('sync.creative.slot.art2'), sub: t('sync.creative.sub.night'), icon: 'nights_stay', promptDescription: t('sync.creative.desc.art2') }
    ], [t]);

    const marketingSlots: CreativeSlot[] = useMemo(() => [
        { id: 'mkt_over1', name: "TỔNG THỂ 1", sub: "Hero Shot 3/4 front", icon: 'home', promptDescription: t('sync.creative.desc.mkt_over1'), groupType: 'overall' },
        { id: 'mkt_over2', name: "TỔNG THỂ 2", sub: "Aerial Bird's Eye 45 deg", icon: 'flight_takeoff', promptDescription: t('sync.creative.desc.mkt_over2'), groupType: 'overall' },
        { id: 'mkt_over3', name: "TỔNG THỂ 3", sub: "Low Angle wide-lens", icon: 'flight_land', promptDescription: t('sync.creative.desc.mkt_over3'), groupType: 'overall' },
        { id: 'mkt_close1', name: "CẬN CẢNH 1", sub: "Structural intersections", icon: 'construction', promptDescription: t('sync.creative.desc.mkt_close1'), groupType: 'closeup' },
        { id: 'mkt_close2', name: "CẬN CẢNH 2", sub: "Decor arrangement", icon: 'chair', promptDescription: t('sync.creative.desc.mkt_close2'), groupType: 'closeup' },
        { id: 'mkt_close3', name: "CẬN CẢNH 3", sub: "Material study", icon: 'texture', promptDescription: t('sync.creative.desc.mkt_close3'), groupType: 'closeup' },
        { id: 'mkt_focus1', name: "LẤY NÉT 1", sub: "Artistic Macro Focus", icon: 'center_focus_strong', promptDescription: t('sync.creative.desc.mkt_focus1'), groupType: 'focused' },
        { id: 'mkt_focus2', name: "LẤY NÉT 2", sub: "Foreground Bokeh", icon: 'blur_on', promptDescription: t('sync.creative.desc.mkt_focus2'), groupType: 'focused' },
        { id: 'mkt_focus3', name: "LẤY NÉT 3", sub: "Light & Shadow play", icon: 'wb_sunny', promptDescription: t('sync.creative.desc.mkt_focus3'), groupType: 'focused' }
    ], [t]);

    const currentSlots = useMemo(() => {
        if (creativeOption === 'architecture') return architectureSlots;
        if (creativeOption === 'marketing-showcase') return marketingSlots;
        return interiorSlots;
    }, [creativeOption, architectureSlots, interiorSlots, marketingSlots]);

    const getPromptTemplateForSlot = (slot: CreativeSlot, option: string, charFile: FileData | null) => {
        const isVi = language === 'vi';
        
        if (option === 'architecture') {
            const viewDescription = slot.promptDescription || slot.name;
            const charPrompt = charFile ? (isVi ? "\n\n• Đưa nhân vật vào bối cảnh một cách tự nhiên." : "\n\n• Naturally integrate the character.") : "";
            if (isVi) {
                return `Ảnh chụp kiến trúc chuyên nghiệp, giữ nguyên 100% hình khối và vật liệu từ mẫu. Tuyệt đối không thêm chi tiết mới. Góc nhìn: ${viewDescription}.${charPrompt} Định dạng 8k sắc nét.`;
            } else {
                 return `Professional architectural photo. Keep 100% massing and materials. No new details. View: ${viewDescription}.${charPrompt} 8k resolution.`;
            }
        } else if (option === 'interior-from-arch') {
            const charPrompt = charFile ? (isVi ? "\n\n• Có thêm nhân vật đang sinh hoạt." : "\n\n• Include active character.") : "";
            if (isVi) {
                return `Thiết kế nội thất bên trong công trình này. Đảm bảo đồng nhất hoàn toàn với phong cách, hệ cửa và vật liệu ngoại thất gốc. Không gian: ${slot.name}.${charPrompt} Ảnh nội thất chuyên nghiệp 8k.`;
            } else {
                 return `Design interior matching this exterior. Perfect consistency with original style, window frames, and materials. Space: ${slot.name}.${charPrompt} 8k interior photo.`;
            }
        } else if (option === 'interior') {
            const action = slot.action || (isVi ? "đang sinh hoạt" : "active");
            const charPrompt = charFile ? (isVi ? `\n\n• Thêm nhân vật ${action}.` : `\n\n• Add character ${action}.`) : "";
            if (isVi) {
                return `Ảnh chụp nội thất của một không gian khác trong cùng ngôi nhà. Giữ nguyên phong cách, bảng màu và vật liệu gốc. Không gian: ${slot.name}.${charPrompt} Ảnh 8k chuyên nghiệp.`;
            } else {
                return `Interior photo of another room in the same house. Maintain identical style, palette, and materials. Space: ${slot.name}.${charPrompt} 8k professional photo.`;
            }
        }
        return slot.name;
    };

    const getFullPromptWithHiddenBoilerplate = (editablePrompt: string) => {
        const isVi = language === 'vi';
        const prefix = isVi ? "Ảnh chụp tạp chí kiến trúc chuyên nghiệp. Giữ 100% phong cách thiết kế gốc. " : "Professional architectural magazine photography. Maintain 100% original style. ";
        const suffix = isVi ? " QUAN TRỌNG: Chỉ tạo MỘT hình ảnh duy nhất chiếm toàn bộ khung hình." : " IMPORTANT: Generate one single, unified, full-frame image.";
        return `${prefix}${editablePrompt}${suffix}`;
    };

    const handleSelectCreativeOption = (optionId: string) => { 
        const newPrompts: Record<string, string> = {};
        if (optionId !== 'marketing-showcase') {
            const slots = optionId === 'architecture' ? architectureSlots : (optionId === 'interior' ? interiorSlots : interiorSlots);
            slots.forEach(slot => { 
                newPrompts[slot.id] = getPromptTemplateForSlot(slot, optionId, characterImage); 
            });
        }
        onStateChange({ creativeOption: optionId as any, creativeResults: {}, creativePrompts: newPrompts }); 
        setIsCreativeModeSelected(true); 
    };

    useEffect(() => {
        if (activeTab === 'creative' && creativeOption !== 'marketing-showcase') {
            const newPrompts = { ...creativePrompts };
            currentSlots.forEach(slot => {
                newPrompts[slot.id] = getPromptTemplateForSlot(slot, creativeOption, characterImage);
            });
            onStateChange({ creativePrompts: newPrompts });
        }
    }, [characterImage, creativeOption, activeTab, language]);

    // --- GENERATION LOGIC ---
    const handleGenerateSync = async () => {
        const unitCost = resolution === '4K' ? 30 : resolution === '2K' ? 20 : resolution === '1K' ? 10 : 5;
        const totalCost = numberOfImages * unitCost;
        if (onDeductCredits && userCredits < totalCost) { if (onInsufficientCredits) onInsufficientCredits(); return; }
        if (!sourceImage) { onStateChange({ error: t('err.input.image') }); return; }

        onStateChange({ isLoading: true, error: null, resultImages: [] });
        setStatusMessage(t('common.processing'));
        let logId: string | null = null;
        let jobId: string | null = null;

        try {
            if (onDeductCredits) logId = await onDeductCredits(totalCost, `Đồng bộ view (${numberOfImages} ảnh) - ${resolution}`);
            const { data: { user } } = await supabase.auth.getUser();
            if (user && logId) { jobId = await jobService.createJob({ user_id: user.id, tool_id: Tool.ViewSync, prompt: customPrompt || 'Synced view rendering', cost: totalCost, usage_log_id: logId }); }
            if (jobId) await jobService.updateJobStatus(jobId, 'processing');

            const promptParts = [];
            const atmosphere = atmosphericAngles.find(a => a.id === selectedAtmosphere);
            const framing = framingAngles.find(f => f.id === selectedFraming);

            if (sceneType === 'interior') {
                const interiorAngle = interiorViewAngles.find(a => a.id === selectedInteriorAngle);
                if (interiorAngle && interiorAngle.id !== 'default') promptParts.push(interiorAngle.prompt);
            } else {
                const perspective = perspectiveAngles.find(p => p.id === selectedPerspective);
                if (perspective && perspective.id !== 'default') promptParts.push(`${perspective.promptClause}`);
            }

            if (framing && framing.id !== 'none') promptParts.push(framing.promptClause);
            if (atmosphere && atmosphere.id !== 'default') promptParts.push(`Render it ${atmosphere.promptClause}`);
            if (customPrompt) promptParts.push(customPrompt);

            let finalPrompt = promptParts.length > 0 ? `Based on the design in the reference image, ${promptParts.join(', ')}.` : "Enhance the quality and clarity of this view. Maintain the exact same architectural style.";
            const singleImageSuffix = language === 'vi' ? " QUAN TRỌNG: Chỉ tạo MỘT hình ảnh duy nhất chiếm toàn bộ khung hình." : " IMPORTANT: Generate one single, unified, full-frame image.";
            finalPrompt += ` Preserving all original details and materials. Photorealistic photography.${singleImageSuffix}`;
            
            const modelName = resolution === 'Standard' ? "GEM_PIX" : "GEM_PIX_2";
            const collectedUrls: string[] = [];
            const inputImages: FileData[] = [sourceImage];
            if (directionImage) inputImages.push(directionImage);

            const promises = Array.from({ length: numberOfImages }).map(async (_, index) => {
                const result = await externalVideoService.generateFlowImage(finalPrompt, inputImages, aspectRatio, 1, modelName);
                if (result.imageUrls?.[0]) {
                    let finalUrl = result.imageUrls[0];
                    if ((resolution === '2K' || resolution === '4K') && result.mediaIds?.[0]) {
                        const targetRes = resolution === '4K' ? 'UPSAMPLE_IMAGE_RESOLUTION_4K' : 'UPSAMPLE_IMAGE_RESOLUTION_2K';
                        const upscaleRes = await externalVideoService.upscaleFlowImage(result.mediaIds[0], result.projectId, targetRes, aspectRatio);
                        if (upscaleRes?.imageUrl) finalUrl = upscaleRes.imageUrl;
                    }
                    collectedUrls.push(finalUrl);
                    onStateChange({ resultImages: [...collectedUrls] });
                    historyService.addToHistory({ tool: Tool.ViewSync, prompt: `Sync: ${finalPrompt}`, sourceImageURL: sourceImage.objectURL, resultImageURL: finalUrl });
                    return finalUrl;
                }
                return null;
            });

            const results = await Promise.all(promises);
            const successfulUrls = results.filter((url): url is string => url !== null);
            if (successfulUrls.length > 0) { if (jobId) await jobService.updateJobStatus(jobId, 'completed', successfulUrls[0]); }
        } catch (err: any) {
            onStateChange({ error: t('err.gen.general') });
            if (jobId) await jobService.updateJobStatus(jobId, 'failed', undefined, err.message);
        } finally { onStateChange({ isLoading: false }); setStatusMessage(null); }
    };

    const handleGenerateBatch = async () => {
        if (isBatchGenerating || generatingViews.size > 0 || analyzingViews.size > 0) return;
        
        const cost = currentSlots.length * (resolution === '4K' ? 30 : resolution === '2K' ? 20 : resolution === '1K' ? 10 : 5);
        if (onDeductCredits && userCredits < cost) { if (onInsufficientCredits) onInsufficientCredits(); return; }
        if (!sourceImage) return;
        
        onStateChange({ error: null });
        setIsBatchGenerating(true);

        try {
            if (onDeductCredits) await onDeductCredits(cost, `Creative Batch: ${currentSlots.length} views`);
            
            if (creativeOption === 'marketing-showcase') {
                const allKeys = currentSlots.map(s => getResultKey(creativeOption, s.id));
                allKeys.forEach(k => setAnalyzingViews(prev => new Set(prev).add(k)));
                
                const accumulator: Record<string, string> = { ...creativePrompts };
                for (const slot of currentSlots) {
                    const key = getResultKey(creativeOption, slot.id);
                    if (!accumulator[slot.id]) {
                        try {
                            const p = await geminiService.generateCreativeViewPrompt(sourceImage, slot.name, creativeOption, language);
                            accumulator[slot.id] = p;
                            onStateChange({ creativePrompts: { ...accumulator } });
                        } catch (e) {
                            accumulator[slot.id] = language === 'vi' ? `Góc nhìn ${slot.name}.` : `View of ${slot.name}.`;
                            onStateChange({ creativePrompts: { ...accumulator } });
                        }
                    }
                    setAnalyzingViews(prev => { const n = new Set(prev); n.delete(key); return n; });
                    await handleGenerateSingleView(slot, true);
                }
            } else {
                const finalPrompts = { ...creativePrompts };
                currentSlots.forEach(slot => {
                    if (!finalPrompts[slot.id]) {
                        finalPrompts[slot.id] = getPromptTemplateForSlot(slot, creativeOption, characterImage);
                    }
                });
                if (Object.keys(finalPrompts).length > Object.keys(creativePrompts).length) {
                    onStateChange({ creativePrompts: finalPrompts });
                }
                
                await Promise.all(currentSlots.map(slot => handleGenerateSingleView(slot, true)));
            }
        } catch (err: any) { 
            onStateChange({ error: t('err.gen.general') }); 
        } finally { 
            setIsBatchGenerating(false); 
        }
    };

       const handleGenerateSingleView = async (slot: CreativeSlot, skipCredits = false) => {
        if (!sourceImage) return;

        const uniqueKey = getResultKey(creativeOption, slot.id);
        const cost = resolution === '4K' ? 30 : resolution === '2K' ? 20 : resolution === '1K' ? 10 : 5;
        if (!skipCredits && onDeductCredits && userCredits < cost) { if (onInsufficientCredits) onInsufficientCredits(); return; }
        
        setGeneratingViews(prev => new Set(prev).add(uniqueKey));
        try {
            const currentPromptValue = latestPromptsRef.current[slot.id] || getPromptTemplateForSlot(slot, creativeOption, characterImage);
            if (!skipCredits && onDeductCredits) await onDeductCredits(cost, `Creative View: ${slot.name}`);
            const finalPrompt = getFullPromptWithHiddenBoilerplate(currentPromptValue);
            const modelName = resolution === 'Standard' ? "GEM_PIX" : "GEM_PIX_2";
            const inputImages: FileData[] = [sourceImage];
            if (characterImage) inputImages.push(characterImage);
            
            const result = await externalVideoService.generateFlowImage(finalPrompt, inputImages, aspectRatio, 1, modelName);
            if (result.imageUrls?.[0]) {
                let finalUrl = result.imageUrls[0];
                if ((resolution === '2K' || resolution === '4K') && result.mediaIds?.[0]) {
                    const targetRes = resolution === '4K' ? 'UPSAMPLE_IMAGE_RESOLUTION_4K' : 'UPSAMPLE_IMAGE_RESOLUTION_2K';
                    const upscaleRes = await externalVideoService.upscaleFlowImage(result.mediaIds[0], result.projectId, targetRes, aspectRatio);
                    if (upscaleRes?.imageUrl) finalUrl = upscaleRes.imageUrl;
                }
                onStateChange({ creativeResults: { ...latestResultsRef.current, [uniqueKey]: finalUrl } });
                historyService.addToHistory({ tool: Tool.ViewSync, prompt: `Creative: ${slot.name}`, sourceImageURL: sourceImage?.objectURL, resultImageURL: finalUrl });
            }
        } catch (e) { console.error(e); } finally { setGeneratingViews(prev => { const n = new Set(prev); n.delete(uniqueKey); return n; }); }
    };

    const getResultKey = (option: string, slotId: string) => `${option}-${slotId}`;
    const handleBackToSelection = () => setIsCreativeModeSelected(false);
    const handleResolutionChange = (val: ImageResolution) => onStateChange({ resolution: val });
    const handlePreview = (url: string) => setPreviewImage(url);
    const handleDownload = async (url: string, name: string) => { setIsDownloading(true); await externalVideoService.forceDownload(url, `creative-${name}.png`); setIsDownloading(false); };
    const handleDownloadAllCreative = async () => { setIsDownloading(true); for (const slot of currentSlots) { const url = creativeResults[getResultKey(creativeOption, slot.id)]; if (url) { await externalVideoService.forceDownload(url, `${slot.name}.png`); await new Promise(r => setTimeout(r, 800)); } } setIsDownloading(false); };

    const selectedOptionData = creativeOptions.find(o => o.id === creativeOption);
    const hasCreativeResults = currentSlots.some(s => !!creativeResults[getResultKey(creativeOption, s.id)]);

    return (
        <div className="flex flex-col gap-0 w-full lg:-mt-6">
            <SafetyWarningModal isOpen={showSafetyModal} onClose={() => setShowSafetyModal(false)} />
            {previewImage && <ImagePreviewModal imageUrl={previewImage} onClose={() => setPreviewImage(null)} />}
            
            <div className="flex justify-center mb-2 sm:mb-4 px-2">
                <div className="bg-gray-100 dark:bg-black/30 p-0.5 rounded-full inline-flex border border-gray-200 dark:border-white/10 w-full sm:w-auto">
                    <button onClick={() => onStateChange({ activeTab: 'sync' })} className={`flex-1 sm:flex-none px-4 sm:px-8 py-2 rounded-full text-xs sm:text-sm font-bold transition-all ${activeTab === 'sync' ? 'bg-white dark:bg-[#7f13ec] text-black dark:text-white shadow-sm' : 'text-gray-500 dark:text-gray-400'}`}>{t('sync.tab.sync')}</button>
                    <button onClick={() => onStateChange({ activeTab: 'creative' })} className={`flex-1 sm:flex-none px-4 sm:px-8 py-2 rounded-full text-xs sm:text-sm font-bold transition-all ${activeTab === 'creative' ? 'bg-white dark:bg-[#7f13ec] text-black dark:text-white shadow-sm' : 'text-gray-500 dark:text-gray-400'}`}>{t('sync.tab.creative')}</button>
                </div>
            </div>

            {/* --- TAB: SYNC --- */}
            {activeTab === 'sync' && (
                <div className="flex flex-col lg:flex-row gap-4 sm:gap-6 md:gap-8 w-full max-w-full items-stretch px-2 sm:px-4 animate-fade-in">
                    <aside className="w-full lg:w-[350px] xl:w-[380px] flex-shrink-0 flex flex-col bg-white dark:bg-[#1A1A1A] border border-border-color dark:border-[#302839] rounded-2xl shadow-sm relative overflow-hidden lg:h-[calc(100vh-130px)] lg:sticky lg:top-[120px]">
                        <div className="p-3 space-y-4 flex-1 lg:overflow-y-auto overflow-x-hidden">
                            <div className="bg-gray-100 dark:bg-black/20 p-4 rounded-2xl space-y-3 border border-gray-200 dark:border-white/5">
                                <label className="block text-xs sm:text-sm font-extrabold text-text-primary dark:text-white mb-2">{t('sync.step1')}</label>
                                <ImageUpload onFileSelect={(f) => onStateChange({ sourceImage: f, resultImages: [] })} previewUrl={sourceImage?.objectURL} />
                            </div>

                            <div className="bg-gray-100 dark:bg-black/20 p-4 rounded-2xl space-y-4 border border-gray-200 dark:border-white/5">
                                <label className="block text-xs sm:text-sm font-extrabold text-text-primary dark:text-white mb-2">{t('sync.step2')}</label>
                                <div className="flex bg-white dark:bg-[#121212] p-1 rounded-xl border border-gray-200 dark:border-[#302839]">
                                    <button onClick={() => onStateChange({ sceneType: 'exterior' })} className={`flex-1 py-1.5 rounded-lg text-[10px] sm:text-xs font-bold transition-colors ${sceneType === 'exterior' || !sceneType ? 'bg-[#7f13ec] text-white shadow' : 'text-gray-400'}`}>{t('sync.scene.ext')}</button>
                                    <button onClick={() => onStateChange({ sceneType: 'interior' })} className={`flex-1 py-1.5 rounded-lg text-[10px] sm:text-xs font-bold transition-colors ${sceneType === 'interior' ? 'bg-[#7f13ec] text-white shadow' : 'text-gray-400'}`}>{t('sync.scene.int')}</button>
                                </div>
                                <div className="space-y-3">
                                    {(sceneType === 'exterior' || !sceneType) ? (
                                        <OptionSelector id="perspective" label={t('sync.angle.ext')} options={perspectiveAngles.map(a => ({ value: a.id, label: a.label }))} value={selectedPerspective} onChange={(val) => onStateChange({ selectedPerspective: val })} variant="select" disabled={isLoading} />
                                    ) : (
                                        <OptionSelector id="interior-angle" label={t('sync.angle.int')} options={interiorViewAngles.map(a => ({ value: a.id, label: a.label }))} value={selectedInteriorAngle} onChange={(val) => onStateChange({ selectedInteriorAngle: val })} variant="select" disabled={isLoading} />
                                    )}
                                    <div className="grid grid-cols-2 gap-2">
                                        <OptionSelector id="framing" label={t('sync.framing')} options={framingAngles.map(a => ({ value: a.id, label: a.label }))} value={selectedFraming} onChange={(val) => onStateChange({ selectedFraming: val })} variant="select" disabled={isLoading} />
                                        <OptionSelector id="atmosphere" label={t('sync.atmosphere')} options={atmosphericAngles.map(a => ({ value: a.id, label: a.label }))} value={selectedAtmosphere} onChange={(val) => onStateChange({ selectedAtmosphere: val })} variant="select" disabled={isLoading} />
                                    </div>
                                </div>
                                <div className="p-3 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-[#121212] shadow-inner">
                                    <textarea rows={4} className="w-full bg-transparent outline-none text-xs sm:text-sm resize-none font-medium text-text-primary dark:text-white" placeholder={t('sync.prompt_placeholder')} value={customPrompt} onChange={(e) => onStateChange({ customPrompt: e.target.value })} />
                                </div>
                            </div>

                            <div className="bg-gray-100 dark:bg-black/20 p-4 rounded-2xl space-y-5 border border-gray-200 dark:border-white/5">
                                <AspectRatioSelector value={aspectRatio} onChange={(val) => onStateChange({ aspectRatio: val })} />
                                <ResolutionSelector value={resolution} onChange={handleResolutionChange} />
                                <NumberOfImagesSelector value={numberOfImages} onChange={(val) => onStateChange({ numberOfImages: val })} />
                            </div>
                        </div>
                        <div className="p-4 bg-white dark:bg-[#1A1A1A] border-t border-border-color dark:border-[#302839] lg:sticky lg:bottom-0 z-10 shadow-[0_-8px_20px_rgba(0,0,0,0.05)]">
                            <button onClick={handleGenerateSync} disabled={isLoading || !sourceImage} className="w-full flex justify-center items-center gap-2 bg-[#7f13ec] hover:bg-[#690fca] text-white font-bold py-3 sm:py-4 rounded-xl transition-all shadow-lg active:scale-95 text-sm sm:text-base">
                                {isLoading ? <><Spinner /> <span>{statusMessage}</span></> : <><span>{t('sync.btn_generate')}</span> <span className="material-symbols-outlined text-yellow-400 text-base sm:text-lg align-middle notranslate">monetization_on</span></>}
                            </button>
                        </div>
                    </aside>
                    <main className="flex-1 flex flex-col bg-white dark:bg-[#1A1A1A] border border-border-color dark:border-[#302839] rounded-2xl shadow-sm overflow-hidden min-h-[400px] sm:min-h-[500px] lg:h-[calc(100vh-130px)] lg:sticky lg:top-[120px]">
                        <div className="flex-1 bg-gray-100 dark:bg-[#121212] relative overflow-hidden flex items-center justify-center min-h-[300px]">
                            {resultImages.length > 0 ? (
                                <div className="w-full h-full p-2 animate-fade-in flex flex-col items-center justify-center relative">
                                    <div className="w-full h-full flex items-center justify-center overflow-hidden">{sourceImage ? <ImageComparator originalImage={sourceImage.objectURL} resultImage={resultImages[selectedIndex]} /> : <img src={resultImages[selectedIndex]} alt="Result" className="max-w-full max-h-full object-contain" />}</div>
                                    <div className="absolute top-4 right-4 flex flex-col gap-2 z-10">
                                        <button onClick={() => handleDownload(resultImages[selectedIndex], 'sync')} className="p-1.5 sm:p-2 bg-white/90 dark:bg-black/50 rounded-xl shadow-lg hover:text-blue-600 backdrop-blur-sm border border-white/20"><span className="material-symbols-outlined text-base sm:text-lg">download</span></button>
                                        <button onClick={() => setPreviewImage(resultImages[selectedIndex])} className="p-1.5 sm:p-2 bg-white/90 dark:bg-black/50 rounded-xl shadow-lg hover:text-green-600 backdrop-blur-sm border border-white/20"><span className="material-symbols-outlined text-base sm:text-lg">zoom_in</span></button>
                                    </div>
                                </div>
                            ) : (
                                <div className="w-full h-full flex flex-col items-center justify-center opacity-20 select-none bg-main-bg dark:bg-[#121212] p-8 text-center">
                                    <span className="material-symbols-outlined text-4xl sm:text-6xl mb-4">view_in_ar</span>
                                    <p className="text-sm sm:text-base font-medium">{t('msg.no_result_render')}</p>
                                </div>
                            )}
                            {isLoading && (
                                <div className="absolute inset-0 bg-[#121212]/80 backdrop-blur-sm z-20 flex flex-col items-center justify-center p-6 text-center">
                                    <Spinner />
                                    <p className="text-white mt-4 font-bold animate-pulse text-sm sm:text-base">{statusMessage}</p>
                                </div>
                            )}
                        </div>
                        {resultImages.length > 0 && !isLoading && (
                            <div className="flex-shrink-0 w-full p-2 bg-white dark:bg-[#1A1A1A] border-t border-border-color dark:border-[#302839]">
                                <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide justify-center items-center">
                                    {resultImages.map((url, idx) => (
                                        <button key={url} onClick={() => setSelectedIndex(idx)} className={`flex-shrink-0 w-12 sm:w-16 md:w-20 aspect-square rounded-lg border-2 transition-all overflow-hidden ${selectedIndex === idx ? 'border-[#7f13ec] ring-2 ring-purple-500/20 scale-105' : 'border-transparent opacity-60 hover:opacity-100'}`}><img src={url} className="w-full h-full object-cover" alt={`Result ${idx + 1}`} /></button>
                                    ))}
                                </div>
                            </div>
                        )}
                    </main>
                </div>
            )}

            {/* --- TAB: CREATIVE --- */}
            {activeTab === 'creative' && !isCreativeModeSelected && (
                <div className="flex flex-col gap-6 py-6 px-4 animate-fade-in">
                    <div className="text-center max-w-2xl mx-auto">
                        <h2 className="text-xl sm:text-2xl font-bold text-gray-900 dark:text-white mb-2">{t('sync.creative.title')}</h2>
                        <p className="text-gray-500 dark:text-gray-400 text-sm">{t('sync.creative.desc')}</p>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6 max-w-[1400px] mx-auto w-full">
                        {creativeOptions.map(opt => (
                            <button key={opt.id} onClick={() => handleSelectCreativeOption(opt.id)} className="group relative flex flex-col h-72 sm:h-80 md:h-96 rounded-2xl overflow-hidden border border-gray-200 dark:border-[#302839] hover:border-[#7f13ec] transition-all shadow-sm hover:shadow-2xl text-left">
                                <div className="absolute inset-0 z-0"><img src={opt.bg} alt={opt.label} className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-1000" /><div className="absolute inset-0 bg-gradient-to-t from-black/95 via-black/40 to-black/20"></div></div>
                                <div className="relative z-10 flex flex-col h-full p-6 sm:p-8 justify-end">
                                    <div className="w-10 h-10 rounded-xl bg-white/10 backdrop-blur-xl border border-white/20 flex items-center justify-center mb-4 group-hover:bg-[#7f13ec] transition-all"><span className="material-symbols-outlined text-white">{opt.icon}</span></div>
                                    <h3 className="text-xl font-black text-white mb-1">{opt.label}</h3>
                                    <p className="text-xs text-gray-300 line-clamp-3 leading-relaxed opacity-90">{opt.longDesc || opt.desc}</p>
                                </div>
                            </button>
                        ))}
                    </div>
                </div>
            )}

            {activeTab === 'creative' && isCreativeModeSelected && (
                <div className="flex flex-col lg:grid lg:grid-cols-12 gap-4 sm:gap-6 p-2 sm:p-4 mt-2 items-start animate-fade-in">
                    <div className="w-full lg:col-span-4 flex flex-col gap-4 lg:sticky lg:top-[120px]">
                        <div className="bg-white dark:bg-[#1E1E1E] rounded-2xl p-4 shadow-sm border border-gray-200 dark:border-[#302839]">
                            <button onClick={handleBackToSelection} className="flex items-center gap-2 text-text-secondary dark:text-gray-400 hover:text-[#7f13ec] transition-all font-bold text-xs sm:text-sm mb-4"><span className="material-symbols-outlined">arrow_back</span><span>{t('common.back')}</span></button>
                            <div className="relative" ref={modeDropdownRef}>
                                <button onClick={() => setIsModeDropdownOpen(!isModeDropdownOpen)} className="w-full bg-[#7f13ec]/5 dark:bg-[#7f13ec]/10 p-3 rounded-2xl border border-[#7f13ec]/20 flex items-center justify-between">
                                    <div className="flex items-center gap-3">
                                        <div className="p-2 rounded-lg bg-[#7f13ec] text-white"><span className="material-symbols-outlined text-lg">{selectedOptionData?.icon}</span></div>
                                        <div className="text-left"><span className="block text-[8px] font-bold text-[#7f13ec] uppercase">CHẾ ĐỘ</span><span className="block text-xs sm:text-sm font-black text-text-primary dark:text-white">{selectedOptionData?.label}</span></div>
                                    </div>
                                    <span className={`material-symbols-outlined text-[#7f13ec] transition-transform ${isModeDropdownOpen ? 'rotate-180' : ''}`}>expand_more</span>
                                </button>
                                {isModeDropdownOpen && (
                                    <div className="absolute top-full left-0 right-0 mt-2 bg-white dark:bg-[#1E1E1E] rounded-xl shadow-2xl border border-border-color dark:border-[#302839] p-1.5 z-50 animate-fade-in">
                                        {creativeOptions.map(opt => (
                                            <button key={opt.id} onClick={() => { handleSelectCreativeOption(opt.id); setIsModeDropdownOpen(false); }} className={`w-full flex items-center gap-3 p-2 rounded-lg text-left ${creativeOption === opt.id ? 'bg-[#7f13ec]/10 text-[#7f13ec]' : 'hover:bg-gray-100 dark:hover:bg-[#2A2A2A] text-text-primary dark:text-gray-200'}`}>
                                                <span className="material-symbols-outlined text-lg">{opt.icon}</span><span className="text-xs sm:text-sm font-bold">{opt.label}</span>
                                            </button>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </div>
                        <div className="bg-white dark:bg-[#1E1E1E] rounded-2xl p-5 shadow-sm border border-gray-200 dark:border-[#302839] space-y-6">
                            <div><label className="text-xs font-bold text-gray-700 dark:text-gray-200 mb-2 block">{t('sync.workspace.source')}</label><ImageUpload onFileSelect={(f) => onStateChange({ sourceImage: f, creativeResults: {} })} previewUrl={sourceImage?.objectURL} /></div>
                            
                            {/* Improved Character Logic: Show only for interior, affecting prompts dynamically */}
                            {creativeOption === 'interior' && (
                                <div>
                                    <label className="text-xs font-bold text-gray-700 dark:text-gray-200 mb-2 block">{t('sync.workspace.char')}</label>
                                    <ImageUpload onFileSelect={(f) => onStateChange({ characterImage: f })} previewUrl={characterImage?.objectURL} />
                                    <p className="text-[9px] text-gray-400 mt-1.5 px-1">{t('sync.workspace.char_hint')}</p>
                                </div>
                            )}

                            <AspectRatioSelector value={aspectRatio} onChange={(v) => onStateChange({ aspectRatio: v })} />
                            <ResolutionSelector value={resolution} onChange={handleResolutionChange} />
                            <button 
                                onClick={handleGenerateBatch} 
                                disabled={isBatchGenerating || generatingViews.size > 0 || analyzingViews.size > 0 || !sourceImage} 
                                className="w-full py-4 bg-[#7f13ec] hover:bg-[#690fca] text-white font-bold rounded-xl shadow-lg flex items-center justify-center gap-2 transform active:scale-95 text-sm uppercase disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                {isBatchGenerating || generatingViews.size > 0 || analyzingViews.size > 0 ? <Spinner /> : <span className="material-symbols-outlined">auto_awesome</span>}
                                {isBatchGenerating || generatingViews.size > 0 || analyzingViews.size > 0 ? t('sync.workspace.generating_wait') : t('sync.workspace.btn_generate_batch').replace('{count}', currentSlots.length.toString())}
                            </button>
                        </div>
                    </div>

                    <div className="w-full lg:col-span-8 flex flex-col">
                        <div className="flex flex-col sm:flex-row justify-between items-center gap-3 mb-6">
                            <h3 className="text-xl font-bold text-gray-900 dark:text-white uppercase tracking-widest">{t('sync.workspace.result_title')}</h3>
                            {hasCreativeResults && (
                                <button onClick={handleDownloadAllCreative} className="flex items-center gap-2 px-5 py-2 bg-gray-900 dark:bg-white text-white dark:text-black hover:opacity-90 rounded-xl text-xs font-bold shadow-md">
                                    {isDownloading ? <Spinner /> : <span className="material-symbols-outlined text-lg">download_for_offline</span>}
                                    <span>TẢI TOÀN BỘ</span>
                                </button>
                            )}
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
                            {currentSlots.map(slot => {
                                const key = getResultKey(creativeOption, slot.id);
                                const resultUrl = creativeResults[key];
                                const isGenerating = generatingViews.has(key);
                                const isAnalyzing = analyzingViews.has(key);
                                const currentPrompt = creativePrompts[slot.id] || "";
                                return (
                                    <div key={slot.id} className="bg-white dark:bg-[#1E1E1E] rounded-2xl overflow-hidden border border-gray-200 dark:border-[#302839] hover:border-[#7f13ec]/50 transition-all duration-300 shadow-lg flex flex-col h-full group">
                                        <div className="aspect-square relative w-full bg-black/40 overflow-hidden">
                                            {resultUrl ? (
                                                <><img src={resultUrl} alt={slot.name} className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-110 cursor-pointer" onClick={() => handlePreview(resultUrl)} />
                                                <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-4 backdrop-blur-sm"><button onClick={() => handlePreview(resultUrl)} className="p-3 bg-white/10 hover:bg-white/20 rounded-full text-white backdrop-blur-md transition-all"><span className="material-symbols-outlined">zoom_in</span></button><button onClick={() => handleDownload(resultUrl, slot.name)} className="p-3 bg-white/10 hover:bg-white/20 rounded-full text-white backdrop-blur-md transition-all"><span className="material-symbols-outlined">download</span></button></div></>
                                            ) : (isGenerating || isAnalyzing) ? (
                                                <div className="absolute inset-0 flex flex-col items-center justify-center bg-gray-50 dark:bg-[#151515]"><Spinner /><span className="text-[10px] font-bold text-gray-500 mt-4 animate-pulse uppercase tracking-widest">{isAnalyzing ? "ĐANG PHÂN TÍCH..." : "ĐANG VẼ..."}</span></div>
                                            ) : (
                                                <div className="w-full h-full flex flex-col items-center justify-center opacity-30 p-4 text-center"><span className="material-symbols-outlined text-4xl mb-2">{slot.icon}</span><span className="text-[10px] font-bold uppercase">{slot.name}</span></div>
                                            )}
                                            <div className="absolute top-0 left-0 right-0 p-4 bg-gradient-to-b from-black/80 to-transparent pointer-events-none"><h4 className="text-xs font-bold text-white shadow-sm">{slot.name}</h4>{slot.sub && <p className="text-[8px] text-gray-300 font-medium uppercase">{slot.sub}</p>}</div>
                                        </div>
                                        <div className="p-4 border-t border-gray-100 dark:border-[#302839] bg-gray-50 dark:bg-[#222] flex flex-col gap-3 flex-grow">
                                            <div className="flex flex-col gap-1.5 flex-grow"><label className="text-[9px] font-bold text-gray-500 uppercase tracking-widest flex items-center gap-1"><span className="material-symbols-outlined text-[12px]">description</span> LỜI NHẮC AI</label><div className={`bg-white dark:bg-black/30 rounded-lg border border-gray-200 dark:border-white/5 overflow-hidden flex-grow shadow-inner transition-all duration-300 ${!currentPrompt ? 'h-10' : 'h-32 sm:h-40'}`}><textarea value={currentPrompt} onChange={(e) => onStateChange({ creativePrompts: { ...creativePrompts, [slot.id]: e.target.value } })} className="w-full text-[11px] font-medium text-text-primary dark:text-gray-200 leading-relaxed bg-transparent p-3 outline-none resize-none h-full" placeholder="..." /></div></div>
                                            <button onClick={() => handleGenerateSingleView(slot)} disabled={isGenerating || isAnalyzing || !sourceImage} className={`w-full py-2.5 rounded-xl text-[10px] font-bold transition-all flex items-center justify-center gap-2 ${resultUrl ? 'bg-gray-800 text-gray-300' : 'bg-[#7f13ec] text-white shadow-lg'}`}>{isGenerating || isAnalyzing ? <Spinner /> : <span className="material-symbols-outlined text-sm">{resultUrl ? 'refresh' : 'auto_fix_high'}</span>}{isGenerating || isAnalyzing ? (isAnalyzing ? "Analyzing..." : "Generating...") : (resultUrl ? t('sync.workspace.regenerate') : t('sync.workspace.generate'))}</button>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default ViewSync;
