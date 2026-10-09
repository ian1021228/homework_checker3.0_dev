/**
 * storageLimit.js - 教師端單一帳號資料總量上限、儲存分析圓餅圖與歷史紀錄滾動封存模組
 * 規格要求：
 * 1. 資料總量上限 (Data Size Cap)：計算 new Blob([JSON.stringify(appData)]).size
 *    空間上限為 3MB (規格範圍 2MB ～ 5MB)，80% 黃色提醒，100% 阻止新增作業。
 * 2. 業務物件數量上限：
 *    - 每位教師最多建立 25 個班級。
 *    - 每班每日作業最多 20 項。
 *    - 單筆聯絡簿與作業備註最多 200 個中文字，嚴格禁止嵌入圖片 Base64 編碼。
 * 3. 設定頁面圖形化圓餅圖 (Donut / Pie Chart) 與各種類別佔比分析。
 * 4. 歷史紀錄滾動修剪 (Rolling Retention)：最近 60 天保留點收明細，超過 60 天自動詢問清理。
 * 5. 學期結束一鍵歸檔清空：一鍵下載全班整學期 Excel/CSV 紀錄後自動清空歷史點收簿。
 */

import { state } from './state.js';
import { safeStringify, showToast, showAlertModal, formatDate, downloadFile } from './utils.js';
import { saveData } from './storage.js';
import { syncDataToCloud } from './firebase.js';

// 規格常數
export const MAX_STORAGE_BYTES = 3 * 1024 * 1024; // 3MB 上限 (規格 2MB~5MB)
export const WARN_THRESHOLD_RATIO = 0.8;          // 80% 警戒線
export const MAX_CLASSES_LIMIT = 25;               // 每位教師最多 25 個班級
export const MAX_DAILY_HOMEWORKS_LIMIT = 20;       // 每班每日最多 20 項作業
export const MAX_TEXT_LENGTH_LIMIT = 200;          // 單筆聯絡簿與作業備註最多 200 字
export const RETENTION_DAYS_LIMIT = 60;            // 點收明細保留 60 天

let hasShownWarningThisSession = false;

/**
 * 格式化位元組為易讀單位
 */
export function formatBytes(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return (bytes / Math.pow(k, i)).toFixed(2) + ' ' + sizes[i];
}

/**
 * 依各資料種類深度計算佔用空間位元組
 */
export function calculateStorageBreakdown() {
    const appData = state.appData || { classes: [], homeworks: [] };
    const fullJsonStr = safeStringify(appData);
    const totalBytes = new Blob([fullJsonStr]).size;
    const maxBytes = MAX_STORAGE_BYTES;
    const percentNum = ((totalBytes / maxBytes) * 100);
    const percent = Math.min(100, percentNum).toFixed(1);
    const isWarning = percentNum >= 80 && percentNum < 100;
    const isExceeded = percentNum >= 100;

    // 1. 作業點收明細 (homeworks)
    const hwBytes = new Blob([safeStringify(appData.homeworks || [])]).size;

    // 2. 班級聯絡簿 (contactBooks across classes)
    let contactBookItems = {};
    if (Array.isArray(appData.classes)) {
        appData.classes.forEach(c => {
            if (c.contactBook) contactBookItems[c.id || c.name] = c.contactBook;
        });
    }
    if (appData.contactBooks) {
        contactBookItems = { ...contactBookItems, ...appData.contactBooks };
    }
    const cbBytes = new Blob([safeStringify(contactBookItems)]).size;

    // 3. 學生成績紀錄 (examScores across classes or root)
    let scoreItems = {};
    if (Array.isArray(appData.classes)) {
        appData.classes.forEach(c => {
            if (c.examScores) scoreItems[c.id || c.name] = c.examScores;
        });
    }
    if (appData.examScores) {
        scoreItems = { ...scoreItems, ...appData.examScores };
    }
    const scoreBytes = new Blob([safeStringify(scoreItems)]).size;

    // 4. 出缺席與榮譽榜 (attendance, affairs, officers)
    let rollItems = {};
    if (Array.isArray(appData.classes)) {
        appData.classes.forEach(c => {
            if (c.attendance || c.officers || c.affairs) {
                rollItems[c.id || c.name] = {
                    attendance: c.attendance || [],
                    officers: c.officers || [],
                    affairs: c.affairs || []
                };
            }
        });
    }
    const rollBytes = new Blob([safeStringify(rollItems)]).size;

    // 5. 班級設定與學籍帳號基礎資訊 (classes basic info, settings, student pins)
    const classesBasic = (appData.classes || []).map(c => ({
        id: c.id,
        name: c.name,
        accessCode: c.accessCode,
        maxSeat: c.maxSeat || c.lastMaxSeat,
        missingSeats: c.missingSeats || c.lastMissingSeats,
        studentPins: c.studentPins || {},
        isReadOnly: c.isReadOnly || c.readOnly || false
    }));
    const metaBytes = Math.max(0, totalBytes - (hwBytes + cbBytes + scoreBytes + rollBytes));

    const categories = [
        {
            key: 'homework',
            name: '作業點收明細',
            bytes: hwBytes,
            color: '#6366f1', // Indigo
            tailwindColor: 'text-indigo-600',
            bgClass: 'bg-indigo-500',
            icon: 'fa-book-open'
        },
        {
            key: 'contact',
            name: '班級聯絡簿',
            bytes: cbBytes,
            color: '#10b981', // Emerald
            tailwindColor: 'text-emerald-600',
            bgClass: 'bg-emerald-500',
            icon: 'fa-chalkboard-user'
        },
        {
            key: 'scores',
            name: '學生成績資料',
            bytes: scoreBytes,
            color: '#f59e0b', // Amber
            tailwindColor: 'text-amber-600',
            bgClass: 'bg-amber-500',
            icon: 'fa-award'
        },
        {
            key: 'attendance',
            name: '出缺席與幹部',
            bytes: rollBytes,
            color: '#06b6d4', // Cyan
            tailwindColor: 'text-cyan-600',
            bgClass: 'bg-cyan-500',
            icon: 'fa-user-check'
        },
        {
            key: 'meta',
            name: '班級與學籍設定',
            bytes: metaBytes,
            color: '#8b5cf6', // Violet
            tailwindColor: 'text-violet-600',
            bgClass: 'bg-violet-500',
            icon: 'fa-school'
        }
    ];

    // 計算各自比例
    categories.forEach(item => {
        item.ratio = totalBytes > 0 ? (item.bytes / totalBytes) : 0;
        item.percent = (item.ratio * 100).toFixed(1);
    });

    return {
        totalBytes,
        maxBytes,
        percentNum,
        percent,
        isWarning,
        isExceeded,
        categories
    };
}

/**
 * 存檔前容量上限檢核
 */
export function checkStorageQuotaBeforeSave() {
    const { totalBytes, maxBytes, percentNum, isWarning, isExceeded } = calculateStorageBreakdown();

    if (isWarning && !hasShownWarningThisSession) {
        hasShownWarningThisSession = true;
        showToast(`空間警訊：您的雲端資料庫容量已達 ${percentNum.toFixed(1)}%（接近 3MB 上限），建議進入設定封存舊資料！`, 'warning', 6000);
    }

    return {
        totalBytes,
        maxBytes,
        isWarning,
        isExceeded
    };
}

/**
 * 業務規則驗證 1：教師班級數量上限 (最多 25 班)
 */
export function validateTeacherClassLimit(customCount, silent = false) {
    const count = typeof customCount === 'number' ? customCount : (state.appData?.classes?.length || 0);
    if (count >= MAX_CLASSES_LIMIT) {
        if (!silent) {
            showAlertModal(
                "班級建立數量已達上限",
                `依校園系統規範，每位教師帳號最多可建立 ${MAX_CLASSES_LIMIT} 個班級（目前已有 ${count} 班）。請先於班級管理封存或刪除不再使用的舊班級。`
            );
        }
        return false;
    }
    return true;
}

/**
 * 業務規則驗證 2：單班單日作業數量上限 (最多 20 項) & 空間滿載阻擋 & 唯讀防護
 */
export function validateAddHomeworkLimit(classId = state.currentClassId) {
    // 1. 檢查班級是否唯讀 (學校管理端鎖定)
    const curClass = state.appData?.classes?.find(c => c.id === classId);
    if (curClass && (curClass.isReadOnly || curClass.readOnly)) {
        showAlertModal(
            "班級唯讀保護模式",
            `本班級【${curClass.name || '此班級'}】已被學校管理端設定為「唯讀保護模式」，無法新增或修改作業！若有操作需求請洽詢學校行政管理處。`
        );
        return false;
    }

    // 2. 檢查空間總量是否達 100%
    const { totalBytes, maxBytes, isExceeded, percent } = calculateStorageBreakdown();
    if (isExceeded) {
        showAlertModal(
            "雲端儲存空間已滿 (100%)",
            `您的教師帳號空間已達上限（${formatBytes(totalBytes)} / ${formatBytes(maxBytes)}，${percent}%）。系統已依安全規範阻止新增作業，請前往「系統設定」執行【學期結束一鍵歸檔】或【清理 60 天舊點收紀錄】以釋放空間！`
        );
        return false;
    }

    // 3. 檢查每班每日作業數量上限 (最多 20 項)
    const todayStr = formatDate(new Date(), 'YYYY-MM-DD');
    const homeworks = state.appData?.homeworks || [];
    const todayHomeworkCount = homeworks.filter(h => {
        if (h.classId !== classId) return false;
        const hwDate = h.createdAt ? formatDate(new Date(h.createdAt), 'YYYY-MM-DD') : (h.date || '');
        return hwDate === todayStr;
    }).length;

    if (todayHomeworkCount >= MAX_DAILY_HOMEWORKS_LIMIT) {
        showAlertModal(
            "今日作業數量已達上限",
            `依教學點收規範，每班每日最多可建立 ${MAX_DAILY_HOMEWORKS_LIMIT} 項作業（本班今日已建立 ${todayHomeworkCount} 項）。建議合併相關項目，或於明日再次新增！`
        );
        return false;
    }

    return true;
}

/**
 * 業務規則驗證 3：文字欄位 200 字限制 & 嚴格禁止 Base64 圖片編碼
 */
export function validateTextContent(text = '', arg2 = '內容', arg3 = true, arg4 = true) {
    if (!text || typeof text !== 'string') return { valid: true, cleanText: '' };

    let maxLength = MAX_TEXT_LENGTH_LIMIT;
    let fieldName = '內容';
    let showAlert = true;

    if (typeof arg2 === 'number') {
        maxLength = arg2;
        fieldName = typeof arg3 === 'string' ? arg3 : '內容';
        showAlert = typeof arg4 === 'boolean' ? arg4 : true;
    } else if (typeof arg2 === 'string') {
        fieldName = arg2;
        showAlert = typeof arg3 === 'boolean' ? arg3 : true;
    } else if (typeof arg2 === 'boolean') {
        showAlert = arg2;
    }

    const trimmed = text.trim();

    // 1. 嚴格禁止嵌入圖片 Base64 編碼
    if (trimmed.includes('data:image/') || /data:\s*image\//i.test(trimmed)) {
        if (showAlert) {
            showAlertModal(
                "禁止嵌入圖片 Base64 編碼",
                `為維護資料庫空間安全與載入效能，聯絡簿與作業備註【嚴格禁止貼上圖片 Base64 編碼】！請以純文字說明作業內容。`
            );
        }
        return { valid: false, reason: 'base64_image' };
    }

    // 2. 限制單筆最多 200 個中文字
    if (trimmed.length > maxLength) {
        if (showAlert) {
            showAlertModal(
                "字數超出限制",
                `${fieldName}目前長度為 ${trimmed.length} 字，超過上限 ${maxLength} 字！請精簡文字後再行送出。`
            );
        }
        return { valid: false, reason: 'length_exceeded' };
    }

    return { valid: true, cleanText: trimmed };
}

/**
 * 歷史紀錄滾動修剪 (Rolling Retention)：
 * 檢測超過 60 天的點收明細，並主動詢問是否清理
 */
export function checkRollingRetention(manualTrigger = false) {
    const homeworks = state.appData?.homeworks || [];
    if (homeworks.length === 0) {
        if (manualTrigger) showToast("目前尚無作業點收紀錄，無須清理！", "info");
        return;
    }

    const now = Date.now();
    const sixtyDaysMs = RETENTION_DAYS_LIMIT * 24 * 60 * 60 * 1000;
    const thresholdDate = new Date(now - sixtyDaysMs);

    // 篩選超過 60 天的舊作業
    const oldHomeworks = homeworks.filter(h => {
        const itemDate = h.createdAt ? new Date(h.createdAt).getTime() : (h.date ? new Date(h.date).getTime() : 0);
        return itemDate > 0 && (now - itemDate) > sixtyDaysMs;
    });

    if (oldHomeworks.length === 0) {
        if (manualTrigger) {
            showToast("歷史紀錄皆在 60 天保留期內，目前點收狀態極佳！", "success");
        }
        return;
    }

    // 計算舊作業所佔 bytes
    const oldBytes = new Blob([safeStringify(oldHomeworks)]).size;
    const oldKb = (oldBytes / 1024).toFixed(1);

    // 構建詢問對話框
    const modalId = 'retention-cleanup-confirm-modal';
    let modal = document.getElementById(modalId);
    if (!modal) {
        modal = document.createElement('div');
        modal.id = modalId;
        modal.className = 'fixed inset-0 z-[150] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm hidden modal';
        document.body.appendChild(modal);
    }

    modal.innerHTML = `
        <div class="bg-white rounded-3xl p-6 sm:p-7 max-w-md w-full shadow-2xl border border-slate-100 space-y-5 text-left transform scale-100">
            <div class="flex items-center gap-3 pb-3 border-b border-slate-100">
                <span class="w-10 h-10 rounded-2xl bg-amber-50 text-amber-600 flex items-center justify-center text-lg border border-amber-200">
                    <i class="fa-solid fa-clock-rotate-left"></i>
                </span>
                <div>
                    <h3 class="text-lg font-black text-slate-900 whitespace-nowrap">歷史點收明細 60 天清理提醒</h3>
                    <p class="text-xs text-slate-500 font-medium">校園資料滾動修剪 · 釋放雲端資料庫容量</p>
                </div>
            </div>

            <div class="p-4 bg-amber-50/70 rounded-2xl border border-amber-200/80 space-y-2 text-xs text-amber-900 leading-relaxed font-medium">
                <div class="font-bold flex items-center gap-1.5 text-amber-950">
                    <i class="fa-solid fa-triangle-exclamation text-amber-600"></i>
                    <span>檢測到超過 60 天以前的作業點收明細：</span>
                </div>
                <p>• 舊作業項目：<b>${oldHomeworks.length}</b> 項（共計釋放約 <b>${oldKb} KB</b> 空間）</p>
                <p>• 最近 60 天內的所有作業點收狀態（已交、未交、待訂正）將<b>100% 完整保留</b>。</p>
            </div>

            <p class="text-xs text-slate-500 leading-relaxed font-medium">
                若需永久留存此批舊紀錄，建議選擇「先下載備份再清理」；亦可直接一鍵清空釋放空間。
            </p>

            <div class="flex flex-col gap-2 pt-2">
                <button type="button" id="btn-backup-and-clean-retention" class="w-full py-3 px-4 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-black text-xs sm:text-sm shadow-md shadow-indigo-600/20 transition-all flex items-center justify-center gap-2 cursor-pointer active:scale-98">
                    <i class="fa-solid fa-file-arrow-down"></i>
                    <span>先下載 CSV/Excel 備份並清理</span>
                </button>
                <button type="button" id="btn-direct-clean-retention" class="w-full py-2.5 px-4 rounded-xl bg-rose-50 hover:bg-rose-100 text-rose-700 font-bold text-xs border border-rose-200 transition-all flex items-center justify-center gap-1.5 cursor-pointer">
                    <i class="fa-solid fa-trash-can"></i>
                    <span>直接清除 ${oldHomeworks.length} 項舊資料</span>
                </button>
                <button type="button" id="btn-cancel-retention" class="w-full py-2 px-4 rounded-xl text-slate-500 hover:text-slate-700 font-bold text-xs text-center transition-colors">
                    暫時保留，稍後處理
                </button>
            </div>
        </div>
    `;

    modal.classList.remove('hidden');

    const closeModal = () => modal.classList.add('hidden');
    modal.querySelector('#btn-cancel-retention').addEventListener('click', closeModal);

    // 先備份再清理
    modal.querySelector('#btn-backup-and-clean-retention').addEventListener('click', async () => {
        exportOldHomeworksBackup(oldHomeworks);
        await performCleanOldHomeworks(oldHomeworks);
        closeModal();
    });

    // 直接清理
    modal.querySelector('#btn-direct-clean-retention').addEventListener('click', async () => {
        await performCleanOldHomeworks(oldHomeworks);
        closeModal();
    });
}

/**
 * 匯出 60 天舊作業備份
 */
function exportOldHomeworksBackup(oldHomeworks) {
    const headers = ['作業編號', '班級ID', '作業名稱', '建立日期', '應繳人數', '已繳座號', '未繳座號'];
    const rows = oldHomeworks.map(h => {
        const submitted = [];
        const unsubmitted = [];
        (h.students || []).forEach(s => {
            if (s.status === 'submitted' || s.status === 'completed' || s.status === 'read') {
                submitted.push(s.seat);
            } else {
                unsubmitted.push(s.seat);
            }
        });
        return [
            h.id || '',
            h.classId || '',
            `"${(h.name || '').replace(/"/g, '""')}"`,
            h.createdAt ? formatDate(new Date(h.createdAt), 'YYYY-MM-DD HH:mm') : '',
            h.studentCount || (h.students ? h.students.length : 0),
            `"${submitted.join(', ')}"`,
            `"${unsubmitted.join(', ')}"`
        ];
    });

    const csvContent = '\uFEFF' + [headers.join(','), ...rows.map(r => r.join(','))].join('\r\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const fileName = `歷史作業點收_超過60天歸檔備份_${formatDate(new Date(), 'YYYYMMDD')}.csv`;
    downloadFile(blob, fileName);
    showToast("已成功下載超過 60 天舊作業備份檔！", "success");
}

/**
 * 執行清理舊作業
 */
async function performCleanOldHomeworks(oldHomeworks) {
    const oldIds = new Set(oldHomeworks.map(h => h.id));
    state.appData.homeworks = (state.appData.homeworks || []).filter(h => !oldIds.has(h.id));
    await saveData();
    await syncDataToCloud();
    showToast(`已成功清理 ${oldHomeworks.length} 項超過 60 天之歷史作業明細！`, "success");
    // 更新設定頁面圓餅圖
    renderStoragePieChart('settings-storage-pie-container');
    if (window.renderHomeworkList) window.renderHomeworkList();
}

/**
 * 學期結束一鍵歸檔清空 (Archive & Clear Semester)：
 * 導師一鍵下載全班整學期的 Excel/CSV 紀錄後，系統自動清空歷史點收簿，迎接新學期。
 */
export async function archiveAndClearSemester() {
    const currentClass = state.appData?.classes?.find(c => c.id === state.currentClassId) || state.appData?.classes?.[0];
    const className = currentClass ? currentClass.name : '全班級';
    const homeworks = state.appData?.homeworks || [];

    if (homeworks.length === 0) {
        showToast("目前尚無作業點收紀錄，無須歸檔清空！", "info");
        return;
    }

    if (!confirm(`確定要執行【${className}】學期結束一鍵歸檔清空嗎？\n\n系統將為您：\n1. 自動打包並下載本學期「完整作業點收＋聯絡簿總清冊 (CSV/Excel)」\n2. 清空歷史點收作業與聯絡簿黑板（班級、學生座號與密碼將完整保留）\n3. 迎接新學期乾淨使用`)) {
        return;
    }

    // 1. 產生完整匯出檔案
    const timestampStr = formatDate(new Date(), 'YYYY-MM-DD');
    const headers = ['班級', '作業名稱', '建立日期', '座號', '點收狀態'];
    const rows = [];

    homeworks.forEach(hw => {
        const cls = state.appData?.classes?.find(c => c.id === hw.classId);
        const cName = cls ? cls.name : hw.classId;
        const dStr = hw.createdAt ? formatDate(new Date(hw.createdAt), 'YYYY-MM-DD HH:mm') : (hw.date || '');
        (hw.students || []).forEach(s => {
            rows.push([
                `"${cName}"`,
                `"${(hw.name || '').replace(/"/g, '""')}"`,
                `"${dStr}"`,
                s.seat,
                `"${s.status}"`
            ]);
        });
    });

    const csvContent = '\uFEFF' + [headers.join(','), ...rows.map(r => r.join(','))].join('\r\n');
    const csvBlob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    downloadFile(csvBlob, `${className}_整學期完整作業點收歸檔_${timestampStr}.csv`);

    // 2. 備份完整 JSON 檔案以防萬一
    const jsonBlob = new Blob([safeStringify(state.appData)], { type: 'application/json' });
    downloadFile(jsonBlob, `${className}_全系統原始資料庫歸檔備份_${timestampStr}.json`);

    // 3. 清空歷史點收簿 (清空 homeworks，重設各班聯絡簿，保留班級基本架構與座號)
    state.appData.homeworks = [];
    if (Array.isArray(state.appData.classes)) {
        state.appData.classes.forEach(c => {
            c.contactBook = {};
        });
    }
    state.appData.contactBooks = {};

    await saveData();
    await syncDataToCloud();

    showAlertModal(
        "學期歸檔與清空成功！",
        `已成功下載「${className}」本學期完整 Excel/CSV 總清冊與備份檔。\n歷史點收簿已歸零清空，班級、座號與學生專屬 PIN 碼完整保留，順利迎接新學期！`
    );

    // 重新渲染視圖
    renderStoragePieChart('settings-storage-pie-container');
    if (window.renderHomeworkList) window.renderHomeworkList();
    if (window.renderContactBookItems) window.renderContactBookItems();
}

/**
 * 繪製圖形化圓餅圖 (SVG Donut Chart) 與各種類別佔比分析
 * @param {string} containerId - 容器元素 ID
 */
export function renderStoragePieChart(containerId = 'settings-storage-pie-container') {
    const container = document.getElementById(containerId);
    if (!container) return;

    const data = calculateStorageBreakdown();
    const { totalBytes, maxBytes, percent, percentNum, isWarning, isExceeded, categories } = data;

    // 計算 SVG 圓環扇形數值
    const size = 180;
    const strokeWidth = 24;
    const radius = (size - strokeWidth) / 2;
    const circumference = 2 * Math.PI * radius;

    let accumulatedOffset = 0;
    const slicesSvg = categories.map((cat) => {
        const sliceLength = (cat.bytes / maxBytes) * circumference;
        const strokeDasharray = `${sliceLength} ${circumference - sliceLength}`;
        const strokeDashoffset = -accumulatedOffset;
        accumulatedOffset += sliceLength;

        if (cat.bytes === 0) return '';
        return `
            <circle cx="${size / 2}" cy="${size / 2}" r="${radius}"
                fill="none"
                stroke="${cat.color}"
                stroke-width="${strokeWidth}"
                stroke-dasharray="${strokeDasharray}"
                stroke-dashoffset="${strokeDashoffset}"
                class="transition-all duration-700 ease-out"
            />
        `;
    }).join('');

    // 狀態標籤
    let statusBadge = `
        <span class="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-black bg-emerald-50 text-emerald-700 border border-emerald-200">
            <span class="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
            空間充裕 (良好)
        </span>
    `;
    if (isExceeded) {
        statusBadge = `
            <span class="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-black bg-rose-50 text-rose-700 border border-rose-300 animate-pulse">
                <i class="fa-solid fa-triangle-exclamation text-rose-600"></i>
                容量達 100% (阻止新增)
            </span>
        `;
    } else if (isWarning) {
        statusBadge = `
            <span class="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-black bg-amber-50 text-amber-800 border border-amber-300">
                <i class="fa-solid fa-triangle-exclamation text-amber-600"></i>
                已達 80% 警戒線 (請封存)
            </span>
        `;
    }

    container.innerHTML = `
        <div class="space-y-5">
            <!-- 頂部容量總覽卡片 -->
            <div class="flex flex-col sm:flex-row items-center justify-between gap-5 p-4 rounded-2xl bg-slate-50/80 border border-slate-200/80">
                <!-- SVG 圓餅圖 (Donut Chart) -->
                <div class="relative w-[180px] h-[180px] shrink-0 flex items-center justify-center">
                    <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" class="-rotate-90 transform">
                        <!-- 底圈背景軌道 -->
                        <circle cx="${size / 2}" cy="${size / 2}" r="${radius}"
                            fill="none"
                            stroke="#e2e8f0"
                            stroke-width="${strokeWidth}"
                        />
                        <!-- 類別彩色扇形 -->
                        ${slicesSvg}
                    </svg>
                    <!-- 圓心文字 -->
                    <div class="absolute inset-0 flex flex-col items-center justify-center text-center pointer-events-none">
                        <span class="text-xs font-bold text-slate-400">已使用</span>
                        <span class="text-2xl font-black text-slate-900 tracking-tight font-mono">${percent}%</span>
                        <span class="text-[10px] font-bold text-slate-500 mt-0.5">${formatBytes(totalBytes)}</span>
                    </div>
                </div>

                <!-- 右側統計說明 -->
                <div class="flex-1 space-y-2.5 text-left w-full sm:w-auto">
                    <div class="flex items-center justify-between gap-2">
                        <span class="text-xs font-bold text-slate-500">雲端空間配額 (單一帳號)</span>
                        ${statusBadge}
                    </div>

                    <div>
                        <div class="flex items-baseline justify-between mb-1 text-xs font-mono">
                            <span class="font-bold text-slate-800">${formatBytes(totalBytes)}</span>
                            <span class="text-slate-400 font-medium">/ 上限 3.00 MB</span>
                        </div>
                        <!-- 進度條 -->
                        <div class="w-full h-2.5 rounded-full bg-slate-200 overflow-hidden">
                            <div class="h-full rounded-full transition-all duration-500 ${isExceeded ? 'bg-rose-500' : (isWarning ? 'bg-amber-500' : 'bg-indigo-600')}" style="width: ${percent}%;"></div>
                        </div>
                    </div>

                    <p class="text-[11px] text-slate-500 leading-snug font-medium">
                        系統在每次存檔前即時精準計算位元組數。當容量達到 80% 時發出警戒，達到 100% 時阻止新增作業以保護資料完整。
                    </p>
                </div>
            </div>

            <!-- 各種類佔用空間明細清單 -->
            <div class="space-y-2">
                <div class="flex items-center justify-between text-xs font-black text-slate-700 px-1">
                    <span>資料分類</span>
                    <span>佔用大小 / 佔比</span>
                </div>
                <div class="space-y-1.5">
                    ${categories.map(cat => `
                        <div class="flex items-center justify-between p-2.5 rounded-xl bg-white border border-slate-100 shadow-2xs text-xs">
                            <div class="flex items-center gap-2">
                                <span class="w-6 h-6 rounded-lg ${cat.bgClass}/20 ${cat.tailwindColor} flex items-center justify-center text-xs">
                                    <i class="fa-solid ${cat.icon}"></i>
                                </span>
                                <span class="font-bold text-slate-800">${cat.name}</span>
                            </div>
                            <div class="flex items-center gap-2 font-mono">
                                <span class="font-bold text-slate-700">${formatBytes(cat.bytes)}</span>
                                <span class="text-slate-400 text-[11px] min-w-[45px] text-right font-medium">(${cat.percent}%)</span>
                            </div>
                        </div>
                    `).join('')}
                </div>
            </div>

            <!-- 歷史紀錄滾動修剪與一鍵歸檔清空操作按鈕區 -->
            <div class="pt-3 border-t border-slate-100 grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <!-- 60 天自動降階清理按鈕 -->
                <button type="button" id="btn-trigger-60d-retention" class="w-full py-2.5 px-3 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs transition-all flex items-center justify-center gap-2 cursor-pointer shadow-2xs active:scale-98">
                    <i class="fa-solid fa-clock-rotate-left text-amber-600"></i>
                    <span>檢查 60 天以上舊紀錄</span>
                </button>

                <!-- 學期結束一鍵歸檔清空按鈕 -->
                <button type="button" id="btn-trigger-archive-semester" class="w-full py-2.5 px-3 rounded-xl bg-indigo-50 hover:bg-indigo-100 text-indigo-700 font-black text-xs transition-all flex items-center justify-center gap-2 cursor-pointer border border-indigo-200/80 active:scale-98">
                    <i class="fa-solid fa-box-archive text-indigo-600"></i>
                    <span>學期結束一鍵歸檔清空</span>
                </button>
            </div>
        </div>
    `;

    // 綁定按鈕點擊事件
    container.querySelector('#btn-trigger-60d-retention')?.addEventListener('click', () => {
        checkRollingRetention(true);
    });

    container.querySelector('#btn-trigger-archive-semester')?.addEventListener('click', () => {
        archiveAndClearSemester();
    });
}

// 暴露全域給視圖或外層腳本呼叫
window.calculateStorageBreakdown = calculateStorageBreakdown;
window.checkStorageQuotaBeforeSave = checkStorageQuotaBeforeSave;
window.renderStoragePieChart = renderStoragePieChart;
window.checkRollingRetention = checkRollingRetention;
window.archiveAndClearSemester = archiveAndClearSemester;
window.validateTeacherClassLimit = validateTeacherClassLimit;
window.validateAddHomeworkLimit = validateAddHomeworkLimit;
window.validateTextContent = validateTextContent;

// 命名空間物件
window.StorageLimit = {
    calculateStorageBreakdown,
    checkStorageQuotaBeforeSave,
    renderStoragePieChart,
    checkRollingRetention,
    archiveAndClearSemester,
    validateTeacherClassLimit,
    validateAddHomeworkLimit,
    validateTextContent,
    MAX_STORAGE_BYTES,
    WARN_THRESHOLD_RATIO,
    MAX_CLASSES_LIMIT,
    MAX_DAILY_HOMEWORKS_LIMIT,
    MAX_TEXT_LENGTH_LIMIT,
    RETENTION_DAYS_LIMIT
};
